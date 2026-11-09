// Unit test for the minimap + crowd pass: the minimap's cached base layer (src/js/render.js: mmSig / mmBase / M.minimap) and the stadium crowd sheet cache
// (src/js/render_fx.js: R.crowd, crBake, crGet).
// Minimap: the base is drawn once through BSU.brush at the canvas's DEVICE size and re-rendered ONLY when its signature changes (a building placed / completed, a tile's
// water class, a charter section bought, the canvas size, the HD toggle, an explicit invalidate), at both map sizes; a camera move redraws just the cheap overlay (one 1:1 blit
// and a few strokes, no gradient, no image data), and an unchanged overlay is not redrawn at all. The ui sizes the canvas 200 px x scale x dpr.
// Crowd: one sheet per (tier, state, density, size) is baked once and blitted 1:1 (one drawImage per frame, a second additive one at game night, none extra by day), a still
// camera bakes nothing, a moving size stretches the last sheet instead of baking every frame, the cache is bounded, and a real stadium game draws it through the football layer.
// Usage: node test/unit/minimap_crowd.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// --- source rules -------------------------------------------------------------------------------------------------------
const rendSrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8'), fxSrc = readFileSync(join(root, 'src', 'js', 'render_fx.js'), 'utf8'), css = readFileSync(join(root, 'src', 'style.css'), 'utf8');
const mmSrc = strip(rendSrc.slice(rendSrc.indexOf('// Minimap: a base layer'), rendSrc.indexOf('// Postcard (fallback')));
const crSrc = strip(fxSrc.slice(fxSrc.indexOf('// Crowd: a soft speckle SHEET'), fxSrc.indexOf('function crowdInWorld')));
ok(mmSrc.length > 4000 && crSrc.length > 3000, 'the minimap and crowd sources were found');
ok(!/Math\.random|ctx\.filter|shadowBlur|\.filter\s*=/.test(mmSrc + crSrc), 'no Math.random / ctx.filter / shadowBlur in the minimap or crowd code');
ok(/BSU\.brush/.test(mmSrc) && /B\.stroke\(|B\.poly\(|B\.softEllipse\(|B\.tone\(/.test(mmSrc) && !/putImageData[\s\S]*fillRect/.test(mmSrc), 'the minimap is drawn through BSU.brush (stroke / poly / softEllipse / tone)');
ok(!/fillRect/.test(mmSrc) && !/fillRect/.test(crSrc), 'no fillRect pixels left in the minimap or the crowd (the pixel-era marks)');
ok(!/pixelated/.test((css.match(/#minimap\{[^}]*\}/) || [''])[0]), '#minimap is no longer image-rendering: pixelated (the canvas is at device resolution)');
ok(Buffer.byteLength(css) <= 108 * 1024, `style.css <= 108 KB (${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)`);

// --- a recording context --------------------------------------------------------------------------------------------------
function rec() {
  const o = { log: [], n: {}, grads: 0 };
  const base = { globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt', fillStyle: '#000', strokeStyle: '#000', imageSmoothingEnabled: true };
  o.g = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => { o.grads++; return { addColorStop() {} }; };
      if (k === 'getLineDash') return () => [];
      if (typeof k !== 'string') return undefined;
      return (...a) => { o.n[k] = (o.n[k] || 0) + 1; if (k === 'drawImage' || k === 'stroke' || k === 'fill') o.log.push({ k: k, a: a, alpha: t.globalAlpha, comp: t.globalCompositeOperation, sm: t.imageSmoothingEnabled }); };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  o.reset = () => { o.log.length = 0; o.n = {}; o.grads = 0; };
  return o;
}
const total = (o) => Object.values(o.n).reduce((a, b) => a + b, 0);

function load() {
  const win = makeWindow(); win.BSU_FORCE_HEADLESS = true;
  const ctx = vm.createContext(win);
  for (const f of JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules) {
    const p = join(root, 'src', 'js', f); if (!existsSync(p)) continue;
    try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
  }
  return win;
}

// --- the minimap, at both map sizes ---------------------------------------------------------------------------------------
for (const size of [96, 64]) {
  const win = load(), BSU = win.BSU, R = BSU.render, S = BSU.sprites, H = BSU.headless;
  BSU.session.newGame({ seed: 42, skipTutorial: true, size });
  const s = BSU.state; for (let k = 0; k < 4; k++) H.render();
  const tag = size + ': ';
  const rc = rec(), mc = win.document.createElement('canvas'); mc.width = 200; mc.height = 200; mc.getContext = () => rc.g;
  R.attachMinimap(mc);
  const info = () => R.minimapInfo(), fr = () => { R.attachMinimap(null); H.render(); R.attachMinimap(mc); };   // frames run with the minimap detached: its own every-6th-frame call must not move the counters under test
  R.minimapInvalidate(); const i0 = info();
  R.minimap(s); let i1 = info();
  ok(i1.renders === i0.renders + 1 && i1.draws === i0.draws + 1 && i1.size === 200, tag + `the first call renders the base once, at the canvas size (${i1.size} px)`);
  ok(rc.n.drawImage === 1 && rc.log[0].a[0] && rc.log[0].a[1] === 0 && rc.log[0].a[2] === 0 && rc.grads === 0, tag + 'the canvas gets ONE 1:1 blit of the base, then the overlay (no gradient on the visible canvas)');
  rc.reset(); R.minimap(s); let i2 = info();
  ok(i2.renders === i1.renders && i2.draws === i1.draws && i2.skips === i1.skips + 1 && total(rc) === 0, tag + 'an unchanged frame redraws nothing: no base render, no overlay draw, not one context call');
  R.panBy(300, 120, false); fr(); rc.reset(); R.minimap(s); let i3 = info();
  ok(i3.renders === i2.renders && i3.draws === i2.draws + 1 && rc.n.drawImage === 1 && rc.grads === 0 && !rc.n.putImageData && !rc.n.createImageData && total(rc) < 80, tag + `a camera move redraws only the overlay: 1 blit + ${total(rc) - 1} calls, base untouched`);
  rc.reset(); R.minimap(s); R.minimap(s); R.minimap(s); ok(info().renders === i3.renders && total(rc) === 0, tag + 'repeated calls at rest stay free');
  // a building placed, then completed
  s.economy.cash = 90e6;
  const sp = H.findSpot('dorm'), pr = sp ? H.place('dorm', sp.x, sp.y) : { ok: false };
  ok(pr.ok !== false, tag + 'a dorm is placed for the cache test');
  R.minimap(s); let i4 = info();
  ok(i4.renders === i3.renders + 1, tag + 'placing a building re-renders the base once');
  R.minimap(s); ok(info().renders === i4.renders, tag + '... and only once');
  H.fastForwardDays(14); R.minimap(s); let i5 = info();
  ok(i5.renders >= i4.renders + 1, tag + `a building finishing (built = 1) re-renders the base (${i5.renders - i4.renders})`);
  R.minimap(s); const keep = info().renders; R.minimap(s); ok(info().renders === keep, tag + 'the base is stable again once nothing changes');
  // water: a land tile flooding crosses a class, a ripple inside a class does not
  const t = s.tiles; let li = -1; for (let i = 0; i < BSU.MAP.N; i++) if (t.type[i] === BSU.T.DRY && t.owner[i] < 0 && t.surface[i] === 0) { li = i; break; }
  const r0 = info().renders; t.depth[li] = 0.05; R.minimap(s); const r1 = info().renders;
  t.depth[li] = 0.12; R.minimap(s); const r2 = info().renders;
  t.depth[li] = 2.4; R.minimap(s); const r3 = info().renders;
  ok(r2 === r1 && r3 === r2 + 1, tag + `a flood crossing a depth class re-renders the base, a ripple inside the class does not (${r0} / ${r1} / ${r2} / ${r3})`);
  t.depth[li] = 0; R.minimap(s);
  // the charter (96 only: a 64 world has no sections)
  const secs = BSU.land.sections(s);
  if (size === 96) {
    const sec = secs.find((x) => x.forSale && !x.owned); ok(!!sec, tag + 'a section is for sale');
    const rb = info().renders; const cr = H.charter(sec.id, true); R.minimap(s);
    ok(cr && cr.ok !== false && info().renders === rb + 1, tag + 'buying a charter section re-renders the base (the State-land shade moves)');
  } else ok(secs.length === 0, tag + 'a 64 x 64 world has no sections and no State-land shade');
  // the canvas size (UI scale / dpr) and an explicit invalidate
  const rs = info().renders; mc.width = 400; mc.height = 400; R.minimap(s);
  ok(info().renders === rs + 1 && info().size === 400, tag + 'a bigger canvas (device resolution) re-renders the base at the new size (' + info().size + ' px)');
  R.minimap(s); ok(info().renders === rs + 1, tag + '... once');
  R.minimapInvalidate(); R.minimap(s); ok(info().renders === rs + 2, tag + 'minimapInvalidate() forces one base render');
  // the HD toggle: the terrain families off, a frame, the next call
  const sigHd = info().sig; ok(R.hdInfo().terrain === true && /\|1\|/.test(sigHd), tag + 'the signature carries the HD toggle (on)');
  const rh = info().renders; S.unregisterPainter('tile'); S.registerPainter('tile', (c, spec) => { S.begin(c, 64, 32, spec.zoom); return { w: 64, h: 32, ox: -32, oy: -16 }; }); fr(); R.minimap(s);
  ok(R.hdInfo().terrain === false && info().renders === rh + 1 && /\|0\|/.test(info().sig), tag + 'switching the HD terrain off re-renders the base (flat pen colours)');
  ok(BSU.errors.size === 0, tag + 'no BSU.error through any of it' + (BSU.errors.size ? ': ' + [...BSU.errors.keys()].join(', ') : ''));
  // the ui sizes the canvas in device pixels: 200 x the UI scale x dpr (<= 2)
  if (size === 96) {
    const U = BSU.ui; win.devicePixelRatio = 1; U.setUiScale(1);
    ok(U.el.minimap.width === 200, 'ui: the minimap canvas is 200 px at scale 100 % and dpr 1');
    win.devicePixelRatio = 2; U.setUiScale(1); ok(U.el.minimap.width === 400 && U.el.minimap.height === 400, 'ui: ... 400 px (device resolution) at dpr 2');
    win.devicePixelRatio = 3; U.setUiScale(1); ok(U.el.minimap.width === 400, 'ui: ... dpr is capped at 2, like the world canvas');
    win.devicePixelRatio = 1; U.setUiScale(1); ok(U.el.minimap.width === 200, 'ui: ... and back to 200 px');
    // the real attached canvas: the same cache, drawn at its own size
    R.attachMinimap(U.el.minimap); R.minimapInvalidate(); R.minimap(s); ok(info().size === 200, 'ui: the attached #minimap is rendered at its backing size');
  }
  // click / drag on the drawn map pans to the tile under the cursor (the inverse of the iso layout), at every UI scale / dpr: the drawn position of the four map corners,
  // the middle and Founders' Hall lands within one tile
  {
    const U = BSU.ui, el = U.el.minimap, W = BSU.MAP.W, panned = [], orig = R.panToTile, f = s.plot.founders;
    R.panToTile = function () { panned.push([arguments[0], arguments[1]]); return orig.apply(R, arguments); };
    const tiles = [[0, 0], [W - 1, 0], [0, W - 1], [W - 1, W - 1], [W >> 1, W >> 1], [f.tx + 1, f.ty + 1]];
    ok(typeof R.minimapToTile === 'function', tag + 'render.minimapToTile exists');
    for (const [dpr, scale] of [[1, 1], [2, 1], [2, 1.15], [1, 1.3], [2, 0.9]]) {
      win.devicePixelRatio = dpr; U.setUiScale(scale); R.attachMinimap(el); R.minimapInvalidate(); R.minimap(s);
      const css = 200 * U.uiScaleEffective(), I = info(), g = I.geo; Object.defineProperty(el, 'clientWidth', { value: css, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: css, configurable: true });
      const drawn = (tx, ty) => ({ offsetX: (g.cx0 + (tx - ty) * g.s) / I.size * css, offsetY: (g.oy + (tx + ty + 1) * g.s / 2) / I.size * css, preventDefault() {}, type: 'pointerdown' });
      let worst = 0;
      for (const [tx, ty] of tiles) { panned.length = 0; el.dispatchEvent(drawn(tx, ty)); el.dispatchEvent({ type: 'pointerup' }); const p = panned[0]; worst = Math.max(worst, p ? Math.max(Math.abs(p[0] - tx), Math.abs(p[1] - ty)) : 99); }
      ok(worst <= 1, tag + `click at the drawn position of 4 corners + middle + Founders' Hall (${f.tx + 1}, ${f.ty + 1}) pans within one tile (worst ${worst.toFixed(2)}; dpr ${dpr}, UI scale ${U.uiScaleEffective()}, canvas ${I.size} px)`);
      panned.length = 0; el.dispatchEvent(drawn(10, 10)); el.dispatchEvent(Object.assign(drawn(W - 12, 20), { type: 'pointermove' })); el.dispatchEvent({ type: 'pointerup' }); el.dispatchEvent(Object.assign(drawn(5, 5), { type: 'pointermove' }));
      ok(panned.length === 2 && Math.abs(panned[1][0] - (W - 12)) <= 1 && Math.abs(panned[1][1] - 20) <= 1, tag + 'a drag keeps panning to the tile under the pointer, and stops on pointerup');
    }
    ok(R.minimapToTile(-1, -1).tx === 0 && R.minimapToTile(2, 2).ty === W - 1, tag + 'a point off the canvas clamps to the map');
    R.panToTile = orig; win.devicePixelRatio = 1; U.setUiScale(1);
  }
}

// --- the crowd sheet cache ---------------------------------------------------------------------------------------------------
{
  const win = load(), BSU = win.BSU, R = BSU.render;
  const rc = rec(), g = rc.g, rect = { x: 100.4, y: 80.6, w: 380, h: 210 };
  R.view.dpr = 1; R.crowdClear();
  ok(typeof R.crowd === 'function' && typeof R.crowdStats === 'function' && typeof R.crowdClear === 'function', 'render_fx exposes crowd / crowdStats / crowdClear');
  R.crowd(g, rect, 0.5, 10, false, { tier: 2, night: 0 }); let st = R.crowdStats(); const d0 = rc.log.filter((c) => c.k === 'drawImage');
  ok(st.bakes === 1 && st.sheets === 1 && d0.length === 1, `day, dry: one sheet baked, ONE drawImage (${d0.length}), ${st.mb} MB`);
  ok(d0[0].a[3] === d0[0].a[7] && d0[0].a[4] === d0[0].a[8] && d0[0].a[7] === 384 && d0[0].a[8] === 216 && d0[0].comp === 'source-over' && d0[0].alpha === 1, 'the blit is 1:1 (the box snaps up to 8 device px: 380 x 210 -> 384 x 216), source-over');
  ok(Math.abs(d0[0].a[5] - 100.4) < 1 && Math.abs(d0[0].a[6] - 80.6) < 1, 'it lands on the rect (device-pixel snapped)');
  rc.reset(); for (let k = 0; k < 150; k++) R.crowd(g, rect, 0.5, 11 + k, false, { tier: 2, night: 0 });
  st = R.crowdStats(); ok(st.bakes === 1 && st.hits >= 150 && rc.n.drawImage === 150 && rc.grads === 0, `a still camera over 150 frames: 0 bakes, exactly one drawImage a frame (${rc.n.drawImage}), no gradient`);
  ok(Math.abs(rc.log[0].a[5] - rc.log[149].a[5]) < 1e-9 && rc.log[0].sm === rc.log[149].sm, 'the day sheet does not move or shimmer (static between frames)');
  // fill buckets (eighths), tiers, rain, night
  R.crowd(g, rect, 0.52, 1, false, { tier: 2, night: 0 }); ok(R.crowdStats().bakes === 1, 'attendance 50 % and 52 % share a sheet (eighths)');
  R.crowd(g, rect, 0.8, 1, false, { tier: 2, night: 0 }); ok(R.crowdStats().bakes === 2, 'a fuller crowd (80 %) bakes its own sheet');
  R.crowd(g, rect, 0.5, 1, false, { tier: 3, night: 0 }); ok(R.crowdStats().bakes === 3, 'another tier bakes its own sheet');
  rc.reset(); R.crowd(g, rect, 0.5, 1, true, { tier: 2, night: 0 }); ok(R.crowdStats().bakes === 4 && rc.n.drawImage === 1, 'rain bakes the poncho sheet (one draw)');
  R.crowd(g, rect, 0.5, 1, true, { tier: 2, night: 1 }); ok(rc.n.drawImage === 2 && R.crowdStats().bakes === 5, 'rain at night: the poncho sheet lit, still no glint layer (wet ponchos do not sparkle)');
  rc.reset(); R.crowd(g, rect, 0.5, 7, false, { tier: 2, night: 1 }); const nb = R.crowdStats().bakes, dn = rc.log.filter((c) => c.k === 'drawImage');
  ok(dn.length === 2 && dn[0].comp === 'source-over' && dn[1].comp === 'lighter' && dn[1].a[3] === 384 && dn[1].a[7] === 384, 'game night: the lit sheet, then ONE additive glint blit (also 1:1): two drawImage calls');
  ok(nb === 7, `night baked its two sheets once (base + glint): ${nb} bakes in all`);
  rc.reset(); const o1 = []; for (let k = 0; k < 120; k++) { R.crowd(g, rect, 0.5, 100 + k * 6, false, { tier: 2, night: 1 }); o1.push(rc.log[rc.log.length - 1].a[1]); }
  ok(R.crowdStats().bakes === nb && rc.n.drawImage === 240 && rc.grads === 0, 'a lit night frame costs two blits and bakes nothing, 120 frames running');
  ok(new Set(o1).size > 20 && o1.every((x) => x >= 0), `the glint layer drifts: ${new Set(o1).size} distinct source offsets over 120 frames`);
  const am = rc.log.filter((c) => c.comp === 'lighter').map((c) => c.alpha); ok(Math.max(...am) - Math.min(...am) > 0.05 && Math.min(...am) > 0.3 && Math.max(...am) <= 0.8, 'its alpha breathes slowly (' + Math.min(...am).toFixed(2) + ' - ' + Math.max(...am).toFixed(2) + ')');
  R.crowd(g, rect, 0, 1, false, { tier: 2, night: 1 }); rc.reset(); R.crowd(g, rect, 0, 1, false, { tier: 2 }); ok(rc.n.drawImage === undefined, 'an empty crowd draws nothing');
  rc.reset(); R.crowd(null, rect, 0.5, 1, false); R.crowd(g, null, 0.5, 1, false); R.crowd(g, { x: 0, y: 0, w: 0, h: 10 }, 0.5, 1, false); R.crowd(g, rect, NaN, NaN, false, {}); ok(true, 'bad arguments never throw');
  // the stands box (o.full) is its own sheet; a bowl rect keeps its ellipse
  const nf = R.crowdStats().bakes; R.crowd(g, rect, 0.5, 1, false, { tier: 2, night: 0, full: true }); ok(R.crowdStats().bakes === nf + 1, 'a stands box (full) is a separate sheet from a bowl rect');
  // dpr 2: device-pixel sizes, the blit lands on css px
  R.crowdClear(); R.view.dpr = 2; rc.reset(); R.crowd(g, { x: 50, y: 40, w: 300, h: 150 }, 0.5, 1, false, { tier: 1, night: 0 });
  const dd = rc.log.find((c) => c.k === 'drawImage'); ok(dd && dd.a[3] === 600 && dd.a[4] === 304 && dd.a[7] === 300 && Math.abs(dd.a[8] - 152) < 1e-9, 'dpr 2: the sheet is 600 x 304 device px, drawn 300 x 152 css px (1:1 on the device)');
  R.view.dpr = 1; R.crowdClear();
  // a size that keeps moving (a zoom) stretches the last sheet and bakes only once it holds
  rc.reset(); for (let k = 0; k < 20; k++) R.crowd(g, { x: 100, y: 80, w: 300 + k * 12, h: 160 + k * 6 }, 0.5, k, false, { tier: 2, night: 0 });
  st = R.crowdStats(); const dz = rc.log.filter((c) => c.k === 'drawImage');
  ok(st.bakes === 1 && st.scaled === 19 && dz[19].a[7] !== dz[19].a[3] && dz[19].sm === true, `a size changing every frame (20 steps): 1 bake, ${st.scaled} stretched draws (smoothed), not a bake per frame`);
  rc.reset(); for (let k = 0; k < 6; k++) R.crowd(g, { x: 100, y: 80, w: 540, h: 274 }, 0.5, k, false, { tier: 2, night: 0 });
  const ds = rc.log.filter((c) => c.k === 'drawImage'); st = R.crowdStats();
  ok(st.bakes === 2 && ds[5].a[7] === ds[5].a[3] && ds[5].a[3] === 544, 'held for 4 frames: the exact sheet is baked once and drawn 1:1 again');
  // a huge box is pixel-budgeted and bounded; the cache evicts the least recently used
  R.crowdClear(); rc.reset(); R.crowd(g, { x: 0, y: 0, w: 3000, h: 2000 }, 0.5, 1, false, { tier: 3, night: 0 });
  const dh = rc.log.find((c) => c.k === 'drawImage'); ok(dh && dh.a[3] * dh.a[4] <= 1.55e6 && dh.a[7] === 3000 && dh.a[3] < dh.a[7], `a 3000 x 2000 box is baked under the 1.5 Mpx budget (${dh.a[3]} x ${dh.a[4]}) and stretched`);
  R.crowdClear(); for (let k = 0; k < 14; k++) for (let f = 0; f < 6; f++) R.crowd(g, { x: 0, y: 0, w: 1100 + k * 40, h: 700 }, 0.5, f, false, { tier: 3, night: 0 });
  st = R.crowdStats(); ok(st.bakes >= 12 && st.mb <= 28.01 && st.sheets <= 24 && st.sheets < st.bakes, `the cache is bounded: ${st.bakes} bakes, ${st.sheets} sheets held, ${st.mb} MB <= 28`);
  R.crowdClear(); st = R.crowdStats(); ok(st.sheets === 0 && st.mb === 0 && st.bakes === 0, 'crowdClear empties the cache and the counters');
  ok(BSU.errors.size === 0, 'no BSU.error from the crowd' + (BSU.errors.size ? ': ' + [...BSU.errors.keys()].join(', ') : ''));
}

// --- a real stadium game: the football layer draws the crowd through the sheet cache -------------------------------------------------
{
  const win = load(), BSU = win.BSU, R = BSU.render, H = BSU.headless;
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 96 });
  const s = BSU.state; for (let k = 0; k < 3; k++) H.render();
  BSU.progress.unlocked = () => true; BSU.progress.unlockOk = () => true; s.economy.cash = 5e9; s.economy.students = 1800;
  const TPD = BSU.params.time.ticksPerDay;
  for (const id of ['practice_field', 'stadium']) { const sp = H.findSpot(id); if (sp) H.place(id, sp.x, sp.y); }
  H.tick(25 * TPD);
  const stad = BSU.buildings.list(s, 'stadium')[0];
  ok(!!stad && stad.built >= 1, 'a stadium stands for the game test');
  if (stad) { BSU.buildings.upgrade(s, stad.id); H.tick(40 * TPD); }
  R.crowdClear(); BSU.sports.setNight(s, false);
  const ph = BSU.sports.playHome(s); ok(ph && ph.ok, 'a watched home game starts: ' + JSON.stringify(ph));
  if (stad) R.panToTile(stad.tx + stad.w / 2, stad.ty + stad.h / 2, false);
  H.tick(120); for (let k = 0; k < 6; k++) H.render();
  const fi = R.fbInfo(), c0 = R.crowdStats();
  ok(fi.active && fi.players === 22 && fi.venue >= 0, 'the football layer is live: ' + JSON.stringify({ active: fi.active, players: fi.players, venue: fi.venue }));
  ok(c0.bakes >= 1 && c0.hits >= 1, `the stadium crowd is drawn through the sheet cache (${c0.bakes} bake(s), ${c0.hits} hit(s), ${c0.mb} MB)`);
  const t0 = R.terrainCacheInfo(); for (let k = 0; k < 60; k++) H.render();
  const c1 = R.crowdStats(), hi = R.hdInfo();
  ok(c1.bakes === c0.bakes && c1.hits > c0.hits, `60 more frames with the camera still: the crowd bakes nothing (${c1.bakes} bakes) and hits the cache ${c1.hits - c0.hits} times`);
  ok(R.terrainCacheInfo().builds === t0.builds && hi.bake !== undefined, 'the crowd does not touch the terrain composite (no rebuilds while the camera is still)');
  ok(BSU.errors.size === 0, 'no BSU.error through the game frames' + (BSU.errors.size ? ': ' + [...BSU.errors.keys()].join(', ') : ''));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
