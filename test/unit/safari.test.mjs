// Unit test for the Safari byte caps (H7). Safari cannot be run on the build machine, so this loads every module into a window whose navigator IS Safari
// (userAgent + Apple vendor), then drives the Safari pair through params.art.hd (safariAtlasMB / safariChunkMB) and proves the fallback to master 1 engages
// without error — for the HD atlas (sprites.get serves the master-1 entry) and for the HD chunk canvases (the chunk bake targets master 1) — and that the
// Chrome pair is not consulted. Also the H7 zoom-out rule: a zoom step that already targets master 1 re-bakes the stale master-2 chunks in place and never latches.
// Usage: node test/unit/safari.test.mjs   (exit 1 on any failure)
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
win.navigator = Object.assign({}, win.navigator, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', vendor: 'Apple Computer, Inc.' });
const ctx = vm.createContext(win);
for (const f of JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules) {
  try { vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
}
const BSU = win.BSU, S = BSU.sprites, R = BSU.render, H = BSU.headless, hd = BSU.params.art.hd;
const state = BSU.session.newGame({ seed: 11, skipTutorial: true, size: 64 }) || BSU.state;
const errs0 = BSU.errors.size;

// --- the caps ---------------------------------------------------------------------------------------------------
const caps = S.hdCaps();
ok(caps.safari === true && caps.atlasMB === hd.safariAtlasMB && caps.chunkMB === hd.safariChunkMB && hd.safariAtlasMB === 64 && hd.safariChunkMB === 80, 'hdCaps() on a Safari navigator is the Safari pair from params.art.hd (64 / 80 MB)');
const saveChrome = [hd.chromeAtlasMB, hd.chromeChunkMB]; hd.chromeAtlasMB = 1e6; hd.chromeChunkMB = 1e6;
ok(S.hdCaps().atlasMB === 64 && S.hdCaps().chunkMB === 80, 'the Chrome pair is not consulted under Safari');
hd.chromeAtlasMB = saveChrome[0]; hd.chromeChunkMB = saveChrome[1];

// --- the HD atlas cap (safariAtlasMB) -----------------------------------------------------------------------------
{
  S.registerHD('hdsaf', (c, spec) => { S.beginHD(c, 40, 30, spec); return { w: 40, h: 30, ox: -20, oy: -30 }; });
  const a2 = S.get('hdsaf:a', 0, 0, 2);
  ok(a2 && a2.zoom === 2 && S.hdFallback === false, 'under the Safari atlas cap an HD sprite bakes at master 2');
  const save = hd.safariAtlasMB; hd.safariAtlasMB = 0.0001;
  const before = S.count(); let threw = null, b2 = null, c2 = null;
  try { b2 = S.get('hdsaf:b', 0, 0, 2); c2 = S.get('hdsaf:c', 0, 0, 2); } catch (e) { threw = e; }
  ok(!threw && S.hdFallback === true, 'driving safariAtlasMB below the HD atlas bytes latches hdFallback without an error');
  ok(c2 && c2.zoom === 1 && c2.sw === 40 && S.count() <= before + 2, 'under the fallback an HD family serves the master-1 entry (ref.zoom 1)');
  S.registerPainter('pensaf', (c, spec) => { S.begin(c, 6, 6, spec.zoom); return { w: 6, h: 6, ox: -3, oy: -3 }; });
  ok(S.get('pensaf', 0, 0, 2).zoom === 2, 'a pen family still bakes at master 2');
  hd.safariAtlasMB = save; S.gc(1e9);
  ok(S.hdFallback === false && S.get('hdsaf:d', 0, 0, 2).zoom === 2, 'restoring the Safari cap and a gc clear the fallback: HD families bake at master 2 again');
  S.unregisterPainter('hdsaf');
}

// --- the HD chunk cap (safariChunkMB) -------------------------------------------------------------------------------
{
  R.reset(state, false); R.bakeStatReset(); R.panToTile(state.plot.founders.tx + 1, state.plot.founders.ty + 1, false); R.setZoom(1); for (let k = 0; k < 3; k++) H.render();
  R.setZoom(2); for (let k = 0; k < 50; k++) H.render();
  const i0 = R.hdInfo();
  ok(i0.chunkMaster === 2 && i0.hdChunks >= 3 && i0.fallback === false && i0.caps.safari === true && i0.caps.chunkMB === 80, 'at zoom 2 the chunks upgrade to master 2 under the 80 MB Safari cap (' + i0.hdChunks + ' HD chunks)');
  const save = hd.safariChunkMB; hd.safariChunkMB = 1;
  let fr = 0; while (!R.hdInfo().fallback && fr < 700) { H.render(); fr++; }   // the cap is checked after every master-2 bake and on the eviction cadence (every few hundred frames)
  const i1 = R.hdInfo();
  ok(i1.fallback === true && i1.chunkMaster === 1 && R.perf().hdFallback === true, 'safariChunkMB driven below the visible HD chunks: the fallback latches (frame ' + fr + ') and the chunk bake targets master 1');
  for (let k = 0; k < 40; k++) H.render();
  const i2 = R.hdInfo();
  ok(i2.hdChunks === 0 && i2.chunks > 0, 'the master-2 chunks are re-baked at master 1 and the view stays drawn (' + i2.chunks + ' live chunks, 0 HD)');
  hd.safariChunkMB = save;
  for (let k = 0; k < 80; k++) H.render();
  const i3 = R.hdInfo();
  ok(i3.fallback === false && i3.chunkMaster === 2 && i3.hdChunks >= 1, 'restoring the Safari chunk cap clears the latch and the upgrades resume');
  // H7: a zoom-OUT step already targets master 1 — the stale master-2 canvases are re-baked in place, the latch is never set (the next zoom-in is HD at once)
  hd.safariChunkMB = 1; R.setZoom(1);
  for (let k = 0; k < 130; k++) H.render();   // the cap check runs every 60 frames
  const i4 = R.hdInfo();
  ok(i4.chunkMaster === 1 && i4.fallback === false && i4.hdChunks === 0 && i4.chunks > 0, 'over the cap on a zoom-out step (master 1 already targeted): stale HD chunks re-baked at master 1, no latch (fallback ' + i4.fallback + ', HD ' + i4.hdChunks + ')');
  hd.safariChunkMB = save; R.setZoom(2);
  for (let k = 0; k < 60; k++) H.render();
  const i5 = R.hdInfo();
  ok(i5.chunkMaster === 2 && i5.fallback === false && i5.hdChunks >= 1, 'zooming back in is HD again without waiting for an idle eviction');
}

// --- UI refresh U6: the CSS closing transitions use `display … allow-discrete` (Chrome 117+, Safari 17.4+). A browser without it ignores the display transition and must still hide
// the element at once: every selector in such a rule needs `.hidden{display:none !important}` (global) plus its own `.hidden` look (opacity 0, pointer-events none) so the two paths end the same way.
{
  const css = readFileSync(join(root, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = []; let depth = 0, buf = '', sel = '';
  for (const ch of css) { if (ch === '{') { if (depth === 0) sel = buf.trim(); buf = ''; depth++; } else if (ch === '}') { depth--; if (depth === 0 && sel && !sel.startsWith('@')) rules.push({ sel, body: buf.trim() }); buf = ''; sel = ''; } else buf += ch; }
  const discrete = rules.filter((r) => /allow-discrete/.test(r.body));
  ok(discrete.length >= 1, 'style.css has ' + discrete.length + ' rule(s) with allow-discrete (the closing transitions)');
  ok(/(^|[^\w-])\.hidden\{display:none !important\}/.test(css), '.hidden{display:none !important} is the global fallback (no transition-behavior support → hidden at once)');
  ok(!/transition-behavior/.test(css) && !/@starting-style/.test(css), 'no transition-behavior longhand and no @starting-style: the discrete transition lives only inside the transition shorthand, so an older Safari drops just the display entry');
  const bad = [];
  for (const r of discrete) {
    const tr = (r.body.match(/transition:([^;]*)/) || ['', ''])[1];
    const props = tr.split(',').map((x) => x.trim().split(/\s+/)[0]);
    if (!/display [^,]*allow-discrete/.test(tr)) bad.push(r.sel + ': allow-discrete is not on the display entry');
    if (!props.every((p) => p === 'opacity' || p === 'transform' || p === 'display')) bad.push(r.sel + ': transitions ' + props.join(' ') + ' (only opacity / transform / display may close)');
    for (const one of r.sel.split(',').map((x) => x.trim())) {
      const look = rules.find((q) => q.sel.split(',').map((x) => x.trim()).includes(one + '.hidden') && /opacity:0/.test(q.body) && /pointer-events:none/.test(q.body));
      if (!look) bad.push(one + ': no `' + one + '.hidden` rule with opacity:0 and pointer-events:none');
      const over = rules.find((q) => q.sel.split(',').map((x) => x.trim()).includes(one + '.hidden') && /display:(?!none)/.test(q.body));
      if (over) bad.push(one + ': its .hidden rule overrides display:none (' + over.body.slice(0, 60) + ')');
    }
  }
  ok(bad.length === 0, 'every allow-discrete surface (' + discrete.map((r) => r.sel).join(' | ') + ') hides without the transition: display:none from .hidden, its own opacity 0 / pointer-events none look' + (bad.length ? '; BAD: ' + bad.join('; ') : ''));
  const insp = rules.find((r) => r.sel === '#inspect.hidden');
  ok(!!insp && /visibility:hidden/.test(insp.body) && /pointer-events:none/.test(insp.body) && !/allow-discrete/.test(css.slice(css.indexOf('#inspect{'), css.indexOf('#inspect{') + 1200)), '#inspect.hidden keeps display:flex for its own fold (visibility:hidden + pointer-events:none, no discrete transition), so it needs no allow-discrete fallback');
}
ok(BSU.errors.size === errs0, 'no BSU.error across the Safari checks');
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\n${passes} passed, 0 failed`);
process.exit(failures ? 1 : 0);
