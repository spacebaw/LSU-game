// style_a.js — A. CLEAN VECTOR / FLAT-SHADED 2.5D (Townscaper / Two Point Campus feel)
// Flat colour planes with soft gradients, crisp silhouettes, rounded foliage blobs with a lit cap, soft contact shadows, no outlines.
window.HD.styles = window.HD.styles || {};
window.HD.styles.A = (function () {
  const H = window.HD, P = H.P, tone = H.tone, css = H.css;
  const FACE_T = { top: 0.0, sw: -0.14, se: -0.46 };
  const ROOF_T = { nw: 0.22, ne: -0.22, sw: 0.02, se: -0.5 };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const seam = (ctx, pts, fill) => { H.poly(ctx, pts); ctx.fillStyle = fill; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = fill; ctx.stroke(); };
  /** flat plane + subtle diagonal gradient (lit upper-left) */
  function plane(ctx, pts, color, t, amp) {
    const bb = H.bbox(pts); const g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, tone(color, t + (amp || 0.08))); g.addColorStop(1, tone(color, t - (amp || 0.08)));
    seam(ctx, pts, g);
  }
  const B = {};
  B.name = 'A · clean vector';

  B.fillQuadShaded = function (ctx, pts, color, o, env) {
    const f = o.face || 'top', m = o.material || 'paint';
    if (m === 'glass') { plane(ctx, pts, color, FACE_T[f] - 0.1, 0.05); ctx.save(); H.poly(ctx, pts); ctx.clip(); const bb = H.bbox(pts); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.moveTo(bb.x0 - 2, bb.y0 + bb.h * 0.55); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.1); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.35); ctx.lineTo(bb.x0 - 2, bb.y0 + bb.h * 0.8); ctx.fill(); ctx.restore(); return; }
    if (m === 'glow') { seam(ctx, pts, css(color)); return; }
    plane(ctx, pts, color, FACE_T[f], m === 'cloth' ? 0.12 : 0.06);
  };

  B.roofPlane = function (ctx, pts, color, o, env) {
    const t = ROOF_T[o.facing] || 0; plane(ctx, pts, color, t, 0.1);
    ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.lineWidth = 0.9; ctx.strokeStyle = tone(color, t - 0.35, 0.45);
    const n = 7; for (let i = 1; i < n; i++) { const f = i / n; const a = pts.length === 4 ? lerp(pts[0], pts[3], f) : lerp(pts[0], pts[2], f); const b = pts.length === 4 ? lerp(pts[1], pts[2], f) : lerp(pts[1], pts[2], f); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.restore();
  };

  B.column = function (ctx, x, yb, h, r, color, env) {
    const g = ctx.createLinearGradient(x - r, 0, x + r, 0); g.addColorStop(0, tone(color, 0.1)); g.addColorStop(0.45, tone(color, 0.25)); g.addColorStop(0.55, tone(color, -0.05)); g.addColorStop(1, tone(color, -0.4));
    ctx.fillStyle = g; ctx.beginPath(); ctx.rect(x - r, yb - h, r * 2, h); ctx.fill();
    ctx.fillStyle = tone(color, -0.15); ctx.fillRect(x - r - 0.8, yb - h, r * 2 + 1.6, 2); ctx.fillRect(x - r - 0.8, yb - 2, r * 2 + 1.6, 2);
  };

  function patches(ctx, cx, cy, seed, color, n) {
    const r = H.rng(seed);
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = r() * 0.7; const x = cx + Math.cos(a) * 30 * d, y = cy + Math.sin(a) * 15 * d; const rx = 4 + r() * 6, ry = rx * 0.45; const up = r() < 0.6; H.ellipse(ctx, x, y, rx, ry); ctx.fillStyle = tone(color, up ? 0.28 : -0.22, 0.75); ctx.fill(); }
  }
  function faces(ctx, T, env, kind) {
    const cx = T.cx, cy = T.cy;
    const face = (pts, f, drop) => {
      if (kind === 'water') { plane(ctx, pts, P.waterDeep, FACE_T[f] - 0.1, 0.05); return; }
      plane(ctx, pts, P.dirt, FACE_T[f], 0.1);
      ctx.save(); H.poly(ctx, pts); ctx.clip();
      // grass lip (3 px) and one stratum line
      const lip = kind === 'marsh' ? P.wet : P.grass; ctx.fillStyle = tone(lip, FACE_T[f] - 0.1); H.poly(ctx, [pts[0], pts[1], [pts[1][0], pts[1][1] + 3], [pts[0][0], pts[0][1] + 3]]); ctx.fill();
      ctx.strokeStyle = tone(P.dirt, FACE_T[f] - 0.35, 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + drop * 0.6); ctx.lineTo(pts[1][0], pts[1][1] + drop * 0.6); ctx.stroke();
      ctx.restore();
    };
    if (T.dropS > 0) { const d = T.dropS * 6; face([[cx - 32, cy], [cx, cy + 16], [cx, cy + 16 + d], [cx - 32, cy + d]], 'sw', d); }
    if (T.dropE > 0) { const d = T.dropE * 6; face([[cx, cy + 16], [cx + 32, cy], [cx + 32, cy + d], [cx, cy + 16 + d]], 'se', d); }
  }
  B.groundTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy);
    faces(ctx, T, env, T.kind);
    const vt = (H.hash(T.tx, T.ty, 1) - 0.5) * 0.14;
    if (T.kind === 'grass') {
      seam(ctx, dia, tone(P.grass, 0.04 + vt));
      ctx.save(); H.poly(ctx, dia); ctx.clip(); patches(ctx, cx, cy, T.seed, P.grass, 2); ctx.restore();
    } else {
      seam(ctx, dia, tone(P.wet, vt));
      ctx.save(); H.poly(ctx, dia); ctx.clip();
      patches(ctx, cx, cy, T.seed, P.wet, 2);
      if (T.pool) { const px = cx + (H.hash(T.tx, T.ty, 2) - .5) * 20, py = cy + (H.hash(T.tx, T.ty, 3) - .5) * 8; H.ellipse(ctx, px, py, 15, 6.5); ctx.fillStyle = tone(P.shallows, -0.15); ctx.fill(); H.ellipse(ctx, px - 3, py - 1.5, 7, 2.5); ctx.fillStyle = tone(P.shallows, 0.35, 0.6); ctx.fill(); }
      const r = H.rng(T.seed * 3);
      ctx.lineCap = 'round'; for (let c = 0; c < 3; c++) { const x = cx + (r() - .5) * 44, y = cy + (r() - .5) * 20; for (let k = 0; k < 4; k++) { const dx = (k - 1.5) * 1.6, hgt = 6 + r() * 6; ctx.lineWidth = 1.2; ctx.strokeStyle = tone(P.reed, r() * 0.5 - 0.1); ctx.beginPath(); ctx.moveTo(x + dx * 0.4, y); ctx.lineTo(x + dx * 1.6, y - hgt); ctx.stroke(); } }
      ctx.restore();
    }
  };

  B.waterTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy), night = env.night;
    faces(ctx, T, env, 'water');
    seam(ctx, dia, tone(P.waterDay, -0.02));
    ctx.save(); H.poly(ctx, dia); ctx.clip(); ctx.lineCap = 'round';
    // shore bands: a lighter shallows band and a foam line along edges that touch land
    const edges = { n: [dia[3], dia[0]], e: [dia[0], dia[1]], s: [dia[1], dia[2]], w: [dia[2], dia[3]] };
    for (const k in edges) if (T.shore[k]) { const [a, b] = edges[k]; ctx.strokeStyle = tone(P.shallows, -0.1, 0.55); ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.strokeStyle = tone(P.shallows, 0.5, 0.7); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    const r = H.rng(T.seed * 5 + 1);
    for (let i = 0; i < 4; i++) { const x = cx + (r() - .5) * 46, y = cy + (r() - .5) * 20, len = 6 + r() * 10; ctx.strokeStyle = night ? 'rgba(201,216,255,0.55)' : tone(P.waterDay, 0.6, 0.6); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - len / 2, y); ctx.quadraticCurveTo(x, y - 1.5, x + len / 2, y); ctx.stroke(); }
    ctx.restore();
  };

  B.path = function (ctx, pts, w, env) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    H.smoothPath(ctx, pts); ctx.lineWidth = w + 1.6; ctx.strokeStyle = tone(P.gravel, -0.35); ctx.stroke();
    H.smoothPath(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = tone(P.gravel, 0.02); ctx.stroke();
    H.smoothPath(ctx, pts); ctx.lineWidth = w * 0.5; ctx.strokeStyle = tone(P.gravel, 0.18, 0.5); ctx.stroke();
    ctx.restore();
  };

  function blob(ctx, x, y, r, color, t) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = tone(color, t); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.32, r * 0.78, 0, Math.PI * 2); ctx.fillStyle = tone(color, t + 0.38); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.42, y - r * 0.48, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = tone(color, t + 0.7); ctx.fill();
    ctx.restore();
  }
  B.tree = function (ctx, x, y, kind, o, env) {
    const r = H.rng(o.seed * 13);
    if (kind === 'liveOak') {
      // trunk and two boughs (flat, right side darker)
      const trunk = [[x - 5.5, y + 1], [x + 5.5, y + 1], [x + 3.5, y - 18], [x + 14, y - 38], [x + 10, y - 40], [x + 1, y - 26], [x - 10, y - 42], [x - 14, y - 39], [x - 3.5, y - 18]];
      H.poly(ctx, trunk); ctx.fillStyle = tone(P.bark, 0.05); ctx.fill();
      ctx.save(); H.poly(ctx, trunk); ctx.clip(); ctx.fillStyle = tone(P.bark, -0.5); ctx.fillRect(x, y - 50, 40, 60); ctx.restore();
      const blobs = []; for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + r() * 0.5; const d = i === 0 ? 0 : 0.55 + r() * 0.45; blobs.push({ x: x + Math.cos(a) * 44 * d, y: y - 52 + Math.sin(a) * 18 * d, r: 15 + r() * 9, t: -0.1 + r() * 0.2 }); }
      blobs.sort((a, b) => a.y - b.y);
      for (const b of blobs) blob(ctx, b.x, b.y, b.r, P.oakLeaf, b.t - (b.y > y - 50 ? 0.18 : 0));
      // Spanish moss: tapered rounded strands from the lower blobs
      ctx.lineCap = 'round'; for (let i = 0; i < 12; i++) { const b = blobs[Math.floor(r() * blobs.length)]; const sx = b.x + (r() - .5) * b.r * 1.4, sy = b.y + b.r * 0.5 + r() * 3, len = 9 + r() * 14; ctx.strokeStyle = tone(P.moss, r() * 0.4 - 0.05, 0.92); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (r() - .5) * 2, sy + len * 0.6); ctx.stroke(); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(sx, sy + len * 0.5); ctx.lineTo(sx + (r() - .5) * 3, sy + len); ctx.stroke(); }
    } else {
      // bald cypress: buttressed trunk, layered tiers, knees in the water
      if (o.inWater) { for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2, d = 10 + r() * 10; const kx = x + Math.cos(a) * d, ky = y + Math.sin(a) * d * 0.45 + 2, kh = 4 + r() * 4; H.ellipse(ctx, kx, ky + 1, 4.5, 1.6); ctx.fillStyle = tone(P.shallows, 0.3, 0.5); ctx.fill(); H.poly(ctx, [[kx - 2.2, ky + 1], [kx + 2.2, ky + 1], [kx + 0.8, ky - kh], [kx - 0.8, ky - kh]]); ctx.fillStyle = tone(P.bark, 0.15); ctx.fill(); ctx.fillStyle = tone(P.bark, -0.4); ctx.fillRect(kx, ky - kh, 2.2, kh + 1); } }
      const trunk = [[x - 7, y + 2], [x + 7, y + 2], [x + 3, y - 14], [x + 2, y - 78], [x - 2, y - 78], [x - 3, y - 14]];
      H.poly(ctx, trunk); ctx.fillStyle = tone(P.bark, 0.1); ctx.fill();
      ctx.save(); H.poly(ctx, trunk); ctx.clip(); ctx.fillStyle = tone(P.bark, -0.45); ctx.fillRect(x, y - 90, 20, 100); ctx.restore();
      const leaf = H.mix(P.cypressLeaf, P.cypressRust, 0.22);
      for (let i = 0; i < 5; i++) { const ty = y - 30 - i * 13, rx = 17 - i * 2.6, ry = 7 - i * 0.8; H.ellipse(ctx, x, ty, rx, ry); ctx.fillStyle = tone(leaf, -0.05 + i * 0.04); ctx.fill(); ctx.save(); H.ellipse(ctx, x, ty, rx, ry); ctx.clip(); H.ellipse(ctx, x - rx * 0.3, ty - ry * 0.4, rx * 0.7, ry * 0.75); ctx.fillStyle = tone(leaf, 0.35 + i * 0.04); ctx.fill(); ctx.restore(); }
      H.poly(ctx, [[x - 4, y - 84], [x + 4, y - 84], [x, y - 98]]); ctx.fillStyle = tone(leaf, 0.3); ctx.fill();
    }
  };

  B.figure = function (ctx, x, y, f, env) {
    const shirt = f.shirt === 'purple' ? P.purple : P.gold, trim = f.shirt === 'purple' ? P.gold : P.purple;
    const back = f.facing === 'ne' || f.facing === 'nw', ph = f.walk == null ? 0 : Math.sin(f.walk * Math.PI * 2);
    const bob = f.walk == null ? 0 : Math.abs(ph) * 0.6;
    ctx.save(); ctx.translate(x, y - bob); ctx.lineCap = 'round';
    // legs
    ctx.strokeStyle = tone(P.denim, -0.1); ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-1.6, -7); ctx.lineTo(-1.6 - ph * 2.2, -0.5); ctx.moveTo(1.6, -7); ctx.lineTo(1.6 + ph * 2.2, -0.5); ctx.stroke();
    // body (rounded)
    ctx.fillStyle = tone(shirt, 0.05); ctx.beginPath(); ctx.roundRect(-3.6, -15.5, 7.2, 9.5, 2.6); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(-3.6, -15.5, 7.2, 9.5, 2.6); ctx.clip(); ctx.fillStyle = tone(shirt, -0.45); ctx.fillRect(0.8, -16, 4, 12); ctx.fillStyle = tone(trim, 0.1); ctx.fillRect(-3.6, -11.2, 7.2, 1.2); ctx.restore();
    // arms
    ctx.strokeStyle = tone(shirt, -0.2); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-3.8, -14); ctx.lineTo(-4.6 + ph * 1.5, -8.5); ctx.moveTo(3.8, -14); ctx.lineTo(4.6 - ph * 1.5, -8.5); ctx.stroke();
    // head + hair
    ctx.fillStyle = tone(P.skin, 0.05); ctx.beginPath(); ctx.arc(0, -18.6, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tone(P.hair, 0.1); ctx.beginPath(); ctx.arc(0, -19.2, 3.3, Math.PI * (back ? 0.05 : 1.05), Math.PI * (back ? 0.95 : 1.95)); ctx.fill();
    if (back) { ctx.fillRect(-3.3, -19.2, 6.6, 2.4); }
    ctx.restore();
  };

  B.shadow = function (ctx, s, env) {
    ctx.save(); const col = [43, 37, 80];
    if (s.poly) { H.poly(ctx, s.poly); ctx.fillStyle = css(col, s.a); ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = (s.soft || 4) * 0.5; ctx.strokeStyle = css(col, s.a * 0.5); ctx.stroke(); }
    else { const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.rx); g.addColorStop(0, css(col, s.a)); g.addColorStop(0.72, css(col, s.a)); g.addColorStop(1, css(col, 0)); ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, s.ry / s.rx); ctx.translate(-s.x, -s.y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.rx, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ctx.restore();
  };

  B.light = function (ctx, s, env) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (s.quad) { H.poly(ctx, s.quad); ctx.fillStyle = css(s.color, 0.35); ctx.fill(); const c = H.centroid(s.quad), bb = H.bbox(s.quad), r = Math.max(bb.w, bb.h) * 0.5 + (s.halo || 8); const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r); g.addColorStop(0, css(s.color, 0.35)); g.addColorStop(1, css(s.color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill(); }
    else if (s.pool) { const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.rx); g.addColorStop(0, css(s.color, s.a)); g.addColorStop(1, css(s.color, 0)); ctx.translate(s.x, s.y); ctx.scale(1, s.ry / s.rx); ctx.translate(-s.x, -s.y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.rx, 0, Math.PI * 2); ctx.fill(); }
    else { const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); g.addColorStop(0, css(s.color, s.a)); g.addColorStop(0.3, css(s.color, s.a * 0.5)); g.addColorStop(1, css(s.color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); if (s.firefly) { ctx.fillStyle = css('#F4FFC0', 0.95); ctx.beginPath(); ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };
  return B;
})();
