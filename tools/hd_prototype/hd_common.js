// hd_common.js — shared kit for the Bayou State HD art-style prototype.
// Colour (continuous version of the 5-tone ramps in docs/ART_STYLE.md §2), noise, iso projection
// (contract.js worldToScreen: 64×32 tiles, 6 px/ft), the fixed comparison scene, and the composer that
// draws that scene through any brush that implements the primitive set:
//   groundTile, waterTile, fillQuadShaded, roofPlane, column, path, tree, figure, shadow, light
window.HD = (function () {
  const H = {};
  // ---------- colour ----------
  const hex = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const arr = (c) => typeof c === 'string' ? hex(c) : c;
  const cl = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
  H.hex = hex;
  H.css = (c, a) => { const C = arr(c); return `rgba(${cl(C[0]) | 0},${cl(C[1]) | 0},${cl(C[2]) | 0},${a == null ? 1 : a})`; };
  H.mix = (a, b, t) => { const A = arr(a), B = arr(b); return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; };
  H.shade = (c, k) => { const C = arr(c); return [C[0] * k, C[1] * k, C[2] * k]; };
  const COOL = hex('#2B2550'), WARM = hex('#FFE0A0');
  /** continuous ramp: t in [-1, 1]; -1 = deep shadow (cool), 0 = base, 1 = highlight (warm). Returns an rgb array. */
  H.toneArr = (c, t) => {
    if (t < 0) { const s = -t; return H.mix(H.shade(c, 1 - 0.48 * s), COOL, 0.30 * s); }
    return H.mix(H.shade(c, 1 + 0.34 * t), WARM, 0.28 * t);
  };
  H.tone = (c, t, a) => H.css(H.toneArr(c, t), a);
  H.sat = (c, k) => { const C = arr(c); const l = (C[0] * .3 + C[1] * .59 + C[2] * .11); return [l + (C[0] - l) * k, l + (C[1] - l) * k, l + (C[2] - l) * k]; };
  // palette (contract.js palette + ART_STYLE ramps' base tones)
  H.P = {
    purple: '#461D7C', purple2: '#5E2CA5', purpleHi: '#7F5BC5', purpleShadow: '#2B1246',
    gold: '#FDD023', gold2: '#F5B700', goldHi: '#FFE680', goldShadow: '#B58500', windowGlow: '#FFD27A',
    grass: '#6E8F3C', highGrass: '#7FA347', wet: '#5A6B3A', dirt: '#7A5A38', clay: '#9A6A44', limestone: '#B9AE93',
    marshMud: '#4C4530', waterDeep: '#1B3A3A', waterDay: '#2E6B5E', shallows: '#6FA895', reed: '#8A9A4B', sand: '#D9C9A1',
    oakLeaf: '#3B5A2A', cypressLeaf: '#3F5E3A', cypressRust: '#C7692B', bark: '#3A2A1E', moss: '#9BAA8A',
    gravel: '#C9B47C', creamStone: '#F5ECD7', tanStucco: '#E8D9B5', terracotta: '#B5533C', asphalt: '#3A3A40',
    skin: '#E2B08A', skin2: '#9C6B48', hair: '#3A2518', denim: '#3C4A6B', metal: '#4A4C55', glass: '#5C6E82'
  };
  // ---------- random + noise ----------
  H.rng = (seed) => { let a = (seed | 0) + 0x6D2B79F5; return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  H.hash = hash;
  const sm = (t) => t * t * (3 - 2 * t);
  H.vnoise = (s, x, y, cell) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = sm(x / cell - gx), fy = sm(y / cell - gy);
    const a = hash(gx, gy, s), b = hash(gx + 1, gy, s), c = hash(gx, gy + 1, s), d = hash(gx + 1, gy + 1, s);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  H.fbm = (s, x, y, cell, oct) => { let v = 0, amp = .55, sum = 0, c = cell; for (let i = 0; i < (oct || 3); i++) { v += H.vnoise(s + i * 7, x, y, c) * amp; sum += amp; amp *= .5; c *= .5; } return v / sum; };
  /** procedural texture canvas (tileable if fn is periodic); fn(x, y) -> [r, g, b, a] */
  H.makeTex = (w, h, fn) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const id = g.createImageData(w, h); const d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = fn(x, y), i = (y * w + x) * 4; d[i] = cl(p[0]); d[i + 1] = cl(p[1]); d[i + 2] = cl(p[2]); d[i + 3] = cl(p[3] == null ? 255 : p[3]); }
    g.putImageData(id, 0, 0); return c;
  };
  /** periodic value noise for tileable textures */
  H.pnoise = (s, x, y, cell, per) => { const n = per / cell; const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = sm(x / cell - gx), fy = sm(y / cell - gy); const w = (i, j) => hash(((i % n) + n) % n, ((j % n) + n) % n, s); const a = w(gx, gy), b = w(gx + 1, gy), c = w(gx, gy + 1), d = w(gx + 1, gy + 1); return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy; };
  // ---------- geometry ----------
  H.W2S = (u, v, e) => ({ x: (u - v) * 32, y: (u + v) * 16 - (e || 0) * 6 });
  H.poly = (ctx, pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
  H.diamond = (cx, cy) => [[cx, cy - 16], [cx + 32, cy], [cx, cy + 16], [cx - 32, cy]];
  H.centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
  H.bbox = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
  /** rounded-cap stroke of a polyline through points */
  H.strokePts = (ctx, pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); };
  /** smooth polyline (Catmull-Rom → beziers) as a path */
  H.smoothPath = (ctx, pts) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
  };
  H.ellipse = (ctx, x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };

  // ---------- the comparison scene ----------
  const N = 6;
  const ridge = (tx, ty) => tx + ty <= 5 || (tx + ty === 6 && tx >= 4);
  const elevAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= N || ty >= N) ? -1.6 : (ridge(tx, ty) ? 2 : 0);
  const kindAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= N || ty >= N) ? 'void' : (ridge(tx, ty) ? 'grass' : tx + ty <= 7 ? 'marsh' : 'water');
  H.elevAtPos = (u, v) => elevAt(Math.round(u), Math.round(v));
  H.scene = () => {
    const S = { tiles: [], objects: [] };
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      const e = elevAt(tx, ty), k = kindAt(tx, ty), c = H.W2S(tx, ty, e);
      const T = { tx, ty, cx: c.x, cy: c.y, kind: k, elev: e, seed: tx * 31 + ty * 7 + 11,
        dropS: Math.max(0, e - elevAt(tx, ty + 1)), dropE: Math.max(0, e - elevAt(tx + 1, ty)),
        nb: { n: kindAt(tx, ty - 1), s: kindAt(tx, ty + 1), e: kindAt(tx + 1, ty), w: kindAt(tx - 1, ty) },
        pool: k === 'marsh' && hash(tx, ty, 5) < 0.45 };
      T.shore = k === 'water' ? { n: T.nb.n !== 'water' && T.nb.n !== 'void', w: T.nb.w !== 'water' && T.nb.w !== 'void', s: T.nb.s !== 'water' && T.nb.s !== 'void', e: T.nb.e !== 'water' && T.nb.e !== 'void' } : null;
      S.tiles.push(T);
    }
    S.tiles.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty) || a.tx - b.tx);
    // the hall: 3×2 footprint on tiles tx 1..3, ty 0..1, elev 2
    S.building = { u0: -0.25, u1: 2.25, v0: -0.25, v1: 1.05, elev: 2, wallH: 44, rise: 26, overhang: 0.18, porchV: 1.5,
      plinth: { u0: -0.42, u1: 2.42, v0: -0.4, v1: 1.5, h: 5 }, columns: [0.0, 0.62, 1.38, 2.0], colV: 1.3, doorU: 1.0, depth: 4.0 };
    // path (continuous tile coords) in two runs: ridge run ends at the stair top, marsh run starts at its foot
    S.path = { ridge: [[1.0, 1.5], [1.0, 2.25], [1.35, 2.9], [1.9, 3.3]], marsh: [[1.9, 3.86], [2.0, 4.25], [2.25, 4.6]], width: 0.42 };
    S.stairs = { v: 3.5, uc: 1.9, w: 0.42, steps: 3, dv: 0.12, dropPx: 12 };
    S.lamp = { u: 0.45, v: 2.7, h: 26 };
    S.trees = [{ kind: 'liveOak', u: 4.85, v: 1.1, seed: 3 }, { kind: 'cypress', u: 4.7, v: 4.35, seed: 9, inWater: true }];
    S.figures = [
      { u: 1.0, v: 2.0, facing: 'sw', walk: 0.25, shirt: 'purple', seed: 1 },
      { u: 1.98, v: 4.1, facing: 'sw', walk: 0.7, shirt: 'gold', seed: 2 },
      { u: 3.1, v: 1.5, facing: 'ne', walk: 0.5, shirt: 'purple', seed: 3 },
      { u: 0.1, v: 3.25, facing: 'se', walk: null, shirt: 'gold', seed: 4 }
    ];
    const r = H.rng(77); S.fireflies = [];
    for (let i = 0; i < 16; i++) { const u = 1 + r() * 4.6, v = 6.4 + r() * 1.6 - u; if (v < 0.3 || v > 5.6) continue; S.fireflies.push({ u, v, h: 4 + r() * 18, a: 0.5 + r() * 0.5 }); }
    return S;
  };

  // ---------- composer ----------
  const FACE = { top: 'top', sw: 'sw', se: 'se' };
  H.draw = function (canvas, brush, opts) {
    const dpr = opts.dpr || 2, W = 460, Hh = 340, night = !!opts.night, t = opts.t || 0;
    canvas.width = W * dpr; canvas.height = Hh * dpr;
    canvas.style.width = (opts.px ? W * dpr : W) + 'px'; canvas.style.height = (opts.px ? Hh * dpr : Hh) + 'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = true;
    const S = H.scene(); const B = brush; B.init && B.init(ctx, { night });
    const env = { night, t, dpr };
    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, night ? '#070a18' : '#141c33'); bg.addColorStop(1, night ? '#04060f' : '#0c1222');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, Hh);
    ctx.save(); ctx.translate(230, 128);
    // 1. ground + water + terrace faces
    for (const T of S.tiles) { if (T.kind === 'water') B.waterTile(ctx, T, env); else B.groundTile(ctx, T, env); }
    // 2. paths
    const pathPts = (run) => run.map(([u, v]) => { const p = H.W2S(u, v, H.elevAtPos(u, v)); return [p.x, p.y]; });
    B.path(ctx, pathPts(S.path.ridge), S.path.width * 40, env, 'ridge');
    B.path(ctx, pathPts(S.path.marsh), S.path.width * 40, env, 'marsh');
    // 3. stairs: steps cut into the terrace, built from fillQuadShaded (limestone)
    { const st = S.stairs, u0 = st.uc - st.w / 2, u1 = st.uc + st.w / 2, per = st.dropPx / st.steps;
      for (let k = 0; k < st.steps; k++) {
        const va = st.v + st.dv * k, vb = va + st.dv, top = 2 * 6 - per * (k + 1);   // px above elev 0
        const q = (u, v, h) => { const p = H.W2S(u, v, 0); return [p.x, p.y - h]; };
        B.fillQuadShaded(ctx, [q(u0, vb, top), q(u1, vb, top), q(u1, vb, top - per), q(u0, vb, top - per)], H.P.limestone, { face: 'sw', material: 'stone' }, env);
        B.fillQuadShaded(ctx, [q(u0, va, top), q(u1, va, top), q(u1, vb, top), q(u0, vb, top)], H.P.limestone, { face: 'top', material: 'stone' }, env);
      } }
    // 4. shadows (cast down-right in screen space), then 5. objects in depth order
    const bl = S.building, kx = 0.55, ky = 0.3;
    const bp = (u, v, h) => { const p = H.W2S(u, v, bl.elev); return [p.x, p.y - (h || 0)]; };
    const proj = (p, h) => [p[0] + h * kx, p[1] + h * ky];
    { const E = bp(bl.u1 + bl.overhang, bl.v0 - bl.overhang), Sx = bp(bl.u1 + bl.overhang, bl.porchV), Wc = bp(bl.u0 - bl.overhang, bl.porchV), Nn = bp(bl.u0 - bl.overhang, bl.v0 - bl.overhang);
      const h = bl.wallH;
      B.shadow(ctx, { poly: [Nn, E, proj(E, h), proj(Sx, h), proj(Wc, h), Wc], soft: 6, a: 0.34 }, env); }
    for (const tr of S.trees) { const p = H.W2S(tr.u, tr.v, H.elevAtPos(tr.u, tr.v)); if (tr.kind === 'liveOak') B.shadow(ctx, { x: p.x + 26, y: p.y + 4, rx: 58, ry: 22, soft: 10, a: 0.3 }, env); else B.shadow(ctx, { x: p.x + 10, y: p.y + 2, rx: 16, ry: 7, soft: 6, a: 0.25 }, env); }
    { const p = H.W2S(S.lamp.u, S.lamp.v, 2); B.shadow(ctx, { poly: [[p.x - 1, p.y], [p.x + 1, p.y], [p.x + 1 + S.lamp.h * kx, p.y + S.lamp.h * ky], [p.x - 1 + S.lamp.h * kx, p.y + S.lamp.h * ky]], soft: 2, a: 0.25 }, env); }
    for (const f of S.figures) { const p = H.W2S(f.u, f.v, H.elevAtPos(f.u, f.v)); B.shadow(ctx, { x: p.x + 2, y: p.y + 1, rx: 6, ry: 2.6, soft: 2, a: 0.3 }, env); }
    const objs = [];
    objs.push({ d: bl.depth, draw: () => drawBuilding(ctx, B, S, env) });
    for (const tr of S.trees) objs.push({ d: tr.u + tr.v, draw: () => { const p = H.W2S(tr.u, tr.v, H.elevAtPos(tr.u, tr.v)); B.tree(ctx, p.x, p.y, tr.kind, { seed: tr.seed, inWater: !!tr.inWater, night }, env); } });
    objs.push({ d: S.lamp.u + S.lamp.v, draw: () => drawLamp(ctx, B, S, env) });
    for (const f of S.figures) objs.push({ d: f.u + f.v, draw: () => { const p = H.W2S(f.u, f.v, H.elevAtPos(f.u, f.v)); B.figure(ctx, p.x, p.y, f, env); } });
    objs.sort((a, b) => a.d - b.d); for (const o of objs) o.draw();
    // 6. night: tint pass (multiply, ART_STYLE §5) then the lights pass (additive)
    if (night) {
      ctx.restore(); ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(14,18,48,0.62)'; ctx.fillRect(0, 0, W, Hh);
      ctx.restore(); ctx.save(); ctx.translate(230, 128);
      // windows glow
      for (const w of windowQuads(S)) B.light(ctx, { quad: w.pts, color: H.P.windowGlow, a: 0.9, halo: 10 }, env);
      // lamp: bulb + ground pool
      { const p = H.W2S(S.lamp.u, S.lamp.v, 2); B.light(ctx, { x: p.x, y: p.y - S.lamp.h - 1, r: 22, color: '#FFE2A0', a: 0.9 }, env); B.light(ctx, { x: p.x, y: p.y + 2, rx: 42, ry: 20, color: '#FFD98A', a: 0.5, pool: true }, env); }
      // fireflies
      for (const f of S.fireflies) { const p = H.W2S(f.u, f.v, H.elevAtPos(f.u, f.v)); B.light(ctx, { x: p.x, y: p.y - f.h, r: 3.5, color: '#D9FF7A', a: f.a, firefly: true }, env); }
    }
    ctx.restore();
    return canvas;
  };

  function windowQuads(S) {
    const bl = S.building, out = [], z0 = bl.plinth.h;
    const bp = (u, v, h) => { const p = H.W2S(u, v, bl.elev); return [p.x, p.y - (h || 0) - z0]; };
    const addWin = (face, a, b, h0, h1) => { out.push({ face, pts: face === 'sw' ? [bp(a, bl.v1, h1), bp(b, bl.v1, h1), bp(b, bl.v1, h0), bp(a, bl.v1, h0)] : [bp(bl.u1, a, h1), bp(bl.u1, b, h1), bp(bl.u1, b, h0), bp(bl.u1, a, h0)] }); };
    // SW face: two tall windows flanking the door (between the columns), SE face: three windows
    addWin('sw', 0.14, 0.42, 8, 32); addWin('sw', 1.58, 1.86, 8, 32);
    addWin('se', -0.08, 0.14, 8, 32); addWin('se', 0.40, 0.62, 8, 32); addWin('se', 0.85, 1.0, 8, 32);
    return out;
  }
  H.windowQuads = windowQuads;

  function drawBuilding(ctx, B, S, env) {
    const bl = S.building, P = H.P;
    const bp = (u, v, h) => { const p = H.W2S(u, v, bl.elev); return [p.x, p.y - (h || 0)]; };
    // plinth / stylobate (limestone), SW porch side is the full width
    const pl = bl.plinth;
    B.fillQuadShaded(ctx, [bp(pl.u0, pl.v1, 0), bp(pl.u1, pl.v1, 0), bp(pl.u1, pl.v1, pl.h), bp(pl.u0, pl.v1, pl.h)], P.limestone, { face: 'sw', material: 'stone' }, env);
    B.fillQuadShaded(ctx, [bp(pl.u1, pl.v1, 0), bp(pl.u1, pl.v0, 0), bp(pl.u1, pl.v0, pl.h), bp(pl.u1, pl.v1, pl.h)], P.limestone, { face: 'se', material: 'stone' }, env);
    B.fillQuadShaded(ctx, [bp(pl.u0, pl.v0, pl.h), bp(pl.u1, pl.v0, pl.h), bp(pl.u1, pl.v1, pl.h), bp(pl.u0, pl.v1, pl.h)], P.limestone, { face: 'top', material: 'stone' }, env);
    const z0 = pl.h, wallTop = z0 + bl.wallH;
    // walls
    B.fillQuadShaded(ctx, [bp(bl.u0, bl.v1, z0), bp(bl.u1, bl.v1, z0), bp(bl.u1, bl.v1, wallTop), bp(bl.u0, bl.v1, wallTop)], P.creamStone, { face: 'sw', material: 'stucco' }, env);
    B.fillQuadShaded(ctx, [bp(bl.u1, bl.v1, z0), bp(bl.u1, bl.v0, z0), bp(bl.u1, bl.v0, wallTop), bp(bl.u1, bl.v1, wallTop)], P.creamStone, { face: 'se', material: 'stucco' }, env);
    // windows (glass; lit at night in the base pass, halo added by the lights pass)
    for (const w of windowQuads(S)) { B.fillQuadShaded(ctx, w.pts, env.night ? P.windowGlow : P.glass, { face: w.face, material: env.night ? 'glow' : 'glass' }, env); }
    // door on the SW face (dark wood with a gold-trimmed purple banner above)
    { const a = bl.doorU - 0.17, b = bl.doorU + 0.17; B.fillQuadShaded(ctx, [bp(a, bl.v1, z0 + 24), bp(b, bl.v1, z0 + 24), bp(b, bl.v1, z0), bp(a, bl.v1, z0)], '#3A2518', { face: 'sw', material: 'wood' }, env);
      B.fillQuadShaded(ctx, [bp(a - .02, bl.v1, z0 + 36), bp(b + .02, bl.v1, z0 + 36), bp(b + .02, bl.v1, z0 + 27), bp(a - .02, bl.v1, z0 + 27)], P.purple, { face: 'sw', material: 'cloth' }, env);
      B.fillQuadShaded(ctx, [bp(a - .02, bl.v1, z0 + 37.5), bp(b + .02, bl.v1, z0 + 37.5), bp(b + .02, bl.v1, z0 + 36), bp(a - .02, bl.v1, z0 + 36)], P.gold, { face: 'sw', material: 'paint' }, env); }
    // SE face: a purple banner with gold trim between windows
    B.fillQuadShaded(ctx, [bp(bl.u1, 0.2, z0 + 34), bp(bl.u1, 0.34, z0 + 34), bp(bl.u1, 0.34, z0 + 14), bp(bl.u1, 0.2, z0 + 14)], P.purple, { face: 'se', material: 'cloth' }, env);
    B.fillQuadShaded(ctx, [bp(bl.u1, 0.2, z0 + 35.5), bp(bl.u1, 0.34, z0 + 35.5), bp(bl.u1, 0.34, z0 + 34), bp(bl.u1, 0.2, z0 + 34)], P.gold, { face: 'se', material: 'paint' }, env);
    // eave fascia: a thin band under the roof on both faces
    const ov = bl.overhang, eaveH = wallTop + 3;
    B.fillQuadShaded(ctx, [bp(bl.u0 - ov, bl.porchV, eaveH - 3), bp(bl.u1 + ov, bl.porchV, eaveH - 3), bp(bl.u1 + ov, bl.porchV, eaveH), bp(bl.u0 - ov, bl.porchV, eaveH)], P.creamStone, { face: 'sw', material: 'wood' }, env);
    B.fillQuadShaded(ctx, [bp(bl.u1 + ov, bl.porchV, eaveH - 3), bp(bl.u1 + ov, bl.v0 - ov, eaveH - 3), bp(bl.u1 + ov, bl.v0 - ov, eaveH), bp(bl.u1 + ov, bl.porchV, eaveH)], P.creamStone, { face: 'se', material: 'wood' }, env);
    // porch columns (in front of the SW wall, under the deep eave)
    for (const cu of bl.columns) { const p = bp(cu, bl.colV, z0); B.column(ctx, p[0], p[1], bl.wallH, 3.2, P.creamStone, env); }
    // hip roof: four planes, ridge along u
    const ru0 = bl.u0 - ov + 0.95, ru1 = bl.u1 + ov - 0.95, vc = (bl.v0 - ov + bl.porchV) / 2, top = eaveH + bl.rise;
    const Nn = bp(bl.u0 - ov, bl.v0 - ov, eaveH), E = bp(bl.u1 + ov, bl.v0 - ov, eaveH), Sx = bp(bl.u1 + ov, bl.porchV, eaveH), Wc = bp(bl.u0 - ov, bl.porchV, eaveH);
    const R1 = bp(ru0, vc, top), R2 = bp(ru1, vc, top);
    B.roofPlane(ctx, [Nn, Wc, R1], P.terracotta, { facing: 'nw' }, env);
    B.roofPlane(ctx, [E, Nn, R1, R2], P.terracotta, { facing: 'ne' }, env);
    B.roofPlane(ctx, [Wc, Sx, R2, R1], P.terracotta, { facing: 'sw' }, env);
    B.roofPlane(ctx, [Sx, E, R2], P.terracotta, { facing: 'se' }, env);
    // ridge cap
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = H.tone(P.terracotta, 0.55); ctx.beginPath(); ctx.moveTo(R1[0], R1[1]); ctx.lineTo(R2[0], R2[1]); ctx.stroke(); ctx.restore();
  }

  function drawLamp(ctx, B, S, env) {
    const L = S.lamp, p = H.W2S(L.u, L.v, 2), P = H.P;
    B.column(ctx, p.x, p.y, L.h, 1.3, P.metal, env);
    // lantern head: a small purple box with a gold cap, glass panes
    const x = p.x, y = p.y - L.h;
    B.fillQuadShaded(ctx, [[x - 3.5, y - 1], [x + 3.5, y - 1], [x + 3.5, y - 8], [x - 3.5, y - 8]], env.night ? '#FFE2A0' : '#DCE6EE', { face: 'sw', material: env.night ? 'glow' : 'glass' }, env);
    B.fillQuadShaded(ctx, [[x - 4.5, y - 8], [x + 4.5, y - 8], [x + 3, y - 11], [x - 3, y - 11]], P.purple, { face: 'top', material: 'paint' }, env);
    B.fillQuadShaded(ctx, [[x - 1.6, y - 11], [x + 1.6, y - 11], [x + 1.2, y - 13.5], [x - 1.2, y - 13.5]], P.gold, { face: 'top', material: 'paint' }, env);
  }
  return H;
})();
