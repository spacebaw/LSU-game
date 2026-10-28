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
// Public: BSU.brush.{tone, toneArr, css, mix, sat, ramp, env, rng, vnoise, fbm, pnoise, poly, bbox, centroid, diamond,
//   smoothPath, ellipse, seamWidth, seamStroke, plane, orb, softEllipse, microGrain, fillQuadShaded, roofPlane, column,
//   groundTile, waterTile, path, tree, figure, shadow, light, glow, decal, cube, begin, selfTest}
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
  const arr = (c) => (typeof c === 'string' ? SP.hex(c) : c);
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
    return { master: m, lod: o.lod != null ? o.lod | 0 : (m >= 2 ? 0 : 1), night: !!o.night, dpr: Number.isFinite(o.dpr) ? o.dpr : 1, originX: Number.isFinite(o.originX) ? o.originX : 0, originY: Number.isFinite(o.originY) ? o.originY : 0 };
  };
  const envOf = (env) => env || DEF_ENV;
  const DEF_ENV = M.env(1);

  // ---------------------------------------------------------------------------
  // Random + noise (world space, seamless by construction)
  // ---------------------------------------------------------------------------
  M.rng = (seed) => { let a = (seed | 0) + 0x6D2B79F5; return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  M.vnoise = SP.vnoise;
  M.fbm = (s, x, y, cell, oct) => { let v = 0, amp = 0.55, sum = 0, c = cell > 0 ? cell : 8; for (let i = 0; i < (oct || 3); i++) { v += SP.vnoise(s + i * 7, x, y, c) * amp; sum += amp; amp *= 0.5; c *= 0.5; } return v / sum; };
  M.pnoise = (s, x, y, cell, per) => SP.pnoise(s, x, y, cell, cell, per, per);

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
  function bbox(pts) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
  function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
  const diamond = (cx, cy) => [[cx, cy - 16], [cx + 32, cy], [cx, cy + 16], [cx - 32, cy]];
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
  M.poly = poly; M.bbox = bbox; M.centroid = centroid; M.diamond = diamond; M.smoothPath = smoothPath; M.ellipse = ellipse; M.lerp = lerp;

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
  /** a ground diamond: T = {cx, cy, kind: grass | high | marsh | wet | dirt, seed, dropS, dropE, pool}; world-anchored noise */
  M.groundTile = function (ctx, T, env) {
    env = envOf(env); const cx = T.cx, cy = T.cy, dia = diamond(cx, cy), r = M.rng((T.seed | 0) * 7 + 3), kind = T.kind || 'grass';
    const wx = cx + env.originX, wy = cy + env.originY;
    faces(ctx, T, kind, env);
    const big = (SP.vnoise(43, wx, wy * 2, 70) - 0.5) * 0.26, half = env.lod > 0 ? 1 : 2;
    if (kind === 'grass' || kind === 'high') {
      const base = kind === 'high' ? P.highGrass : P.grass;
      const g = ctx.createLinearGradient(cx - 200, cy - 120, cx + 200, cy + 190); g.addColorStop(0, col(base, 0.22 + big)); g.addColorStop(1, col(base, -0.1 + big));
      poly(ctx, dia); ctx.fillStyle = g; ctx.fill(); seamStroke(ctx, dia, g, env);
      ctx.save(); poly(ctx, dia); ctx.clip(); microGrain(ctx, dia, 0.18, env);
      for (let i = 0; i < half; i++) softEllipse(ctx, cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 18, 11 + r() * 7, 5 + r() * 3, toneArr(sat(P.highGrass, SAT_C), 0.3), 0.22, 0.1);
      for (let i = 0; i < half; i++) { const x = cx + (r() - 0.5) * 46, y = cy + (r() - 0.5) * 20; orb(ctx, x, y - 1.5, 2.6 + r() * 1.5, 1.9 + r(), P.highGrass, 0, { spec: 0.35 }); }
      ctx.restore();
    } else if (kind === 'dirt') {
      const g = ctx.createLinearGradient(cx - 200, cy - 120, cx + 200, cy + 190); g.addColorStop(0, col(P.dirt, 0.2 + big)); g.addColorStop(1, col(P.dirt, -0.12 + big));
      poly(ctx, dia); ctx.fillStyle = g; ctx.fill(); seamStroke(ctx, dia, g, env);
      ctx.save(); poly(ctx, dia); ctx.clip(); microGrain(ctx, dia, 0.25, env);
      for (let i = 0; i < half; i++) softEllipse(ctx, cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 18, 9 + r() * 6, 4 + r() * 2, toneArr(P.dirt, -0.3), 0.3, 0.2);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(cx - 200, cy - 120, cx + 200, cy + 190); g.addColorStop(0, col(P.wet, 0.18 + big)); g.addColorStop(1, col(P.wet, -0.15 + big));
      poly(ctx, dia); ctx.fillStyle = g; ctx.fill(); seamStroke(ctx, dia, g, env);
      ctx.save(); poly(ctx, dia); ctx.clip(); microGrain(ctx, dia, 0.22, env);
      for (let i = 0; i < half; i++) softEllipse(ctx, cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 18, 10 + r() * 6, 4 + r() * 2, toneArr(sat(P.marshMud, SAT_C), -0.2), 0.4, 0.3);
      if (T.pool) {
        const px = cx + (r() - 0.5) * 20, py = cy + (r() - 0.5) * 8;
        ctx.save(); ctx.translate(px, py); ctx.scale(16, 7); const pg = ctx.createRadialGradient(0.1, 0.2, 0, 0, 0, 1); pg.addColorStop(0, col(P.waterDeep, 0.1)); pg.addColorStop(0.8, col(P.shallows, -0.1)); pg.addColorStop(1, col(P.shallows, 0.3)); ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        softEllipse(ctx, px - 5, py - 2.2, 5, 1.6, env.night ? '#C9D8FF' : SPEC, 0.75, 0.3); ctx.lineWidth = 0.8; ctx.strokeStyle = css(RIM, 0.35); ellipse(ctx, px, py, 16, 7); ctx.stroke();
      }
      if (kind === 'marsh') for (let c = 0; c < (env.lod > 0 ? 2 : 3); c++) { const x = cx + (r() - 0.5) * 44, y = cy + (r() - 0.5) * 20; for (let k = 0; k < 5; k++) { const dx = (k - 2) * 1.5, hgt = 7 + r() * 7; const gg = ctx.createLinearGradient(x + dx - 1, 0, x + dx + 1, 0); gg.addColorStop(0, col(P.reed, 0.5)); gg.addColorStop(1, col(P.reed, -0.4)); ctx.strokeStyle = gg; ctx.lineCap = 'round'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + dx * 0.4, y); ctx.lineTo(x + dx * 1.8, y - hgt); ctx.stroke(); } }
      ctx.restore();
    }
  };
  /** a water diamond: T.shore = {n, e, s, w} edges that touch land; shallows bands, caustic rings, glints (silver at night) */
  M.waterTile = function (ctx, T, env) {
    env = envOf(env); const cx = T.cx, cy = T.cy, dia = diamond(cx, cy), r = M.rng((T.seed | 0) * 5 + 7), night = env.night, sh = T.shore || {};
    if (T.dropS > 0 || T.dropE > 0) faces(ctx, T, 'water', env);
    const nShore = (sh.n ? 1 : 0) + (sh.w ? 1 : 0) + (sh.s ? 1 : 0) + (sh.e ? 1 : 0);
    const base = mix(T.deep ? P.waterDeep : P.waterDay, P.shallows, 0.12 * nShore);
    const g = ctx.createLinearGradient(cx - 200, cy - 120, cx + 200, cy + 190); g.addColorStop(0, col(base, 0.3)); g.addColorStop(0.6, col(base, -0.05)); g.addColorStop(1, col(base, -0.3));
    poly(ctx, dia); ctx.fillStyle = g; ctx.fill(); seamStroke(ctx, dia, g, env);
    ctx.save(); poly(ctx, dia); ctx.clip(); ctx.lineCap = 'round';
    const edges = { n: [dia[3], dia[0]], e: [dia[0], dia[1]], s: [dia[1], dia[2]], w: [dia[2], dia[3]] };
    for (const k in edges) if (sh[k]) {
      const a = edges[k][0], b = edges[k][1]; const m = lerp(a, b, 0.5), nx = -(b[1] - a[1]), ny = (b[0] - a[0]); const L = Math.hypot(nx, ny) || 1; const sg0 = Math.sign((m[0] - cx) * nx + (m[1] - cy) * ny) || 1;
      const sg = ctx.createLinearGradient(m[0], m[1], m[0] - (nx / L) * 10 * sg0, m[1] - (ny / L) * 10 * sg0); sg.addColorStop(0, col(P.shallows, 0.55, 0.75)); sg.addColorStop(1, col(P.shallows, 0.2, 0));
      ctx.fillStyle = sg; ctx.fillRect(cx - 40, cy - 20, 80, 40); ctx.lineWidth = 1.2; ctx.strokeStyle = css('#F2FFF8', 0.6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const rings = env.lod > 0 ? 2 : 3, glints = env.lod > 0 ? 3 : 5;
    for (let i = 0; i < rings; i++) { const x = cx + (r() - 0.5) * 40, y = cy + (r() - 0.5) * 16; ctx.lineWidth = 0.9; ctx.strokeStyle = col(base, 0.6, 0.3); ellipse(ctx, x, y, 7 + r() * 6, 2.5 + r() * 2); ctx.stroke(); }
    for (let i = 0; i < glints; i++) { const x = cx + (r() - 0.5) * 46, y = cy + (r() - 0.5) * 20; softEllipse(ctx, x, y, 4 + r() * 5, 0.9 + r() * 0.6, night ? '#C9D8FF' : SPEC, night ? 0.65 : 0.8, 0.25); }
    ctx.restore();
  };
  /** a smooth polyline of screen points, width w: gravel by default (o.material: gravel | asphalt | boardwalk later) */
  M.path = function (ctx, pts, w, env, o) {
    if (!pts || pts.length < 2) return; env = envOf(env); o = o || {};
    const c = o.material === 'asphalt' ? (PAL.asphalt || '#3A3A40') : o.material === 'boardwalk' ? (PAL.boardwalk || '#8B7355') : P.gravel;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    smoothPath(ctx, pts); ctx.lineWidth = w + 2; ctx.strokeStyle = col(c, -0.5, 0.5); ctx.stroke();
    smoothPath(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = col(c, 0.05); ctx.stroke();
    smoothPath(ctx, pts); ctx.lineWidth = w * 0.6; ctx.strokeStyle = col(c, 0.35, 0.6); ctx.stroke();
    ctx.save(); ctx.translate(-1.2, -1 - w / 2 + 0.6); smoothPath(ctx, pts); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.5; ctx.strokeStyle = col(c, 0.8); ctx.stroke(); ctx.restore();
    if (o.material !== 'asphalt' && env.lod === 0) { const r = M.rng((pts[0][0] * 5 + 11) | 0); for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 5; k++) { const p = lerp(pts[i], pts[i + 1], r()); orb(ctx, p[0] + (r() - 0.5) * w * 0.6, p[1] + (r() - 0.5) * w * 0.3, 1.1, 0.8, c, 0.1, { noRim: true, spec: 0.5 }); } }
    ctx.restore();
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
        M.figure(g, 64, 100, { facing: 'sw', walk: 0.3, shirt: 'purple', seed: 6 }, env); M.shadow(g, { x: 64, y: 100, rx: 10, ry: 4, a: 0.3 }, env); M.shadow(g, { poly: [[0, 0], [10, 0], [10, 10]], soft: 4, a: 0.3 }, env);
        M.light(g, { x: 20, y: 20, r: 8, color: '#FFE2A0', a: 0.9 }, env); M.light(g, { quad: [[10, 10], [20, 10], [20, 20], [10, 20]], color: '#FFD27A' }, env); M.light(g, { x: 20, y: 20, rx: 20, ry: 8, pool: true, color: '#FFD98A', a: 0.5 }, env);
        M.glow(g, [[10, 10], [20, 10], [20, 20], [10, 20]], null, env); M.decal(g, { x: 30, y: 30, w: 10, h: 6, shape: 'rect' }, env); M.decal(g, { x: 30, y: 30, w: 10, h: 10, shape: 'disc' }, env); M.cube(g, 64, 90, 20, P.purple, env);
        drew++;
      }
    } catch (e) { A(false, 'primitive threw: ' + (e && e.message)); }
    A(drew === 2, 'every primitive drew at master 1 and 2');
    notes.push('ramps continuous, ' + drew + ' masters, ' + (Date.now() - t0) + ' ms');
    return { ok: ok, notes: notes.join('; ') };
  };
})();
