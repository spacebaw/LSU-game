// style_b.js — B. PAINTERLY TEXTURED (hand-painted strategy game)
// Procedural tileable noise textures applied with 'overlay' (grass blades, stucco grain, roof courses, water ripples),
// brush dabs with soft edges, ambient occlusion at bases, warm key / cool shadow, no outlines.
window.HD.styles = window.HD.styles || {};
window.HD.styles.B = (function () {
  const H = window.HD, P = H.P, tone = H.tone, css = H.css;
  const FACE_T = { top: 0.02, sw: -0.12, se: -0.48 };
  const ROOF_T = { nw: 0.25, ne: -0.2, sw: 0.05, se: -0.52 };
  const WARM = '#FFE0A0', COOL = '#2B2550';
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const TEX = {};
  /** 128-periodic luminance texture → canvas pattern (grey 128 = no change under 'overlay') */
  function lum(name, fn) {
    if (TEX[name]) return TEX[name];
    const c = H.makeTex(128, 128, (x, y) => { const v = fn(x, y); const g = 128 + v * 127; return [g, g, g, 255]; });
    TEX[name] = c; return c;
  }
  const pn = (s, x, y, cell) => H.pnoise(s, x, y, cell, 128);
  function textures() {
    lum('grass', (x, y) => { const streak = pn(3, x * 4, y * 2, 8) - 0.5; const big = pn(4, x, y, 32) - 0.5; const fine = pn(5, x * 2, y * 2, 4) - 0.5; return streak * 0.4 + big * 0.35 + fine * 0.2; });
    lum('mud', (x, y) => (pn(7, x, y, 16) - 0.5) * 0.5 + (pn(8, x * 2, y * 2, 4) - 0.5) * 0.3);
    lum('stucco', (x, y) => (pn(11, x * 2, y * 2, 2) - 0.5) * 0.12 + (pn(12, x, y, 32) - 0.5) * 0.16);
    lum('stone', (x, y) => (pn(13, x * 2, y * 2, 2) - 0.5) * 0.3 + (pn(14, x, y, 16) - 0.5) * 0.25);
    lum('wood', (x, y) => (pn(15, x * 4, y, 4) - 0.5) * 0.45);
    lum('bark', (x, y) => (pn(16, x * 6, y, 4) - 0.5) * 0.6 + (pn(17, x, y, 16) - 0.5) * 0.2);
    lum('water', (x, y) => (pn(19, x, y * 5, 16) - 0.5) * 0.5 + (pn(20, x, y * 3, 8) - 0.5) * 0.25);
    lum('gravel', (x, y) => (pn(21, x * 2, y * 2, 2) - 0.5) * 0.55 + (pn(22, x, y, 8) - 0.5) * 0.2);
    lum('dirt', (x, y) => { const band = Math.sin(y * 0.9 + pn(23, x, y, 16) * 3) * 0.12; return band + (pn(24, x * 2, y * 2, 2) - 0.5) * 0.3; });
    lum('roof', (x, y) => { const row = ((y % 5) + 5) % 5; const col = ((x + (Math.floor(y / 5) % 2) * 4) % 8 + 8) % 8; const edge = row < 1 ? -0.45 : (row < 2 ? 0.18 : 0.02 - row * 0.03); const brk = col < 1 ? -0.2 : 0; return edge + brk + (pn(25, x * 2, y * 2, 2) - 0.5) * 0.15; });
    lum('leaf', (x, y) => (pn(27, x * 2, y * 2, 4) - 0.5) * 0.5 + (pn(28, x, y, 16) - 0.5) * 0.3);
  }
  function overlay(ctx, pts, name, alpha, rot, origin) {
    ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (rot) { ctx.translate(origin[0], origin[1]); ctx.rotate(rot); ctx.translate(-origin[0], -origin[1]); }
    ctx.fillStyle = ctx.createPattern(TEX[name], 'repeat'); const bb = H.bbox(pts); ctx.fillRect(bb.x0 - 200, bb.y0 - 200, bb.w + 400, bb.h + 400); ctx.restore();
  }
  /** soft-edged brush dab */
  function dab(ctx, x, y, rx, ry, ang, color, a, soft) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang || 0); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, css(color, a)); g.addColorStop(soft == null ? 0.6 : soft, css(color, a)); g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  /** tapered brush stroke */
  function stroke(ctx, x0, y0, x1, y1, w, color, a) {
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = css(color, a); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * 0.6, y0 + (y1 - y0) * 0.6); ctx.stroke();
    ctx.lineWidth = w * 0.5; ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  const warmCool = (color, t) => t >= 0 ? H.mix(H.toneArr(color, t), WARM, 0.08) : H.mix(H.toneArr(color, t), COOL, 0.1);
  function plane(ctx, pts, color, t, vert) {
    const bb = H.bbox(pts); const g = vert ? ctx.createLinearGradient(0, bb.y0, 0, bb.y1) : ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, css(warmCool(color, t + 0.1))); g.addColorStop(1, css(warmCool(color, t - 0.14)));
    H.poly(ctx, pts); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = css(warmCool(color, t - 0.05), 0.7); ctx.stroke();
  }
  function flat(ctx, pts, fill) { H.poly(ctx, pts); ctx.fillStyle = fill; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = fill; ctx.stroke(); }
  /** opaque union of soft dabs: silhouette first, then the dabs, then a clipped texture */
  function cluster(ctx, dabs, color, baseT, tex, texA) {
    ctx.beginPath(); for (const d of dabs) ctx.ellipse(d.x, d.y, d.rx * 0.92, d.ry * 0.92, d.ang || 0, 0, Math.PI * 2); ctx.fillStyle = css(warmCool(color, baseT)); ctx.fill();
    for (const d of dabs) dab(ctx, d.x, d.y, d.rx, d.ry, d.ang || 0, warmCool(color, d.t), 0.95, 0.7);
    if (tex) { ctx.save(); ctx.beginPath(); for (const d of dabs) ctx.ellipse(d.x, d.y, d.rx * 0.95, d.ry * 0.95, d.ang || 0, 0, Math.PI * 2); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = texA; ctx.fillStyle = ctx.createPattern(TEX[tex], 'repeat'); ctx.fillRect(-400, -400, 1200, 1200); ctx.restore(); }
  }
  const B = {}; B.name = 'B · painterly';
  B.init = function () { textures(); };

  B.fillQuadShaded = function (ctx, pts, color, o, env) {
    const f = o.face || 'top', m = o.material || 'paint', t = FACE_T[f];
    if (m === 'glow') { H.poly(ctx, pts); ctx.fillStyle = css(color); ctx.fill(); dab(ctx, ...H.centroid(pts), H.bbox(pts).w * 0.5, H.bbox(pts).h * 0.4, 0, '#FFF6D0', 0.5); return; }
    if (m === 'glass') { plane(ctx, pts, color, t - 0.15, true); const bb = H.bbox(pts); ctx.save(); H.poly(ctx, pts); ctx.clip(); stroke(ctx, bb.x0 + 1, bb.y0 + bb.h * 0.7, bb.x1 - 1, bb.y0 + bb.h * 0.15, 2.2, '#DCE6EE', 0.35); ctx.restore(); return; }
    plane(ctx, pts, color, t, f !== 'top');
    const tex = m === 'stucco' ? 'stucco' : m === 'stone' ? 'stone' : m === 'wood' ? 'wood' : m === 'cloth' ? 'wood' : null;
    if (tex) overlay(ctx, pts, tex, m === 'cloth' ? 0.35 : 0.8);
    if (f !== 'top' && m !== 'cloth') { // AO toward the ground
      const bb = H.bbox(pts); const g = ctx.createLinearGradient(0, bb.y1 - Math.min(14, bb.h), 0, bb.y1); g.addColorStop(0, 'rgba(43,37,80,0)'); g.addColorStop(1, 'rgba(43,37,80,0.28)');
      ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.w, bb.h); ctx.restore(); }
  };

  B.roofPlane = function (ctx, pts, color, o, env) {
    const t = ROOF_T[o.facing] || 0; plane(ctx, pts, color, t, true);
    const e0 = pts[0], e1 = pts[1], ang = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
    overlay(ctx, pts, 'roof', 0.85, ang, e0);
    ctx.save(); H.poly(ctx, pts); ctx.clip();
    // painted highlights toward the ridge, a soft darker band along the eave
    const apex = pts.length === 4 ? lerp(pts[2], pts[3], 0.5) : pts[2];
    const mid = lerp(e0, e1, 0.5);
    for (let i = 0; i < 4; i++) { const f = 0.55 + i * 0.1; const p = lerp(mid, apex, f); dab(ctx, p[0] + (i - 1.5) * 9, p[1], 10, 3.5, ang, warmCool(color, t + 0.5), 0.22); }
    stroke(ctx, e0[0], e0[1], e1[0], e1[1], 3, warmCool(color, t - 0.55), 0.35);
    ctx.restore();
  };

  B.column = function (ctx, x, yb, h, r, color, env) {
    const g = ctx.createLinearGradient(x - r, 0, x + r, 0); g.addColorStop(0, css(warmCool(color, 0.05))); g.addColorStop(0.4, css(warmCool(color, 0.3))); g.addColorStop(1, css(warmCool(color, -0.5)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.rect(x - r, yb - h, r * 2, h); ctx.fill();
    overlay(ctx, [[x - r, yb - h], [x + r, yb - h], [x + r, yb], [x - r, yb]], 'stucco', 0.7);
    ctx.fillStyle = css(warmCool(color, -0.2)); ctx.fillRect(x - r - 0.9, yb - h, r * 2 + 1.8, 2.2); ctx.fillRect(x - r - 0.9, yb - 2.2, r * 2 + 1.8, 2.2);
    const ao = ctx.createLinearGradient(0, yb - 10, 0, yb); ao.addColorStop(0, 'rgba(43,37,80,0)'); ao.addColorStop(1, 'rgba(43,37,80,0.3)'); ctx.fillStyle = ao; ctx.fillRect(x - r, yb - 10, r * 2, 10);
  };

  function faces(ctx, T, kind) {
    const cx = T.cx, cy = T.cy;
    const face = (pts, f, drop) => {
      if (kind === 'water') { plane(ctx, pts, P.waterDeep, FACE_T[f] - 0.05, true); overlay(ctx, pts, 'water', 0.5); return; }
      plane(ctx, pts, P.dirt, FACE_T[f], true); overlay(ctx, pts, 'dirt', 0.9);
      ctx.save(); H.poly(ctx, pts); ctx.clip();
      // AO under the overhanging turf lip, then a ragged painted lip
      const g = ctx.createLinearGradient(0, pts[0][1], 0, pts[0][1] + 9); g.addColorStop(0, 'rgba(30,25,60,0.45)'); g.addColorStop(1, 'rgba(30,25,60,0)'); ctx.fillStyle = g;
      H.poly(ctx, [pts[0], pts[1], [pts[1][0], pts[1][1] + 9], [pts[0][0], pts[0][1] + 9]]); ctx.fill();
      const lip = kind === 'marsh' ? P.wet : P.grass, r = H.rng(T.seed + 99);
      for (let i = 0; i < 9; i++) { const p = lerp(pts[0], pts[1], i / 8); dab(ctx, p[0], p[1] + 1 + r() * 1.5, 4 + r() * 2, 2 + r() * 1.5, 0, warmCool(lip, FACE_T[f] - 0.08), 0.9, 0.4); }
      ctx.restore();
    };
    if (T.dropS > 0) { const d = T.dropS * 6; face([[cx - 32, cy], [cx, cy + 16], [cx, cy + 16 + d], [cx - 32, cy + d]], 'sw', d); }
    if (T.dropE > 0) { const d = T.dropE * 6; face([[cx, cy + 16], [cx + 32, cy], [cx + 32, cy + d], [cx, cy + 16 + d]], 'se', d); }
  }
  B.groundTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy), r = H.rng(T.seed * 7 + 1);
    faces(ctx, T, T.kind);
    const big = (H.vnoise(41, cx, cy * 2, 90) - 0.5) * 0.3;
    if (T.kind === 'grass') {
      flat(ctx, dia, css(warmCool(P.grass, 0.08 + big))); overlay(ctx, dia, 'grass', 0.6);
      ctx.save(); H.poly(ctx, dia); ctx.clip();
      for (let i = 0; i < 10; i++) { const x = cx + (r() - .5) * 56, y = cy + (r() - .5) * 26, up = r() < 0.6, len = 3 + r() * 4; stroke(ctx, x, y, x + (r() - .3) * 3, y - len, 1.2, warmCool(P.grass, up ? 0.45 + r() * 0.3 : -0.3), 0.4); }
      for (let i = 0; i < 3; i++) dab(ctx, cx + (r() - .5) * 40, cy + (r() - .5) * 18, 7 + r() * 6, 3 + r() * 2, 0, warmCool(P.highGrass, 0.25), 0.3, 0.3);
      ctx.restore();
    } else {
      flat(ctx, dia, css(warmCool(P.wet, big))); overlay(ctx, dia, 'mud', 0.7);
      ctx.save(); H.poly(ctx, dia); ctx.clip();
      for (let i = 0; i < 3; i++) dab(ctx, cx + (r() - .5) * 40, cy + (r() - .5) * 18, 8 + r() * 6, 3 + r() * 2, 0, warmCool(P.marshMud, -0.3), 0.35, 0.3);
      if (T.pool) { const px = cx + (r() - .5) * 20, py = cy + (r() - .5) * 8; dab(ctx, px, py, 17, 7.5, 0, warmCool(P.shallows, -0.25), 0.95, 0.75); overlay(ctx, [[px - 17, py - 8], [px + 17, py - 8], [px + 17, py + 8], [px - 17, py + 8]], 'water', 0.5); dab(ctx, px - 4, py - 2, 7, 2.2, 0, warmCool(P.shallows, 0.6), 0.5, 0.3); }
      for (let c = 0; c < 4; c++) { const x = cx + (r() - .5) * 46, y = cy + (r() - .5) * 20; dab(ctx, x, y + 1, 5, 2, 0, warmCool(P.marshMud, -0.5), 0.4, 0.3); for (let k = 0; k < 6; k++) { const dx = (k - 2.5) * 1.3, hgt = 7 + r() * 8; stroke(ctx, x + dx * 0.4, y, x + dx * 1.8, y - hgt, 1.4, warmCool(P.reed, r() * 0.7 - 0.25), 0.85); } }
      ctx.restore();
    }
  };

  B.waterTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy), r = H.rng(T.seed * 5 + 3), night = env.night;
    faces(ctx, T, 'water');
    const nShore = (T.shore.n ? 1 : 0) + (T.shore.w ? 1 : 0) + (T.shore.s ? 1 : 0) + (T.shore.e ? 1 : 0);
    flat(ctx, dia, css(warmCool(H.mix(P.waterDay, P.shallows, 0.15 * nShore), -0.02))); overlay(ctx, dia, 'water', 0.7);
    ctx.save(); H.poly(ctx, dia); ctx.clip(); ctx.lineCap = 'round';
    const edges = { n: [dia[3], dia[0]], e: [dia[0], dia[1]], s: [dia[1], dia[2]], w: [dia[2], dia[3]] };
    for (const k in edges) if (T.shore[k]) { const [a, b] = edges[k]; for (let i = 0; i < 8; i++) { const p = lerp(a, b, (i + 0.5) / 8); dab(ctx, p[0] + (r() - .5) * 3, p[1] + (r() - .5) * 2, 6, 3.2, 0, warmCool(P.shallows, 0.2), 0.45, 0.3); } for (let i = 0; i < 5; i++) { const p = lerp(a, b, (i + 0.5) / 5); stroke(ctx, p[0] - 4, p[1] + (r() - .5), p[0] + 4, p[1] + (r() - .5), 1.3, '#DFF3E8', 0.5); } }
    for (let i = 0; i < 6; i++) { const x = cx + (r() - .5) * 46, y = cy + (r() - .5) * 20, len = 6 + r() * 12; stroke(ctx, x - len / 2, y, x + len / 2, y - 0.8, 1.6, night ? '#C9D8FF' : warmCool(P.waterDay, 0.55), night ? 0.5 : 0.45); }
    for (let i = 0; i < 3; i++) dab(ctx, cx + (r() - .5) * 40, cy + (r() - .5) * 18, 9, 3, 0, warmCool(P.waterDeep, -0.3), 0.3, 0.3);
    ctx.restore();
  };

  B.path = function (ctx, pts, w, env) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    H.smoothPath(ctx, pts); ctx.lineWidth = w + 3; ctx.strokeStyle = css(warmCool(P.gravel, -0.35), 0.35); ctx.stroke();
    H.smoothPath(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = css(warmCool(P.gravel, 0.0)); ctx.stroke();
    // gravel grain, clipped to the stroke
    H.smoothPath(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = css(warmCool(P.gravel, 0.0)); ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.strokeStyle = ctx.createPattern(TEX.gravel, 'repeat'); ctx.stroke(); ctx.restore();
    const r = H.rng(pts[0][0] * 3 + 5); for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 6; k++) { const p = lerp(pts[i], pts[i + 1], r()); dab(ctx, p[0] + (r() - .5) * w * 0.7, p[1] + (r() - .5) * w * 0.35, 1.6, 1, 0, warmCool(P.gravel, r() < 0.5 ? 0.5 : -0.5), 0.6, 0.3); }
    ctx.restore();
  };

  B.tree = function (ctx, x, y, kind, o, env) {
    const r = H.rng(o.seed * 13 + 2);
    const trunkFill = (poly) => { const bb = H.bbox(poly); const g = ctx.createLinearGradient(bb.x0, 0, bb.x1, 0); g.addColorStop(0, css(warmCool(P.bark, 0.15))); g.addColorStop(0.45, css(warmCool(P.bark, 0.3))); g.addColorStop(1, css(warmCool(P.bark, -0.5))); H.poly(ctx, poly); ctx.fillStyle = g; ctx.fill(); overlay(ctx, poly, 'bark', 0.9); };
    dab(ctx, x, y + 1, 12, 5, 0, COOL, 0.35, 0.2);   // AO at the base
    if (kind === 'liveOak') {
      trunkFill([[x - 6, y + 1], [x + 6, y + 1], [x + 3.5, y - 18], [x + 15, y - 40], [x + 11, y - 42], [x + 1, y - 27], [x - 10, y - 44], [x - 14, y - 41], [x - 3.5, y - 18]]);
      // canopy: many soft leaf-cluster dabs in three tone bands (dark lower, mid, light upper-left)
      const cxs = x + 2, cys = y - 54;
      const dabs = []; for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()); const dx = cxs + Math.cos(a) * 48 * d, dy = cys + Math.sin(a) * 21 * d; dabs.push({ x: dx, y: dy, rx: 10 + r() * 8, ry: 7 + r() * 5, ang: (r() - .5) * 0.8, t: -((dx - cxs) / 48) * 0.35 - ((dy - cys) / 21) * 0.45 + (r() - .5) * 0.2 }); }
      dabs.sort((p, q) => p.y - q.y);
      cluster(ctx, dabs, P.oakLeaf, -0.45, 'leaf', 0.6);
      for (let i = 0; i < 12; i++) dab(ctx, cxs - 12 + (r() - .5) * 56, cys - 9 + (r() - .5) * 18, 5 + r() * 4, 3 + r() * 2, (r() - .5), warmCool(P.oakLeaf, 0.8), 0.4, 0.3);
      // Spanish moss: feathery hanging strokes
      for (let i = 0; i < 16; i++) { const sx = cxs + (r() - .5) * 95, sy = cys + 8 + r() * 14, len = 10 + r() * 16; stroke(ctx, sx, sy, sx + (r() - .5) * 3, sy + len, 2.6, warmCool(P.moss, r() * 0.5 - 0.15), 0.75); stroke(ctx, sx + 1, sy + 2, sx + (r() - .5) * 4, sy + len * 0.8, 1.2, warmCool(P.moss, 0.5), 0.6); }
    } else {
      if (o.inWater) { for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2, d = 10 + r() * 10; const kx = x + Math.cos(a) * d, ky = y + Math.sin(a) * d * 0.45 + 2, kh = 4 + r() * 4; dab(ctx, kx, ky + 1.5, 5, 2, 0, warmCool(P.shallows, 0.35), 0.5, 0.3); trunkFill([[kx - 2.2, ky + 1], [kx + 2.2, ky + 1], [kx + 0.8, ky - kh], [kx - 0.8, ky - kh]]); } }
      trunkFill([[x - 7.5, y + 2], [x + 7.5, y + 2], [x + 3, y - 14], [x + 2, y - 80], [x - 2, y - 80], [x - 3, y - 14]]);
      const leaf = H.mix(P.cypressLeaf, P.cypressRust, 0.22);
      for (let i = 0; i < 5; i++) { const ty = y - 30 - i * 13, rx = 18 - i * 2.7, ry = 7.5 - i * 0.9; const ds = []; for (let k = 0; k < 9; k++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()); const px = x + Math.cos(a) * rx * d, py = ty + Math.sin(a) * ry * d; ds.push({ x: px, y: py, rx: 5 + r() * 4, ry: 2.5 + r() * 2, ang: (r() - .5) * 1.2, t: -((px - x) / rx) * 0.35 - ((py - ty) / ry) * 0.25 + i * 0.05 }); } cluster(ctx, ds, leaf, -0.4, 'leaf', 0.5); }
      for (let i = 0; i < 4; i++) dab(ctx, x - 2 + (r() - .5) * 8, y - 86 - i * 3, 3.5, 2, 0, warmCool(leaf, 0.3), 0.9, 0.4);
    }
  };

  B.figure = function (ctx, x, y, f, env) {
    const shirt = f.shirt === 'purple' ? P.purple : P.gold, trim = f.shirt === 'purple' ? P.gold : P.purple;
    const back = f.facing === 'ne' || f.facing === 'nw', ph = f.walk == null ? 0 : Math.sin(f.walk * Math.PI * 2), bob = f.walk == null ? 0 : Math.abs(ph) * 0.6;
    ctx.save(); ctx.translate(x, y - bob); ctx.lineCap = 'round';
    const grad = (c, x0, y0, x1, y1, t0, t1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, css(warmCool(c, t0))); g.addColorStop(1, css(warmCool(c, t1))); return g; };
    ctx.strokeStyle = grad(P.denim, -3, 0, 3, 0, 0.1, -0.4); ctx.lineWidth = 2.7; ctx.beginPath(); ctx.moveTo(-1.6, -7); ctx.lineTo(-1.6 - ph * 2.2, -0.5); ctx.moveTo(1.6, -7); ctx.lineTo(1.6 + ph * 2.2, -0.5); ctx.stroke();
    ctx.fillStyle = grad(shirt, -4, -16, 4, -6, 0.3, -0.5); ctx.beginPath(); ctx.roundRect(-3.7, -15.5, 7.4, 9.5, 2.8); ctx.fill();
    ctx.fillStyle = css(warmCool(trim, 0.1)); ctx.fillRect(-3.2, -11.2, 6.4, 1.2);
    ctx.strokeStyle = grad(shirt, -4, 0, 4, 0, 0.1, -0.45); ctx.lineWidth = 1.9; ctx.beginPath(); ctx.moveTo(-3.8, -14); ctx.lineTo(-4.6 + ph * 1.5, -8.5); ctx.moveTo(3.8, -14); ctx.lineTo(4.6 - ph * 1.5, -8.5); ctx.stroke();
    ctx.fillStyle = grad(P.skin, -3, -21, 3, -16, 0.25, -0.35); ctx.beginPath(); ctx.arc(0, -18.6, 3.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = grad(P.hair, -3, -22, 3, -17, 0.3, -0.3); ctx.beginPath(); ctx.arc(0, -19.2, 3.4, Math.PI * (back ? 0.05 : 1.05), Math.PI * (back ? 0.95 : 1.95)); ctx.fill(); if (back) ctx.fillRect(-3.4, -19.2, 6.8, 2.4);
    dab(ctx, -1.2, -16.5, 1.6, 1, 0, '#FFF3D0', 0.35, 0.2);
    ctx.restore();
  };

  B.shadow = function (ctx, s, env) {
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; const col = [60, 52, 110];
    if (s.poly) { for (let i = 3; i >= 1; i--) { H.poly(ctx, s.poly); ctx.lineJoin = 'round'; ctx.lineWidth = (s.soft || 4) * i * 0.6; ctx.strokeStyle = css(col, s.a * 0.22); ctx.stroke(); } H.poly(ctx, s.poly); ctx.fillStyle = css(col, s.a * 0.8); ctx.fill(); }
    else dab(ctx, s.x, s.y, s.rx, s.ry, 0, col, s.a * 0.9, 0.45);
    ctx.restore();
  };

  B.light = function (ctx, s, env) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (s.quad) { H.poly(ctx, s.quad); ctx.fillStyle = css(s.color, 0.3); ctx.fill(); const c = H.centroid(s.quad), bb = H.bbox(s.quad); dab(ctx, c[0], c[1] + 2, bb.w * 0.5 + (s.halo || 8), bb.h * 0.5 + (s.halo || 8) * 0.8, 0, s.color, 0.28, 0.15); }
    else if (s.pool) { dab(ctx, s.x, s.y, s.rx, s.ry, 0, s.color, s.a * 0.7, 0.1); dab(ctx, s.x, s.y, s.rx * 0.5, s.ry * 0.5, 0, s.color, s.a * 0.4, 0.2); }
    else { dab(ctx, s.x, s.y, s.r, s.r, 0, s.color, s.a * 0.75, 0.08); dab(ctx, s.x, s.y, s.r * 0.35, s.r * 0.35, 0, '#FFF6D0', s.a * 0.6, 0.2); if (s.firefly) { ctx.fillStyle = css('#F4FFC0', 0.95); ctx.beginPath(); ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };
  return B;
})();
