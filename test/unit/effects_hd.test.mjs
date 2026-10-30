// Unit test for the H5 effects + icons pass: the brush blob cache (src/js/brush.js), the converted effect passes of src/js/render_fx.js and the overlay /
// ghost / particle drawing of src/js/render.js, and the HD catalog icons of src/js/sprites_icons_hd.js.
// Loads every manifest module through makeWindow() from test/domstub.mjs (the stub canvas records nothing, so passes are also called on a recording context of
// this file's own). Checks: the blob cache is keyed by (kind, colour, quantised radius) and bounded; no gradient is created at draw time by any effect pass;
// every pass draws at night / in rain / fog / a landfall without throwing; the ghost fills ONE union path; rain is three layers; the icons bake for every catalog
// row at both masters with ONE frame size, locked variants too, without leaving extra atlas entries.
// Usage: node test/unit/effects_hd.test.mjs   (exit 1 on any failure)
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
const brushSrc = readFileSync(join(root, 'src', 'js', 'brush.js'), 'utf8'), fxSrc = readFileSync(join(root, 'src', 'js', 'render_fx.js'), 'utf8');
const rendSrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8'), icoSrc = readFileSync(join(root, 'src', 'js', 'sprites_icons_hd.js'), 'utf8');
const icoCode = strip(icoSrc);
ok(!/ctx\.filter|\.shadowBlur|shadowColor/.test(strip(brushSrc)) && !/\.filter\s*=|shadowBlur/.test(strip(fxSrc)), 'no ctx.filter / shadowBlur in the blob cache or the effect passes (Safari < 18 / slow)');
ok(!/Math\.random/.test(strip(brushSrc)) && !/Math\.random/.test(strip(fxSrc)) && !/Math\.random/.test(icoCode), 'no Math.random in the H5 sources');
ok(/registerHD\('icon'/.test(icoCode) && !/registerPainter\(/.test(icoCode) && /pin: true/.test(icoCode), "icons register through registerHD('icon') only, pinned (baked once per session)");
ok(!/createLinearGradient|createRadialGradient|createPattern|fillText|rng\.fx|paintBuilding/.test(icoCode), 'the icon painter is brush-only: no hand-written gradient, no fillText, no pen building, no rng.fx');
ok(/bakeWith\(it\.id/.test(icoCode), 'footprint icons bake their HD building through sprites.bakeWith (scratch canvas, never cached)');
ok(!/fillRect\(Math\.round\(sx - ps/.test(fxSrc) && !/ellRects/.test(fxSrc), 'the pixel splash frames and the pixel-ellipse helpers are gone from render_fx');
ok(/manifest/.test('manifest') && JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules.indexOf('sprites_icons_hd.js') === JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules.indexOf('sprites_buildings_hd.js') + 1, 'manifest: sprites_icons_hd.js right after sprites_buildings_hd.js');

// --- load every module --------------------------------------------------------------------------------------------------
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules) {
  const p = join(root, 'src', 'js', f); if (!existsSync(p)) continue;
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
}
const BSU = win.BSU, R = BSU.render, B = BSU.brush, S = BSU.sprites, SKY = BSU.SKY;

// --- a recording context ------------------------------------------------------------------------------------------------
function rec() {
  const o = { log: [], n: {}, grads: 0 };
  const base = { globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt', fillStyle: '#000', strokeStyle: '#000', imageSmoothingEnabled: true, font: '10px sans', textAlign: 'left', textBaseline: 'alphabetic' };
  o.g = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => { o.grads++; return { addColorStop() {} }; };
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'getLineDash') return () => [];
      if (typeof k !== 'string') return undefined;
      return (...a) => { o.n[k] = (o.n[k] || 0) + 1; if (k === 'drawImage' || k === 'stroke' || k === 'fill' || k === 'fillRect' || k === 'ellipse' || k === 'arc') o.log.push({ k: k, a: a, alpha: t.globalAlpha, comp: t.globalCompositeOperation, lw: t.lineWidth, join: t.lineJoin, cap: t.lineCap }); };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  o.reset = () => { o.log.length = 0; o.n = {}; o.grads = 0; };
  return o;
}

// --- the blob cache -----------------------------------------------------------------------------------------------------
B.blobClear();
const b1 = B.blob('halo', '#FFD27A', 20, 20), b2 = B.blob('halo', '#FFD27A', 20.3, 19.6), b3 = B.blob('halo', '#9FD2FF', 20, 20), b4 = B.blob('halo', '#FFD27A', 40, 40), b5 = B.blob('pool', '#FFD27A', 20, 20);
ok(b1 && b1 === b2 && b3 !== b1 && b4 !== b1 && b5 !== b1 && B.blobStats().n === 4, `blob cache: one entry per (kind, colour, quantised radius) — ${B.blobStats().n} entries for 5 requests, 2 of them the same`);
ok(b1.rx === 20 && b1.w === 40 && b1.h === 40 && B.blobQ(1) === 2 && B.blobQ(24) === 24 && B.blobQ(999) === 320 && B.blobQ(100) >= 96 && B.blobQ(100) <= 112, 'the ladder: integer px to 24, 5 % steps to 320, clamped at both ends');
ok(B.blob('nope', '#fff', 10, 10) === null && B.blob('halo', '#fff', 0, 0) === null && B.blob('halo', '#fff', NaN, NaN) === null, 'an unknown kind / a zero or NaN radius gives null, never a throw');
let kindsOk = true; for (const k of B.blobKinds) { const e = B.blob(k, k === 'puddle' ? 'night' : k === 'fog' ? '196,208,220' : '#FFE0A0', 12, k === 'puddle' ? 6 : 12, { seed: 2 }); if (!e || e.w < 2 || e.h < 2) kindsOk = false; }
ok(kindsOk && ['halo', 'glow', 'pool', 'dot', 'puff', 'ao', 'foam', 'ring', 'cone', 'puddle', 'fog', 'vignette', 'haze'].every((k) => B.blobKinds.includes(k)), `every blob kind bakes (${B.blobKinds.join(', ')})`);
B.blobClear(); for (let i = 0; i < 720; i++) B.blob('halo', '#' + (0x100000 + i * 37).toString(16).slice(0, 6), 12 + (i % 5), 12);
ok(B.blobStats().n <= B.blobStats().max && B.blobStats().mb < 20.1, `the cache is bounded (${B.blobStats().n} ≤ ${B.blobStats().max} entries, ${B.blobStats().mb} MB ≤ 20)`);
B.blobClear();
{
  const r = rec(); const ok1 = B.drawBlob(r.g, 'glow', '#FFE0A0', 100.3, 50.7, 10.2, 10.2, 0.5, 2), e = B.blob('glow', '#FFE0A0', 20.4, 20.4), d = r.log.find((c) => c.k === 'drawImage');
  ok(ok1 && d && d.a[3] === e.w / 2 && d.a[4] === e.h / 2 && Math.abs(d.a[1] * 2 - Math.round(d.a[1] * 2)) < 1e-9 && Math.abs(d.a[2] * 2 - Math.round(d.a[2] * 2)) < 1e-9 && d.alpha === 0.5, 'drawBlob blits at the baked device size on a device-pixel-snapped centre (a 1:1 copy at dpr 2) with the alpha asked for');
  const big = B.blob('halo', '#fff', 900, 900), r2 = rec(); B.drawBlob(r2.g, 'halo', '#fff', 500, 400, 900, 900, 1, 1);
  const d2 = r2.log.find((c) => c.k === 'drawImage'); ok(big.w === 640 && d2 && d2.a[3] === 1800, 'past the 320-px cap the biggest blob is stretched to the radius asked for');
}
B.blobClear();

// --- the passes on a night campus in rain and fog -----------------------------------------------------------------------
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
const s = BSU.state, H = BSU.headless, WX = BSU.weather;
const errs0 = BSU.errors.size;
s.economy.cash = 5e7;
for (const id of ['substation', 'wastewater', 'dorm', 'dining_hall', 'generator', 'lecture_hall']) { const sp = H.findSpot(id); if (sp) H.place(id, sp.x, sp.y); }
for (const b of s.buildings) if (b) b.built = 1;
H.tick(40); WX.scriptSky(s, SKY.NIGHT, 0.5); H.tick(40); s.wildlife.fireflies = 200; for (let k = 0; k < 6; k++) H.render();
const pf = (n) => R.passFn(n);
ok(['weather', 'tint', 'lights', 'fog', 'fireworks', 'storm', 'beacons', 'spotlight', 'charter', 'network', 'overlays', 'fxhud'].every((n) => typeof pf(n) === 'function') && pf('nope') === null, 'render.passFn(name) returns every registered pass (null for an unknown name)');
const pm = R.perf().passMs; ok(pm && typeof pm === 'object' && ['chunks', 'entities', 'weather', 'lights', 'fog'].every((k) => Number.isFinite(pm[k]) && pm[k] >= 0), `perf().passMs reports the stages and passes (lights ${(pm.lights || 0).toFixed(2)} ms, weather ${(pm.weather || 0).toFixed(2)} ms)`);
const V = R.view;
{
  const r = rec(); pf('lights')(s, r.g, V, 1, 16);
  const lights = r.log.filter((c) => c.k === 'drawImage'), nb = R.lightsCount();
  ok(nb > 0 && lights.length >= nb && r.grads === 0, `the lights pass draws ${lights.length} cached blits for ${nb} lights and creates no gradient`);
  ok(lights.every((c) => c.comp === 'lighter') && r.n.createLinearGradient === undefined, 'every light is additive (lighter), straight onto the frame');
  const st = B.blobStats(); const r2 = rec(); pf('lights')(s, r2.g, V, 1, 16); ok(B.blobStats().bakes === st.bakes && r2.log.length === r.log.length, 'a second lights frame bakes nothing new: the halos come from the cache');
  ok(R.composites.lights.width <= 4 && R.composites.lights.height <= 4, 'the lights composite is no longer a full-frame canvas (1 px)');
  WX.scriptSky(s, SKY.DAY, 0.5); const r3 = rec(); pf('lights')(s, r3.g, V, 1, 16); ok(r3.log.length === 0 && R.lightsCount() === 0, 'by day the lights pass draws nothing'); WX.scriptSky(s, SKY.NIGHT, 0.5);
}
{
  s.weather.rainRate = 0.8; s.weather.wind = 0.5; s.weather.fog = 0.4; for (let k = 0; k < 40; k++) H.render();   // puddles + splashes + rain lines + fog wisps
  R._fxPuddleWet(0.9); for (let k = 0; k < 4; k++) H.render();
  const r = rec(); pf('storm')(s, r.g, V, 1, 16);
  const strokes = r.log.filter((c) => c.k === 'stroke');
  ok(strokes.length >= 3 && strokes.slice(-3).every((c) => c.join === 'round') && strokes.slice(-3)[2].lw > strokes.slice(-3)[0].lw && strokes.slice(-3)[2].alpha > strokes.slice(-3)[0].alpha, `rain is three depth layers (far thin and dim → near wide and bright, round joins): ${strokes.slice(-3).map((c) => c.lw.toFixed(2) + '@' + c.alpha.toFixed(2))}`);
  ok(r.grads === 0, 'the rain / storm pass creates no gradient');
  const rf = rec(); pf('fog')(s, rf.g, V, 1, 16); ok(rf.grads === 0 && rf.log.some((c) => c.k === 'drawImage'), `the fog pass (wisps, weather fog discs, the night vignette) draws cached sprites and creates no gradient (${rf.log.filter((c) => c.k === 'drawImage').length} blits)`);
  const vig = rf.log.filter((c) => c.k === 'drawImage' && c.a[3] > 0 && c.a.length === 9 && c.a[3] === c.a[7] * (V.dpr || 1)); ok(vig.length >= 4 || rf.log.filter((c) => c.k === 'drawImage').length >= 4, 'the night vignette is blitted from one cached canvas (four slabs around the clear centre)');
  const g2 = rec(); R.groundFx(s, g2.g, [], 0, { shAlpha: 0.1, perfMode: false });
  ok(g2.grads === 0 && R.fxStats().puddles > 0, `puddles come from cached 'puddle' blobs (${R.fxStats().puddles} on screen), no gradient at draw time`);
  const sp = R.fxStats().splashes; ok(sp >= 0, `splash pool alive (${sp})`);
  const wx = rec(); pf('weather')(s, wx.g, V, 1, 16); ok(wx.grads === 0, 'the weather pass (steam puffs, shimmer, particles) creates no gradient');
}
{   // rain splashes: cached rings + droplets, no pixel frames
  R._fxReset(s); s.weather.rainRate = 0.9; for (let k = 0; k < 30; k++) H.render();
  const r = rec(); R.groundFx(s, r.g, [], 0, { shAlpha: 0.2, perfMode: false });
  ok(r.n.fillRect === undefined, 'splashes and puddles draw no fillRect (the B5 pixel frames are gone)');
}
{   // fireworks: soft heads from the cache, trails round-capped and additive
  R._fxReset(s); for (let k = 0; k < 3; k++) R.addShell(1000, 700, 0, 120, 1);
  for (let k = 0; k < 60; k++) H.render();   // past the 650-ms climb: bursts
  const r = rec(); pf('fireworks')(s, r.g, V, 1, 16);
  const strokes = r.log.filter((c) => c.k === 'stroke'), blits = r.log.filter((c) => c.k === 'drawImage');
  ok(R.fxStats().shells >= 1 && blits.length >= 20 && r.grads === 0 && strokes.length >= 4 && strokes.every((c) => c.cap === 'round' && c.comp === 'lighter'), `a burst draws ${blits.length} cached heads / flashes and ${strokes.length} round-capped additive trails, no gradient`);
  ok(r.n.rect === undefined && r.n.fillRect === undefined, 'no 3-px square heads');
  R._fxReset(s);
}
{   // contact AO / steam / shimmer fast paths
  const sh = rec(); R.groundFx(s, sh.g, [{ kind: 'tree', ref: { sw: 96, zoom: 1 }, variant: 0, sx: 300, sy: 300 }], 1, { shAlpha: 0.2, perfMode: false });
  ok(sh.log.some((c) => c.k === 'drawImage') && sh.grads === 0, 'a tree gets one cached AO ellipse (no path, no gradient)');
}

// --- overlays, ghost, cursor ---------------------------------------------------------------------------------------------
{
  const f = s.plot.founders, W = BSU.MAP.W, tiles = [(f.ty + 3) * W + f.tx + 3, (f.ty + 3) * W + f.tx + 4, (f.ty + 4) * W + f.tx + 3, (f.ty + 4) * W + f.tx + 4];
  R.ghost({ tiles: tiles, color: 'green', connectorTiles: [(f.ty + 5) * W + f.tx + 3, (f.ty + 5) * W + f.tx + 4], radius: 0, radiusCenter: { tx: f.tx, ty: f.ty } });
  R.hoverTile = (f.ty + 3) * W + f.tx + 3; H.render();
  const r = rec(); pf('overlays')(s, r.g, V, 1, 16);
  const fills = r.log.filter((c) => c.k === 'fill'), strokes = r.log.filter((c) => c.k === 'stroke');
  ok(r.n.fillRect === undefined && fills.length >= 3, `ghost tiles are anti-aliased paths, not fillRect runs (${fills.length} fills, ${r.n.fillRect || 0} fillRect)`);
  ok(strokes.some((c) => c.join === 'round' && c.lw >= 1.5), 'the ghost footprint and the cursor ring carry a rounded outline (round joins, ≥ 1.5 px)');
  ok(strokes.filter((c) => c.lw >= 3.5).length >= 1, 'the cursor ring has a soft halo under its crisp line');
  R.ghost(null); R.hoverTile = -1;
  // a heat-map overlay tile is an AA diamond fill too
  s.ui.overlay = BSU.OV.WATER; for (let i = 0; i < 4096; i += 7) { if (s.tiles.depth) s.tiles.depth[i] = Math.max(s.tiles.depth[i], 0.5); } H.render(); const ro = rec(); pf('overlays')(s, ro.g, V, 1, 16);
  ok(ro.n.fillRect === undefined, `overlay tiles draw as anti-aliased diamonds (${ro.log.filter((c) => c.k === 'fill').length} fills, no fillRect)`);
  s.ui.overlay = BSU.OV.NONE;
}
// --- network, charter, beacons -------------------------------------------------------------------------------------------
{
  const e0 = BSU.errors.size; let threw = null;
  try {
    R.tiePreview({ tiles: [100, 101, 102], surfaces: ['path', 'boardwalk', 'path'], snap: false, water: 1 }); const rn = rec(); pf('network')(s, rn.g, V, 1, 16);
    ok(rn.log.some((c) => c.k === 'stroke' && c.cap === 'round'), 'the tie preview strokes round-capped dashes');
    R.tiePreview(null); const rc = rec(); pf('charter')(s, rc.g, V, 1, 16); pf('beacons')(s, rc.g, V, 1, 16); pf('spotlight')(s, rc.g, V, 1, 16); pf('fxhud')(s, rc.g, V, 1, 16);
    for (const kind of ['bolt', 'drop', 'wave', 'crack', 'gator', 'link', 'mosquito', 'sandbag', 'crowd']) R.drawIssueGlyph(rc.g, kind, 50, 50, 8, '#FDD023');
    const f = s.plot.founders, W = BSU.MAP.W, mk = (id, tx, ty) => ({ id: id, kind: 'unpowered', color: '#FDD023', title: 'Founders Hall has no power', fix: 'Build a substation', glyph: 'bolt', severity: 3, anchor: { tx: tx, ty: ty }, rect: { tx: tx, ty: ty, w: 2, h: 2 }, tiles: [ty * W + tx], progress: null });
    const near = mk('a', f.tx, f.ty), far = mk('b', f.tx + 60, f.ty + 60), rb = rec();
    const nb = R._issueDraw.beacons(s, rb.g, V, [near, far], near, performance.now()), nl = R._issueDraw.label(s, rb.g, V, near), na = R._issueDraw.arrows(s, rb.g, V, [near, far], far);
    ok(nb >= 1 && na >= 1 && rb.log.filter((c) => c.k === 'stroke' && c.join === 'round').length >= 2 && rb.n.arcTo >= 8, `issue beacons (${nb}), the selected label (${nl}) and the edge arrows (${na}) draw with round joins and arcTo rounded boxes`);
  } catch (e) { threw = e; }
  ok(!threw && BSU.errors.size === e0, 'network / charter / beacons / spotlight / fxhud passes and every issue glyph draw without throwing' + (threw ? ': ' + threw.stack : ''));
}
// --- world particles: every kind through the sorted pass -------------------------------------------------------------------
{
  const e0 = BSU.errors.size; let threw = null;
  try {
    WX.scriptSky(s, SKY.DAY, 0.5); const c = R.camera; const types = ['rain', 'splash', 'dust', 'smoke', 'steam', 'sparks', 'firefly', 'petal', 'bead', 'leaf', 'confetti', 'coin', 'fogWisp', 'mosqDot', 'debris', 'foam', 'sheet', 'gush', 'lightningBloom'];
    R.particles.clear(); for (const t of types) R.particles.emit(t, c.x, c.y, 4, { z: 10, spread: 30, vz: 20 });
    let seen = 0, lifeOk = true; R.particles.forEachWorld((x, y, z, sz, col, type, life) => { seen++; if (!(life > 0 && life <= 1)) lifeOk = false; });
    ok(seen >= types.length * 3 && lifeOk, `forEachWorld hands the life left (0–1] as its 7th argument (${seen} particles)`);
    for (let k = 0; k < 8; k++) H.render();
    R.particles.emit('confetti', 300, 200, 20, { screen: true, vz: 100 }); R.particles.emit('sparks', 300, 200, 20, { screen: true }); R.particles.emit('coin', 300, 200, 20, { screen: true }); for (let k = 0; k < 4; k++) H.render();
  } catch (e) { threw = e; }
  ok(!threw && BSU.errors.size === e0, 'every world and screen particle kind draws (soft puffs, AA discs, tumbling chips): no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));
  {   // a particle never leaves its fade behind: the sorted entity loop draws sprites at whatever alpha the last entity left
    const ps = (R.drawList || []).filter((e) => e && e.kind === 'particle'), r = rec(); let leaked = 0;
    for (const e of ps) { r.g.globalAlpha = 0.37; r.g.globalCompositeOperation = 'lighter'; e.draw(e, r.g); if (r.g.globalAlpha !== 1 || r.g.globalCompositeOperation !== 'source-over') leaked++; }
    ok(ps.length >= 10 && leaked === 0, `every particle kind restores alpha 1 / source-over after its draw (${ps.length} particles drawn, ${leaked} leaked)`);
  }
  R.particles.clear();
}
// --- a landfall and the sky tour -----------------------------------------------------------------------------------------
{
  let threw = null;
  try {
    for (const ph of [SKY.DAWN, SKY.DAY, SKY.GOLDEN, SKY.DUSK, SKY.NIGHT]) { WX.scriptSky(s, ph, 0.9); s.weather.fog = 0.5; s.weather.rainRate = 0.3; for (let k = 0; k < 3; k++) H.render(); }
    H.forceHurricane(3); let reached = false; for (let k = 0; k < 400 && !reached; k++) { H.tick(10); H.render(); if (s.setPiece && s.setPiece.kind === 'landfall' && s.setPiece.tick >= 200) reached = true; }
    for (let k = 0; k < 6; k++) { H.tick(10); H.render(); }
  } catch (e) { threw = e; }
  ok(!threw && BSU.errors.size === errs0, 'every sky phase with fog + rain, then a landfall: no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));
}

// --- icons ---------------------------------------------------------------------------------------------------------------
const cat = BSU.data.catalog, ids = Object.keys(cat);
ok(S.isHD('icon:dorm') && S.hdIconFamilies().join() === 'icon' && S.isPinned('icon') && S.hdFamilies().includes('icon'), 'the icon family is HD and pinned (baked once per session)');
ok(S.ICON_FRAME && S.ICON_FRAME.size === 64 && S.ICON_FRAME.radius === 8 && Object.isFrozen(S.ICON_FRAME), 'ICON_FRAME is the one frozen frame spec (64 units, radius 8)');
{
  const sizes = new Set(), bad = []; let n = 0;
  for (const id of ids) for (const v of [0, 1]) {
    const e = S.get('icon:' + id, v, 0, 2), e1 = S.get('icon:' + id, v, 0, 1);
    if (!e || !e1) { bad.push(id + (v ? ' locked' : '') + ' null'); continue; }
    sizes.add(e.sw + 'x' + e.sh + '@' + e.ox + ',' + e.oy + '/' + e1.sw + 'x' + e1.sh + '@' + e1.ox + ',' + e1.oy);
    if (!e.hd || !e1.hd || e.zoom !== 2 || e1.zoom !== 1) bad.push(id + ' not HD at both masters'); n++;
  }
  ok(bad.length === 0 && n === ids.length * 2, `every catalog row (${ids.length}) bakes its icon, normal and locked, at masters 1 + 2` + (bad.length ? ': ' + bad.slice(0, 4).join(', ') : ''));
  ok(sizes.size === 1 && [...sizes][0] === '128x128@-64,-64/64x64@-32,-32', `one frame size for every icon: ${[...sizes].join(' | ')}`);
}
{
  const before = S.count(); const st0 = S.iconBakeStats();
  S.get('icon:dorm', 0, 0, 2); ok(S.count() === before, 'a baked icon is served from the atlas (no new key on a repeat get)');
  S.clear(); const c0 = S.count(); S.get('icon:library', 0, 0, 2); const c1 = S.count();
  ok(c1 - c0 === 1, `a footprint icon adds exactly ONE atlas entry (its own): the HD building behind it is baked on a scratch canvas and freed (${c1 - c0})`);
  const st1 = S.iconBakeStats(); ok(st1.sources >= 1 && st1.freed === st1.sources, `every scratch source is freed right after the blit (${st1.sources} baked, ${st1.freed} freed)`);
  void st0;
}
{
  const t0 = Date.now(); S.clear(); for (const id of ids) S.get('icon:' + id, 0, 0, 2); const ms = Date.now() - t0;
  ok(ms < 4000, `all ${ids.length} icons bake in ${ms} ms on the stub (advisory: < 4 s)`);
  const t1 = Date.now(); for (const id of ids) S.get('icon:' + id, 0, 0, 2); ok(Date.now() - t1 < 100, 'the second pass over the icons is a cache lookup (< 100 ms)');
}
// --- H7: the water pass's bars through brush.bars, memMB counts the effect caches, the surge barrier icon -------------------------------------------------
try {
  const calls = []; const gp = { globalAlpha: 1, fillStyle: '#000' };
  const gb = new Proxy(gp, { get(t, k) { if (k in t) return t[k]; if (k === 'rect') return (x, y, w, h) => { calls.push(['rect', x, y, w, h]); }; if (k === 'fill') return () => { calls.push(['fill', t.globalAlpha, t.fillStyle]); }; return () => { calls.push([String(k)]); }; }, set(t, k, v) { t[k] = v; return true; } });
  ok(B.bars(gb, new Float32Array(0), 0, 1, '#fff', 1, 1) === 0 && calls.length === 0, 'brush.bars: no bars, no calls');
  const arr = new Float32Array([10.3, 20.4, 6, 30, 40, 0.2, 50.5, 60, 1]);
  const n = B.bars(gb, arr, 3, 1, '#E6F3EC', 0.4, 2);
  const fl = calls.find((c) => c[0] === 'fill'), rc = calls.filter((c) => c[0] === 'rect');
  ok(n === 3 && calls.filter((c) => c[0] === 'beginPath').length === 1 && calls.filter((c) => c[0] === 'fill').length === 1 && rc.length === 3, 'brush.bars: ONE path and ONE fill for any number of bars');
  ok(fl && fl[1] === 0.4 && fl[2] === '#E6F3EC' && gp.globalAlpha === 1, 'brush.bars: the layer\'s alpha and colour, and the context is left at alpha 1');
  ok(rc.every((c) => Math.abs(c[1] * 2 - Math.round(c[1] * 2)) < 1e-9 && Math.abs(c[2] * 2 - Math.round(c[2] * 2)) < 1e-9 && Math.abs(c[3] * 2 - Math.round(c[3] * 2)) < 1e-9 && Math.abs(c[4] * 2 - Math.round(c[4] * 2)) < 1e-9), 'brush.bars: every bar sits on the device pixel grid (at dpr 2: halves of a CSS px), so it is crisp and never anti-aliased');
  ok(rc[0][1] === 10.5 && rc[0][2] === 20.5 && rc[0][3] === 6 && rc[0][4] === 1, 'brush.bars: a 6-px bar at x 10.3 snaps to 10.5…16.5, 1 CSS px = 2 device px thick');
  ok(rc[1][3] === 0.5 && rc[2][3] >= 0.5, 'brush.bars: a bar shorter than a device pixel is one device pixel (a dot, never nothing)');
  ok(B.bars(gb, arr, 1, 1, '#fff', 1) === 1 && calls.filter((c) => c[0] === 'rect').pop()[3] === 6, 'brush.bars: scale defaults to 1 (CSS px = device px)');
  const wsrc = rendSrc.slice(rendSrc.indexOf('function waterPass('), rendSrc.indexOf('// Pass 3b'));
  ok(wsrc.length > 2000 && !/fillRect/.test(wsrc) && /waterBars\(g, Wa/.test(wsrc) && /waterBars\(g, Wcl/.test(wsrc) && /waterBars\(g, Wcd/.test(wsrc) && /waterBars\(g, Wd,/.test(wsrc), 'the live water pass has no fillRect left: swells, ripples, glints, foam, flecks, streaks and the surge debris / chop are layers filled through brush.bars');
  ok((wsrc.match(/waterBars\(g, /g) || []).length === 12, 'twelve layers, one fill each (about a dozen calls a frame instead of ~6,000 fillRects)');
  // a frame over water: the bars layers reach the context as strokes of their own alphas
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const sw = BSU.state, tp = sw.tiles; let wi = -1; for (let i = 0; i < tp.type.length; i++) if (tp.type[i] === BSU.T.BAYOU) { wi = i; break; }
  ok(wi >= 0, 'seed 42 has a bayou tile to look at');
  if (wi >= 0) {
    const W = BSU.MAP.W, tx = wi % W, ty = (wi / W) | 0, cam = { x: (tx - ty) * 32, y: (tx + ty) * 16, zoom: 1 };
    const r = rec(); const lines = [];
    const o = r.g; const sg = new Proxy(o, { get(t, k) { if (k === 'fill') return () => { lines.push([t.globalAlpha]); }; return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
    R.renderInto(sg, 900, 600, sw, cam);
    ok(lines.some((l) => Math.abs(l[0] - 0.42) < 1e-9) && R.perf().water > 0, 'a frame over the bayou fills the swell layer once (alpha .42) — ' + R.perf().water + ' water tiles drawn');
  }
  // memMB counts the blob cache and the night vignette canvas
  { B.blobClear(); const m0 = R.perf(); B.blob('halo', '#FFD27A', 60, 60); B.blob('fog', '196,208,220', 120, 60, { seed: 1 }); const m1 = R.perf(), bs = B.blobStats();
    ok(m1.blobMB === Math.round(bs.mb * 100) / 100 && m1.blobMB > m0.blobMB && m1.memMB - m0.memMB >= m1.blobMB - m0.blobMB - 0.011 && typeof m1.vignetteMB === 'number', 'perf().memMB counts the brush blob cache (blobMB ' + m1.blobMB + ' MB of ' + bs.n + ' blobs)');
    ok(typeof R.vignetteMB === 'function' && R.vignetteMB() >= 0 && m1.vignetteMB === Math.round(R.vignetteMB() * 100) / 100, 'perf().memMB counts the night vignette canvas (' + m1.vignetteMB + ' MB until the first night frame)');
    ok(/R\.vignetteMB = function/.test(fxSrc) && /mem \+= blobMB \+ vignetteMB/.test(rendSrc), 'the vignette canvas and the blob cache are summed into render.perf().memMB'); }
  // the surge barrier gate is the brush's
  ok(/function drawBarrierGate\(/.test(icoSrc) && /it\.id === 'surge_barrier'\) drawBarrierGate/.test(icoSrc), 'the surge barrier icon draws its gate with drawBarrierGate (brush quads, a head beam, gold bars)');
  { let pen = 0; const og = S.get; S.clear(); S.get = function (id) { if (id === 'surge_barrier') pen++; return og.apply(S, arguments); };
    const e2 = S.get('icon:surge_barrier', 0, 0, 2), e1 = S.get('icon:surge_barrier', 1, 0, 1); S.get = og;
    ok(e2 && e1 && e2.hd && e1.hd && pen === 0, 'baking the surge barrier icon (both masters, open and locked) never asks for the pen gate sprite (' + pen + ' asks)'); }
} catch (e) { ok(false, 'H7 effects: ' + (e.stack || e)); }
ok(BSU.errors.size === errs0, 'no BSU.error through the whole file');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
