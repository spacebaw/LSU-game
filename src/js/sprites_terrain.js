'use strict';
// ============================================================================
// BAYOU STATE — sprites_terrain.js (H1 terrain + water pass): the HD painters of every terrain and water family, composed from
// BSU.brush (style C "soft rendered diorama") and registered over the pen painters of sprites.js through sprites.registerHD, so
// sprites.get(id, variant, frame, zoom) serves them at master 1 (zoom 0.5 / 1, lod 1) and master 2 (zoom 2 / Retina, lod 0).
// Extends BSU.sprites (no new namespace). Canvas sizes and anchors are exactly the pen painters' (docs/ART_STYLE.md §7), so
// render.js's chunk bake positions nothing differently; what changed is the variant of `tile` (position bits for every type, a
// depth bit for water) and `cliff` (1–5 px terrace steps are sprites too), both set by render.js only while this file's families are HD.
// World anchoring: a cached tile variant carries its 8×8-tile block position (brush.posEnv), so noise, grain and decoration sites
// are sampled in world px with a 256×128 period — neighbours and chunk borders join with no seam and no visible 1-tile repeat.
// Families: tile, cliff, tuft, patch, shore, tone, reeds, knees, worn, mound, levee, floodwall, canal, water (hdTerrainFamilies()).
// Pen painters kept (not terrain): surf (the gator fence stamp + palette icons), preservePost, decal, light; vegetation is H3.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  const PAL = BSU.params.palette;
  const T = BSU.T;
  const hash = BSU.rng.hash;
  const X = M.extra || {};
  const TW = 64, TH = 32, PX_PER_FT = 6;
  const B = () => BSU.brush;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const AO = '#1E1946', SPEC = '#FFFBEA';
  // run directions in screen space (sprites.DIRS): N up-right, E down-right, S down-left, W up-left; bits N1 E2 S4 W8
  const DIRS = M.DIRS || [{ bit: 1, dx: 1, dy: -1 }, { bit: 2, dx: 1, dy: 1 }, { bit: 4, dx: -1, dy: 1 }, { bit: 8, dx: -1, dy: -1 }];
  const FAMILIES = ['tile', 'cliff', 'tuft', 'patch', 'shore', 'tone', 'reeds', 'knees', 'worn', 'mound', 'levee', 'floodwall', 'canal', 'water'];
  M.HD_TERRAIN = Object.freeze(FAMILIES.slice());
  /** the terrain / water families this file registers as HD (in registration order) */
  M.hdTerrainFamilies = function () { return FAMILIES.slice(); };
  /** tile variant bits set by render's chunk bake while the terrain is HD: 8 shallow bed (< 1.5 ft), 1024 deep bed (≥ 3 ft), pos << 4 */
  M.TILE_SHALLOW = 8; M.TILE_DEEP = 1024; M.TILE_POS_SHIFT = 4;

  // ---------------------------------------------------------------------------
  // tile:<T> — 64×32, ox −32 oy −16; variant: bit 3 shallow, bit 10 deep, bits 4–9 the block position (every type, H1)
  // ---------------------------------------------------------------------------
  M.registerHD('tile', function (ctx, spec) {   // pinned: the 64 block-position variants are fetched only by chunk bakes (never gc'd between them)
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec);
    const t = clamp(parseInt(spec.sub, 10) || 0, 0, 7), v = spec.variant | 0, shallow = (v & M.TILE_SHALLOW) !== 0, deep = (v & M.TILE_DEEP) !== 0, pv = (v >> M.TILE_POS_SHIFT) & 63;
    const cx = TW >> 1, cy = TH >> 1, env = Br.posEnv(g.env, pv, cx, cy), seed = t * 131 + 7;
    switch (t) {
      case T.OPEN_WATER: Br.waterTile(ctx, { cx: cx, cy: cy, seed: seed, depth: shallow ? 0 : deep ? 2 : 1 }, env); break;
      case T.BAYOU: Br.waterTile(ctx, { cx: cx, cy: cy, seed: seed, depth: shallow ? 0 : 1, bayou: true }, env); break;
      case T.POND: Br.waterTile(ctx, { cx: cx, cy: cy, seed: seed, depth: 1, pond: true }, env); break;
      case T.MARSH: Br.groundTile(ctx, { cx: cx, cy: cy, seed: seed, kind: 'marsh' }, env); break;
      case T.WET: Br.groundTile(ctx, { cx: cx, cy: cy, seed: seed, kind: 'wet' }, env); break;
      case T.HIGH: Br.groundTile(ctx, { cx: cx, cy: cy, seed: seed, kind: 'high' }, env); break;
      case T.DRAINED: Br.groundTile(ctx, { cx: cx, cy: cy, seed: seed, kind: 'dirt' }, env); break;
      default: Br.groundTile(ctx, { cx: cx, cy: cy, seed: seed, kind: 'grass' }, env); break;
    }
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  }, { pin: true });

  // ---------------------------------------------------------------------------
  // cliff — variant = face px (1…96; 1–5 is a terrace step, the pen painter started at 6), frame 0 south (under the SW edge, lit) /
  // 1 east (SE edge, shadow); canvas 32 × (16 + h); anchor the tile centre (ox −32 south / 0 east, oy 0)
  // ---------------------------------------------------------------------------
  M.registerHD('cliff', function (ctx, spec) {
    const Br = B(); const h = clamp(spec.variant | 0, 1, 96), east = (spec.frame & 1) === 1;
    const g = Br.begin(ctx, 32, 16 + h, spec), env = g.env, lod = env.lod, seed = hash(h, east ? 3 : 5);
    const a = east ? [0, 16] : [0, 0], b = east ? [32, 0] : [32, 16];
    const pts = [a, b, [b[0], b[1] + h], [a[0], a[1] + h]];
    const ft = east ? -0.42 : -0.08;   // key light upper-left: the south face is lit, the east face in shadow
    if (h <= 5) {   // a sub-foot terrace step: a toned band exactly as tall as the pixel step, a lit lip on the south edge
      Br.plane(ctx, pts, 'dirt', ft - 0.15, { vert: true, amp: 0.12, rim: east ? 0.2 : 0.08 });
      if (!east) Br.stroke(ctx, [a, b], 1, 'grass', 0.35, 0.6, { cap: 'butt' });
      return { w: 32, h: 16 + h, ox: east ? 0 : -32, oy: 0 };
    }
    Br.plane(ctx, pts, 'dirt', ft, { vert: true, amp: 0.22, rim: east ? 0.22 : 0.12 });
    Br.microGrain(ctx, pts, 0.3, env);
    ctx.save(); Br.poly(ctx, pts); ctx.clip();
    const band = (y0, y1, color, t, amp) => Br.plane(ctx, [[a[0], a[1] + y0], [b[0], b[1] + y0], [b[0], b[1] + y1], [a[0], a[1] + y1]], color, t, { vert: true, amp: amp, rim: 0 });
    band(0, 3.5, 'dirt', ft + 0.12, 0.1);                                                          // topsoil
    if (h >= 12) for (let y = 3.5 + 7 + (seed % 5); y < h - 3; y += 22) {                           // strata: clay with a limestone seam on tall faces
      band(y, Math.min(h - 2, y + 14), 'clay', ft - 0.05, 0.12);
      if (h >= 24) { band(y + 14, Math.min(h - 2, y + 20), 'limestone', ft - 0.1, 0.1); Br.stroke(ctx, [[a[0], a[1] + y + 14], [b[0], b[1] + y + 14]], 1, 'limestone', -0.9, 0.5, { cap: 'butt' }); }
      Br.stroke(ctx, [[a[0], a[1] + y], [b[0], b[1] + y]], 1.1, 'dirt', -0.85, 0.55, { cap: 'butt' });   // the layer boundary
    }
    Br.edgeFade(ctx, pts, a, b, 9, AO, 0, 0.38);                                                   // the lip's shadow
    Br.edgeFade(ctx, pts, pts[2], pts[3], Math.min(8, h * 0.5), AO, 0, 0.3);                       // the foot in shadow
    for (let i = 0, nr = 2 + (seed % 3); i < nr; i++) {                                            // roots wandering down
      let c = 3 + (hash(seed, 710 + i) % 26); const len = 4 + (hash(seed, 720 + i) % Math.max(1, Math.min(14, h - 6)));
      const top = east ? 16 - c / 2 : c / 2, rp = [[c, top + 3]];
      for (let y = 4; y < 3 + len; y += 2) { c += ((hash(seed, 740 + i + y) & 3) - 1.5) * 0.9; rp.push([c, top + y]); }
      Br.stroke(ctx, rp, 1.1, 'bark', -0.3, 0.8, { smooth: true });
    }
    for (let i = 0; i < (lod > 0 ? 2 : 3); i++) {                                                  // stones
      const c = 3 + (hash(seed, 300 + i) % 26), y = 5 + (hash(seed, 350 + i) % Math.max(1, h - 9)); const top = east ? 16 - c / 2 : c / 2;
      Br.orb(ctx, c, top + y, 1.8 + (hash(seed, 360 + i) & 1) * 0.6, 1.2, 'limestone', ft + 0.1, { spec: 0.4 });
    }
    ctx.restore();
    if (h >= 10) for (let c = 1; c < 32; c += lod > 0 ? 5 : 3) {                                   // the grass overhang over the lip
      if ((hash(seed, 600 + c) % 4) === 0) continue;
      const top = east ? 16 - c / 2 : c / 2;
      Br.orb(ctx, c, top + 1.2, 2.1, 1.5, east ? 'grass' : 'highGrass', east ? -0.2 : 0.15, { noRim: true, spec: east ? 0 : 0.25 });
    }
    return { w: 32, h: 16 + h, ox: east ? 0 : -32, oy: 0 };
  }, { pin: true });

  // ---------------------------------------------------------------------------
  // tuft (8×6, variants 0–3, sub 'high'), patch:<clover|dirt|lime> (16×8, variants 0–3)
  // ---------------------------------------------------------------------------
  M.registerHD('tuft', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, 8, 6, spec), env = g.env;
    const v = spec.variant & 3, seed = hash(0x7f7, v), color = spec.sub === 'high' ? 'highGrass' : 'grass';
    Br.softEllipse(ctx, 4, 5.2, 3.6, 1, AO, 0.35, 0.3);
    const n = 3 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) { const x = 1.5 + (hash(seed, 10 + i) % 6), h = 2.5 + (hash(seed, 20 + i) % 3), lean = (hash(seed, 30 + i) % 3) - 1; Br.blade(ctx, x, 5.5, h, lean, color, 0.25, 1.2); }
    void env;
    return { w: g.w, h: g.h, ox: -4, oy: -5 };
  });
  M.registerHD('patch', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, 16, 8, spec), env = g.env, lod = env.lod;
    const v = spec.variant & 3, kind = spec.sub || 'dirt', seed = hash(0x9a7 + v, kind === 'clover' ? 1 : kind === 'lime' ? 2 : 3);
    if (kind === 'clover') {
      const cl = Br.mix(Br.ramp('grass'), '#2F6E4E', 0.45);
      Br.softEllipse(ctx, 8, 4, 7.5, 3.4, Br.toneArr(cl, -0.25), 0.85, 0.55);
      for (let i = 0, n = lod > 0 ? 3 : 6; i < n; i++) { const x = 2.5 + (hash(seed, 10 + i) % 11), y = 2 + (hash(seed, 20 + i) % 4); Br.orb(ctx, x, y, 1.1, 0.8, cl, 0.45, { noRim: true, spec: 0.3 }); }
      Br.orb(ctx, 4 + (hash(seed, 40) % 8), 3, 0.7, 0.6, '#F2EEDC', 0.2, { noRim: true });   // one white clover head
    } else if (kind === 'lime') {
      Br.softEllipse(ctx, 8, 5.4, 7.5, 2.6, AO, 0.45, 0.4);
      Br.orb(ctx, 8, 4, 6.5, 2.4, 'limestone', 0, { spec: 0.4 });
      Br.orb(ctx, 5.5, 3.2, 2.4, 1, 'limestone', 0.35, { noRim: true, spec: 0.5 });
    } else {
      const d = Br.mix(Br.ramp('dirt'), Br.ramp('grass'), 0.4);   // dirt softened toward the grass it sits on
      Br.softEllipse(ctx, 8, 4, 7.5, 3.3, Br.toneArr(d, -0.1), 0.9, 0.5);
      Br.softEllipse(ctx, 6.5, 3, 3.5, 1.4, Br.toneArr(d, 0.45), 0.6, 0.3);
      if (lod === 0) for (let i = 0; i < 4; i++) { const x = 2 + (hash(seed, 50 + i) % 12), y = 2 + (hash(seed, 60 + i) % 5); Br.orb(ctx, x, y, 0.8, 0.6, d, -0.2, { noRim: true }); }
    }
    return { w: g.w, h: g.h, ox: -8, oy: -4 };
  });

  // ---------------------------------------------------------------------------
  // shore:<sand|mud> (land side, variant = mask of WATER neighbours N1 E2 S4 W8), shore:ripple (water side, mask of LAND neighbours),
  // shore:beach (the cove floor, whole tile) — 64×32 tile canvases
  // ---------------------------------------------------------------------------
  const EDGE = (dia) => ({ 1: [dia[3], dia[0]], 2: [dia[0], dia[1]], 4: [dia[1], dia[2]], 8: [dia[2], dia[3]] });   // N, E, S, W edges of the diamond
  M.registerHD('shore', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec), env = g.env, lod = env.lod;
    const kind = spec.sub || 'sand', mask = spec.variant & 15, cx = TW >> 1, cy = TH >> 1, dia = Br.diamond(cx, cy), E = EDGE(dia), seed = hash(0x5e0 + mask, kind.length);
    ctx.save(); Br.poly(ctx, Br.diamondGrown(cx, cy, 0.7)); ctx.clip();
    if (kind === 'beach') {   // the cove floor: shell sand, damp toward the water (the S and E edges), scattered shells
      const fill = Br.tone('sand', 0.08);
      Br.poly(ctx, dia); ctx.fillStyle = fill; ctx.fill(); Br.seamStroke(ctx, dia, fill, env);
      Br.macroGrain(ctx, dia, 0.4, env); Br.microGrain(ctx, dia, 0.2, env);
      Br.edgeFade(ctx, dia, dia[1], dia[2], 13, 'sand', -0.4, 0.55); Br.edgeFade(ctx, dia, dia[0], dia[1], 9, 'sand', -0.3, 0.35);
      for (let i = 0, n = lod > 0 ? 3 : 6; i < n; i++) { const x = cx - 24 + (hash(seed, 10 + i) % 48), y = cy - 10 + (hash(seed, 20 + i) % 20); if (Math.abs(x - cx) / 32 + Math.abs(y - cy) / 16 > 0.85) continue; Br.orb(ctx, x, y, 1.1, 0.7, 'limestone', 0.5, { noRim: true, spec: 0.5 }); }
    } else {
      for (const bit in E) {
        if (!(mask & bit)) continue;
        const a = E[bit][0], b = E[bit][1];
        if (kind === 'sand') {
          Br.edgeFade(ctx, dia, a, b, 13, 'sand', 0.2, 0.92); Br.edgeFade(ctx, dia, a, b, 4.5, 'sand', -0.35, 0.5);
          Br.stroke(ctx, [a, b], 1, 'sand', -0.6, 0.45, { cap: 'butt' });
        } else if (kind === 'mud') {
          Br.edgeFade(ctx, dia, a, b, 9, 'mud', -0.45, 0.9); Br.edgeFade(ctx, dia, a, b, 3, 'mud', -0.95, 0.6);
          const m = Br.lerp(a, b, 0.5), c = Br.centroid(dia), nx = (c[0] - m[0]) / 32, ny = (c[1] - m[1]) / 16;   // the wet sheen just inside the waterline
          Br.stroke(ctx, [[a[0] + nx * 1.6, a[1] + ny * 0.8], [b[0] + nx * 1.6, b[1] + ny * 0.8]], 1, 'waterShallow', 0.3, 0.4, { cap: 'butt' });
        } else {   // ripple: the shallows band on the water side of the shore, a foam thread on the waterline, a second ripple inward
          Br.edgeFade(ctx, dia, a, b, 11, 'waterShallow', 0.55, 0.6);
          Br.stroke(ctx, [a, b], 1.2, '#F2FFF8', 0, 0.55, { cap: 'butt' });
          if (lod === 0) { const m = Br.lerp(a, b, 0.5), c = Br.centroid(dia), nx = (c[0] - m[0]) / 32, ny = (c[1] - m[1]) / 16; Br.stroke(ctx, [[a[0] + nx * 5, a[1] + ny * 2.5], [b[0] + nx * 5, b[1] + ny * 2.5]], 0.9, 'waterShallow', 0.5, 0.35, { cap: 'butt' }); }
        }
      }
      if (kind === 'sand' && lod === 0) for (let i = 0; i < 5; i++) {   // shell flecks near the waterline
        const x = cx - 26 + (hash(seed, 30 + i) % 52), y = cy - 12 + (hash(seed, 40 + i) % 24);
        const dx = (x - cx) / 32, dy = (y - cy) / 16; let d = 2;
        if (mask & 1) d = Math.min(d, 1 - (dx - dy)); if (mask & 2) d = Math.min(d, 1 - (dx + dy)); if (mask & 4) d = Math.min(d, 1 + (dx - dy)); if (mask & 8) d = Math.min(d, 1 + (dx + dy));
        if (d > 0.32 || d < 0.03) continue;
        Br.orb(ctx, x, y, 0.9, 0.6, 'limestone', 0.6, { noRim: true, spec: 0.5 });
      }
    }
    ctx.restore();
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });
  // tone:<warm|cool> — the per-tile tint diamond the bake draws at ≤ .28 alpha (ground height / slope / world noise)
  M.registerHD('tone', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec), env = g.env, dia = Br.diamond(TW >> 1, TH >> 1);
    const fill = Br.css(spec.sub === 'cool' ? (M.COOL_TINT || '#2B2550') : (M.WARM_TINT || '#FFE0A0'), 1);
    Br.poly(ctx, dia); ctx.fillStyle = fill; ctx.fill(); Br.seamStroke(ctx, dia, fill, env);
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });

  // ---------------------------------------------------------------------------
  // reeds (12×14, variants 0–2, 2 sway frames), knees (64×32 overlay keyed by the block position), worn (64×32), mound (24×14)
  // ---------------------------------------------------------------------------
  M.registerHD('reeds', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, 12, 14, spec), env = g.env;
    const v = spec.variant % 3, f = spec.frame % 2, seed = hash(0x2ee, v);
    Br.softEllipse(ctx, 6, 13.2, 4.5, 1.1, AO, 0.45, 0.3);
    const n = 5 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) { const x = 2.5 + (hash(seed, 10 + i) % 8), len = 7 + (hash(seed, 20 + i) % 6), lean = ((hash(seed, 30 + i) % 3) - 1) + f * 1.2; Br.blade(ctx, x, 13.2, len, lean, 'reed', (i & 1) ? 0.1 : -0.15, 1.4); }
    { const x = 3.5 + (hash(seed, 40) % 6) + f * 0.8, y = 2 + (hash(seed, 50) % 3); Br.orb(ctx, x, y, 0.9, 1.6, 'sand', -0.2, { noRim: true, spec: 0.3 }); }   // one seed head
    void env;
    return { w: g.w, h: g.h, ox: -6, oy: -13 };
  });
  M.registerHD('knees', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec);
    const pv = spec.variant & 63, seed = hash(pv, 0x4ee), cx = TW >> 1, cy = TH >> 1, env = Br.posEnv(g.env, pv, cx, cy);
    const cand = [];
    for (let y = cy - 12; y < cy + 13; y += 2) for (let x = cx - 28; x <= cx + 28; x += 3) {
      if (Math.abs(x - cx) / 32 + Math.abs(y - cy) / 16 > 0.85) continue;
      const n = Br.marshField(env, x, y); if (n > 0.37 && n < 0.49) cand.push([x, y]);   // the pool's mud rim (the marsh tile floods n < .42)
    }
    const knees = [];
    if (cand.length) {
      const c0 = cand[hash(seed, 1) % cand.length]; knees.push(c0);
      for (let i = 0; i < cand.length && knees.length < 6; i++) { const c = cand[(i * 7 + hash(seed, 2)) % cand.length]; if (Math.abs(c[0] - c0[0]) <= 14 && Math.abs(c[1] - c0[1]) <= 7 && !knees.some((k) => Math.abs(k[0] - c[0]) < 3 && Math.abs(k[1] - c[1]) < 2)) knees.push(c); }
    } else { const n = 2 + (hash(seed, 3) % 2); for (let i = 0; i < n; i++) knees.push([cx - 8 + (hash(seed, 10 + i) % 16), cy + (hash(seed, 20 + i) % 6) - 2]); }
    knees.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < knees.length; i++) {
      const x = knees[i][0], y = knees[i][1], kh = 3 + (hash(seed, 30 + i) % 3);
      Br.softEllipse(ctx, x + 0.5, y + 0.6, 2.4, 0.9, AO, 0.4, 0.3);
      Br.stroke(ctx, [[x + 0.5, y], [x + 0.5, y - kh]], 2.2, 'bark', -0.35, 1, { cap: 'round' });
      Br.stroke(ctx, [[x, y - 0.5], [x, y - kh + 0.3]], 0.9, 'bark', 0.45, 0.9, { cap: 'round' });
      Br.orb(ctx, x + 0.5, y - kh, 1.2, 0.9, 'bark', 0.3, { noRim: true, spec: 0.3 });
    }
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });
  M.registerHD('worn', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec), env = g.env;
    const v = spec.variant % 3, dirt = (spec.variant & 4) !== 0, seed = hash(0x0e0, v + (dirt ? 8 : 0)), cx = TW >> 1, cy = TH >> 1, color = dirt ? 'dirt' : (PAL.gravel || '#C9B47C');
    const dens = dirt ? 0.32 : 0.42;
    for (let y = cy - 14; y <= cy + 14; y += 3) for (let x = cx - 30; x <= cx + 30; x += 4) {
      const d = Math.abs(x - cx) / 32 + Math.abs(y - cy) / 16; if (d > 0.95) continue;
      const n = (hash(seed, x + y * 131) & 1023) / 1024; if (n > dens * (1 - d * d) * (env.lod > 0 ? 1.4 : 2.2)) continue;
      const jx = ((hash(seed, 7 + x * 3 + y) & 7) - 3.5) * 0.4, jy = ((hash(seed, 9 + x + y * 5) & 3) - 1.5) * 0.4;
      Br.orb(ctx, x + jx, y + jy, 1 + (n * 4 % 1) * 0.6, 0.7, color, n > dens * 0.5 ? 0.25 : -0.3, { noRim: true, spec: dirt ? 0 : 0.3 });
    }
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });
  // L3 Dredge & fill: mound variants 1–3 are the SPOIL HEAP of a run in progress (stage 0–2; HD only: this registration replaces the pen painter of the family), 60×36 anchored (−30, −26): a wet mud heap
  // that grows with the stage, a darker apron where the slurry runs out, and the steel dredge pipe lying in from the north-west with
  // its flanges and the outflow at the crown. Variant 0 stays the grassy Mound.
  function spoilHD(ctx, spec, stage) {
    const Br = B(); const g = Br.begin(ctx, 60, 36, spec), env = g.env, lod = env.lod;
    const s = clamp(stage | 0, 0, 2), seed = hash(0x5b0, s), cx = 30, base = 27;
    const rx = 10 + s * 5.5, hgt = 4.5 + s * 4.2, ry = 4.2 + s * 1.7;
    Br.softEllipse(ctx, cx, base + 1.2, rx + 7, ry + 3.4, AO, 0.38, 0.3);                       // the ground shadow
    Br.softEllipse(ctx, cx, base + 0.4, rx + 5, ry + 2.2, 'marshMud', 0.85, 0.5);               // the wet apron where the slurry spreads
    Br.orb(ctx, cx, base - hgt * 0.42, rx, ry + hgt * 0.55, 'marshMud', -0.12, { spec: 0.14 }); // the heap: dark wet mud
    Br.orb(ctx, cx - 1.2, base - hgt * 0.8, rx * 0.66, (ry + hgt * 0.55) * 0.6, 'dirt', 0.08, { noRim: true, spec: 0.2 });   // the drying crown
    for (let k = 0; k < 6 + s * 2; k++) {                                                        // spoil clods and drying cracks
      const a = (hash(seed, 11 + k) % 1000) / 1000, b = (hash(seed, 31 + k) % 1000) / 1000;
      const x = cx + (a - 0.5) * rx * 1.5, y = base - hgt * (0.2 + b * 0.7);
      if (lod > 0 && (k & 1)) continue;
      Br.orb(ctx, x, y, 1.1 + a * 1.3, 0.8 + b * 0.5, k % 3 === 0 ? 'sand' : 'dirt', (k & 1) ? 0.25 : -0.3, { noRim: true, spec: 0 });
    }
    // the dredge pipe: in from the north-west tile edge to the crown, along the iso axis (2 px across per 1 px down)
    const x1 = cx - 3, y1 = base - hgt * 0.95 - 1, x0 = 12, y0 = y1 - (x1 - x0) / 2;
    const px = (t) => x0 + (x1 - x0) * t, py = (t) => y0 + (y1 - y0) * t;
    Br.softEllipse(ctx, (x0 + x1) / 2 + 1, (y0 + y1) / 2 + 4.2, (x1 - x0) / 2 + 2, 2.2, AO, 0.3, 0.3);    // its shadow on the ground
    Br.stroke(ctx, [[x0, y0], [x1, y1]], 4.2, '#22232B', -0.2, 1, { cap: 'round' });              // the dark under-edge
    Br.stroke(ctx, [[x0, y0 - 0.4], [x1, y1 - 0.4]], 3.2, '#8E9299', 0.05, 1, { cap: 'round' });  // the steel body
    Br.stroke(ctx, [[x0 + 1, y0 - 1.2], [x1 - 1, y1 - 1.2]], 1, '#D8DCE2', 0.4, 0.8, { cap: 'round' });   // the lit thread
    for (let k = 1; k <= 2; k++) { const t = k / 3; Br.stroke(ctx, [[px(t), py(t) - 2.2], [px(t) + 0.2, py(t) + 2.1]], 1.3, k === 2 ? '#B8651E' : '#4A4D57', -0.1, 1, { cap: 'butt' }); }   // flanges: steel joint, rust joint
    Br.orb(ctx, x1, y1 + 0.5, 3.2, 2, '#2A2A33', -0.2, { noRim: true, spec: 0 });                  // the mouth
    Br.softEllipse(ctx, x1 + 4.5, y1 + 4.6, 5.5 + s, 2.3, 'marshMud', 0.9, 0.5);                  // the slurry running off the crown
    Br.stroke(ctx, [[x1 + 2, y1 + 4.2], [x1 + 6 + s, y1 + 5.4]], 0.9, '#D8CFA8', 0.2, lod > 0 ? 0.18 : 0.3, { cap: 'round' });   // a wet glint on it
    return { w: g.w, h: g.h, ox: -30, oy: -26 };
  }
  M.registerHD('mound', function (ctx, spec) {
    if ((spec.variant | 0) >= 1) return spoilHD(ctx, spec, (spec.variant | 0) - 1);   // L3: variants 1–3 = the spoil heap of a Dredge & fill run
    const Br = B(); const g = Br.begin(ctx, 24, 14, spec), env = g.env;
    Br.softEllipse(ctx, 12, 13, 11.5, 1.6, AO, 0.45, 0.3);
    Br.orb(ctx, 12, 8.2, 11.5, 5.6, 'highGrass', 0.05, { spec: 0.22 });
    Br.orb(ctx, 12, 3.6, 5.2, 2.1, PAL.gravel || '#C9B47C', 0.05, { noRim: true, spec: 0.35 });   // the worn gravel top
    void env; void spec;
    return { w: g.w, h: g.h, ox: -12, oy: -20 };
  });

  // ---------------------------------------------------------------------------
  // run strips (levee berm, floodwall panels, canal cut): per direction of the 4-mask a quad from the tile centre to the edge
  // midpoint, rows [j0, j1) of a band `t` rows tall whose top row sits `yoff` px above the centre; an isolated tile gets N + S stubs
  // ---------------------------------------------------------------------------
  function runDirs(mask, stub) {
    const dirs = DIRS.filter((d) => mask & d.bit);
    if (dirs.length) return dirs.map((d) => ({ d: d, len: 16 }));
    return [{ d: DIRS[0], len: stub }, { d: DIRS[2], len: stub }];
  }
  const bandQuad = (cx, cy, d, len, j0, j1, top) => [[cx, cy + top + j0], [cx + d.dx * len, cy + d.dy * (len >> 1) + top + j0], [cx + d.dx * len, cy + d.dy * (len >> 1) + top + j1], [cx, cy + top + j1]];
  // levee — variant = mask | 16 cracked crown; a grassy berm rising 12 px over the diamond with a gravel crown path
  // canvas 64×48, ox −32, oy −28 (12 rows above the diamond, 4 below for the toe)
  M.registerHD('levee', function (ctx, spec) {
    const Br = B(); const RISE = 12, TOE = 4; const g = Br.begin(ctx, TW, TH + RISE + TOE, spec), env = g.env, lod = env.lod;
    const v = spec.variant, mask = v & 15, cracked = !!(v & 16), cx = TW >> 1, cy = (TH >> 1) + RISE, seed = hash(0x1e, v);
    const t = 22, crownT = 10, top = -(RISE - (t >> 1)) + 2 - (t >> 1);   // = −10: the crown's back edge sits 10 px above the centre
    const runs = runDirs(mask, 8);
    const crown = (pts) => { Br.plane(ctx, pts, 'grass', 0.12, { vert: true, amp: 0.1, rim: 0 }); Br.microGrain(ctx, pts, 0.2, env); };
    const slope = (pts) => { Br.plane(ctx, pts, 'grass', -0.2, { vert: true, amp: 0.22, rim: 0.12 }); Br.microGrain(ctx, pts, 0.25, env); if (pts.length === 4) Br.edgeFade(ctx, pts, pts[2], pts[3], TOE + 2, AO, 0, 0.35); };
    // the centre: the upper / lower halves of the strip rhombus, then every direction's bands over them
    crown([[cx, cy + top], [cx + 20, cy + top + crownT], [cx, cy + top + crownT + 1], [cx - 20, cy + top + crownT]]);
    slope([[cx - 20, cy + top + crownT], [cx + 20, cy + top + crownT], [cx, cy + top + t]]);
    for (const r of runs) { slope(bandQuad(cx, cy, r.d, r.len, crownT, t, top)); }
    for (const r of runs) { crown(bandQuad(cx, cy, r.d, r.len, 0, crownT + 0.6, top)); }
    // the lit back edge of the crown and the crown's front lip
    for (const r of runs) { const q = bandQuad(cx, cy, r.d, r.len, 0, crownT, top); Br.stroke(ctx, [q[0], q[1]], 1.1, 'grass', 0.75, 0.6, { cap: 'butt' }); Br.stroke(ctx, [q[3], q[2]], 1, 'grass', -0.7, 0.55, { cap: 'butt' }); }
    // the gravel crown path along the middle of the crown (rows 3–5 of the pen strip → y = top + 4.5)
    ctx.save(); ctx.beginPath(); for (const r of runs) { ctx.moveTo(cx, cy + top + 4.5); ctx.lineTo(cx + r.d.dx * r.len, cy + r.d.dy * (r.len >> 1) + top + 4.5); }
    Br.strokePath(ctx, 4.5, env, { material: 'gravel', unit: 1, seed: seed }); ctx.restore();
    if (cracked) for (let i = 0; i < (lod > 0 ? 3 : 5); i++) {   // a weak crest: dark cracks across the crown
      const r = runs[i % runs.length], k = 2 + (hash(seed, 50 + i) % Math.max(1, r.len - 3)), x = cx + r.d.dx * k, y = cy + r.d.dy * (k >> 1) + top + 2 + (hash(seed, 60 + i) % 6);
      Br.stroke(ctx, [[x - 2, y - 1], [x, y + 1.5], [x + 2.5, y + 0.5], [x + 3.5, y + 3]], 0.9, 'bark', -0.6, 0.8, { cap: 'round' });
    }
    return { w: g.w, h: g.h, ox: -(TW >> 1), oy: -(TH >> 1) - RISE };
  });
  // floodwall — variant = mask; gray T-wall panels 18 px high with joints every 8 px, purple 1-ft gauge stripes + gold ticks
  // canvas 64×56, ox −32, oy −36
  M.registerHD('floodwall', function (ctx, spec) {
    const Br = B(); const RISE = 20; const g = Br.begin(ctx, TW, TH + RISE + 2, spec), env = g.env;
    const mask = spec.variant & 15, cx = TW >> 1, cy = (TH >> 1) + RISE, seed = hash(0xf1, spec.variant);
    const cap = 4, face = 18, t = cap + face + 2, top = -(RISE - (t >> 1)) + 1 - (t >> 1);   // = −19
    const steel = X.steel || '#8A8A8E', conc = X.concrete || '#B8B8BC', runs = runDirs(mask, 8);
    for (const r of runs) {
      const q = r.d;
      Br.fillQuadShaded(ctx, bandQuad(cx, cy, q, r.len, t - 2, t, top), conc, { face: 'top', material: 'stone', t: -0.25 }, env);                    // footing
      Br.fillQuadShaded(ctx, bandQuad(cx, cy, q, r.len, cap, t - 2, top), steel, { face: q.dy > 0 ? 'sw' : 'se', material: 'metal', t: 0.05 }, env);   // the panel face
      Br.fillQuadShaded(ctx, bandQuad(cx, cy, q, r.len, 0, cap, top), steel, { face: 'top', material: 'metal', t: 0.25, noAO: true }, env);            // the cap (top of the T)
      const fq = bandQuad(cx, cy, q, r.len, cap, t - 2, top);
      Br.stroke(ctx, [fq[0], fq[1]], 1, steel, -0.7, 0.6, { cap: 'butt' });   // the cap's underside
      for (let k = 8; k < r.len; k += 8) { const x = cx + q.dx * k, y = cy + q.dy * (k >> 1) + top; Br.stroke(ctx, [[x, y + cap], [x, y + t - 2]], 1, steel, -0.6, 0.6, { cap: 'butt' }); }   // panel joints
      for (let ft = 1; ft * PX_PER_FT < face; ft++) {   // 1-ft gauge stripes up the face, a gold tick beside each joint
        const yy = top + t - 2 - ft * PX_PER_FT, a = [cx, cy + yy], b = [cx + q.dx * r.len, cy + q.dy * (r.len >> 1) + yy];
        Br.stroke(ctx, [a, b], 1, PAL.purple, 0, 0.9, { cap: 'butt' });
        for (let k = 1; k < r.len; k += 8) Br.stroke(ctx, [[cx + q.dx * k, cy + q.dy * (k >> 1) + yy], [cx + q.dx * (k + 1.5), cy + q.dy * ((k + 1.5) >> 1) + yy]], 1.2, PAL.gold, 0.2, 1, { cap: 'butt' });
      }
    }
    void seed;
    return { w: g.w, h: g.h, ox: -(TW >> 1), oy: -(TH >> 1) - RISE };
  });
  // canal — variant = mask | 16 culvert | 32 gate present | 64 gate closed; a 12-px cut with concrete lips and a dark bed; 64×32
  M.registerHD('canal', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec), env = g.env;
    const v = spec.variant, mask = v & 15, culvert = !!(v & 16), gate = !!(v & 32), closed = !!(v & 64), cx = TW >> 1, cy = TH >> 1;
    const t = 12, top = -(t >> 1), conc = X.concrete || '#B8B8BC', runs = runDirs(mask, 8), pop = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
    Br.plane(ctx, [[cx - 6, cy + top], [cx + 6, cy + top], [cx + 6, cy + top + t], [cx - 6, cy + top + t]], 'waterDeep', -0.1, { vert: true, amp: 0.2, rim: 0 });
    for (const r of runs) {
      const q = bandQuad(cx, cy, r.d, r.len, 0, t, top);
      Br.plane(ctx, q, 'waterDeep', -0.1, { vert: true, amp: 0.22, rim: 0.1 });
      Br.edgeFade(ctx, q, q[0], q[1], 4, AO, 0, 0.45);                                                   // the near bank's shadow on the water
      const mq = bandQuad(cx, cy, r.d, r.len, t >> 1, (t >> 1) + 1, top); Br.stroke(ctx, [mq[0], mq[1]], 1, 'waterDeep', 0.65, 0.45, { cap: 'butt' });   // the reflective mid line
      Br.stroke(ctx, [q[0], q[1]], 1.2, conc, 0.1, 1, { cap: 'butt' }); Br.stroke(ctx, [q[3], q[2]], 1.2, conc, -0.3, 1, { cap: 'butt' });            // concrete lips
    }
    if (culvert || pop >= 3) for (const s of [-1, 1]) { const x = cx + s * 14, y = cy + 8; Br.fillQuadShaded(ctx, [[x - 2, y], [x + 2, y], [x + 2, y + 4], [x - 2, y + 4]], X.steelDark || '#6A6A70', { face: 'se', material: 'metal', noAO: true }, env); Br.orb(ctx, x, y + 2, 1.1, 1.1, X.black || '#1B1B1B', -0.5, { noRim: true }); }
    if (gate) {
      const gy = closed ? cy - 5 : cy - 11;   // raised 6 px above the bed when open
      Br.column(ctx, cx - 6.5, cy + 2, 14, 1, PAL.gold, env); Br.column(ctx, cx + 6.5, cy + 2, 14, 1, PAL.gold, env);
      Br.fillQuadShaded(ctx, [[cx - 6, gy], [cx + 6, gy], [cx + 6, gy + 10], [cx - 6, gy + 10]], PAL.purple, { face: 'sw', material: 'metal', noAO: true }, env);
      Br.stroke(ctx, [[cx - 4, gy + 3.5], [cx + 4, gy + 3.5]], 1, PAL.purple, -0.6, 0.8, { cap: 'butt' }); Br.stroke(ctx, [[cx - 4, gy + 6.5], [cx + 4, gy + 6.5]], 1, PAL.purple, -0.6, 0.8, { cap: 'butt' });
      if (closed) Br.stroke(ctx, [[cx - 6, gy + 0.5], [cx + 6, gy + 0.5]], 1.2, PAL.gold, 0.2, 1, { cap: 'butt' });
    }
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });

  // ---------------------------------------------------------------------------
  // water — variant 0: the static sheen the bake draws at .35 alpha under the live pass; variant 1: the surge tint with debris flecks
  // ---------------------------------------------------------------------------
  M.registerHD('water', function (ctx, spec) {
    const Br = B(); const g = Br.begin(ctx, TW, TH, spec), env = g.env, cx = TW >> 1, cy = TH >> 1, seed = hash(0x0a7, spec.variant), dia = Br.diamond(cx, cy);
    ctx.save(); Br.poly(ctx, dia); ctx.clip();
    if ((spec.variant & 1) === 0) {
      Br.softEllipse(ctx, cx - 6, cy - 5, 22, 2.2, Br.toneArr('waterShallow', 0.4), 0.55, 0.2);
      Br.softEllipse(ctx, cx + 8, cy + 5, 18, 1.8, Br.toneArr('waterShallow', 0.2), 0.45, 0.2);
      for (let i = 0; i < 3; i++) { const x = cx - 20 + (hash(seed, 10 + i) % 40), y = cy - 8 + (hash(seed, 20 + i) % 16); Br.softEllipse(ctx, x, y, 3, 0.8, SPEC, 0.6, 0.3); }
    } else {
      const fill = Br.tone('waterDeep', -0.35);
      ctx.fillStyle = fill; ctx.fill(); Br.seamStroke(ctx, dia, fill, env);
      for (let i = 0; i < 4; i++) { const x = cx - 20 + (hash(seed, 30 + i) % 40), y = cy - 8 + (hash(seed, 40 + i) % 16); Br.stroke(ctx, [[x - 1.5, y], [x + 1.5, y]], 1.6, X.debris || '#5A4A3A', 0, 1, { cap: 'round' }); Br.stroke(ctx, [[x - 0.5, y - 1], [x + 0.5, y - 1]], 1, X.debris || '#5A4A3A', 0.5, 1, { cap: 'round' }); }
      const pts = []; for (let x = cx - 28; x <= cx + 28; x += 4) pts.push([x, cy + 1.5 * Math.sin((x * Math.PI * 2) / 20)]);
      Br.stroke(ctx, pts, 1, 'waterDeep', 0.5, 0.6, { smooth: true });
    }
    ctx.restore();
    return { w: TW, h: TH, ox: -(TW >> 1), oy: -(TH >> 1) };
  });

  // ---------------------------------------------------------------------------
  // Self-test additions (run by sprites.js's own selfTest via M._tests): every family bakes at both masters with the pen geometry
  // ---------------------------------------------------------------------------
  M._tests.push(function () {
    const notes = []; const fail = (m) => notes.push(m);
    if (!BSU.brush) return { ok: false, notes: 'brush.js not loaded' };
    for (const f of FAMILIES) if (!M.isHD(f === 'tile' ? 'tile:4' : f === 'shore' ? 'shore:sand' : f === 'tone' ? 'tone:warm' : f === 'patch' ? 'patch:dirt' : f)) fail(f + ' is not HD');
    const ids = [['tile:4', 0], ['tile:0', 8 | (5 << 4)], ['tile:2', 63 << 4], ['cliff', 3], ['cliff', 40], ['shore:ripple', 5], ['levee', 16 | 3], ['floodwall', 10], ['canal', 32 | 64 | 5], ['water', 1], ['knees', 9], ['worn', 4], ['mound', 0], ['reeds', 1], ['tuft:high', 2], ['patch:lime', 1], ['tone:cool', 0]];
    const errs = BSU.errors ? BSU.errors.size : 0;
    for (const [id, v] of ids) for (const z of [1, 2]) {
      const e = M.get(id, v, id === 'cliff' ? 1 : 0, z);
      if (!e) { fail(id + '@' + z + ' did not bake'); continue; }
      if (e.zoom !== z || !e.hd) fail(id + '@' + z + ' is not an HD entry at master ' + z);
      if (id.startsWith('tile') && !(e.sw === 64 * z && e.sh === 32 * z && e.ox === -32 * z && e.oy === -16 * z)) fail(id + '@' + z + ' geometry ' + JSON.stringify([e.sw, e.sh, e.ox, e.oy]));
      if (id === 'cliff' && !(e.sw === 32 * z && e.sh === (16 + v) * z && e.ox === 0 && e.oy === 0)) fail('cliff east ' + v + '@' + z + ' geometry ' + JSON.stringify([e.sw, e.sh, e.ox, e.oy]));
      if (id === 'levee' && !(e.sw === 64 * z && e.sh === 48 * z && e.oy === -28 * z)) fail('levee@' + z + ' geometry');
    }
    if (BSU.errors && BSU.errors.size !== errs) fail('BSU.errors grew while baking the HD terrain families');
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'HD terrain: ' + FAMILIES.length + ' families at masters 1 + 2' };
  });
})();
