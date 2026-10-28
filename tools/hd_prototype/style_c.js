// style_c.js — C. SOFT RENDERED (toy / diorama)
// Gradient-based lighting as if 3D-rendered: smooth materials, rounded bevels, specular on roofs and water,
// soft cast shadows, a faint cool rim light on the shadow side, saturated clean colours. Looks like a rendered miniature.
window.HD.styles = window.HD.styles || {};
window.HD.styles.C = (function () {
  const H = window.HD, P = H.P, css = H.css;
  const FACE_T = { top: 0.05, sw: -0.1, se: -0.48 };
  const ROOF_T = { nw: 0.3, ne: -0.18, sw: 0.08, se: -0.5 };
  const RIM = '#B8C8FF', SPEC = '#FFFBEA';
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const satTone = (c, t) => H.toneArr(H.sat(c, 1.12), t);
  const col = (c, t, a) => css(satTone(c, t), a);
  let GRAIN = null;
  function grain() { if (!GRAIN) GRAIN = H.makeTex(64, 64, (x, y) => { const v = H.pnoise(31, x * 2, y * 2, 2, 64) - 0.5; const g = 128 + v * 60; return [g, g, g, 255]; }); return GRAIN; }
  function microGrain(ctx, pts, a) { ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = a; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); const bb = H.bbox(pts); ctx.fillRect(bb.x0 - 4, bb.y0 - 4, bb.w + 8, bb.h + 8); ctx.restore(); }
  /** soft radial blob (sphere-like when offset) */
  function orb(ctx, x, y, rx, ry, color, t, opts) {
    const o = opts || {}; ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.05);
    g.addColorStop(0, col(color, t + 0.75)); g.addColorStop(0.35, col(color, t + 0.25)); g.addColorStop(0.8, col(color, t - 0.3)); g.addColorStop(1, col(color, t - 0.65));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    if (!o.noRim) { ctx.lineWidth = 0.9 / Math.max(rx, ry) * 1.6; ctx.strokeStyle = css(RIM, 0.35); ctx.beginPath(); ctx.arc(0, 0, 0.93, Math.PI * 0.05, Math.PI * 0.6); ctx.stroke(); }
    if (o.spec) { ctx.fillStyle = css(SPEC, o.spec); ctx.beginPath(); ctx.ellipse(-0.38, -0.45, 0.2, 0.12, -0.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function softEllipse(ctx, x, y, rx, ry, color, a, plateau) {
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, css(color, a)); g.addColorStop(plateau == null ? 0.5 : plateau, css(color, a)); g.addColorStop(1, css(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  /** bevelled, gradient-lit plane: lit from the upper-left, light inner edge on top/left, cool rim on bottom/right */
  function plane(ctx, pts, color, t, o) {
    o = o || {}; const bb = H.bbox(pts);
    const g = o.vert ? ctx.createLinearGradient(0, bb.y0, 0, bb.y1) : ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, col(color, t + (o.amp || 0.16))); g.addColorStop(1, col(color, t - (o.amp || 0.16)));
    H.poly(ctx, pts); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = col(color, t, 0.8); ctx.stroke();
    ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.lineCap = 'round';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]; const mx = (a[0] + b[0]) / 2 - (bb.x0 + bb.x1) / 2, my = (a[1] + b[1]) / 2 - (bb.y0 + bb.y1) / 2;
      const lit = (-mx - my * 1.2) > 0;   // edge facing the key light (upper-left)
      ctx.lineWidth = lit ? 1.6 : 1.1; ctx.strokeStyle = lit ? col(color, t + 0.7, 0.55) : css(RIM, o.rim == null ? 0.28 : o.rim);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    if (o.spec) softEllipse(ctx, bb.x0 + bb.w * 0.3, bb.y0 + bb.h * 0.3, bb.w * 0.3, bb.h * 0.25, SPEC, o.spec, 0.1);
    ctx.restore();
  }
  const B = {}; B.name = 'C · soft rendered';

  B.fillQuadShaded = function (ctx, pts, color, o, env) {
    const f = o.face || 'top', m = o.material || 'paint', t = FACE_T[f];
    if (m === 'glow') { plane(ctx, pts, color, 0.1, { amp: 0.1, rim: 0 }); softEllipse(ctx, ...H.centroid(pts), H.bbox(pts).w * 0.45, H.bbox(pts).h * 0.35, '#FFFFFF', 0.45, 0.1); return; }
    if (m === 'glass') { plane(ctx, pts, color, t - 0.1, { vert: true, amp: 0.3, rim: 0.4 }); const bb = H.bbox(pts); ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.fillStyle = css('#FFFFFF', 0.4); ctx.beginPath(); ctx.moveTo(bb.x0 - 2, bb.y0 + bb.h * 0.5); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.05); ctx.lineTo(bb.x1 + 2, bb.y0 + bb.h * 0.22); ctx.lineTo(bb.x0 - 2, bb.y0 + bb.h * 0.67); ctx.fill(); ctx.restore(); return; }
    plane(ctx, pts, color, t, { vert: f !== 'top', amp: m === 'cloth' ? 0.22 : 0.14, spec: m === 'paint' || m === 'cloth' ? 0.18 : 0 });
    if (m === 'stucco' || m === 'stone') microGrain(ctx, pts, 0.35);
    if (f !== 'top') { const bb = H.bbox(pts); const g = ctx.createLinearGradient(0, bb.y1 - Math.min(10, bb.h), 0, bb.y1); g.addColorStop(0, 'rgba(30,25,70,0)'); g.addColorStop(1, 'rgba(30,25,70,0.25)'); ctx.save(); H.poly(ctx, pts); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.w, bb.h); ctx.restore(); }
  };

  B.roofPlane = function (ctx, pts, color, o, env) {
    const t = ROOF_T[o.facing] || 0;
    const e0 = pts[0], e1 = pts[1], apex = pts.length === 4 ? lerp(pts[2], pts[3], 0.5) : pts[2], mid = lerp(e0, e1, 0.5);
    // gradient from the eave (darker) to the ridge (brighter), then a specular band near the ridge
    const g = ctx.createLinearGradient(mid[0], mid[1], apex[0], apex[1]); g.addColorStop(0, col(color, t - 0.2)); g.addColorStop(0.75, col(color, t + 0.15)); g.addColorStop(1, col(color, t + 0.45));
    H.poly(ctx, pts); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = col(color, t, 0.8); ctx.stroke();
    ctx.save(); H.poly(ctx, pts); ctx.clip();
    const n = 7; for (let i = 1; i < n; i++) { const f = i / n; const a = pts.length === 4 ? lerp(pts[0], pts[3], f) : lerp(pts[0], pts[2], f); const b = lerp(pts[1], pts[2], f);
      ctx.lineWidth = 1; ctx.strokeStyle = col(color, t - 0.5, 0.35); ctx.beginPath(); ctx.moveTo(a[0], a[1] + 0.6); ctx.lineTo(b[0], b[1] + 0.6); ctx.stroke();
      ctx.strokeStyle = col(color, t + 0.6, 0.3); ctx.beginPath(); ctx.moveTo(a[0], a[1] - 0.6); ctx.lineTo(b[0], b[1] - 0.6); ctx.stroke(); }
    if (o.facing === 'nw' || o.facing === 'sw') { const p = lerp(mid, apex, 0.8); softEllipse(ctx, p[0], p[1], 22, 5, SPEC, 0.3, 0.1); }
    // eave edge: light bevel + cool rim depending on side
    ctx.lineCap = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = (o.facing === 'se' || o.facing === 'ne') ? css(RIM, 0.35) : col(color, t + 0.6, 0.5); ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
    ctx.restore();
    // soft shadow the eave casts onto whatever is below it (walls, columns)
    if (o.facing === 'sw' || o.facing === 'se') { ctx.save(); ctx.globalCompositeOperation = 'multiply'; const sg = ctx.createLinearGradient(0, e0[1], 0, e0[1] + 12); sg.addColorStop(0, 'rgba(50,40,100,0.42)'); sg.addColorStop(1, 'rgba(50,40,100,0)'); ctx.fillStyle = sg; H.poly(ctx, [e0, e1, [e1[0], e1[1] + 12], [e0[0], e0[1] + 12]]); ctx.fill(); ctx.restore(); }
  };

  B.column = function (ctx, x, yb, h, r, color, env) {
    const g = ctx.createLinearGradient(x - r, 0, x + r, 0); g.addColorStop(0, col(color, 0.0)); g.addColorStop(0.3, col(color, 0.55)); g.addColorStop(0.6, col(color, 0.05)); g.addColorStop(0.9, col(color, -0.5)); g.addColorStop(1, col(RIM, 0.0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.rect(x - r, yb - h, r * 2, h); ctx.fill();
    ctx.fillStyle = col(color, -0.1); ctx.beginPath(); ctx.roundRect(x - r - 1, yb - h - 0.5, r * 2 + 2, 2.6, 0.8); ctx.fill(); ctx.beginPath(); ctx.roundRect(x - r - 1, yb - 2.4, r * 2 + 2, 2.6, 0.8); ctx.fill();
    const ao = ctx.createLinearGradient(0, yb - 8, 0, yb); ao.addColorStop(0, 'rgba(30,25,70,0)'); ao.addColorStop(1, 'rgba(30,25,70,0.3)'); ctx.fillStyle = ao; ctx.fillRect(x - r, yb - 8, r * 2, 8);
  };

  function faces(ctx, T, kind) {
    const cx = T.cx, cy = T.cy;
    const face = (pts, f, drop) => {
      if (kind === 'water') { plane(ctx, pts, P.waterDeep, FACE_T[f] - 0.1, { vert: true, amp: 0.25, rim: 0.15 }); return; }
      plane(ctx, pts, P.dirt, FACE_T[f], { vert: true, amp: 0.22, rim: 0.18 }); microGrain(ctx, pts, 0.3);
      ctx.save(); H.poly(ctx, pts); ctx.clip();
      const lip = kind === 'marsh' ? P.wet : P.grass;
      H.poly(ctx, [pts[0], pts[1], [pts[1][0], pts[1][1] + 3.5], [pts[0][0], pts[0][1] + 3.5]]); const lg = ctx.createLinearGradient(0, pts[0][1], 0, pts[0][1] + 3.5); lg.addColorStop(0, col(lip, FACE_T[f] + 0.3)); lg.addColorStop(1, col(lip, FACE_T[f] - 0.35)); ctx.fillStyle = lg; ctx.fill();
      const g = ctx.createLinearGradient(0, pts[0][1] + 3, 0, pts[0][1] + 10); g.addColorStop(0, 'rgba(30,25,70,0.35)'); g.addColorStop(1, 'rgba(30,25,70,0)'); ctx.fillStyle = g; H.poly(ctx, [[pts[0][0], pts[0][1] + 3], [pts[1][0], pts[1][1] + 3], [pts[1][0], pts[1][1] + 10], [pts[0][0], pts[0][1] + 10]]); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = col(P.dirt, FACE_T[f] - 0.4, 0.5); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + drop * 0.62); ctx.lineTo(pts[1][0], pts[1][1] + drop * 0.62); ctx.stroke();
      ctx.restore();
    };
    if (T.dropS > 0) { const d = T.dropS * 6; face([[cx - 32, cy], [cx, cy + 16], [cx, cy + 16 + d], [cx - 32, cy + d]], 'sw', d); }
    if (T.dropE > 0) { const d = T.dropE * 6; face([[cx, cy + 16], [cx + 32, cy], [cx + 32, cy + d], [cx, cy + 16 + d]], 'se', d); }
  }
  B.groundTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy), r = H.rng(T.seed * 7 + 3);
    faces(ctx, T, T.kind);
    const big = (H.vnoise(43, cx, cy * 2, 70) - 0.5) * 0.26;
    if (T.kind === 'grass') {
      // smooth felt-like grass: diagonal key-light gradient + a soft cloud of lighter patches + rounded tufts
      H.poly(ctx, dia); const g = ctx.createLinearGradient(-200, -120, 200, 190); g.addColorStop(0, col(P.grass, 0.22 + big)); g.addColorStop(1, col(P.grass, -0.1 + big)); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = g; ctx.stroke();
      ctx.save(); H.poly(ctx, dia); ctx.clip(); microGrain(ctx, dia, 0.18);
      for (let i = 0; i < 2; i++) softEllipse(ctx, cx + (r() - .5) * 40, cy + (r() - .5) * 18, 11 + r() * 7, 5 + r() * 3, satTone(P.highGrass, 0.3), 0.22, 0.1);
      for (let i = 0; i < 2; i++) { const x = cx + (r() - .5) * 46, y = cy + (r() - .5) * 20; orb(ctx, x, y - 1.5, 2.6 + r() * 1.5, 1.9 + r(), P.highGrass, 0.0, { spec: 0.35 }); }
      ctx.restore();
    } else {
      H.poly(ctx, dia); const g = ctx.createLinearGradient(-200, -120, 200, 190); g.addColorStop(0, col(P.wet, 0.18 + big)); g.addColorStop(1, col(P.wet, -0.15 + big)); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = g; ctx.stroke();
      ctx.save(); H.poly(ctx, dia); ctx.clip(); microGrain(ctx, dia, 0.22);
      for (let i = 0; i < 2; i++) softEllipse(ctx, cx + (r() - .5) * 40, cy + (r() - .5) * 18, 10 + r() * 6, 4 + r() * 2, satTone(P.marshMud, -0.2), 0.4, 0.3);
      if (T.pool) { const px = cx + (r() - .5) * 20, py = cy + (r() - .5) * 8; ctx.save(); ctx.translate(px, py); ctx.scale(16, 7); const pg = ctx.createRadialGradient(0.1, 0.2, 0, 0, 0, 1); pg.addColorStop(0, col(P.waterDeep, 0.1)); pg.addColorStop(0.8, col(P.shallows, -0.1)); pg.addColorStop(1, col(P.shallows, 0.3)); ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); softEllipse(ctx, px - 5, py - 2.2, 5, 1.6, SPEC, 0.75, 0.3); ctx.lineWidth = 0.8; ctx.strokeStyle = css(RIM, 0.35); H.ellipse(ctx, px, py, 16, 7); ctx.stroke(); }
      for (let c = 0; c < 3; c++) { const x = cx + (r() - .5) * 44, y = cy + (r() - .5) * 20; for (let k = 0; k < 5; k++) { const dx = (k - 2) * 1.5, hgt = 7 + r() * 7; const gg = ctx.createLinearGradient(x + dx - 1, 0, x + dx + 1, 0); gg.addColorStop(0, col(P.reed, 0.5)); gg.addColorStop(1, col(P.reed, -0.4)); ctx.strokeStyle = gg; ctx.lineCap = 'round'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + dx * 0.4, y); ctx.lineTo(x + dx * 1.8, y - hgt); ctx.stroke(); } }
      ctx.restore();
    }
  };

  B.waterTile = function (ctx, T, env) {
    const cx = T.cx, cy = T.cy, dia = H.diamond(cx, cy), r = H.rng(T.seed * 5 + 7), night = env.night;
    faces(ctx, T, 'water');
    const nShore = (T.shore.n ? 1 : 0) + (T.shore.w ? 1 : 0) + (T.shore.s ? 1 : 0) + (T.shore.e ? 1 : 0);
    const base = H.mix(P.waterDay, P.shallows, 0.12 * nShore);
    H.poly(ctx, dia); const g = ctx.createLinearGradient(-200, -120, 200, 190); g.addColorStop(0, col(base, 0.3)); g.addColorStop(0.6, col(base, -0.05)); g.addColorStop(1, col(base, -0.3)); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = g; ctx.stroke();
    ctx.save(); H.poly(ctx, dia); ctx.clip(); ctx.lineCap = 'round';
    const edges = { n: [dia[3], dia[0]], e: [dia[0], dia[1]], s: [dia[1], dia[2]], w: [dia[2], dia[3]] };
    for (const k in edges) if (T.shore[k]) { const [a, b] = edges[k]; const m = lerp(a, b, 0.5), nx = -(b[1] - a[1]), ny = (b[0] - a[0]); const L = Math.hypot(nx, ny); const sg = ctx.createLinearGradient(m[0], m[1], m[0] - nx / L * 10 * Math.sign((m[0] - cx) * nx + (m[1] - cy) * ny || 1), m[1] - ny / L * 10 * Math.sign((m[0] - cx) * nx + (m[1] - cy) * ny || 1)); sg.addColorStop(0, col(P.shallows, 0.55, 0.75)); sg.addColorStop(1, col(P.shallows, 0.2, 0)); ctx.fillStyle = sg; ctx.fillRect(cx - 40, cy - 20, 80, 40); ctx.lineWidth = 1.2; ctx.strokeStyle = css('#F2FFF8', 0.6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    // caustic rings and sharp specular glints
    for (let i = 0; i < 3; i++) { const x = cx + (r() - .5) * 40, y = cy + (r() - .5) * 16; ctx.lineWidth = 0.9; ctx.strokeStyle = col(base, 0.6, 0.3); H.ellipse(ctx, x, y, 7 + r() * 6, 2.5 + r() * 2); ctx.stroke(); }
    for (let i = 0; i < 5; i++) { const x = cx + (r() - .5) * 46, y = cy + (r() - .5) * 20; softEllipse(ctx, x, y, 4 + r() * 5, 0.9 + r() * 0.6, night ? '#C9D8FF' : SPEC, night ? 0.65 : 0.8, 0.25); }
    ctx.restore();
  };

  B.path = function (ctx, pts, w, env) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    H.smoothPath(ctx, pts); ctx.lineWidth = w + 2; ctx.strokeStyle = col(P.gravel, -0.5, 0.5); ctx.stroke();
    H.smoothPath(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = col(P.gravel, 0.05); ctx.stroke();
    H.smoothPath(ctx, pts); ctx.lineWidth = w * 0.6; ctx.strokeStyle = col(P.gravel, 0.35, 0.6); ctx.stroke();
    ctx.save(); ctx.translate(-1.2, -1); H.smoothPath(ctx, pts); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.5; ctx.strokeStyle = col(P.gravel, 0.8); ctx.save(); ctx.translate(0, -w / 2 + 0.6); ctx.stroke(); ctx.restore(); ctx.restore();
    const r = H.rng(pts[0][0] * 5 + 11); for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 5; k++) { const p = lerp(pts[i], pts[i + 1], r()); orb(ctx, p[0] + (r() - .5) * w * 0.6, p[1] + (r() - .5) * w * 0.3, 1.1, 0.8, P.gravel, 0.1, { noRim: true, spec: 0.5 }); }
    ctx.restore();
  };

  B.tree = function (ctx, x, y, kind, o, env) {
    const r = H.rng(o.seed * 13 + 5);
    const cyl = (poly) => { const bb = H.bbox(poly); const g = ctx.createLinearGradient(bb.x0, 0, bb.x1, 0); g.addColorStop(0, col(P.bark, -0.2)); g.addColorStop(0.35, col(P.bark, 0.45)); g.addColorStop(0.7, col(P.bark, -0.2)); g.addColorStop(1, col(P.bark, -0.6)); H.poly(ctx, poly); ctx.fillStyle = g; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.8; ctx.strokeStyle = css(RIM, 0.25); ctx.stroke(); };
    softEllipse(ctx, x, y + 1, 13, 5, '#1E1946', 0.4, 0.2);
    if (kind === 'liveOak') {
      cyl([[x - 6, y + 1], [x + 6, y + 1], [x + 3.5, y - 18], [x + 15, y - 40], [x + 11, y - 42], [x + 1, y - 27], [x - 10, y - 44], [x - 14, y - 41], [x - 3.5, y - 18]]);
      const cxs = x + 2, cys = y - 54; const orbs = [];
      for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2 + r() * 0.5, d = i === 0 ? 0 : 0.5 + r() * 0.5; orbs.push({ x: cxs + Math.cos(a) * 46 * d, y: cys + Math.sin(a) * 19 * d, r: 14 + r() * 9 }); }
      orbs.sort((p, q) => p.y - q.y);
      for (const ob of orbs) { const t = -((ob.y - cys) / 19) * 0.25 - ((ob.x - cxs) / 46) * 0.15; orb(ctx, ob.x, ob.y, ob.r, ob.r * 0.82, P.oakLeaf, t, { spec: 0.22 }); }
      // AO between the lower orbs and the trunk, then translucent moss strands
      softEllipse(ctx, cxs, cys + 16, 40, 10, '#1E1946', 0.25, 0.1);
      ctx.lineCap = 'round'; for (let i = 0; i < 16; i++) { const sx = cxs + (r() - .5) * 92, sy = cys + 8 + r() * 13, len = 10 + r() * 16; const mg = ctx.createLinearGradient(0, sy, 0, sy + len); mg.addColorStop(0, col(P.moss, 0.3, 0.9)); mg.addColorStop(1, col(P.moss, 0.55, 0.15)); ctx.strokeStyle = mg; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + (r() - .5) * 4, sy + len * 0.5, sx + (r() - .5) * 3, sy + len); ctx.stroke(); }
    } else {
      if (o.inWater) { for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2, d = 10 + r() * 10; const kx = x + Math.cos(a) * d, ky = y + Math.sin(a) * d * 0.45 + 2, kh = 4 + r() * 4; ctx.lineWidth = 0.8; ctx.strokeStyle = css('#F2FFF8', 0.45); H.ellipse(ctx, kx, ky + 1, 4.5, 1.7); ctx.stroke(); cyl([[kx - 2.2, ky + 1], [kx + 2.2, ky + 1], [kx + 0.8, ky - kh], [kx - 0.8, ky - kh]]); } }
      cyl([[x - 7.5, y + 2], [x + 7.5, y + 2], [x + 3, y - 14], [x + 2, y - 80], [x - 2, y - 80], [x - 3, y - 14]]);
      const leaf = H.mix(P.cypressLeaf, P.cypressRust, 0.22);
      for (let i = 0; i < 6; i++) { const ty = y - 26 - i * 11.5, rx = 18 - i * 2.6; const n = 6 - Math.floor(i / 2); for (let k = 0; k < n; k++) { const f = n === 1 ? 0 : (k / (n - 1)) * 2 - 1; const ox = x + f * rx * 0.8, oy = ty + Math.abs(f) * 2.5 + ((k % 2) - .5) * 2; orb(ctx, ox, oy, 6.5 - i * 0.5, 5 - i * 0.35, leaf, 0.05 + i * 0.03 - f * 0.12, { spec: 0.15 }); } softEllipse(ctx, x, ty + 5, rx * 0.8, 2.4, '#1E1946', 0.22, 0.2); }
      orb(ctx, x, y - 92, 4.5, 6.5, leaf, 0.2, { spec: 0.2 });
    }
  };

  B.figure = function (ctx, x, y, f, env) {
    const shirt = f.shirt === 'purple' ? P.purple : P.gold, trim = f.shirt === 'purple' ? P.gold : P.purple;
    const back = f.facing === 'ne' || f.facing === 'nw', ph = f.walk == null ? 0 : Math.sin(f.walk * Math.PI * 2), bob = f.walk == null ? 0 : Math.abs(ph) * 0.6;
    ctx.save(); ctx.translate(x, y - bob); ctx.lineCap = 'round';
    const grad = (c, x0, x1, t0, t1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, col(c, t0)); g.addColorStop(0.4, col(c, (t0 + t1) / 2 + 0.2)); g.addColorStop(1, col(c, t1)); return g; };
    ctx.strokeStyle = grad(P.denim, -3, 3, 0.1, -0.5); ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(-1.6, -7); ctx.lineTo(-1.6 - ph * 2.2, -0.5); ctx.moveTo(1.6, -7); ctx.lineTo(1.6 + ph * 2.2, -0.5); ctx.stroke();
    ctx.fillStyle = grad(shirt, -4, 4, 0.2, -0.55); ctx.beginPath(); ctx.roundRect(-3.8, -15.6, 7.6, 9.6, 3.2); ctx.fill();
    ctx.strokeStyle = css(RIM, 0.3); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.roundRect(-3.8, -15.6, 7.6, 9.6, 3.2); ctx.stroke();
    ctx.fillStyle = col(trim, 0.1); ctx.beginPath(); ctx.roundRect(-3.3, -11.3, 6.6, 1.3, 0.6); ctx.fill();
    ctx.strokeStyle = grad(shirt, -4, 4, 0.1, -0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3.9, -14); ctx.lineTo(-4.7 + ph * 1.5, -8.5); ctx.moveTo(3.9, -14); ctx.lineTo(4.7 - ph * 1.5, -8.5); ctx.stroke();
    orb(ctx, 0, -18.6, 3.4, 3.4, P.skin, 0.05, { spec: 0.5 });
    ctx.fillStyle = grad(P.hair, -3, 3, 0.3, -0.4); ctx.beginPath(); ctx.arc(0, -19.2, 3.5, Math.PI * (back ? 0.05 : 1.05), Math.PI * (back ? 0.95 : 1.95)); ctx.fill(); if (back) ctx.fillRect(-3.5, -19.2, 7, 2.5);
    ctx.restore();
  };

  B.shadow = function (ctx, s, env) {
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; const c = [40, 34, 90];
    if (s.poly) { for (let i = 4; i >= 1; i--) { H.poly(ctx, s.poly); ctx.lineJoin = 'round'; ctx.lineWidth = (s.soft || 4) * i * 0.7; ctx.strokeStyle = css(c, s.a * 0.16); ctx.stroke(); } H.poly(ctx, s.poly); ctx.fillStyle = css(c, s.a * 0.75); ctx.fill(); }
    else { softEllipse(ctx, s.x, s.y, s.rx, s.ry, c, s.a * 0.9, 0.35); softEllipse(ctx, s.x - s.rx * 0.2, s.y, s.rx * 0.5, s.ry * 0.5, c, s.a * 0.5, 0.3); }
    ctx.restore();
  };

  B.light = function (ctx, s, env) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (s.quad) { H.poly(ctx, s.quad); ctx.fillStyle = css(s.color, 0.35); ctx.fill(); const c = H.centroid(s.quad), bb = H.bbox(s.quad); const h = s.halo || 8; softEllipse(ctx, c[0], c[1] + 1, bb.w * 0.5 + h * 1.6, bb.h * 0.5 + h, s.color, 0.16, 0.1); softEllipse(ctx, c[0], c[1] + 1, bb.w * 0.5 + h * 0.6, bb.h * 0.5 + h * 0.4, s.color, 0.25, 0.2); }
    else if (s.pool) { softEllipse(ctx, s.x, s.y, s.rx, s.ry, s.color, s.a * 0.55, 0.05); softEllipse(ctx, s.x, s.y, s.rx * 0.55, s.ry * 0.55, s.color, s.a * 0.45, 0.1); }
    else { softEllipse(ctx, s.x, s.y, s.r * 1.4, s.r * 1.4, s.color, s.a * 0.35, 0.02); softEllipse(ctx, s.x, s.y, s.r * 0.7, s.r * 0.7, s.color, s.a * 0.6, 0.08); softEllipse(ctx, s.x, s.y, s.r * 0.22, s.r * 0.22, '#FFFFFF', s.a * 0.9, 0.3); if (s.firefly) { ctx.fillStyle = css('#F4FFC0', 0.95); ctx.beginPath(); ctx.arc(s.x, s.y, 0.9, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  };
  return B;
})();
