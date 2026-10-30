'use strict';
// ============================================================================
// BAYOU STATE — brush.js (H0 pipeline pass): the HD brush, style C "soft rendered diorama".
// Owner: nothing in state (pure drawing; every call is deterministic in its arguments).
// Implements: docs/PLAN_HD_ART.md §1 (the primitive set) and §3; docs/ART_STYLE.md §2–§3 and "## Brush API".
// The brush is the ONLY painter API for HD sprite families (sprites.registerHD) and for the HD chunk bake:
// passes H1–H6 compose these primitives and never add ad-hoc gradients of their own (PLAN §5 "Style drift").
// Everything here is vanilla Canvas 2D, resolution independent (real-valued geometry, antialiasing, gradients,
// patterns), no ctx.filter and no shadowBlur (Safari). Coordinates are 1× art px; the context the caller hands in
// is already scaled to the master (sprites.beginHD / render's HD chunk bake), so a master-2 bake lands at
// 1 art px = 2 device px of detail with no change to the painter.
// Public: BSU.brush.{tone, toneArr, css, mix, sat, ramp, env, posEnv, rng, vnoise, fbm, pnoise, field, poly, bbox, centroid, diamond,
//   diamondGrown, smoothPath, ellipse, seamWidth, seamStroke, plane, orb, softEllipse, microGrain, macroGrain, sites, edgeFade, stroke,
//   blade, puddle, strokePath, fillQuadShaded, roofPlane, column, groundTile, waterTile, path, tree, figure, capsule, digits, shadow, light,
//   glow, decal, cube, begin, blob, drawBlob, bars, blobQ, blobStats, blobClear, blobKinds, selfTest}
// H7: bars is the batched device-pixel fill of the water pass's horizontal wave / glint / foam / chop bars (one path per layer, not one fillRect each).
// H5 effects pass: blob / drawBlob are the cached soft sprites (halo, glow, pool, dot, puff, ao, foam, ring, cone, puddle, fog, vignette) every effect pass draws with drawImage.
// H4 characters pass: capsule (a limb / body / hull lit across its width) and digits (jersey numbers as strokes) are the body kit the
// character families compose (sprites_entities_hd.js); figure stays the H0 reference composition.
// H1 terrain + water pass: posEnv / field / sites / macroGrain anchor a CACHED tile sprite to its 8×8-tile block position (period
// 256×128 px), so 64 position variants of one tile family join seamlessly across tiles and chunks; strokePath is the layered stroke
// behind every path / road / boardwalk / bridge deck (render.js strokes the smoothed centrelines through it).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.brush = BSU.brush || {});
  const SP = BSU.sprites;
  const PAL = BSU.params.palette;
  const hash = BSU.rng.hash;

  // ---------------------------------------------------------------------------
  // Colour: the CONTINUOUS form of the 5-tone ramps (ART_STYLE §2). t ∈ [−1, 1]: −1 deep shadow, −.5 shadow,
  // 0 base, .5 light, 1 highlight — the knots carry exactly makeRamp's coefficients, so tone(c, −1) === ramp(c)[0]
  // etc. and every palette hex stays valid; between the knots the shade factor and the tint amount interpolate.
  // ---------------------------------------------------------------------------
  const COOL = SP.hex(SP.COOL_TINT || '#2B2550'), WARM = SP.hex(SP.WARM_TINT || '#FFE0A0');
  const KN_T = [-1, -0.5, 0, 0.5, 1], KN_K = [0.52, 0.74, 1, 1.16, 1.34], KN_A = [0.30, 0.16, 0, 0.12, 0.28];
  const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const arr = (c) => (typeof c === 'string' ? SP.hex(c.charCodeAt(0) === 35 ? c : M.ramp(c)) : c);   // a hex, or a ramp / palette name (H1: the painters pass names)
  function toneArr(c, t) {
    const C = arr(c); t = Number.isFinite(t) ? (t < -1 ? -1 : t > 1 ? 1 : t) : 0;
    let i = 0; while (i < 3 && t > KN_T[i + 1]) i++;
    const f = (t - KN_T[i]) / (KN_T[i + 1] - KN_T[i]);
    const k = KN_K[i] + (KN_K[i + 1] - KN_K[i]) * f, a = KN_A[i] + (KN_A[i + 1] - KN_A[i]) * f, tint = t < 0 ? COOL : WARM;
    const r = cl(C[0] * k), g = cl(C[1] * k), b = cl(C[2] * k);   // clamp after the shade step, before the tint, exactly as makeRamp's shade() → mix()
    return [r + (tint[0] - r) * a, g + (tint[1] - g) * a, b + (tint[2] - b) * a];
  }
  const css = (c, a) => { const C = arr(c); return 'rgba(' + (cl(C[0]) | 0) + ',' + (cl(C[1]) | 0) + ',' + (cl(C[2]) | 0) + ',' + (a == null ? 1 : a) + ')'; };
  const mix = (a, b, t) => { const A = arr(a), B = arr(b); return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; };
  const sat = (c, k) => { const C = arr(c); const l = C[0] * 0.3 + C[1] * 0.59 + C[2] * 0.11; return [l + (C[0] - l) * k, l + (C[1] - l) * k, l + (C[2] - l) * k]; };
  const lum = (C) => C[0] * 0.3 + C[1] * 0.59 + C[2] * 0.11;
  const SAT_C = 1.12;                      // style C: colours a touch cleaner than the pixel ramps
  const colCache = new Map();
  /** the style's colour string for base c at ramp position t (alpha a): saturated 1.12, then the continuous ramp */
  function col(c, t, a) {
    const key = (typeof c === 'string' ? c : ((c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0))) + '|' + ((t * 64) | 0) + '|' + (a == null ? 1 : (a * 100) | 0);
    let s = colCache.get(key);
    if (s === undefined) { if (colCache.size > 4096) colCache.clear(); s = css(toneArr(sat(c, SAT_C), t), a); colCache.set(key, s); }
    return s;
  }
  M.toneArr = toneArr; M.css = css; M.mix = mix; M.sat = sat; M.tone = col;
  /** base hex of a material ramp name (sprites.RAMP_BASES), a palette key, or the hex itself */
  M.ramp = (name) => (SP.RAMP_BASES && SP.RAMP_BASES[name]) || PAL[name] || (typeof name === 'string' && name[0] === '#' ? name : SP.RAMP_BASES.grass);
  const P = {
    grass: M.ramp('grass'), highGrass: M.ramp('highGrass'), wet: M.ramp('wet'), dirt: M.ramp('dirt'), limestone: M.ramp('limestone'),
    marshMud: M.ramp('marshMud'), waterDeep: M.ramp('waterDeep'), waterDay: PAL.waterDay || '#2E6B5E', shallows: M.ramp('waterShallow'),
    reed: M.ramp('reed'), sand: M.ramp('sand'), oakLeaf: M.ramp('oakLeaf'), cypressLeaf: M.ramp('cypressLeaf'), cypressRust: M.ramp('cypressRust'),
    bark: M.ramp('bark'), moss: M.ramp('moss'), gravel: PAL.gravel || '#C9B47C', purple: PAL.purple, gold: PAL.gold,
    skin: '#E2B08A', hair: '#3A2518', denim: '#3C4A6B', metal: '#4A4C55'
  };
  M.P = P;
  const RIM = '#B8C8FF', SPEC = '#FFFBEA', AO = [30, 25, 70], SHADOW_C = [40, 34, 90];

  // ---------------------------------------------------------------------------
  // env: what every primitive reads besides its arguments. master 1 = today's art px, 2 = HD; lod 0 full detail
  // (master 2), 1 reduced (master 1: no micro grain, half the decorative dabs); night switches glints / glow;
  // originX/Y = world px of the context's (0, 0) so patterns and noise are world-anchored (chunks join seamlessly).
  // ---------------------------------------------------------------------------
  M.env = function (master, o) {
    o = o || {};
    const m = master === 2 ? 2 : 1;
    return { master: m, lod: o.lod != null ? o.lod | 0 : (m >= 2 ? 0 : 1), night: !!o.night, dpr: Number.isFinite(o.dpr) ? o.dpr : 1, originX: Number.isFinite(o.originX) ? o.originX : 0, originY: Number.isFinite(o.originY) ? o.originY : 0, periodic: !!o.periodic };
  };
  const envOf = (env) => env || DEF_ENV;
  const DEF_ENV = M.env(1);
  /** H1: the env of a CACHED tile sprite at block position pv (tx & 7 | (ty & 7) << 3), diamond centre (cx, cy) on its canvas: the
   *  context's (0, 0) is anchored to the 8×8-tile block's screen offset (the marsh painter's X0 / Y0), and every field, grain and site
   *  grid repeats every 256×128 px, so the 64 variants of a family join seamlessly across tiles and chunk borders */
  M.posEnv = function (env, pv, cx, cy) {
    env = envOf(env); pv = pv | 0;
    const X0 = ((pv & 7) - (pv >> 3)) * 32 + 256, Y0 = ((pv & 7) + (pv >> 3)) * 16;
    return { master: env.master, lod: env.lod, night: env.night, dpr: env.dpr, originX: X0 - cx, originY: Y0 - cy, periodic: true };
  };

  // ---------------------------------------------------------------------------
  // Random + noise (world space, seamless by construction)
  // ---------------------------------------------------------------------------
  M.rng = (seed) => { let a = (seed | 0) + 0x6D2B79F5; return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  M.vnoise = SP.vnoise;
  M.fbm = (s, x, y, cell, oct) => { let v = 0, amp = 0.55, sum = 0, c = cell > 0 ? cell : 8; for (let i = 0; i < (oct || 3); i++) { v += SP.vnoise(s + i * 7, x, y, c) * amp; sum += amp; amp *= 0.5; c *= 0.5; } return v / sum; };
  M.pnoise = (s, x, y, cell, per) => SP.pnoise(s, x, y, cell, cell, per, per);
  /** H1: a world-anchored field in [0, 1) at local (x, y): periodic 256×128 px (cell × cell/2, cell a power of two ≤ 64) under a
   *  posEnv, free world noise (iso-stretched 2:1) under a chunk env */
  M.field = function (env, seed, x, y, cell) {
    env = envOf(env); const wx = x + env.originX, wy = y + env.originY, c = cell > 0 ? cell : 16;
    if (env.periodic) return SP.pnoise(seed, wx, wy, c, Math.max(1, c >> 1), 256, 128);
    return SP.vnoise(seed, wx, wy * 2, c);
  };

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
  function bbox(pts) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
  function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
  const diamond = (cx, cy) => [[cx, cy - 16], [cx + 32, cy], [cx, cy + 16], [cx - 32, cy]];
  /** the diamond with every edge pushed ~g px outward (the clip for tile decorations that a neighbour finishes: no AA hairline at the edge) */
  const diamondGrown = (cx, cy, g) => [[cx, cy - 16 - g], [cx + 32 + 2 * g, cy], [cx, cy + 16 + g], [cx - 32 - 2 * g, cy]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function smoothPath(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
  }
  function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  M.poly = poly; M.bbox = bbox; M.centroid = centroid; M.diamond = diamond; M.diamondGrown = diamondGrown; M.smoothPath = smoothPath; M.ellipse = ellipse; M.lerp = lerp;

  // ---------------------------------------------------------------------------
  // Seams: antialiased diamonds leave a hairline between neighbours; stroking each tile with its own fill at ~0.9
  // DEVICE px closes it (PLAN §5 "Seams"). The width is given in art px, so it shrinks with the master.
  // ---------------------------------------------------------------------------
  M.SEAM_PX = 0.9;
  M.seamWidth = (env) => M.SEAM_PX / envOf(env).master;
  function seamStroke(ctx, pts, style, env) { poly(ctx, pts); ctx.lineJoin = 'round'; ctx.lineWidth = M.seamWidth(env); ctx.strokeStyle = style; ctx.stroke(); }
  M.seamStroke = seamStroke;

  // ---------------------------------------------------------------------------
  // Core shapes
  // ---------------------------------------------------------------------------
  let GRAIN = null;
  const patterns = new WeakMap();
  function grain() {
    if (GRAIN) return GRAIN;
    const c = SP.newCanvas(64, 64); const g = SP.ctx2d(c);
    try {
      const id = g.createImageData(64, 64); const d = id.data;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const v = M.pnoise(31, x * 2, y * 2, 2, 64) - 0.5; const q = cl(128 + v * 60) | 0, i = (y * 64 + x) * 4; d[i] = q; d[i + 1] = q; d[i + 2] = q; d[i + 3] = 255; }
      g.putImageData(id, 0, 0);
    } catch (e) { /* stub */ }
    GRAIN = c; return c;
  }
  /** low-alpha overlay grain clipped to pts, anchored to world px (env.originX/Y) so tiles and chunks join */
  function microGrain(ctx, pts, a, env) {
    env = envOf(env); if (env.lod > 0) return;
    let pat = patterns.get(ctx);
    if (pat === undefined) { try { pat = ctx.createPattern(grain(), 'repeat') || null; } catch (e) { pat = null; } patterns.set(ctx, pat); }
    if (!pat) return;
    const ox = ((env.originX % 64) + 64) % 64, oy = ((env.originY % 64) + 64) % 64;
    ctx.save(); poly(ctx, pts); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true;
    ctx.translate(-ox, -oy); ctx.fillStyle = pat; const bb = bbox(pts); ctx.fillRect(bb.x0 + ox - 4, bb.y0 + oy - 4, bb.w + 8, bb.h + 8); ctx.restore();
  }
  /** sphere-like radial blob: lit upper-left, cool rim arc on the lower right, optional specular dot (o.spec = alpha) */
  function orb(ctx, x, y, rx, ry, color, t, o) {
    o = o || {}; ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.05);
    g.addColorStop(0, col(color, t + 0.75)); g.addColorStop(0.35, col(color, t + 0.25)); g.addColorStop(0.8, col(color, t - 0.3)); g.addColorStop(1, col(color, t - 0.65));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    if (!o.noRim) { ctx.lineWidth = (0.9 / Math.max(rx, ry)) * 1.6; ctx.strokeStyle = css(RIM, 0.35); ctx.beginPath(); ctx.arc(0, 0, 0.93, Math.PI * 0.05, Math.PI * 0.6); ctx.stroke(); }
    if (o.spec) { ctx.fillStyle = css(SPEC, o.spec); ctx.beginPath(); ctx.ellipse(-0.38, -0.45, 0.2, 0.12, -0.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  /** radial fade: solid to `plateau`, then to transparent at the rim */
  function softEllipse(ctx, x, y, rx, ry, color, a, plateau) {
    if (!(rx > 0 && ry > 0)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, css(color, a)); g.addColorStop(plateau == null ? 0.5 : plateau, css(color, a)); g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  /** bevelled, gradient-lit plane: key light upper-left, light inner edge on the lit edges, cool rim on the others */
  function plane(ctx, pts, color, t, o) {
    o = o || {}; const bb = bbox(pts), amp = o.amp || 0.16;
    const g = o.vert ? ctx.createLinearGradient(0, bb.y0, 0, bb.y1) : ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, col(color, t + amp)); g.addColorStop(1, col(color, t - amp));
    poly(ctx, pts); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = col(color, t, 0.8); ctx.stroke();
    ctx.save(); poly(ctx, pts); ctx.clip(); ctx.lineCap = 'round';
    const mcx = (bb.x0 + bb.x1) / 2, mcy = (bb.y0 + bb.y1) / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]; const mx = (a[0] + b[0]) / 2 - mcx, my = (a[1] + b[1]) / 2 - mcy;
      const lit = (-mx - my * 1.2) > 0;   // the edge faces the key light (upper-left)
      ctx.lineWidth = lit ? 1.6 : 1.1; ctx.strokeStyle = lit ? col(color, t + 0.7, 0.55) : css(RIM, o.rim == null ? 0.28 : o.rim);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    if (o.spec) softEllipse(ctx, bb.x0 + bb.w * 0.3, bb.y0 + bb.h * 0.3, bb.w * 0.3, bb.h * 0.25, SPEC, o.spec, 0.1);
    ctx.restore();
  }
  M.plane = plane; M.orb = orb; M.softEllipse = softEllipse; M.microGrain = microGrain;

  // ---------------------------------------------------------------------------
  // H1 terrain + water pass — world-anchored ground kit (cached tile variants join across tiles and chunks)
  // ---------------------------------------------------------------------------
  let MACRO = null;
  const macroPatterns = new WeakMap();
  /** the one LOW-frequency texture: a 256×128 periodic luminance field (cells 64×32 + 32×16), applied at `overlay` so the ground drifts
   *  light / dark over several tiles with no per-tile step; the pattern is anchored to world px (env.originX / Y mod 256 / 128) */
  function macroTex() {
    if (MACRO) return MACRO;
    const c = SP.newCanvas(256, 128); const g = SP.ctx2d(c);
    try {
      const id = g.createImageData(256, 128); const d = id.data;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) { const v = 0.65 * SP.pnoise(53, x, y, 64, 32, 256, 128) + 0.35 * SP.pnoise(61, x, y, 32, 16, 256, 128) - 0.5; const q = cl(128 + v * 96) | 0, i = (y * 256 + x) * 4; d[i] = q; d[i + 1] = q; d[i + 2] = q; d[i + 3] = 255; }
      g.putImageData(id, 0, 0);
    } catch (e) { /* stub */ }
    MACRO = c; return c;
  }
  M.macroGrain = function (ctx, pts, a, env) {
    env = envOf(env);
    let pat = macroPatterns.get(ctx);
    if (pat === undefined) { try { pat = ctx.createPattern(macroTex(), 'repeat') || null; } catch (e) { pat = null; } macroPatterns.set(ctx, pat); }
    if (!pat) return;
    const ox = ((env.originX % 256) + 256) % 256, oy = ((env.originY % 128) + 128) % 128;
    ctx.save(); poly(ctx, pts); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true;
    ctx.translate(-ox, -oy); ctx.fillStyle = pat; const bb = bbox(pts); ctx.fillRect(bb.x0 + ox - 4, bb.y0 + oy - 4, bb.w + 8, bb.h + 8); ctx.restore();
  };
  /** world-anchored decoration sites over the diamond (cx, cy) grown by pad: one jittered candidate per cw × ch px cell of a grid that
   *  repeats every 256×128 px under a posEnv (a patch cut by a tile edge is finished by the neighbour, which places the same site).
   *  cb(x, y, r1, r2, r3, h) gets local coordinates, three deterministic [0, 1) values and the raw hash; returns the site count */
  M.sites = function (env, seed, cx, cy, cw, ch, pad, cb) {
    env = envOf(env); const ox = env.originX, oy = env.originY, per = !!env.periodic;
    cw = cw > 0 ? cw : 32; ch = ch > 0 ? ch : 16; pad = pad > 0 ? pad : 0;
    const nx = Math.max(1, Math.round(256 / cw)), ny = Math.max(1, Math.round(128 / ch));
    const x0 = cx - 32 - pad + ox, x1 = cx + 32 + pad + ox, y0 = cy - 16 - pad + oy, y1 = cy + 16 + pad + oy;
    let n = 0;
    for (let j = Math.floor(y0 / ch); j <= Math.floor(y1 / ch); j++) for (let i = Math.floor(x0 / cw); i <= Math.floor(x1 / cw); i++) {
      const ii = per ? ((i % nx) + nx) % nx : i, jj = per ? ((j % ny) + ny) % ny : j;
      const h1 = hash(seed + ii * 7919, jj * 104729 + 29) >>> 0, h2 = hash(seed + 977 + ii * 7919, jj * 104729 + 31) >>> 0, h3 = hash(seed + 4441 + ii * 7919, jj * 104729 + 37) >>> 0;
      const lx = i * cw + ((h1 & 1023) / 1024) * cw - ox, ly = j * ch + ((h2 & 1023) / 1024) * ch - oy;
      if (Math.abs(lx - cx) / (32 + pad) + Math.abs(ly - cy) / (16 + pad) > 1) continue;
      cb(lx, ly, ((h1 >>> 10) & 1023) / 1024, ((h2 >>> 10) & 1023) / 1024, (h3 & 1023) / 1024, h3);
      n++;
    }
    return n;
  };
  /** a band fading from the edge a→b (col(color, t, alpha) on the edge) to transparent `depth` px inward (toward the polygon), clipped to pts */
  M.edgeFade = function (ctx, pts, a, b, depth, color, t, alpha) {
    const m = lerp(a, b, 0.5), c = centroid(pts); let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if ((c[0] - m[0]) * nx + (c[1] - m[1]) * ny < 0) { nx = -nx; ny = -ny; }
    const g = ctx.createLinearGradient(m[0], m[1], m[0] + nx * depth, m[1] + ny * depth); g.addColorStop(0, col(color, t, alpha)); g.addColorStop(1, col(color, t, 0));
    ctx.save(); poly(ctx, pts); ctx.clip(); ctx.fillStyle = g; const bb = bbox(pts); ctx.fillRect(bb.x0 - 1, bb.y0 - 1, bb.w + 2, bb.h + 2); ctx.restore();
  };
  /** a toned polyline: o = {smooth (Catmull-Rom), cap, close}; alpha a */
  M.stroke = function (ctx, pts, w, color, t, a, o) {
    if (!pts || pts.length < 2) return; o = o || {};
    if (o.smooth) smoothPath(ctx, pts); else { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (o.close) ctx.closePath(); }
    ctx.lineCap = o.cap || 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = col(color, t, a); ctx.stroke();
  };
  /** a lit reed / grass blade from (x, y) up h px leaning `lean` px: shadow stroke + a lighter thread on its left (no gradient: cheap at 64 variants) */
  M.blade = function (ctx, x, y, h, lean, color, t, w) {
    w = w || 1.5; ctx.lineCap = 'round';
    ctx.lineWidth = w; ctx.strokeStyle = col(color, t - 0.45); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lean, y - h); ctx.stroke();
    ctx.lineWidth = w * 0.5; ctx.strokeStyle = col(color, t + 0.4); ctx.beginPath(); ctx.moveTo(x - w * 0.3, y - 0.5); ctx.lineTo(x + lean * 0.9 - w * 0.3, y - h + 0.5); ctx.stroke();
  };
  /** standing water in the ground: a deep → shallow pool, a specular bar at the upper-left, a cool rim; o.t nudges the water tone */
  M.puddle = function (ctx, x, y, rx, ry, env, o) {
    env = envOf(env); o = o || {}; const t = o.t || 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); const pg = ctx.createRadialGradient(0.1, 0.2, 0, 0, 0, 1); pg.addColorStop(0, col(P.waterDeep, t + 0.1)); pg.addColorStop(0.8, col(P.shallows, t - 0.1)); pg.addColorStop(1, col(P.shallows, t + 0.3)); ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    softEllipse(ctx, x - rx * 0.3, y - ry * 0.32, rx * 0.32, ry * 0.24, env.night ? '#C9D8FF' : SPEC, o.spec == null ? 0.6 : o.spec, 0.3);
    ctx.lineWidth = 0.8; ctx.strokeStyle = css(RIM, o.rim == null ? 0.35 : o.rim); ellipse(ctx, x, y, rx, ry); ctx.stroke();
  };
  const NODASH = [];
  /** layered strokes of the CURRENT path (built by the caller under any CTM): o.material gravel | asphalt | boardwalk | concrete,
   *  o.stub (a tee connector: edge + body only), o.seed (dash phase), o.unit = px per CTM unit (32 under render's iso ground transform,
   *  1 in screen px). Soft dark edge (the AO where the surface meets the ground) → body → lit crown → an up-left highlight thread →
   *  the material's marks (gravel specks, gold centre dashes, plank gaps, expansion joints); lod 1 skips the marks */
  M.strokePath = function (ctx, w, env, o) {
    o = o || {}; env = envOf(env); const u = o.unit > 0 ? o.unit : 1, px = 1 / u, m = o.material || 'gravel', seed = (o.seed | 0) >>> 0;
    const X = SP.extra || {};
    const c = m === 'asphalt' ? (PAL.asphalt || '#3A3A40') : m === 'boardwalk' ? (X.deckWood || PAL.boardwalk || '#8B7355') : m === 'concrete' ? (X.concrete || '#B8B8BC') : P.gravel;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(NODASH); ctx.lineDashOffset = 0;
    ctx.lineWidth = w + 2.4 * px; ctx.strokeStyle = col(c, -0.6, 0.5); ctx.stroke();
    if (m === 'asphalt' || m === 'concrete') { ctx.lineWidth = w + 1.2 * px; ctx.strokeStyle = col(c, m === 'asphalt' ? 0.6 : -0.35); ctx.stroke(); }   // curb / kerb
    if (m === 'boardwalk') { ctx.lineWidth = w + 1.2 * px; ctx.strokeStyle = col(c, -0.75); ctx.stroke(); }   // the dark cypress edge
    ctx.lineWidth = w; ctx.strokeStyle = col(c, m === 'concrete' ? 0.1 : 0); ctx.stroke();
    if (!o.stub) {
      ctx.lineWidth = w * 0.55; ctx.strokeStyle = col(c, 0.3, m === 'asphalt' ? 0.3 : 0.5); ctx.stroke();
      ctx.save(); if (u > 1) ctx.translate(-px, 0); else ctx.translate(-1.1, -0.55); ctx.lineWidth = 1.2 * px; ctx.strokeStyle = col(c, 0.85, 0.5); ctx.stroke(); ctx.restore();
      if (env.lod === 0 || m !== 'gravel') {
        ctx.lineCap = 'butt';
        if (m === 'gravel') {
          ctx.lineWidth = 1.5 * px; ctx.setLineDash([1 * px, 4.2 * px]); ctx.lineDashOffset = (seed % 7) * 0.7 * px; ctx.strokeStyle = col(c, -0.45, 0.5); ctx.stroke();
          ctx.lineDashOffset = (seed % 5) * px + 2.2 * px; ctx.strokeStyle = col(c, 0.9, 0.55); ctx.stroke();
        } else if (m === 'asphalt') { ctx.lineWidth = 1.4 * px; ctx.setLineDash([4.5 * px, 4.5 * px]); ctx.strokeStyle = col(P.gold, 0.2, 0.9); ctx.stroke(); }
        else if (m === 'boardwalk') {
          ctx.lineWidth = w - 0.6 * px; ctx.setLineDash([1 * px, 2.9 * px]); ctx.strokeStyle = col(c, -0.7, 0.6); ctx.stroke();
          ctx.setLineDash([2 * px, 8.6 * px]); ctx.lineDashOffset = (seed % 9) * 1.6 * px + 1.3 * px; ctx.strokeStyle = col(c, 0.45, 0.4); ctx.stroke();
        } else { ctx.lineWidth = w - 1.2 * px; ctx.setLineDash([0.7 * px, 7 * px]); ctx.lineDashOffset = (seed % 5) * 1.3 * px; ctx.strokeStyle = col(c, -0.4, 0.5); ctx.stroke(); ctx.setLineDash(NODASH); ctx.lineWidth = 1.3 * px; ctx.strokeStyle = col(c, 0.5, 0.6); ctx.stroke(); }
      }
    }
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  // The primitive set (PLAN_HD_ART §1)
  // ---------------------------------------------------------------------------
  const FACE_T = { top: 0.05, sw: -0.1, se: -0.48, ne: -0.3, nw: 0.0 };
  const ROOF_T = { nw: 0.3, ne: -0.18, sw: 0.08, se: -0.5 };
  /** a shaded quad: o.face top / sw (lit) / se (shadow); o.material stucco | stone | wood | cloth | paint | metal | glass | glow */
  M.fillQuadShaded = function (ctx, pts, color, o, env) {
    o = o || {}; env = envOf(env); const f = o.face || 'top', m = o.material || 'paint', t = (FACE_T[f] || 0) + (o.t || 0);
    if (m === 'glow') { plane(ctx, pts, color, 0.1, { amp: 0.1, rim: 0 }); const c = centroid(pts), bb = bbox(pts); softEllipse(ctx, c[0], c[1], bb.w * 0.45, bb.h * 0.35, '#FFFFFF', 0.45, 0.1); return; }
    if (m === 'glass') {
      plane(ctx, pts, color, t - 0.1, { vert: true, amp: 0.3, rim: 0.4 }); const bb = bbox(pts);
      ctx.save(); poly(ctx, pts); ctx.clip(); ctx.fillStyle = css('#FFFFFF', 0.4); ctx.beginPath(); ctx.moveTo(bb.x0 - 2, bb.y0 + bb.h * 0.5); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.05); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.22); ctx.lineTo(bb.x0 - 2, bb.y0 + bb.h * 0.67); ctx.fill(); ctx.restore(); return;
    }
    plane(ctx, pts, color, t, { vert: f !== 'top', amp: m === 'cloth' ? 0.22 : m === 'metal' ? 0.3 : 0.14, spec: m === 'paint' || m === 'cloth' ? 0.18 : m === 'metal' ? 0.35 : 0 });
    if (m === 'stucco' || m === 'stone') microGrain(ctx, pts, 0.35, env);
    if (f !== 'top' && !o.noAO) { const bb = bbox(pts); const g = ctx.createLinearGradient(0, bb.y1 - Math.min(10, bb.h), 0, bb.y1); g.addColorStop(0, css(AO, 0)); g.addColorStop(1, css(AO, 0.25)); ctx.save(); poly(ctx, pts); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.w, bb.h); ctx.restore(); }
  };
  /** a roof plane whose FIRST edge (pts[0]→pts[1]) is the eave; o.facing nw / ne / sw / se; courses, ridge-side specular, eave shadow */
  M.roofPlane = function (ctx, pts, color, o, env) {
    o = o || {}; env = envOf(env); const t = ROOF_T[o.facing] || 0;
    const e0 = pts[0], e1 = pts[1], apex = pts.length === 4 ? lerp(pts[2], pts[3], 0.5) : pts[2], mid = lerp(e0, e1, 0.5);
    const g = ctx.createLinearGradient(mid[0], mid[1], apex[0], apex[1]); g.addColorStop(0, col(color, t - 0.2)); g.addColorStop(0.75, col(color, t + 0.15)); g.addColorStop(1, col(color, t + 0.45));
    poly(ctx, pts); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = col(color, t, 0.8); ctx.stroke();
    ctx.save(); poly(ctx, pts); ctx.clip();
    const n = env.lod > 0 ? 4 : 7;
    for (let i = 1; i < n; i++) {
      const f = i / n; const a = pts.length === 4 ? lerp(pts[0], pts[3], f) : lerp(pts[0], pts[2], f), b = lerp(pts[1], pts[2], f);
      ctx.lineWidth = 1; ctx.strokeStyle = col(color, t - 0.5, 0.35); ctx.beginPath(); ctx.moveTo(a[0], a[1] + 0.6); ctx.lineTo(b[0], b[1] + 0.6); ctx.stroke();
      ctx.strokeStyle = col(color, t + 0.6, 0.3); ctx.beginPath(); ctx.moveTo(a[0], a[1] - 0.6); ctx.lineTo(b[0], b[1] - 0.6); ctx.stroke();
    }
    if (o.facing === 'nw' || o.facing === 'sw') { const p = lerp(mid, apex, 0.8); softEllipse(ctx, p[0], p[1], 22, 5, SPEC, 0.3, 0.1); }
    ctx.lineCap = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = (o.facing === 'se' || o.facing === 'ne') ? css(RIM, 0.35) : col(color, t + 0.6, 0.5); ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
    ctx.restore();
    if ((o.facing === 'sw' || o.facing === 'se') && !o.noShadow) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; const sg = ctx.createLinearGradient(0, e0[1], 0, e0[1] + 12); sg.addColorStop(0, 'rgba(50,40,100,0.42)'); sg.addColorStop(1, 'rgba(50,40,100,0)'); ctx.fillStyle = sg; poly(ctx, [e0, e1, [e1[0], e1[1] + 12], [e0[0], e0[1] + 12]]); ctx.fill(); ctx.restore(); }
  };
  /** a cylinder standing on (x, yBase), height h, radius r: lit left, cool rim right, cap rings, contact AO */
  M.column = function (ctx, x, yb, h, r, color, env) {
    const g = ctx.createLinearGradient(x - r, 0, x + r, 0); g.addColorStop(0, col(color, 0)); g.addColorStop(0.3, col(color, 0.55)); g.addColorStop(0.6, col(color, 0.05)); g.addColorStop(0.9, col(color, -0.5)); g.addColorStop(1, col(RIM, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, yb - h, r * 2, h);
    ctx.fillStyle = col(color, -0.1); ctx.beginPath(); ctx.roundRect(x - r - 1, yb - h - 0.5, r * 2 + 2, 2.6, 0.8); ctx.fill(); ctx.beginPath(); ctx.roundRect(x - r - 1, yb - 2.4, r * 2 + 2, 2.6, 0.8); ctx.fill();
    const ao = ctx.createLinearGradient(0, yb - 8, 0, yb); ao.addColorStop(0, css(AO, 0)); ao.addColorStop(1, css(AO, 0.3)); ctx.fillStyle = ao; ctx.fillRect(x - r, yb - 8, r * 2, 8);
    void env;
  };
  /** terrace / slab faces of a tile toward the S (lower-left) and E (lower-right) neighbours; drop in ft */
  function faces(ctx, T, kind, env) {
    const cx = T.cx, cy = T.cy;
    const face = (pts, f, drop) => {
      if (kind === 'water') { plane(ctx, pts, P.waterDeep, FACE_T[f] - 0.1, { vert: true, amp: 0.25, rim: 0.15 }); return; }
      plane(ctx, pts, P.dirt, FACE_T[f], { vert: true, amp: 0.22, rim: 0.18 }); microGrain(ctx, pts, 0.3, env);
      ctx.save(); poly(ctx, pts); ctx.clip();
      const lip = kind === 'marsh' || kind === 'wet' ? P.wet : kind === 'high' ? P.highGrass : P.grass;
      poly(ctx, [pts[0], pts[1], [pts[1][0], pts[1][1] + 3.5], [pts[0][0], pts[0][1] + 3.5]]); const lg = ctx.createLinearGradient(0, pts[0][1], 0, pts[0][1] + 3.5); lg.addColorStop(0, col(lip, FACE_T[f] + 0.3)); lg.addColorStop(1, col(lip, FACE_T[f] - 0.35)); ctx.fillStyle = lg; ctx.fill();
      const g = ctx.createLinearGradient(0, pts[0][1] + 3, 0, pts[0][1] + 10); g.addColorStop(0, css(AO, 0.35)); g.addColorStop(1, css(AO, 0)); ctx.fillStyle = g; poly(ctx, [[pts[0][0], pts[0][1] + 3], [pts[1][0], pts[1][1] + 3], [pts[1][0], pts[1][1] + 10], [pts[0][0], pts[0][1] + 10]]); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = col(P.dirt, FACE_T[f] - 0.4, 0.5); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + drop * 0.62); ctx.lineTo(pts[1][0], pts[1][1] + drop * 0.62); ctx.stroke();
      ctx.restore();
    };
    if (T.dropS > 0) { const d = T.dropS * 6; face([[cx - 32, cy], [cx, cy + 16], [cx, cy + 16 + d], [cx - 32, cy + d]], 'sw', d); }
    if (T.dropE > 0) { const d = T.dropE * 6; face([[cx, cy + 16], [cx + 32, cy], [cx + 32, cy + d], [cx, cy + 16 + d]], 'se', d); }
  }
  /** the marsh pool field (shared with the knees overlay: the pen marsh painter's periodic field, cells 16×8 + 8×4, period 256×128) */
  const MARSH_SEED = hash(((BSU.T && BSU.T.MARSH) || 2) * 131 + 7, 0x51);
  M.marshField = function (env, x, y) { env = envOf(env); const wx = x + env.originX, wy = y + env.originY; return 0.55 * SP.pnoise(MARSH_SEED, wx, wy, 16, 8, 256, 128) + 0.30 * SP.pnoise(MARSH_SEED + 7, wx, wy, 8, 4, 256, 128) + 0.075; };
  /** the ground base: fill + seam stroke, the macro drift and (lod 0) the micro grain, then the caller's decorations clipped to the grown diamond */
  function groundBase(ctx, cx, cy, dia, fill, env, macroA, grainA) {
    poly(ctx, dia); ctx.fillStyle = fill; ctx.fill(); M.seamStroke(ctx, dia, fill, env);
    ctx.save(); poly(ctx, diamondGrown(cx, cy, 0.7)); ctx.clip();
    if (macroA > 0) M.macroGrain(ctx, dia, macroA, env);
    if (grainA > 0) M.microGrain(ctx, dia, grainA, env);
  }
  /** a ground diamond: T = {cx, cy, kind: grass | high | marsh | wet | dirt, seed, dropS, dropE, pool, t}; everything world-anchored through env
   *  (a posEnv for a cached variant, the chunk origin for a direct call): the macro drift, the grain, the patch / tuft / puddle / reed sites */
  M.groundTile = function (ctx, T, env) {
    env = envOf(env); const cx = T.cx, cy = T.cy, dia = diamond(cx, cy), kind = T.kind || 'grass', seed = (T.seed | 0), lod = env.lod, t0 = T.t || 0;
    faces(ctx, T, kind, env);
    if (kind === 'grass' || kind === 'high') {
      const base = kind === 'high' ? P.highGrass : P.grass;
      groundBase(ctx, cx, cy, dia, col(base, t0 + (kind === 'high' ? 0.05 : 0)), env, 0.5, 0.18);
      M.sites(env, seed + 11, cx, cy, 48, 24, 18, (x, y, r1, r2, r3) => { if (lod > 0 && r3 > 0.5) return; M.softEllipse(ctx, x, y, 10 + r1 * 8, 4.5 + r2 * 3, toneArr(sat(P.highGrass, SAT_C), 0.3), 0.24, 0.1); });
      M.sites(env, seed + 23, cx, cy, 48, 24, 18, (x, y, r1, r2, r3) => { if (r3 > 0.45) return; M.softEllipse(ctx, x, y, 9 + r1 * 7, 4 + r2 * 2.5, toneArr(sat(base, SAT_C), -0.35), 0.2, 0.1); });
      M.sites(env, seed + 37, cx, cy, 28, 14, 5, (x, y, r1, r2, r3) => { if (r3 > (lod > 0 ? 0.3 : 0.62)) return; M.orb(ctx, x, y - 1.2, 2.2 + r1 * 1.4, 1.6 + r2 * 0.8, kind === 'high' ? P.highGrass : P.grass, 0.1, { spec: 0.3 }); });
      if (kind === 'high') M.sites(env, seed + 41, cx, cy, 64, 32, 10, (x, y, r1, r2, r3) => { if (r3 > 0.3) return; M.softEllipse(ctx, x, y, 6 + r1 * 5, 2.5 + r2 * 1.5, toneArr(sat(P.sand, SAT_C), 0.2), 0.22, 0.2); });
      ctx.restore();
    } else if (kind === 'dirt') {
      groundBase(ctx, cx, cy, dia, col(mix(P.dirt, P.sand, 0.22), t0 + 0.08), env, 0.45, 0.25);
      M.sites(env, seed + 13, cx, cy, 44, 22, 16, (x, y, r1, r2, r3) => { if (lod > 0 && r3 > 0.5) return; M.softEllipse(ctx, x, y, 8 + r1 * 6, 3.5 + r2 * 2, toneArr(sat(P.dirt, SAT_C), -0.3), 0.3, 0.2); });
      M.sites(env, seed + 29, cx, cy, 40, 20, 10, (x, y, r1, r2, r3, h) => {   // cracks: short dark zig-zags
        if (r3 > 0.55) return; const pts = [[x, y]]; let px = x, py = y; for (let k = 0; k < 4; k++) { px += ((h >> (k * 3)) & 7) - 3 + (k & 1 ? 2 : -2); py += ((h >> (k * 2 + 5)) & 3) * 0.6 + 0.4; pts.push([px, py]); }
        M.stroke(ctx, pts, 0.9, P.dirt, -0.85, 0.7, { cap: 'round' });
      });
      ctx.restore();
    } else {
      const wet = kind === 'wet';
      groundBase(ctx, cx, cy, dia, col(P.wet, t0 + (wet ? 0 : -0.12)), env, 0.45, 0.22);
      M.sites(env, seed + 17, cx, cy, 44, 22, 16, (x, y, r1, r2, r3) => { if (lod > 0 && r3 > 0.5) return; M.softEllipse(ctx, x, y, 9 + r1 * 6, 4 + r2 * 2, toneArr(sat(P.marshMud, SAT_C), -0.2), 0.4, 0.3); });
      if (kind === 'marsh') {   // standing water where the pool field is low (the knees overlay keys on the same field), a mud rim, reed clumps
        M.sites(env, seed + 19, cx, cy, 32, 16, 12, (x, y, r1, r2) => { const n = M.marshField(env, x, y); if (n >= 0.42) return; const rx = 9 + r1 * 8, ry = 3.5 + r2 * 3; M.softEllipse(ctx, x, y + 0.5, rx + 4, ry + 2, toneArr(sat(P.marshMud, SAT_C), -0.9), 0.55, 0.4); M.puddle(ctx, x, y, rx, ry, env, { t: -0.4, spec: lod > 0 ? 0.2 : 0.32, rim: 0.18 }); });
        M.sites(env, seed + 31, cx, cy, 36, 18, 6, (x, y, r1, r2, r3, h) => { if (M.marshField(env, x, y) < 0.44 || r3 > (lod > 0 ? 0.5 : 0.8)) return; const n = 3 + (h & 3); for (let k = 0; k < n; k++) { const dx = (k - n / 2) * 1.6; M.blade(ctx, x + dx, y, 6 + ((h >> (k + 2)) & 7) + r1 * 4, dx * 0.8 + (r2 - 0.5) * 3, P.reed, 0.1, 1.4); } });
      }
      if (T.pool) M.puddle(ctx, cx, cy + 1, 16, 7, env);
      if (wet) M.sites(env, seed + 43, cx, cy, 48, 24, 8, (x, y, r1, r2, r3) => { if (r3 > (lod > 0 ? 0.3 : 0.5)) return; M.puddle(ctx, x, y, 3.5 + r1 * 3, 1.6 + r2 * 1.2, env, { t: -0.25, spec: 0.3, rim: 0.2 }); });
      ctx.restore();
    }
  };
  /** a water diamond: T = {cx, cy, seed, depth: 0 shallow (< 1.5 ft) | 1 mid | 2 deep (≥ 3 ft), shore: {n, e, s, w} edges that touch land
   *  (optional: the chunk's shore:ripple overlay carries them for cached tiles), pond, bayou}: the smooth surface, the macro drift, sand ripples on
   *  a shallow bed, caustic rings and glints (silver at night; lod 1 keeps a quarter of them so 0.5× stays calm) */
  M.waterTile = function (ctx, T, env) {
    env = envOf(env); const cx = T.cx, cy = T.cy, dia = diamond(cx, cy), seed = T.seed | 0, night = env.night, sh = T.shore || {}, lod = env.lod;
    if (T.dropS > 0 || T.dropE > 0) faces(ctx, T, 'water', env);
    const d = T.depth == null ? 1 : T.depth | 0;
    const base = T.pond ? mix(P.waterDeep, P.reed, 0.12) : d >= 2 ? P.waterDeep : d === 1 ? mix(P.waterDeep, P.waterDay, 0.55) : mix(P.waterDay, P.shallows, 0.22);
    groundBase(ctx, cx, cy, dia, col(base, d === 0 ? 0.12 : d === 1 ? 0.05 : -0.05), env, 0.3, 0);
    if (d === 0 && !T.pond) for (let k = -2; k <= 2; k++) {   // sand ripples on the shallow bed: pale rows that drift with the world y
      const y = cy + k * 6 + 1.5, ph = (y + env.originY) * 0.35; const pts = []; for (let x = cx - 34; x <= cx + 34; x += 6) pts.push([x, y + 1.6 * Math.sin((x + env.originX) * 0.45 + ph)]);
      M.stroke(ctx, pts, 1.1, P.shallows, 0.35, lod > 0 ? 0.22 : 0.32, { smooth: true, cap: 'round' });
    }
    const edges = { n: [dia[3], dia[0]], e: [dia[0], dia[1]], s: [dia[1], dia[2]], w: [dia[2], dia[3]] };
    for (const k in edges) if (sh[k]) { M.edgeFade(ctx, dia, edges[k][0], edges[k][1], 10, P.shallows, 0.55, 0.75); M.stroke(ctx, [edges[k][0], edges[k][1]], 1.2, '#F2FFF8', 0, 0.6); }
    M.sites(env, seed + 5, cx, cy, 40, 20, 10, (x, y, r1, r2, r3) => { if (r3 > (lod > 0 ? 0.35 : 0.7)) return; ctx.lineWidth = 0.9; ctx.strokeStyle = col(base, 0.6, 0.28); ellipse(ctx, x, y, 6 + r1 * 6, 2.2 + r2 * 2); ctx.stroke(); });
    M.sites(env, seed + 9, cx, cy, 30, 15, 8, (x, y, r1, r2, r3) => { if (r3 > (lod > 0 ? 0.25 : 0.75)) return; M.softEllipse(ctx, x, y, 3 + r1 * 4, 0.7 + r2 * 0.5, night ? '#C9D8FF' : SPEC, night ? 0.45 : 0.5, 0.25); });
    if (T.pond) M.sites(env, seed + 15, cx, cy, 48, 24, 8, (x, y, r1, r2, r3) => { if (r3 > 0.5) return; M.softEllipse(ctx, x, y, 3 + r1 * 3, 1.3 + r2 * 1.2, toneArr(sat(P.reed, SAT_C), -0.3), 0.55, 0.4); });   // algae
    ctx.restore();
  };
  /** a smooth polyline of screen points, width w: gravel by default (o.material: gravel | asphalt | boardwalk | concrete) — strokePath + gravel orbs */
  M.path = function (ctx, pts, w, env, o) {
    if (!pts || pts.length < 2) return; env = envOf(env); o = o || {};
    smoothPath(ctx, pts); M.strokePath(ctx, w, env, { material: o.material, unit: 1, seed: (pts[0][0] * 5 + 11) | 0 });
    if ((o.material || 'gravel') === 'gravel' && env.lod === 0) { const r = M.rng((pts[0][0] * 5 + 11) | 0); for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 2; k++) { const p = lerp(pts[i], pts[i + 1], r()); orb(ctx, p[0] + (r() - 0.5) * w * 0.6, p[1] + (r() - 0.5) * w * 0.3, 1.1, 0.8, P.gravel, 0.1, { noRim: true, spec: 0.5 }); } }
  };
  /** a tree at trunk base (x, y): kind liveOak | cypress; o = {seed, inWater, stage} */
  M.tree = function (ctx, x, y, kind, o, env) {
    o = o || {}; env = envOf(env); const r = M.rng((o.seed | 0) * 13 + 5), sc = o.stage === 0 ? 0.55 : o.stage === 1 ? 0.8 : 1;
    const cyl = (pl) => { const bb = bbox(pl); const g = ctx.createLinearGradient(bb.x0, 0, bb.x1, 0); g.addColorStop(0, col(P.bark, -0.2)); g.addColorStop(0.35, col(P.bark, 0.45)); g.addColorStop(0.7, col(P.bark, -0.2)); g.addColorStop(1, col(P.bark, -0.6)); poly(ctx, pl); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = css(RIM, 0.25); ctx.stroke(); };
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); x = 0; y = 0;
    softEllipse(ctx, x, y + 1, 13, 5, '#1E1946', 0.4, 0.2);
    if (kind === 'liveOak' || kind === 'oak') {
      cyl([[x - 6, y + 1], [x + 6, y + 1], [x + 3.5, y - 18], [x + 15, y - 40], [x + 11, y - 42], [x + 1, y - 27], [x - 10, y - 44], [x - 14, y - 41], [x - 3.5, y - 18]]);
      const cxs = x + 2, cys = y - 54; const orbs = [];
      for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2 + r() * 0.5, d = i === 0 ? 0 : 0.5 + r() * 0.5; orbs.push({ x: cxs + Math.cos(a) * 46 * d, y: cys + Math.sin(a) * 19 * d, r: 14 + r() * 9 }); }
      orbs.sort((p, q) => p.y - q.y);
      for (const ob of orbs) { const t = -((ob.y - cys) / 19) * 0.25 - ((ob.x - cxs) / 46) * 0.15; orb(ctx, ob.x, ob.y, ob.r, ob.r * 0.82, P.oakLeaf, t, { spec: 0.22 }); }
      softEllipse(ctx, cxs, cys + 16, 40, 10, '#1E1946', 0.25, 0.1);
      const strands = env.lod > 0 ? 8 : 16; ctx.lineCap = 'round';
      for (let i = 0; i < strands; i++) { const sx = cxs + (r() - 0.5) * 92, sy = cys + 8 + r() * 13, len = 10 + r() * 16; const mg = ctx.createLinearGradient(0, sy, 0, sy + len); mg.addColorStop(0, col(P.moss, 0.3, 0.9)); mg.addColorStop(1, col(P.moss, 0.55, 0.15)); ctx.strokeStyle = mg; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + (r() - 0.5) * 4, sy + len * 0.5, sx + (r() - 0.5) * 3, sy + len); ctx.stroke(); }
    } else {
      if (o.inWater) for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2, d = 10 + r() * 10; const kx = x + Math.cos(a) * d, ky = y + Math.sin(a) * d * 0.45 + 2, kh = 4 + r() * 4; ctx.lineWidth = 0.8; ctx.strokeStyle = css('#F2FFF8', 0.45); ellipse(ctx, kx, ky + 1, 4.5, 1.7); ctx.stroke(); cyl([[kx - 2.2, ky + 1], [kx + 2.2, ky + 1], [kx + 0.8, ky - kh], [kx - 0.8, ky - kh]]); }
      cyl([[x - 7.5, y + 2], [x + 7.5, y + 2], [x + 3, y - 14], [x + 2, y - 80], [x - 2, y - 80], [x - 3, y - 14]]);
      const leaf = mix(P.cypressLeaf, P.cypressRust, o.autumn ? 0.75 : 0.22);
      for (let i = 0; i < 6; i++) { const ty = y - 26 - i * 11.5, rx = 18 - i * 2.6; const n = 6 - Math.floor(i / 2); for (let k = 0; k < n; k++) { const f = n === 1 ? 0 : (k / (n - 1)) * 2 - 1; const ox = x + f * rx * 0.8, oy = ty + Math.abs(f) * 2.5 + ((k % 2) - 0.5) * 2; orb(ctx, ox, oy, 6.5 - i * 0.5, 5 - i * 0.35, leaf, 0.05 + i * 0.03 - f * 0.12, { spec: 0.15 }); } softEllipse(ctx, x, ty + 5, rx * 0.8, 2.4, '#1E1946', 0.22, 0.2); }
      orb(ctx, x, y - 92, 4.5, 6.5, leaf, 0.2, { spec: 0.2 });
    }
    ctx.restore();
  };
  /** a figure standing on (x, y): f = {facing sw|se|ne|nw, walk phase 0–1 or null, shirt: hex or 'purple'|'gold', trim, skin, hair, seed} */
  M.figure = function (ctx, x, y, f, env) {
    f = f || {}; void env;
    const shirt = f.shirt === 'purple' ? P.purple : f.shirt === 'gold' ? P.gold : (f.shirt || P.purple), trim = f.trim || (f.shirt === 'purple' ? P.gold : P.purple);
    const skin = f.skin || P.skin, hair = f.hair || P.hair, pants = f.pants || P.denim;
    const back = f.facing === 'ne' || f.facing === 'nw', ph = f.walk == null ? 0 : Math.sin(f.walk * Math.PI * 2), bob = f.walk == null ? 0 : Math.abs(ph) * 0.6;
    ctx.save(); ctx.translate(x, y - bob); ctx.lineCap = 'round';
    const grad = (c, x0, x1, t0, t1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, col(c, t0)); g.addColorStop(0.4, col(c, (t0 + t1) / 2 + 0.2)); g.addColorStop(1, col(c, t1)); return g; };
    ctx.strokeStyle = grad(pants, -3, 3, 0.1, -0.5); ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(-1.6, -7); ctx.lineTo(-1.6 - ph * 2.2, -0.5); ctx.moveTo(1.6, -7); ctx.lineTo(1.6 + ph * 2.2, -0.5); ctx.stroke();
    ctx.fillStyle = grad(shirt, -4, 4, 0.2, -0.55); ctx.beginPath(); ctx.roundRect(-3.8, -15.6, 7.6, 9.6, 3.2); ctx.fill();
    ctx.strokeStyle = css(RIM, 0.3); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.roundRect(-3.8, -15.6, 7.6, 9.6, 3.2); ctx.stroke();
    ctx.fillStyle = col(trim, 0.1); ctx.beginPath(); ctx.roundRect(-3.3, -11.3, 6.6, 1.3, 0.6); ctx.fill();
    ctx.strokeStyle = grad(shirt, -4, 4, 0.1, -0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3.9, -14); ctx.lineTo(-4.7 + ph * 1.5, -8.5); ctx.moveTo(3.9, -14); ctx.lineTo(4.7 - ph * 1.5, -8.5); ctx.stroke();
    orb(ctx, 0, -18.6, 3.4, 3.4, skin, 0.05, { spec: 0.5 });
    ctx.fillStyle = grad(hair, -3, 3, 0.3, -0.4); ctx.beginPath(); ctx.arc(0, -19.2, 3.5, Math.PI * (back ? 0.05 : 1.05), Math.PI * (back ? 0.95 : 1.95)); ctx.fill(); if (back) ctx.fillRect(-3.5, -19.2, 7, 2.5);
    ctx.restore();
  };
  // ---------------------------------------------------------------------------
  // H4 characters pass — the body kit primitives (sprites_entities_hd.js composes every limb, body, tail and hull from these)
  // ---------------------------------------------------------------------------
  /** a tapered capsule A → B (art px) lit ACROSS its width: the flank that faces the key light (upper-left) is light, the other
   *  carries the cool rim; limbs, bodies, tails, hulls, poles. o: {amp (.3), rim (alpha .22), spec (alpha), a (alpha), flat (no rim)} */
  M.capsule = function (ctx, ax, ay, bx, by, ra, rb, color, t, o) {
    o = o || {}; ra = ra > 0 ? ra : 0; rb = rb > 0 ? rb : 0; if (!ra && !rb) return;
    const dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy);
    if (L < 0.05) { orb(ctx, ax, ay, Math.max(ra, rb), Math.max(ra, rb), color, t, { spec: o.spec, noRim: o.flat }); return; }
    const amp = o.amp == null ? 0.3 : o.amp, ang = Math.atan2(dy, dx);
    let nx = -dy / L, ny = dx / L; if (nx + ny > 0) { nx = -nx; ny = -ny; }   // the normal that faces the key light (upper-left)
    const rm = Math.max(ra, rb), mx = (ax + bx) / 2, my = (ay + by) / 2;
    const g = ctx.createLinearGradient(mx + nx * rm, my + ny * rm, mx - nx * rm, my - ny * rm);
    g.addColorStop(0, col(color, t + amp, o.a)); g.addColorStop(0.42, col(color, t + amp * 0.3, o.a)); g.addColorStop(1, col(color, t - amp * 1.5, o.a));
    ctx.beginPath(); ctx.arc(ax, ay, ra, ang + Math.PI / 2, ang + Math.PI * 1.5); ctx.arc(bx, by, rb, ang - Math.PI / 2, ang + Math.PI / 2); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    if (!o.flat && rm > 0.9) { ctx.lineCap = 'round'; ctx.lineWidth = 0.7; ctx.strokeStyle = css(RIM, o.rim == null ? 0.22 : o.rim); ctx.beginPath(); ctx.moveTo(ax - nx * (ra - 0.4), ay - ny * (ra - 0.4)); ctx.lineTo(bx - nx * (rb - 0.4), by - ny * (rb - 0.4)); ctx.stroke(); }
    if (o.spec) { ctx.fillStyle = css(SPEC, o.spec); ctx.beginPath(); ctx.ellipse(ax + dx * 0.3 + nx * rm * 0.45, ay + dy * 0.3 + ny * rm * 0.45, Math.max(0.5, L * 0.18), Math.max(0.3, rm * 0.22), ang, 0, Math.PI * 2); ctx.fill(); }
  };
  const GLYPH = {
    0: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]], 1: [[[1, 0], [1, 4]]], 2: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 4], [2, 4]]], 3: [[[0, 0], [2, 0], [2, 4], [0, 4]], [[0, 2], [2, 2]]],
    4: [[[0, 0], [0, 2], [2, 2]], [[2, 0], [2, 4]]], 5: [[[2, 0], [0, 0], [0, 2], [2, 2], [2, 4], [0, 4]]], 6: [[[2, 0], [0, 0], [0, 4], [2, 4], [2, 2], [0, 2]]],
    7: [[[0, 0], [2, 0], [2, 4]]], 8: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], [[0, 2], [2, 2]]], 9: [[[2, 2], [0, 2], [0, 0], [2, 0], [2, 4], [0, 4]]]
  };
  /** a string of digits as round-capped strokes on a 3 × 5 grid, h px tall, centred on (x, y): jersey numbers, the down marker
   *  (fonts are not deterministic across machines, strokes are). o: {w stroke width, a alpha, sx horizontal squash (a turned torso), skew} */
  M.digits = function (ctx, x, y, str, h, color, t, o) {
    o = o || {}; str = String(str == null ? '' : str); if (!str.length || !(h > 0)) return;
    const u = h / 4, sx = o.sx == null ? 1 : Math.max(0.15, o.sx), cw = 2 * u * sx, gap = u * sx * 0.9, W = str.length * cw + (str.length - 1) * gap, skew = o.skew || 0;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = o.w || Math.max(0.5, h * 0.2); ctx.strokeStyle = col(color, t, o.a);
    let x0 = x - W / 2;
    for (const ch of str) {
      const gl = GLYPH[ch];
      if (gl) for (const seg of gl) { ctx.beginPath(); for (let i = 0; i < seg.length; i++) { const px = x0 + seg[i][0] * u * sx + (seg[i][1] - 2) * u * skew, py = y + (seg[i][1] - 2) * u; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke(); }
      x0 += cw + gap;
    }
    ctx.restore();
  };
  /** contact / cast shadow (multiply): {x, y, rx, ry, a} ellipse or {poly, soft, a} */
  M.shadow = function (ctx, s, env) {
    void env; ctx.save(); ctx.globalCompositeOperation = 'multiply'; const a = Number.isFinite(s.a) ? s.a : 0.3;
    if (s.poly) { for (let i = 4; i >= 1; i--) { poly(ctx, s.poly); ctx.lineJoin = 'round'; ctx.lineWidth = (s.soft || 4) * i * 0.7; ctx.strokeStyle = css(SHADOW_C, a * 0.16); ctx.stroke(); } poly(ctx, s.poly); ctx.fillStyle = css(SHADOW_C, a * 0.75); ctx.fill(); }
    else { softEllipse(ctx, s.x, s.y, s.rx, s.ry, SHADOW_C, a * 0.9, 0.35); softEllipse(ctx, s.x - s.rx * 0.2, s.y, s.rx * 0.5, s.ry * 0.5, SHADOW_C, a * 0.5, 0.3); }
    ctx.restore();
  };
  /** additive light (the lights pass, scaled by nightAmount): {x, y, r, color, a} bloom, {quad} window, {pool, rx, ry} ground pool, firefly */
  M.light = function (ctx, s, env) {
    void env; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const a = Number.isFinite(s.a) ? s.a : 0.8, color = s.color || PAL.windowGlow || '#FFD27A';
    if (s.quad) { poly(ctx, s.quad); ctx.fillStyle = css(color, 0.35); ctx.fill(); const c = centroid(s.quad), bb = bbox(s.quad); const h = s.halo || 8; softEllipse(ctx, c[0], c[1] + 1, bb.w * 0.5 + h * 1.6, bb.h * 0.5 + h, color, 0.16, 0.1); softEllipse(ctx, c[0], c[1] + 1, bb.w * 0.5 + h * 0.6, bb.h * 0.5 + h * 0.4, color, 0.25, 0.2); }
    else if (s.pool) { softEllipse(ctx, s.x, s.y, s.rx, s.ry, color, a * 0.55, 0.05); softEllipse(ctx, s.x, s.y, s.rx * 0.55, s.ry * 0.55, color, a * 0.45, 0.1); }
    else { const r = s.r || 8; softEllipse(ctx, s.x, s.y, r * 1.4, r * 1.4, color, a * 0.35, 0.02); softEllipse(ctx, s.x, s.y, r * 0.7, r * 0.7, color, a * 0.6, 0.08); softEllipse(ctx, s.x, s.y, r * 0.22, r * 0.22, '#FFFFFF', a * 0.9, 0.3); if (s.firefly) { ctx.fillStyle = css('#F4FFC0', 0.95); ctx.beginPath(); ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };
  /** a lit material in the BASE pass (a window at night, a lantern pane): fillQuadShaded with material 'glow' */
  M.glow = function (ctx, pts, color, env) { M.fillQuadShaded(ctx, pts, color || PAL.windowGlow || '#FFD27A', { material: 'glow' }, env); };
  /** a flat emblem on a face: d = {x, y, w, h, color, trim, shape: rect | disc | diamond, face}; bottom-centre anchored */
  M.decal = function (ctx, d, env) {
    env = envOf(env); const w = d.w || 8, h = d.h || 6, x = d.x, y = d.y, c = d.color || P.purple, tr = d.trim || P.gold, t = FACE_T[d.face || 'sw'] || 0;
    ctx.save();
    if (d.shape === 'disc') { orb(ctx, x, y - h / 2, w / 2, h / 2, c, t, { spec: 0.3 }); if (tr) { ctx.lineWidth = 0.9; ctx.strokeStyle = col(tr, 0.2); ellipse(ctx, x, y - h / 2, w / 2 - 0.6, h / 2 - 0.6); ctx.stroke(); } }
    else {
      const pts = d.shape === 'diamond' ? [[x, y - h], [x + w / 2, y - h / 2], [x, y], [x - w / 2, y - h / 2]] : [[x - w / 2, y - h], [x + w / 2, y - h], [x + w / 2, y], [x - w / 2, y]];
      plane(ctx, pts, c, t, { amp: 0.18, spec: 0.2, vert: true });
      if (tr) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.8, Math.min(w, h) * 0.12); ctx.strokeStyle = col(tr, 0.15); poly(ctx, d.shape === 'diamond' ? pts : [[x - w / 2 + 1, y - h + 1], [x + w / 2 - 1, y - h + 1], [x + w / 2 - 1, y - 1], [x - w / 2 + 1, y - 1]]); ctx.stroke(); }
    }
    ctx.restore();
  };
  /** the H0 proof sprite: a shaded iso cube of size s standing on the diamond centre (x, y); three faces, a gold decal, contact shadow */
  M.cube = function (ctx, x, y, s, color, env) {
    env = envOf(env); const hw = s, hh = s / 2, h = s; color = color || P.purple;
    M.shadow(ctx, { x: x + 4, y: y + 1, rx: hw * 1.25, ry: hh * 1.2, a: 0.35 }, env);
    M.fillQuadShaded(ctx, [[x - hw, y - h], [x, y - h + hh], [x, y + hh], [x - hw, y]], color, { face: 'sw', material: 'paint' }, env);
    M.fillQuadShaded(ctx, [[x, y - h + hh], [x + hw, y - h], [x + hw, y], [x, y + hh]], color, { face: 'se', material: 'paint' }, env);
    M.fillQuadShaded(ctx, [[x, y - h - hh], [x + hw, y - h], [x, y - h + hh], [x - hw, y - h]], color, { face: 'top', material: 'paint' }, env);
    M.decal(ctx, { x: x - hw / 2, y: y - h * 0.25 + hh / 4, w: s * 0.42, h: s * 0.3, color: P.gold, trim: color, shape: 'rect', face: 'sw' }, env);
  };
  /** size an HD painter's canvas (sprites.beginHD) → {w, h, S, env}; the shorthand every HD painter starts with */
  M.begin = function (ctx, w, h, spec) { return SP.beginHD(ctx, w, h, spec); };

  // ---------------------------------------------------------------------------
  // H5 effects pass — the BLOB CACHE (docs/ART_STYLE.md "## Effects (H5)"). Every soft thing an effect pass draws more than once a frame — a
  // light halo, a lamp pool, a firefly, a firework head, a steam puff, a puddle, a contact-AO ellipse, a fog lump, a mast cone — is baked ONCE
  // per (kind, colour, radius) at DEVICE pixels and drawn with drawImage: no per-particle gradient at draw time (PLAN_HD_ART §5). The radius
  // is quantised onto a fine ladder (every integer px to 24, then 5 % steps) so a halo that breathes 2.2 → 2.6 × does not bake 40 canvases; drawBlob draws it at the quantised size (≤ 2.5 % off
  // the radius asked for) with the centre snapped to a device pixel. A bounded LRU: 640 entries / 20 MB, least-recently-used quarter out first.
  //   blob(kind, color, rx, ry, o) → {canvas, w, h, rx, ry, key} | null    rx / ry in DEVICE px (CSS px × dpr × zoom)
  //   kinds: halo (gaussian falloff) · glow (bloom: halo + white-hot core, o.core) · pool (flat centre, ground pool) · dot (firefly / spark head)
  //          haze (the stadium's glow dome: a pale veil under a warm pool, one blit) · puff (three soft lobes: steam, smoke) · ao (cool contact shadow) · foam (flat streak) · ring (a splash ring) · cone (a soft-edged mast cone, apex up)
  //          puddle (color = 'day' | 'dusk' | 'night': wet halo, sky body, rim, glint; ry = rx / 2) · fog (color = 'r,g,b', o.seed: 7 lumps)
  //          vignette (the whole canvas: clear centre, dark edges; draw it stretched over the frame)
  // ---------------------------------------------------------------------------
  // The ladder is every integer device px up to 24, then 5 % steps up to 320: a halo is drawn at its QUANTISED size on a device-pixel-snapped centre, so the
  // blit is a 1:1 pixel copy (software raster: ~7× cheaper than a scaled, sub-pixel bilinear blit) and the size error is ≤ 2.5 %, invisible in a gradient.
  const BLOB_LADDER = (function () { const L = [2]; for (let r = 3; r <= 24; r++) L.push(r); for (let r = 24; r < 320; r = Math.ceil(r * 1.05)) if (r > L[L.length - 1]) L.push(r); L.push(320); return L; })();
  function blobQ(r) {
    const L = BLOB_LADDER; if (!(r > L[0])) return L[0]; if (r >= L[L.length - 1]) return L[L.length - 1];
    let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= r) lo = m; else hi = m; }
    return (r / L[lo] < L[hi] / r) ? L[lo] : L[hi];   // nearest on a log scale
  }
  M.blobQ = blobQ;
  const blobMap = new Map(); let blobBytes = 0, blobUse = 0, blobBakes = 0, blobHits = 0;
  const BLOB_MAX = 640, BLOB_MAX_BYTES = 20 * 1048576;
  /** a gaussian-ish falloff as gradient stops: alpha(t) = a · (exp(−k·u²) − exp(−k)) / (1 − exp(−k)), u = max(0, (t − plateau) / (1 − plateau)) */
  function gaussStops(g, color, a, k, plateau) {
    const e1 = Math.exp(-k); plateau = plateau || 0;
    for (let i = 0; i <= 8; i++) { const t = i / 8, u = t <= plateau ? 0 : (t - plateau) / (1 - plateau); g.addColorStop(t, css(color, Math.max(0, a * (Math.exp(-k * u * u) - e1) / (1 - e1)))); }
  }
  function radialFill(ctx, cx, cy, rx, ry, stopsFn) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); stopsFn(g);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const PUD_PAL = { day: ['#1B2230', '#6E93AE', '#DCEBF5'], dusk: ['#161C2A', '#42586F', '#9DB2C6'], night: ['#10141F', '#1E2A3F', '#566B88'] };   // wet halo / sky in the water / glint
  const BLOB = {
    halo(ctx, W, H, color, o) { radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, o.a == null ? 1 : o.a, 4.2, 0)); },
    glow(ctx, W, H, color, o) {
      const a = o.a == null ? 1 : o.a, core = o.core == null ? 0.17 : o.core;
      radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, a, 4.6, 0));
      radialFill(ctx, W / 2, H / 2, W / 2 * core * 2.2, H / 2 * core * 2.2, (g) => { g.addColorStop(0, css('#FFFFFF', 0.95 * a)); g.addColorStop(0.35, css(mix(color, '#FFFFFF', 0.6), 0.55 * a)); g.addColorStop(1, css(color, 0)); });
    },
    pool(ctx, W, H, color, o) { radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, o.a == null ? 1 : o.a, 3.6, 0.2)); },
    ao(ctx, W, H, color, o) { radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, o.a == null ? 1 : o.a, 3.2, 0.32)); },
    foam(ctx, W, H, color, o) { radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, o.a == null ? 1 : o.a, 3.0, 0.4)); },
    haze(ctx, W, H, color, o) {   // the stadium's glow dome in ONE canvas: a pale veil (rx .77 of the canvas, ry .51 of it, centred a hair above the middle) under a warm ground pool filling it — one blit instead of two
      const a = o.a == null ? 1 : o.a, hx = W / 2 / 1.3, hy = H / 2 * 0.6 / 0.7;
      radialFill(ctx, W / 2, H / 2 - hx * 0.1, hx, hy, (g) => gaussStops(g, '#DCE4E8', 0.275 * a, 4.2, 0));
      radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, 0.323 * a, 3.6, 0.2));
    },
    ring(ctx, W, H, color, o) {   // an expanding splash ring: a soft 2:1 ellipse line (width ≈ 1 px), brightest at its near (lower) rim
      const a = o.a == null ? 1 : o.a, lw = Math.max(0.9, Math.min(W, H) * 0.12);
      ctx.lineWidth = lw * 2.4; ctx.strokeStyle = css(color, 0.18 * a); ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W / 2 - lw * 1.4, H / 2 - lw * 1.4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = css(color, 0.85 * a); ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W / 2 - lw * 1.4, H / 2 - lw * 1.4, 0, 0, Math.PI * 2); ctx.stroke();
    },
    dot(ctx, W, H, color, o) {
      const a = o.a == null ? 1 : o.a;
      radialFill(ctx, W / 2, H / 2, W / 2, H / 2, (g) => gaussStops(g, color, a * 0.9, 8, 0));
      radialFill(ctx, W / 2, H / 2, W / 2 * 0.3, H / 2 * 0.3, (g) => { g.addColorStop(0, css('#FFFFFF', a)); g.addColorStop(0.6, css(mix(color, '#FFFFFF', 0.5), 0.7 * a)); g.addColorStop(1, css(color, 0)); });
    },
    puff(ctx, W, H, color, o) {
      const a = o.a == null ? 0.6 : o.a;
      for (const l of [[0, 0, 0.62, 0.62, 1], [-0.28, 0.12, 0.5, 0.46, 0.8], [0.3, -0.1, 0.46, 0.44, 0.8], [0.04, -0.26, 0.4, 0.36, 0.6]]) {
        radialFill(ctx, W / 2 + l[0] * W / 2, H / 2 + l[1] * H / 2, W / 2 * l[2], H / 2 * l[3], (g) => { g.addColorStop(0, css(color, a * l[4])); g.addColorStop(0.35, css(color, a * l[4] * 0.62)); g.addColorStop(1, css(color, 0)); });
      }
    },
    cone(ctx, W, H, color, o) {   // apex up, widening to the full width at the bottom; three nested wedges = a soft edge, then a fade along the length
      const a = o.a == null ? 0.9 : o.a;
      for (let k = 0; k < 3; k++) {
        const sp = 1 - k * 0.14, ap = 2 + k * 1.2;
        ctx.fillStyle = css(color, a * (k === 0 ? 0.3 : 0.4)); ctx.beginPath(); ctx.moveTo(W / 2 - ap, 0); ctx.lineTo(W / 2 + ap, 0); ctx.lineTo(W / 2 + W / 2 * sp, H); ctx.lineTo(W / 2 - W / 2 * sp, H); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'destination-in'; const m = ctx.createLinearGradient(0, 0, 0, H);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.4, 'rgba(0,0,0,0.5)'); m.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = m; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    },
    puddle(ctx, W, H, color, o) {   // W × H = 2:1: the wet ground, the sky in the water, a cool rim, a lit sliver on the upper-left
      const P = PUD_PAL[color] || PUD_PAL.day, cx = W / 2, cy = H / 2, rx = W / 2, ry = H / 2;
      radialFill(ctx, cx, cy, rx, ry, (g) => gaussStops(g, P[0], 0.3, 3.2, 0.4));
      radialFill(ctx, cx, cy, rx * 0.74, ry * 0.74, (g) => { g.addColorStop(0, css(P[1], 0.52)); g.addColorStop(0.78, css(P[1], 0.46)); g.addColorStop(1, css(P[1], 0)); });
      radialFill(ctx, cx - rx * 0.12, cy - ry * 0.14, rx * 0.5, ry * 0.46, (g) => { g.addColorStop(0, css(P[2], 0.26)); g.addColorStop(1, css(P[2], 0)); });
      ctx.lineWidth = Math.max(0.8, rx * 0.04); ctx.strokeStyle = css(P[0], 0.3); ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.7, ry * 0.7, 0, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
      radialFill(ctx, cx - rx * 0.36, cy - ry * 0.3, rx * 0.24, Math.max(1, ry * 0.07), (g) => { g.addColorStop(0, css(P[2], 0.75)); g.addColorStop(1, css(P[2], 0)); });
    },
    vignette(ctx, W, H, color, o) {   // the night frame: clear in the middle, darkening toward the edges and corners (one stretched canvas replaces 24 stacked edge bands)
      const a = o.a == null ? 1 : o.a;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(W / 2, H / 2); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.45);
      for (const st of [[0, 0], [0.58, 0], [0.76, 0.07], [0.92, 0.26], [1.04, 0.42], [1.25, 0.56], [1.45, 0.66]]) g.addColorStop(st[0] / 1.45, css(color, st[1] * a));
      ctx.fillStyle = g; ctx.fillRect(-1.5, -1.5, 3, 3); ctx.restore();
    },
    fog(ctx, W, H, color, o) {   // seven overlapping lumps on a 2:1 sheet, then a soft elliptical mask: the B5 wisp, at device resolution
      const seed = o.seed | 0, c = color.split(',').map(Number);
      for (let b = 0; b < 7; b++) {
        const h = hash(seed * 31 + b, 977), cx = (22 + b * 14 + ((h & 15) - 8) * 1.2) / 128 * W, cy = H / 2 + (((h >> 4) & 15) - 8) * 2.2 / 64 * H, r = (22 + ((h >> 8) & 15) * 1.4) / 64 * (W / 2), a = 0.3 + 0.14 * (((h >> 12) & 7) / 7);
        radialFill(ctx, cx, cy, r, r * 0.5, (g) => { g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'); g.addColorStop(0.55, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a * 0.4).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)'); });
      }
      ctx.globalCompositeOperation = 'destination-in'; ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(W / 2, H / 2); const mk = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);   // the mask is a RECT fill: destination-in must clear the corners too
      mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(0.5, 'rgba(0,0,0,0.9)'); mk.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = mk; ctx.fillRect(-1, -1, 2, 2); ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    }
  };
  M.blobKinds = Object.keys(BLOB);
  /** the cached blob for (kind, color, rx, ry) — radii in device px (quantised onto the ladder; ≥ 2, capped at 320) — or null (unknown kind, no canvas) */
  M.blob = function (kind, color, rx, ry, o) {
    const fn = BLOB[kind]; if (!fn || !(rx > 0)) return null;
    if (!(ry > 0)) ry = rx;
    o = o || {};
    const qx = blobQ(rx), qy = blobQ(ry), key = kind + '|' + color + '|' + qx + '|' + qy + '|' + (o.a == null ? '' : Math.round(o.a * 100)) + '|' + (o.core == null ? '' : Math.round(o.core * 100)) + '|' + (o.seed | 0);
    let e = blobMap.get(key);
    if (e !== undefined) { blobHits++; e.used = ++blobUse; return e; }
    try {
      const W = Math.max(2, Math.ceil(qx * 2)), H = Math.max(2, Math.ceil(qy * 2));
      const c = SP.newCanvas(W, H), g = SP.ctx2d(c);
      try { c.width = W; c.height = H; g.imageSmoothingEnabled = true; } catch (err) { /* stub */ }
      fn(g, W, H, color, o);
      e = { canvas: c, w: W, h: H, rx: qx, ry: qy, key: key, used: ++blobUse, bytes: W * H * 4 };
    } catch (err) { return null; }
    blobBakes++; blobBytes += e.bytes; blobMap.set(key, e);
    if (blobMap.size > BLOB_MAX || blobBytes > BLOB_MAX_BYTES) {   // drop the least recently used quarter (never the entry just baked)
      const arr = [...blobMap.values()].sort((a1, b1) => a1.used - b1.used); const n = Math.ceil(arr.length / 4);
      for (let i = 0; i < n; i++) { const v = arr[i]; if (v === e) continue; blobMap.delete(v.key); blobBytes -= v.bytes; try { v.canvas.width = 1; v.canvas.height = 1; } catch (err) { /* stub */ } }
    }
    return e;
  };
  /** draw a blob centred at (cx, cy) with radii (rx, ry) in the context's own units (CSS px under a dpr transform; `scale` = device px per unit). The blob is drawn at
   *  its baked (quantised) device size on a device-pixel-snapped centre — a 1:1 copy; false when none could be had */
  M.drawBlob = function (g, kind, color, cx, cy, rx, ry, alpha, scale, o) {
    const sc = scale || 1, b = M.blob(kind, color, rx * sc, ry * sc, o); if (!b) return false;
    g.globalAlpha = alpha;
    if (rx * sc > b.rx * 1.08 || ry * sc > b.ry * 1.08) {   // past the ladder's 320-px cap: stretch the biggest blob (a smooth gradient scales cleanly)
      if (kind !== 'haze') { g.drawImage(b.canvas, cx - rx, cy - ry, rx * 2, ry * 2); return true; }
      // H7b: the stadium haze is the one blob that always lands here (a game-night dome spans 2-3 frames at the game camera: ~5 M device px at 1440 x 900 / dpr 2): its alpha moves under half a level per
      // source px, so a nearest-neighbour stretch is within a level of the bilinear one and costs 2.5x less in software raster (7 ms against 17.5)
      const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(b.canvas, cx - rx, cy - ry, rx * 2, ry * 2); g.imageSmoothingEnabled = sm; return true;
    }
    g.drawImage(b.canvas, Math.round(cx * sc - b.w / 2) / sc, Math.round(cy * sc - b.h / 2) / sc, b.w / sc, b.h / sc); return true;
  };
  /** H7: ONE batched fill of horizontal bars: `arr` = flat [x, y, len, …] (n bars, CSS px; y = top edge), `w` the thickness, `scale` the device px per CSS px. Every bar is snapped to the
   *  DEVICE pixel grid (crisp at dpr 2), at least one device px each way, all in one path with ONE fill (a round-capped stroke of the same bars cost 3× the raster at dpr 2). Returns n */
  M.bars = function (g, arr, n, w, color, alpha, scale) {
    n = n | 0; if (!(n > 0) || !arr || !(w > 0)) return 0;
    const sc = scale > 0 ? scale : 1, inv = 1 / sc, th = Math.max(inv, Math.round(w * sc) * inv);
    g.globalAlpha = alpha; g.fillStyle = color; g.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 3, x0 = Math.round(arr[o] * sc) * inv, x1 = Math.round((arr[o] + arr[o + 2]) * sc) * inv; g.rect(x0, Math.round(arr[o + 1] * sc) * inv, x1 > x0 ? x1 - x0 : inv, th); }
    g.fill(); g.globalAlpha = 1;
    return n;
  };
  M.blobStats = function () { return { n: blobMap.size, mb: Math.round(blobBytes / 10485.76) / 100, bakes: blobBakes, hits: blobHits, max: BLOB_MAX }; };
  M.blobClear = function () { for (const v of blobMap.values()) { try { v.canvas.width = 1; v.canvas.height = 1; } catch (err) { /* stub */ } } blobMap.clear(); blobBytes = 0; blobBakes = 0; blobHits = 0; };

  // ---------------------------------------------------------------------------
  // selfTest: ramp knots equal the 5-tone ramps, luminance monotone in t, seam width per master, every primitive draws
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [], t0 = Date.now(); let ok = true;
    const A = (c, m) => { if (!c) { ok = false; notes.push('FAIL ' + m); if (BSU.SELFTEST) throw new Error('brush selfTest: ' + m); } };
    for (const name of ['grass', 'limestone', 'waterDeep', 'azaleaBloom']) {
      const base = M.ramp(name), R = SP.ramp(name), knots = [-1, -0.5, 0, 0.5, 1];
      for (let i = 0; i < 5; i++) { const got = toneArr(base, knots[i]), want = SP.hex(R[i]); A(Math.abs(got[0] - want[0]) <= 2 && Math.abs(got[1] - want[1]) <= 2 && Math.abs(got[2] - want[2]) <= 2, name + ' tone(' + knots[i] + ') = ramp[' + i + ']'); }   // makeRamp floors after shade and rounds after mix: ≤ 2/255 apart
      let prev = -1; for (let t = -1; t <= 1.0001; t += 0.05) { const l = lum(toneArr(base, t)); A(l >= prev - 1, name + ' luminance monotone at t=' + t.toFixed(2)); prev = l; }   // ≤ 1 level: a channel pinned at 255 can dip a hair under the warm tint (sand), as the 5-tone ramp itself does
    }
    A(Math.abs(M.seamWidth(M.env(1)) - 0.9) < 1e-9 && Math.abs(M.seamWidth(M.env(2)) - 0.45) < 1e-9, 'seam width 0.9 art px at master 1, 0.45 at master 2 (0.9 device px)');
    A(M.env(2).lod === 0 && M.env(1).lod === 1 && M.env(2, { night: true }).night === true, 'env: lod 0 at master 2, 1 at master 1');
    const c = SP.newCanvas(8, 8), g = SP.ctx2d(c); let drew = 0;
    try {
      for (const m of [1, 2]) {
        const env = M.env(m); const spec = { master: m, env: env };
        M.begin(g, 128, 128, spec);
        M.groundTile(g, { cx: 64, cy: 64, kind: 'grass', seed: 1, dropS: 1, dropE: 0.5 }, env); M.groundTile(g, { cx: 64, cy: 64, kind: 'marsh', seed: 2, pool: true }, env);
        M.waterTile(g, { cx: 64, cy: 64, seed: 3, shore: { n: true, e: false, s: true, w: false } }, env);
        M.fillQuadShaded(g, [[10, 10], [60, 10], [60, 50], [10, 50]], '#F5ECD7', { face: 'sw', material: 'stucco' }, env);
        M.roofPlane(g, [[10, 60], [70, 60], [50, 30], [30, 30]], '#B5533C', { facing: 'sw' }, env);
        M.column(g, 40, 100, 30, 3, '#F5ECD7', env); M.path(g, [[0, 100], [40, 90], [100, 110]], 12, env); M.tree(g, 64, 100, 'liveOak', { seed: 4 }, env); M.tree(g, 64, 100, 'cypress', { seed: 5, inWater: true }, env);
        M.figure(g, 64, 100, { facing: 'sw', walk: 0.3, shirt: 'purple', seed: 6 }, env); M.capsule(g, 10, 10, 30, 40, 2, 1.5, P.purple, 0, { spec: 0.3 }); M.capsule(g, 10, 10, 10, 10, 2, 2, P.gold, 0); M.digits(g, 40, 40, '28', 5, P.gold, 0, { sx: 0.7 }); M.shadow(g, { x: 64, y: 100, rx: 10, ry: 4, a: 0.3 }, env); M.shadow(g, { poly: [[0, 0], [10, 0], [10, 10]], soft: 4, a: 0.3 }, env);
        M.light(g, { x: 20, y: 20, r: 8, color: '#FFE2A0', a: 0.9 }, env); M.light(g, { quad: [[10, 10], [20, 10], [20, 20], [10, 20]], color: '#FFD27A' }, env); M.light(g, { x: 20, y: 20, rx: 20, ry: 8, pool: true, color: '#FFD98A', a: 0.5 }, env);
        M.glow(g, [[10, 10], [20, 10], [20, 20], [10, 20]], null, env); M.decal(g, { x: 30, y: 30, w: 10, h: 6, shape: 'rect' }, env); M.decal(g, { x: 30, y: 30, w: 10, h: 10, shape: 'disc' }, env); M.cube(g, 64, 90, 20, P.purple, env);
        drew++;
      }
    } catch (e) { A(false, 'primitive threw: ' + (e && e.message)); }
    A(drew === 2, 'every primitive drew at master 1 and 2');
    try {   // H5: the blob cache is keyed by (kind, colour, quantised radius) and every kind bakes
      M.blobClear(); const b1 = M.blob('halo', '#FFD27A', 20, 20), b2 = M.blob('halo', '#FFD27A', 20.3, 19.6), b3 = M.blob('halo', '#9FD2FF', 20, 20), b4 = M.blob('halo', '#FFD27A', 40, 40);
      A(b1 && b1 === b2 && b3 !== b1 && b4 !== b1 && b1.rx === 20 && M.blobStats().n === 3, 'blob cache: one entry per (kind, colour, quantised radius)');
      for (const k of M.blobKinds) A(M.blob(k, k === 'puddle' ? 'day' : k === 'fog' ? '196,208,220' : '#FFE0A0', 12, 6, { seed: 1 }), 'blob kind ' + k + ' bakes');
      M.blobClear();
    } catch (e) { A(false, 'blob threw: ' + (e && e.message)); }
    notes.push('ramps continuous, ' + drew + ' masters, ' + (Date.now() - t0) + ' ms');
    return { ok: ok, notes: notes.join('; ') };
  };
})();
