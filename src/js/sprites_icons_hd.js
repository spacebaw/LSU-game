'use strict';
// ============================================================================
// BAYOU STATE — sprites_icons_hd.js (H5 effects + icons pass): the HD catalog icons, style C "soft rendered diorama".
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: docs/PLAN_HD_ART.md §4 row "H5 effects + icons" ("icons re-baked from HD masters"); docs/ART_STYLE.md §11 (the B6 icon frame) re-expressed
// through BSU.brush, "## Brush API" and "## Icons (H5)".
// `icon:<catalogId>` is registered through BSU.sprites.registerHD('icon', …) OVER the pen painter of sprites_buildings.js (manifest order: this file loads right
// after sprites_buildings_hd.js, so the HD building painter exists when an icon asks for a building). The frame is the pen's 64 × 64 art px (128 × 128 device px at
// master 2 — what render.drawIcon asks for — 64 × 64 at master 1), anchored on its centre; variant bit 1 = the locked look. EVERY icon shares one frame:
//   · the backdrop — a rounded 64-unit plate (radius 8) from one bevelled plane in the school's purple, lit from the upper left, a soft key bloom and a cool
//     vignette toward the lower right, a 1-px gold-tinted rim (lighter on its lit upper-left edges);
//   · the ground pad — the SAME plate for every footprint row (the footprint diamond + 6 px, purple stone), grass / marsh / water for runs, plants and pilings, a
//     two-face slab (SW face lit, SE face in shadow) with its lit upper rim and a soft contact shadow cast down-right under whatever stands on it;
//   · the same margin — the pen's iconFit (drawn extent = 60 · (extent / 400)^0.22 clamped to 42 … 60 of the 64 units, a size order that holds: po'boy < dorm <
//     library < stadium), so the frame never changes between rows; rows drawn ≥ 2.6× their true size carry the footprint chip ("1×1").
// What stands on the pad comes from the HD masters, never from the pen: footprint rows bake their HD building ONCE for this icon with the entrance on the lit
// face (sprites.bakeWith at master 2: a scratch canvas freed right after the blit, so the atlas never holds an extra FRONT_L variant), plants are the HD oak /
// cypress / azalea cells, levee / floodwall / canal runs are the HD terrain families, reeds / mounds the HD marsh pieces; paths, roads, the boardwalk, the Pedestrian
// Bridge and the gator fence are drawn by the brush's own path / deck / column primitives (the same strokePath the map's paths use). Only the surge barrier gate
// (no HD family yet) is its pen sprite, smoothed into the frame.
// Conventions: brush calls only (no hand-written gradient, no fillText, no Math.random, no rng.fx); every jitter from BSU.rng.hash; deterministic in (id, variant,
// master). Public (BSU.sprites): hdIconFamilies(), ICON_FRAME (frozen), iconBakeStats().
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  const B = BSU.brush;
  if (!M || !B || typeof M.registerHD !== 'function' || typeof M.iconPlan !== 'function' || typeof M.iconFit !== 'function' || typeof B.fillQuadShaded !== 'function') return;
  const hash = BSU.rng.hash;
  const SPR = BSU.SPR || {};
  const ICON = 64;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const strHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h >>> 0; };
  const uv = (u, v) => [32 * (u - v), 16 * (u + v)];

  /** the frame spec, one object for every icon (asserted by test/unit/effects_hd.test.mjs) */
  const FRAME = Object.freeze({ size: ICON, radius: 8, margin: 2, box: 60, minBox: 42, rim: '#9A8038', plate: '#3A2C60', slabPad: 6, slabThick: 4 });
  M.ICON_FRAME = FRAME;
  const GROUND = Object.freeze({
    slab: { base: '#4C3C73', mat: 'stone' },    // under every footprint row: the purple pad
    grass: { base: '#6E8F3C', mat: 'paint' },   // runs on land, plants
    marsh: { base: '#5A6B3A', mat: 'paint' },   // the boardwalk, the preserve, dredge & fill
    water: { base: '#5A8A82', mat: 'paint' }    // the Pedestrian Bridge, pilings
  });
  const bakeStats = { icons: 0, sources: 0, freed: 0 };
  M.iconBakeStats = () => ({ icons: bakeStats.icons, sources: bakeStats.sources, freed: bakeStats.freed });

  // ---------------------------------------------------------------------------
  // The frame: a rounded plate as ONE bevelled plane, a key bloom, a vignette, the gold rim
  // ---------------------------------------------------------------------------
  /** a rounded rectangle as a polygon (n segments per corner), clockwise from the top-left corner's upper end */
  function roundPts(x, y, w, h, r, n) {
    const pts = [];
    for (let c = 0; c < 4; c++) {
      const cx = c === 0 || c === 3 ? x + r : x + w - r, cy = c < 2 ? y + r : y + h - r, a0 = Math.PI + c * Math.PI / 2;
      for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    }
    return pts;
  }
  const FRAME_PTS = roundPts(0.5, 0.5, ICON - 1, ICON - 1, FRAME.radius, 7);
  function drawBackdrop(ctx, env, locked) {
    B.plane(ctx, FRAME_PTS, locked ? '#3A3446' : FRAME.plate, 0, { amp: 0.26, rim: 0.12 });
    ctx.save(); B.poly(ctx, FRAME_PTS); ctx.clip();
    B.softEllipse(ctx, 19, 14, 40, 31, '#9B7BE0', locked ? 0.08 : 0.2, 0.05);    // the key bloom, upper left
    B.softEllipse(ctx, 56, 58, 34, 24, '#0E0824', 0.34, 0.1);                    // the cool vignette, lower right
    ctx.restore();
  }
  function drawRim(ctx, env, locked) {
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.9;
    ctx.strokeStyle = locked ? 'rgba(74,66,96,0.95)' : B.tone('#9A8038', -0.35, 0.95); B.poly(ctx, FRAME_PTS); ctx.stroke();
    const half = FRAME_PTS.slice(Math.floor(FRAME_PTS.length * 0.62)).concat(FRAME_PTS.slice(0, Math.floor(FRAME_PTS.length * 0.14)));   // the lit upper-left run
    ctx.strokeStyle = locked ? 'rgba(107,98,128,0.9)' : B.tone('#9A8038', 0.55, 0.9); ctx.beginPath(); ctx.moveTo(half[0][0], half[0][1]); for (let i = 1; i < half.length; i++) ctx.lineTo(half[i][0], half[i][1]); ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // The ground pad: a two-face slab under whatever stands in the frame
  // ---------------------------------------------------------------------------
  /** [left, top, right, bottom] vertices (and which two are lit-side neighbours of the bottom) of a convex iso quad given in any winding */
  function corners(pts) {
    let bi = 0, li = 0, ri = 0, ti = 0;
    for (let i = 1; i < pts.length; i++) { if (pts[i][1] > pts[bi][1]) bi = i; if (pts[i][0] < pts[li][0]) li = i; if (pts[i][0] > pts[ri][0]) ri = i; if (pts[i][1] < pts[ti][1]) ti = i; }
    return { L: pts[li], T: pts[ti], R: pts[ri], Bt: pts[bi] };
  }
  const inQuad = (p, c, k) => { const dx = Math.abs(p[0] - (c.L[0] + c.R[0]) / 2) / (Math.abs(c.R[0] - c.L[0]) / 2 || 1), dy = Math.abs(p[1] - (c.T[1] + c.Bt[1]) / 2) / (Math.abs(c.Bt[1] - c.T[1]) / 2 || 1); return dx + dy < k; };
  function drawSlab(ctx, env, pts, th, kind, id) {
    const G = GROUND[kind] || GROUND.slab, c = corners(pts), seed = strHash(id) ^ 0x1c0, r = B.rng(seed), cx = (c.L[0] + c.R[0]) / 2, cy = (c.T[1] + c.Bt[1]) / 2;
    const dn = (p) => [p[0], p[1] + th];
    B.fillQuadShaded(ctx, [c.L, c.Bt, dn(c.Bt), dn(c.L)], G.base, { face: 'sw', material: 'stone', noAO: true }, env);   // the lit SW face
    B.fillQuadShaded(ctx, [c.Bt, c.R, dn(c.R), dn(c.Bt)], G.base, { face: 'se', material: 'stone', noAO: true }, env);   // the shadow SE face
    B.fillQuadShaded(ctx, pts, G.base, { face: 'top', material: G.mat }, env);
    ctx.save(); B.poly(ctx, pts); ctx.clip();
    if (kind === 'slab') {   // paving: two soft joint lines and a lit edge
      B.softEllipse(ctx, cx - (c.R[0] - c.L[0]) * 0.18, cy - 1, (c.R[0] - c.L[0]) * 0.34, (c.Bt[1] - c.T[1]) * 0.3, '#8A74C4', 0.2, 0.1);
    } else if (kind === 'grass') {
      for (let i = 0; i < 5; i++) { const p = [cx + (r() - 0.5) * (c.R[0] - c.L[0]) * 0.8, cy + (r() - 0.5) * (c.Bt[1] - c.T[1]) * 0.8]; if (inQuad(p, c, 0.85)) B.softEllipse(ctx, p[0], p[1], 6 + r() * 5, 2.6 + r() * 1.6, i & 1 ? '#8EAC50' : '#4B5E32', i & 1 ? 0.26 : 0.22, 0.2); }
    } else if (kind === 'marsh') {
      for (let i = 0; i < 5; i++) { const p = [cx + (r() - 0.5) * (c.R[0] - c.L[0]) * 0.8, cy + (r() - 0.5) * (c.Bt[1] - c.T[1]) * 0.8]; if (inQuad(p, c, 0.85)) B.softEllipse(ctx, p[0], p[1], 5 + r() * 5, 2.2 + r() * 1.5, i & 1 ? '#3E4830' : '#7A884E', 0.3, 0.2); }
    } else {   // water: soft light, two glints
      B.softEllipse(ctx, cx - 5, cy - 2, (c.R[0] - c.L[0]) * 0.3, (c.Bt[1] - c.T[1]) * 0.28, '#BDEFD8', 0.22, 0.1);
      for (let i = 0; i < 4; i++) { const p = [cx + (r() - 0.5) * (c.R[0] - c.L[0]) * 0.7, cy + (r() - 0.5) * (c.Bt[1] - c.T[1]) * 0.7]; if (inQuad(p, c, 0.8)) B.softEllipse(ctx, p[0], p[1], 2.5 + r() * 2.5, 0.7, '#FFFFFF', 0.55, 0.3); }
    }
    ctx.restore();
    if (env.lod === 0) for (let i = 0; i < (kind === 'grass' ? 6 : kind === 'marsh' ? 3 : 0); i++) { const p = [cx + (r() - 0.5) * (c.R[0] - c.L[0]) * 0.7, cy + (r() - 0.5) * (c.Bt[1] - c.T[1]) * 0.7]; if (inQuad(p, c, 0.78)) B.orb(ctx, p[0], p[1] - 0.8, 1.4 + r() * 0.9, 1 + r() * 0.5, kind === 'grass' ? 'highGrass' : 'reed', 0.1, { spec: 0.25 }); }
    ctx.lineJoin = 'round'; B.stroke(ctx, [c.L, c.T, c.R], 0.9, G.base, 0.7, 0.6);   // the lit upper rim
    return c;
  }

  // ---------------------------------------------------------------------------
  // Decks and the fence: drawn by the brush (the map's own materials), three tiles on the pad
  // ---------------------------------------------------------------------------
  function drawRun(ctx, env, kind, s, ox, oy) {
    const pt = (u, v, h) => { const w = uv(u, v); return [w[0] * s + ox, w[1] * s + oy - (h || 0)]; };
    const U = 1.5;
    if (kind === 'path' || kind === 'road') {
      B.path(ctx, [pt(-U, 0), pt(0, 0), pt(U, 0)], (kind === 'road' ? 13 : 11) * s, env, { material: kind === 'road' ? 'asphalt' : 'gravel' });
    } else if (kind === 'gator_fence') {
      for (let u = -U + 0.1; u <= U; u += 0.5) { const a = pt(u, 0, 0); B.column(ctx, a[0], a[1], 10, 0.8, '#C4C8D4', env); }
      for (const h of [3.5, 8]) B.stroke(ctx, [pt(-U, 0, h), pt(U, 0, h)], 1, '#D8DCE6', h > 5 ? 0.45 : 0.1, 0.95);
      for (let u = -U + 0.1; u < U; u += 0.2) B.stroke(ctx, [pt(u, 0, 3.5), pt(u + 0.2, 0, 8)], 0.5, '#C4C8D4', 0.1, 0.4);
    } else if (kind === 'boardwalk' || kind === 'bridge') {
      const br = kind === 'bridge', hw = 0.36, rise = br ? 5 : 4, dth = 2.2;
      const quad = (u0, u1, v0, v1, h) => [pt(u0, v0, h), pt(u1, v0, h), pt(u1, v1, h), pt(u0, v1, h)];
      B.shadow(ctx, { poly: quad(-U, U, -hw + 0.1, hw + 0.1, 0).map((p) => [p[0] + 2, p[1] + 1]), soft: 2.5, a: 0.4 }, env);
      for (let u = -U + 0.25; u < U; u += br ? 1 : 0.5) { const a = pt(u, hw - 0.04, rise - dth); B.column(ctx, a[0], a[1] + rise - dth, rise - dth + 0.5, br ? 1.1 : 0.7, br ? 'steel' : 'bark', env); }   // stilts / piers under the near edge
      B.fillQuadShaded(ctx, [pt(-U, hw, rise - dth), pt(U, hw, rise - dth), pt(U, hw, rise), pt(-U, hw, rise)], br ? 'steel' : 'wood', { face: 'sw', material: br ? 'stone' : 'wood', noAO: true }, env);   // the deck's lit side
      B.fillQuadShaded(ctx, quad(-U, U, -hw, hw, rise), br ? '#B8B8BC' : '#9B6A48', { face: 'top', material: br ? 'stone' : 'wood' }, env);
      if (br) { B.stroke(ctx, [pt(-U, 0, rise), pt(U, 0, rise)], 0.7, '#E6E6EA', 0.2, 0.7); for (let u = -U + 0.5; u < U; u += 0.5) B.stroke(ctx, [pt(u, -hw, rise), pt(u, hw, rise)], 0.5, '#8E8E94', 0, 0.5); }
      else for (let u = -U + 0.12, k = 0; u < U; u += 0.12, k++) B.stroke(ctx, [pt(u, -hw + 0.02, rise), pt(u, hw - 0.02, rise)], 0.5, k % 3 === 2 ? '#C58D62' : '#7C5236', 0, k % 3 === 2 ? 0.5 : 0.6, { cap: 'butt' });
      for (const side of [-1, 1]) {   // rails: the far one first, the near one over the deck
        const v = side * hw, rh = br ? 5 : 3;
        for (let u = -U; u <= U + 0.01; u += br ? 0.5 : 0.5) { const a = pt(u, v, rise); B.column(ctx, a[0], a[1], rh, br ? 0.55 : 0.5, br ? 'purple2' : 'bark', env); if (br && Math.round((u + U) / 0.5) % 2 === 0) B.orb(ctx, a[0], a[1] - rh - 0.6, 0.9, 0.9, 'gold', 0.1, { noRim: true }); }
        B.stroke(ctx, [pt(-U, v, rise + rh), pt(U, v, rise + rh)], br ? 1 : 0.9, br ? 'purple2' : 'bark', side > 0 ? 0.35 : -0.1, 0.95);
        if (br) B.stroke(ctx, [pt(-U, v, rise + 1.5), pt(U, v, rise + 1.5)], 0.8, 'purple', 0, 0.9);
      }
    }
  }
  /** the preserve's gold boundary: back posts and rails first, the reeds over them, the front ones last */
  function drawPreserve(ctx, env, c, front) {
    const e = front ? [[c.L, c.Bt], [c.Bt, c.R]] : [[c.L, c.T], [c.T, c.R]], rail = (a, b, h) => [[a[0], a[1] - h], [b[0], b[1] - h]];
    for (const [a, b] of e) B.stroke(ctx, rail(a, b, 5), 1, 'gold', front ? 0.2 : -0.1, 0.95);
    for (const p of front ? [c.L, c.Bt, c.R] : [c.L, c.T, c.R]) { B.column(ctx, p[0], p[1], 7, 0.8, 'gold', env); B.orb(ctx, p[0], p[1] - 7.4, 1.1, 1.1, 'gold', 0.4, { noRim: true }); }
  }

  // ---------------------------------------------------------------------------
  // Sources: the HD masters the icon stands on its pad
  // ---------------------------------------------------------------------------
  /** the entry an item stands for at the icon's master: an HD atlas cell, or (footprint rows) the HD building baked ONCE for this icon (entrance on the lit face) */
  function sourceOf(it, z) {
    if (it.bld) { const e = M.bakeWith(it.id, it.v, 0, z); if (e && e.canvas) { e.tmp = true; bakeStats.sources++; } return e; }
    return M.get(it.id, it.v, 0, z);
  }
  function drawItem(ctx, it, s, ox, oy, z) {
    const e = sourceOf(it, z); if (!e || !e.canvas) return;
    const ez = e.zoom || z, dx = it.ax * s + ox + (e.ox / ez) * s, dy = it.ay * s + oy + (e.oy / ez) * s;
    try { ctx.drawImage(e.canvas, e.sx, e.sy, e.sw, e.sh, dx, dy, (e.sw / ez) * s, (e.sh / ez) * s); } catch (err) { /* stub */ }
    if (e.tmp) { try { e.canvas.width = 1; e.canvas.height = 1; bakeStats.freed++; } catch (err) { /* stub */ } }
  }

  // ---------------------------------------------------------------------------
  // Chips: the footprint badge and the padlock
  // ---------------------------------------------------------------------------
  function drawBadge(ctx, env, str, x, y) {
    const w = str.length * 5 + 3, h = 10, pts = roundPts(x, y, w, h, 3.2, 3);
    B.plane(ctx, pts, '#1A1230', -0.1, { amp: 0.1, rim: 0.1 }); ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.strokeStyle = B.tone('#6E5A2C', 0.1, 0.95); B.poly(ctx, pts); ctx.stroke();
    let cx = x + 3.4; const top = y + 2.4, bot = y + h - 2.4;
    for (const ch of str) {   // the chip's own tiny glyphs: a flagged one, a cross, the other digits from the brush
      if (ch === '1') { B.stroke(ctx, [[cx + 0.4, top + 1.3], [cx + 1.6, top], [cx + 1.6, bot]], 0.95, 'gold', 0.3, 1); cx += 3.8; }
      else if (ch === '×') { B.stroke(ctx, [[cx, top + 1.4], [cx + 2.6, bot - 1.4]], 0.85, 'gold', 0.1, 0.95); B.stroke(ctx, [[cx + 2.6, top + 1.4], [cx, bot - 1.4]], 0.85, 'gold', 0.1, 0.95); cx += 4.2; }
      else { B.digits(ctx, cx + 1.4, (top + bot) / 2, ch, bot - top, 'gold', 0.3, { sx: 0.9, w: 0.95 }); cx += 4.4; }
    }
  }
  function drawPadlock(ctx, env, x, y) {
    ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.strokeStyle = B.tone('#D8D2E8', 0, 1); ctx.beginPath(); ctx.arc(x + 3.5, y + 3.2, 2.4, Math.PI, 0); ctx.stroke(); ctx.lineCap = 'butt';
    B.plane(ctx, roundPts(x, y + 3.4, 7, 5.6, 1.4, 3), '#F5B700', 0, { amp: 0.2, rim: 0.2 });
    B.softEllipse(ctx, x + 3.5, y + 6, 1.1, 1.1, '#2B1246', 0.95, 0.5);
  }

  // ---------------------------------------------------------------------------
  // The painter
  // ---------------------------------------------------------------------------
  const RUN_KINDS = { path: 1, road: 1, boardwalk: 1, bridge: 1, gator_fence: 1 };   // drawn by the brush; every other run is made of HD terrain stamps
  M.registerHD('icon', function (ctx, spec) {
    const id = spec.sub, locked = (spec.variant & 1) === 1, G = B.begin(ctx, ICON, ICON, spec), env = G.env, z = G.S === 2 ? 2 : 1;
    drawBackdrop(ctx, env, locked);
    const pl = M.iconPlan(id);
    if (pl) {
      const f = M.iconFit(id), s = f.s, ox = f.ox, oy = f.oy, pts = pl.poly.map((p) => [p[0] * s + ox, p[1] * s + oy]), th = Math.max(2, Math.round(pl.th * s * 1.4));
      const c = drawSlab(ctx, env, pts, th, pl.ground, id);
      const runKind = RUN_KINDS[id] ? id : '';
      if (runKind) drawRun(ctx, env, runKind, s, ox, oy);
      else {
        if (id === 'preserve') drawPreserve(ctx, env, c, false);
        // the contact shadow, cast down-right from the footprint under everything that stands on the pad
        const sh = (k) => pts.map((p) => [cx(pts) + (p[0] - cx(pts)) * k + 2.4, cy(pts) + (p[1] - cy(pts)) * k + 1.4]);
        if (pl.items.some((it) => it.bld)) B.shadow(ctx, { poly: sh(0.78), soft: 3, a: 0.42 }, env);
        else if (pl.items.length) B.shadow(ctx, { x: cx(pts) + 3, y: cy(pts) + 1.5, rx: (c.R[0] - c.L[0]) * 0.28, ry: (c.Bt[1] - c.T[1]) * 0.26, a: 0.3 }, env);
        for (const it of pl.items) { if (it.id === 'preservePost') continue; drawItem(ctx, it, s, ox, oy, z); }
        if (id === 'preserve') drawPreserve(ctx, env, c, true);
      }
      if (f.badge && pl.foot) drawBadge(ctx, env, pl.foot, 4, 5);
    }
    if (locked) {   // the pen's look: greyscale + dim, then the padlock
      try { ctx.save(); B.poly(ctx, FRAME_PTS); ctx.clip(); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, ICON, ICON); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.12; ctx.fillStyle = '#1A1230'; ctx.fillRect(0, 0, ICON, ICON); ctx.restore(); } catch (e) { /* stub */ }
    }
    drawRim(ctx, env, locked);
    if (locked) drawPadlock(ctx, env, 50.5, 4.5);
    bakeStats.icons++;
    return { w: ICON, h: ICON, ox: -(ICON >> 1), oy: -(ICON >> 1) };
  }, { pin: true });   // pinned: baked once per session — gc never drops an icon, so the build menu re-opens from the atlas (a cell is 64 KB at master 2)
  const cx = (pts) => (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, cy = (pts) => (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  M.hdIconFamilies = () => ['icon'];

  // ---------------------------------------------------------------------------
  // Self-test: every catalog row bakes at both masters with the one frame size (and the locked look)
  // ---------------------------------------------------------------------------
  if (Array.isArray(M._tests)) M._tests.push(function () {
    const notes = [], cat = BSU.data && BSU.data.catalog;
    if (!cat) return { ok: true, notes: 'data.js not loaded yet' };
    let n = 0;
    for (const id of Object.keys(cat)) {
      for (const z of [1, 2]) for (const v of [0, 1]) {
        const e = M.get('icon:' + id, v, 0, z);
        if (!e) { notes.push('icon:' + id + ' null at master ' + z); continue; }
        if (e.sw !== ICON * z || e.sh !== ICON * z || e.ox !== -32 * z || e.oy !== -32 * z) notes.push('icon:' + id + ' is not the 64-unit frame at master ' + z);
        if (!e.hd) notes.push('icon:' + id + ' is not an HD entry');
      }
      n++;
    }
    return { ok: !notes.length, notes: notes.join('; ') || (n + ' catalog icons at masters 1 + 2, one frame') };
  });
})();
