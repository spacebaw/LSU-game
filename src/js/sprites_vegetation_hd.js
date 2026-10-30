'use strict';
// ============================================================================
// BAYOU STATE — sprites_vegetation_hd.js (H3 vegetation pass): the HD vegetation painters, style C "soft rendered diorama".
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: docs/PLAN_HD_ART.md §4 row "H3 vegetation"; docs/ART_STYLE.md "## Brush API" (orb / capsule / softEllipse / stroke /
// shadow), "## Style C palette" (vegetation knots), §9 (the B2 vegetation language: live oaks with clustered canopies, dappled
// undersides, buttressed trunks and moss; bald cypress spindles with rust autumn; azaleas with blossom clusters; palmettos;
// understory shrubs on the marsh edge) re-expressed through BSU.brush. A canopy is layered soft orbs lit from the upper left (each
// cluster one orb + a rim of soft leaf masses), a source-atop AO ellipse pulls the underside to the shade tones, a source-atop sun patch
// warms the lit side, trunks and limbs are tapered capsules lit across their width, moss and cypress fronds are toned strokes;
// nothing hand-picks a colour or writes a gradient (the brush owns every gradient).
// Registered through BSU.sprites.registerHD(<family>, …) OVER the pen painters of sprites.js (manifest order: this file loads right
// after sprites_terrain.js, the first HD module, i.e. after sprites.js and brush.js), so sprites.get('oak' | 'cypress' | 'palmetto' |
// 'azalea' | 'shrub', variant, 0, zoom) serves them at master 1 (zoom 0.5 / 1, lod 1) and master 2 (zoom 2 / Retina, lod 0).
// Cells, anchors (trunk base: ox −w/2, oy −h + 4; shrub ox −11, oy −10) and frame counts (1) are the pen painters' exactly.
// Variant bits (sprites.treeVariant): stage 0–2 | autumn 4 (cypress) | bloom 8 (azalea) | silhouette (0–3) << 4 | water 64 (a
// cypress on a marsh / water tile) | jitter (0–3) << 7 (H3: render passes hash(tx, ty) >> 2 so a stand of one silhouette is not a
// stamp: blob positions, canopy tones, tier widths, frond and moss placement shift per jitter). jitter 0 is the pen's layout.
// Wind: the oak's LIVE moss strokes stay in render.drawTree (the sprite is one frame); the baked strands are the 0.5× / perf-mode art.
// lod 1 (master 1): the canopy is a single soft silhouette with its lit side and shaded underside (cluster orbs only — no leaf
// clumps, sun flecks, moss strands, frond hairs, individual blossoms); an azalea in bloom keeps soft pink masses so the season still reads.
// brush.tree (called by the quad / rookery / habitat painters of sprites_buildings_hd.js) is replaced here by a drawImage of the cached oak / cypress
// cell, so a quad's oak is the map's oak; the H0 composition remains the fallback.
// Public (BSU.sprites): hdVegetationFamilies(), hdVegetationCells (frozen), TREE_JIT_SHIFT (sprites.js), vegetationHDSelfTest.
// Conventions: brush calls only (no createLinearGradient / createRadialGradient / createPattern, no fillText, no Math.random, no
// rng.fx); every jitter from BSU.rng.hash / brush.rng(seed); deterministic in (id, variant, frame, master).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  const B = BSU.brush;
  if (!M || !B || typeof M.registerHD !== 'function' || typeof B.capsule !== 'function' || typeof B.orb !== 'function' || typeof M.treeVariant !== 'function') return;
  const hash = BSU.rng.hash;
  const AO = '#1E1946';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rngOf = (seed) => B.rng(seed | 0);
  const SAT = 1.12;   // style C saturation (brush.tone applies it to every toned stroke / orb; the raw-RGB softEllipse fills get it here so the layers match)
  /** the [r, g, b] of base at ramp position t with the style's saturation — for softEllipse fills (which take a raw colour) */
  const tc = (base, t) => B.toneArr(B.sat(base, SAT), t);

  // ---------------------------------------------------------------------------
  // Style C vegetation palette (docs/ART_STYLE.md "## Style C palette", vegetation rows) — bases only; the brush ramps them
  // ---------------------------------------------------------------------------
  const C = Object.freeze({
    // live oak: four canopy tones around the oakLeaf base — deep, sun-warmed, cool, fresh — assigned per cluster from its place in the crown
    oakDeep: 'oakLeaf', oakWarm: B.mix('oakLeaf', 'highGrass', 0.4), oakCool: B.mix('oakLeaf', 'cypressLeaf', 0.55), oakFresh: B.mix('oakLeaf', 'grass', 0.28),
    bark: 'bark', moss: 'moss', cypress: 'cypressLeaf', rust: 'cypressRust', cypressNew: B.mix('cypressLeaf', 'highGrass', 0.35), rustDeep: B.mix('cypressRust', 'cypressLeaf', 0.3),
    palm: 'palmLeaf', palmPetiole: B.mix('palmLeaf', 'highGrass', 0.35), azalea: 'azaleaLeaf', bloom: 'azaleaBloom', shrub: B.mix('azaleaLeaf', 'oakLeaf', 0.3),
    mud: 'marshMud', shallows: 'waterShallow', reflect: B.mix('bark', 'waterDeep', 0.55)
  });
  const OAK_TONES = [C.oakDeep, C.oakWarm, C.oakCool, C.oakFresh];
  /** the cells (w, h in art px, per stage) — the pen painters' exactly (asserted in test/unit/vegetation_hd.test.mjs) */
  const CELLS = Object.freeze({
    oak: Object.freeze([[8, 14], [40, 36], [96, 56]]), cypress: Object.freeze([[6, 16], [16, 48], [24, 80]]), palmetto: Object.freeze([[12, 10], [18, 15], [24, 20]]),
    azalea: Object.freeze([[10, 6], [16, 10], [16, 10]]), shrub: Object.freeze([[22, 12], [22, 12], [22, 12]])
  });
  const FAMILIES = ['oak', 'cypress', 'palmetto', 'azalea', 'shrub'];

  // ---------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------
  /** run fn with every brush call landing only on pixels already painted (the underside AO, the sun patch, the dapples) */
  function atop(ctx, fn) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; fn(); ctx.restore(); }
  /** the soft ground contact: a multiply ellipse (the building / character kit) + a tight AO at the trunk */
  function contact(ctx, env, x, y, rx, ry, a, aoRx, aoRy) {
    B.shadow(ctx, { x: x, y: y, rx: rx, ry: ry, a: a }, env);
    if (aoRx > 0) B.softEllipse(ctx, x, y - 0.3, aoRx, aoRy, AO, 0.42, 0.25);
  }
  /** a bark trunk: a tapered capsule lit across its width, surface roots spreading at its foot, a soft AO over the junction with the ground */
  function trunk(ctx, cx, topY, base, ra, rb, flareW, lean, rootT) {
    B.capsule(ctx, cx + lean, topY, cx, base - rb * 0.5, ra, rb, C.bark, 0.1, { amp: 0.34 });
    if (flareW > 0) for (const s of [-1, 1]) B.capsule(ctx, cx + s * rb * 0.45, base - rb * 1.05, cx + s * (rb + flareW), base + 0.15, rb * 0.5, 0.5, C.bark, s < 0 ? 0.2 : -0.12 + (rootT || 0), { amp: 0.3, flat: true });
    B.softEllipse(ctx, cx, base + 0.3, rb + flareW * 0.85, Math.max(1, rb * 0.42), AO, 0.4, 0.3);
  }
  /** a hanging moss strand: a curved thread that thins and fades toward its tip (three segments), a lit thread along its left (the live
   *  strokes of render.drawTree are moss +.5, so the baked strands sit in the same tone) */
  function mossStrand(ctx, x, y, len, sway, w, shade) {
    const wob = (sway >= 0 ? -0.45 : 0.45) * Math.min(1, len / 8), p = [[x, y], [x + sway * 0.3 + wob, y + len * 0.36], [x + sway * 0.75 - wob * 0.7, y + len * 0.7], [x + sway, y + len]], sd = shade || 0;   // shade: < 0 darkens (the shrub's low drapes)
    for (let i = 0; i < 3; i++) {
      const f = 1 - i * 0.3;
      B.stroke(ctx, [p[i], p[i + 1]], w * (1.2 - i * 0.3), C.moss, -0.2 + sd, 0.66 * f, { cap: 'round' });
      B.stroke(ctx, [[p[i][0] - w * 0.3, p[i][1]], [p[i + 1][0] - w * 0.3, p[i + 1][1]]], w * 0.5, C.moss, 0.5 + sd, 0.7 * f, { cap: 'round' });
    }
  }
  /** one leaf cluster: the big orb (lit upper-left, its own shaded underside) and, at lod 0, soft-edged leaf masses round the rim (they melt into
   *  the orb: a feathered, scalloped silhouette, never a ring of bubbles), lit mounds on the upper left, dark pockets on the lower right, leaf dabs */
  function cluster(ctx, env, cx, cy, rx, ry, base, t, r, o) {
    o = o || {};
    B.orb(ctx, cx, cy, rx * 1.03, ry * 1.08, base, t, { spec: env.lod === 0 && o.spec ? o.spec : 0, noRim: env.lod === 0 });
    if (env.lod > 0) return;
    const rc = clamp(Math.min(rx, ry) * (o.clump || 0.34), 1.5, 4.8), nRim = Math.max(6, Math.round((rx + ry) * (o.density || 0.5) * 0.62));
    for (let k = 0; k < nRim; k++) {   // soft leaf masses on the rim, lit on the upper left, shaded on the lower right
      const a = Math.PI * 2 * (k + r() * 0.8) / nRim, cs = Math.cos(a), sn = Math.sin(a), dist = 0.72 + r() * 0.2, lit = -(cs * 0.55 + sn * 0.85);
      const s = rc * (0.75 + r() * 0.55), pad = s * 0.95 + 0.3;
      let x = cx + cs * rx * dist, y = cy + sn * ry * dist;
      if (o.w) { x = clamp(x, pad, o.w - pad); y = clamp(y, s * 0.8 + 0.3, o.h - 0.3); }   // a mass never runs off the cell
      B.softEllipse(ctx, x, y, s * 1.15, s * 0.95, tc(base, t + lit * 0.3 - 0.04 + (r() - 0.5) * 0.1), 0.97, 0.62);
    }
    const nm = Math.max(2, Math.round(rx / 6));
    for (let k = 0; k < nm; k++) {   // lit mounds in the upper left of the cluster
      const a = Math.PI * (1.0 + 0.8 * r()), d = 0.25 + r() * 0.45;
      B.softEllipse(ctx, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, rc * (1.1 + r() * 0.7), rc * (0.85 + r() * 0.5), tc(base, t + 0.42 + (r() - 0.5) * 0.1), 0.62, 0.3);
    }
    const nd = Math.max(2, Math.round(rx * ry * 0.06));
    for (let k = 0; k < nd; k++) {   // leaf dabs: soft light / dark flecks across the cluster
      const a = Math.PI * 2 * r(), d = Math.sqrt(r()) * 0.85, dark = (k & 1) === 0;
      B.softEllipse(ctx, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 0.8 + r() * 1.2, 0.6 + r() * 0.8, tc(base, t + (dark ? -0.32 : 0.34)), 0.5, 0.3);
    }
    atop(ctx, () => B.softEllipse(ctx, cx + rx * 0.08, cy + ry * 0.62, rx * 0.98, ry * 0.52, AO, o.under == null ? 0.34 : o.under, 0.22));   // the cluster's own underside
  }

  // ---------------------------------------------------------------------------
  // Live oak — oak:<variant> (stage 0–2: 8×14, 40×36, 96×56). The pen's cluster layouts (so the four silhouettes keep their shapes), each cluster
  // one orb + soft rim masses in one of four canopy tones; buttressed trunk and limbs as capsules behind the canopy; a dappled underside; moss strands.
  // ---------------------------------------------------------------------------
  function oakLayout(stage, sil, seed) {
    const j = (k, m) => (hash(seed, 40 + k) % (2 * m + 1)) - m;
    if (stage === 0) return { blobs: [[4 + (sil & 1), 4 + (sil >> 1), 3.5, 3.4]], limbs: [], cx: 4, base: 11, trunk: null, moss: 0 };
    if (stage === 1) {
      const lx = 8 + j(0, 2), rx = 32 + j(1, 2), ly = 18 + j(2, 1), ry = 18 + j(3, 1);
      const blobs = [[20 + j(4, 1), 12, 15, 8], [lx, ly, 9, 6], [rx, ry, 9, 6], [20 + j(5, 2), 6, 9, 5]];
      if (sil === 3) { blobs[1][2] = 7; blobs[2][2] = 7; blobs[0][3] = 9.5; }
      return { blobs: blobs, limbs: [[19, 24, lx, ly + 3, 1.3], [21, 24, rx, ry + 3, 1.3]], cx: 20, base: 32.4, trunk: { top: 22, ra: 1.7, rb: 2.2, flare: 3.4, fh: 6 }, moss: 4 + (sil & 1), mossLen: [3, 9], mossMinY: 14, canopyH: 30 };
    }
    const lx = (sil === 1 ? 16 : sil === 2 ? 24 : 19) + j(0, 2), rx = (sil === 2 ? 80 : sil === 1 ? 72 : 77) + j(1, 2);
    const ly = (sil === 1 ? 29 : 26) + j(2, 1), ry = (sil === 2 ? 29 : 26) + j(3, 1);
    const blobs = [[48 + j(4, 2), 19 + j(5, 1), 27, 12], [lx, ly, sil === 1 ? 17 : 14, sil === 1 ? 9.5 : 8.5], [rx, ry, sil === 2 ? 17 : 14, sil === 2 ? 9.5 : 8.5],
      [34 + j(6, 2), 11, 15, 7.5], [62 + j(7, 2), 10, 15, 7.5], [48 + j(8, 3), 6, 11, 5.5]];
    if (sil === 3) { blobs[0] = [40, 17, 19, 11]; blobs.push([64, 16, 17, 10]); blobs[5] = [42, 6, 10, 5.5]; blobs[4] = [66, 9, 12, 6.5]; }
    else blobs.push([48 + j(9, 4), 27, 11, 4.5]);
    const limbs = [[46.5, 37, lx + 2, ly + 4, 1.8], [49.5, 37, rx - 2, ry + 4, 1.8], [47.5, 36, 36 + j(10, 3), 22, 1.5], [48.5, 36, 60 + j(11, 3), 21, 1.5]];
    if (sil === 1) limbs.push([46.5, 38, 10, 33, 1.4]); else if (sil === 2) limbs.push([49.5, 38, 86, 32, 1.4]);
    return { blobs: blobs, limbs: limbs, cx: 48, base: 52, trunk: { top: 34, ra: 2.5, rb: 3.2, flare: 6.2, fh: 9 }, moss: 9 + (sil & 1) * 2, mossLen: [4, 14], mossMinY: 20, canopyH: 44 };
  }
  function drawOak(ctx, env, stage, sil, jit, w, h) {
    const lod = env.lod, seed0 = hash(0x0ac, stage * 4 + sil), seed = jit ? hash(seed0, 900 + jit) : seed0, r = rngOf(seed + 7), L = oakLayout(stage, sil, seed), cx = L.cx;
    for (const b of L.blobs) { b[2] = Math.max(1.5, Math.min(b[2], (b[0] - 0.6) / 1.03, (w - b[0] - 0.6) / 1.03)); b[3] = Math.max(1.5, Math.min(b[3], (b[1] - 0.6) / 1.08)); }   // a cluster never runs off the cell (the pen's pixels were cut flat there)
    // ground: the soft contact under the crown + the tight AO round the trunk foot
    if (stage === 0) contact(ctx, env, cx, h - 3, 3.4, 1.1, 0.3, 2.4, 0.9);
    else if (stage === 1) contact(ctx, env, cx, h - 3, 13, 3.2, 0.3, 5, 1.6);
    else contact(ctx, env, cx, h - 3, 31, 4.2, 0.3, 8, 2.2);
    // trunk + buttress + limbs (behind the canopy: the clusters hide what they cover, the gaps between them show the limbs)
    const tl = (jit - 1.5) * 0.35;
    if (stage === 0) {
      trunk(ctx, cx, 6.5, L.base, 0.8, 1.05, 0.5, 0, 0);
    } else {
      const T = L.trunk, base = L.base;
      for (const l of L.limbs) B.capsule(ctx, cx + (l[0] - cx) * 0.4, T.top + 1.2, l[2], l[3], l[4], l[4] * 0.55, C.bark, 0.12, { amp: 0.3, flat: true });
      trunk(ctx, cx, T.top, base, T.ra, T.rb, T.flare - T.rb, tl, 0);
      if (lod === 0) {   // furrows on the lit and the shaded side of the trunk
        const n = stage === 2 ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const fx = cx - T.ra * 0.75 + k * T.ra * 0.95, y0 = T.top + 2 + r() * 3, y1 = base - 2 - r() * 3;
          B.stroke(ctx, [[fx, y0], [fx + (r() - 0.5) * 0.6, (y0 + y1) / 2], [fx + (r() - 0.5) * 0.5, y1]], 0.45, C.bark, k === 0 ? 0.6 : -0.6, 0.55, { smooth: true });
        }
      }
    }
    // canopy: clusters back to front (highest first), each in one of the four oak tones by its place in the crown
    const order = L.blobs.map((b, i) => i).sort((a, b) => L.blobs[a][1] - L.blobs[b][1] || L.blobs[a][0] - L.blobs[b][0]);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const b of L.blobs) { x0 = Math.min(x0, b[0] - b[2]); x1 = Math.max(x1, b[0] + b[2]); y0 = Math.min(y0, b[1] - b[3]); y1 = Math.max(y1, b[1] + b[3]); }
    const ccx = (x0 + x1) / 2, ccy = (y0 + y1) / 2, crx = Math.max(1, (x1 - x0) / 2), cry = Math.max(1, (y1 - y0) / 2);
    for (let q = 0; q < order.length; q++) {
      const k = order[q], b = L.blobs[k], fx = (b[0] - ccx) / crx, fy = (b[1] - ccy) / cry;
      const pick = fx < -0.35 ? ((hash(seed, 60 + k) & 1) ? 1 : 3) : fx > 0.35 ? ((hash(seed, 60 + k) & 1) ? 2 : 0) : ((hash(seed, 60 + k) & 1) ? 0 : 3);
      const t = 0.2 - fy * 0.2 - fx * 0.14 + ((hash(seed, 80 + k) % 13) - 6) * 0.012;
      cluster(ctx, env, b[0], b[1], b[2], b[3], OAK_TONES[pick], t, r, { spec: fy < 0 ? 0.13 : 0, clump: stage === 2 ? 0.34 : 0.3, density: stage === 2 ? 0.46 : 0.5, w: w, h: h });
    }
    // the lit side and the shaded underside (source-atop: only on painted leaves)
    atop(ctx, () => {
      B.softEllipse(ctx, ccx - crx * 0.34, y0 + cry * 0.52, crx * 0.66, cry * 0.55, tc('oakLeaf', 0.9), 0.4, 0.1);
      B.softEllipse(ctx, ccx + crx * 0.05, y1 - cry * 0.1, crx * 0.95, cry * 0.5, AO, 0.62, 0.3);
      B.softEllipse(ctx, ccx + crx * 0.5, ccy + cry * 0.1, crx * 0.5, cry * 0.7, AO, 0.18, 0.1);   // the shadow flank
      if (lod === 0 && stage > 0) {   // dapples: sun holes and shade pockets on the underside
        const nd = stage === 2 ? 14 : 5;
        for (let k = 0; k < nd; k++) {
          const px = x0 + 4 + r() * (x1 - x0 - 8), py = y0 + cry * (1.2 + r() * 0.8);
          if (k & 1) B.softEllipse(ctx, px, py, 1.0 + r() * 1.3, 0.65 + r() * 0.7, tc('oakLeaf', 0.9), 0.5, 0.3);
          else B.softEllipse(ctx, px, py, 1.3 + r() * 1.6, 0.8 + r() * 0.8, tc('oakLeaf', -0.85), 0.5, 0.3);
        }
      }
    });
    if (lod === 0 && stage > 0) {   // sun flecks along the lit clusters
      const nf = stage === 2 ? 20 : 7;
      for (let k = 0; k < nf; k++) {
        const b = L.blobs[(k * 7 + (hash(seed, 120) & 7)) % L.blobs.length], a = Math.PI * (1.1 + r() * 0.75);
        B.softEllipse(ctx, b[0] + Math.cos(a) * b[2] * (0.3 + r() * 0.5), b[1] + Math.sin(a) * b[3] * (0.2 + r() * 0.6), 0.9 + r() * 1.0, 0.65 + r() * 0.5, tc('oakLeaf', 1), 0.5, 0.3);
      }
    }
    // Spanish moss: strands hung from the lower rims of the lower clusters (lod 0 only: 0.5× reads the silhouette, render draws the live strokes ≥ 1×)
    const lows = lod === 0 && L.moss > 0 ? L.blobs.filter((b) => b[1] > (stage === 2 ? 15 : 11) && b[1] + b[3] > L.mossMinY - 1) : [];
    if (lows.length) {
      for (let i = 0; i < L.moss; i++) {
        const b = lows[hash(seed, 700 + i) % lows.length], a = Math.PI * (0.18 + 0.64 * (((hash(seed, 710 + i) % 100) + 0.5) / 100));
        const sx = b[0] + Math.cos(a) * b[2] * 0.86, sy = b[1] + Math.sin(a) * b[3] * 0.84;
        if (Math.abs(sx - cx) < (stage === 2 ? 5 : 3) && sy < L.base - 14) continue;
        const cls = hash(seed, 750 + i) % 3, len = L.mossLen[0] + (L.mossLen[1] - L.mossLen[0]) * (cls * 0.38 + (hash(seed, 800 + i) % 100) / 380), sway = ((hash(seed, 900 + i) % 7) - 3) * 0.6;
        mossStrand(ctx, sx, sy, len, sway, stage === 2 ? 1.15 : 0.95);
        if (cls === 2) mossStrand(ctx, sx - 1.3, sy + 0.3, len * 0.7, -sway * 0.7, stage === 2 ? 0.9 : 0.75);
      }
    }
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // Bald cypress — cypress:<variant> (stage 0–2: 6×16, 16×48, 24×80). A spindle of feathery sprays (the pen's tier geometry: widest at 65 % of
  // the crown, a width per tier from the seed, silhouette 3 at stage 2 the flat-topped old tree), each spray a few soft lobes (lit on the left, shaded on
  // the right) with drooping branchlet strokes at lod 0, a dark core and the trunk showing between the sprays, a flared base with knees; autumn swaps the leaf for the rust ramp; a cypress in water stands in a
  // waterline ring with a soft trunk reflection instead of a ground shadow.
  // ---------------------------------------------------------------------------
  function drawCypress(ctx, env, stage, sil, jit, autumn, water, w, h) {
    const lod = env.lod, seed0 = hash(0xc7, stage * 4 + sil), seed = jit ? hash(seed0, 950 + jit) : seed0, r = rngOf(seed + 3);
    const SZ = [[6, 16, 2, 4, 0, 2], [16, 48, 4, 11, 2, 4], [24, 80, 6, 24, 4, 8]][stage], tw = SZ[2], th = SZ[3], flare = SZ[4];
    const cx = w >> 1, base = h - 4, folTop = 1, folBot = base - th + (stage === 2 ? 6 : stage === 1 ? 3 : 1), crown = folBot - folTop;
    // ground / water
    if (water) {
      const half = (tw >> 1) + flare + 1.2;
      B.softEllipse(ctx, cx, base + 1, half + 1.5, 1.7, C.reflect, 0.4, 0.2);
      B.capsule(ctx, cx, base + 0.4, cx + 0.2, base + 3.3, tw * 0.5, tw * 0.3, C.reflect, -0.15, { flat: true, a: 0.5 });
      ctx.save(); ctx.lineWidth = 0.8; ctx.strokeStyle = B.tone(C.shallows, 0.55, 0.75); B.ellipse(ctx, cx, base + 0.2, half, 1.3); ctx.stroke(); ctx.restore();
      if (lod === 0) { ctx.save(); ctx.lineWidth = 0.5; ctx.strokeStyle = B.tone(C.shallows, 0.9, 0.5); B.ellipse(ctx, cx, base + 0.5, half + 1.8, 1.9); ctx.stroke(); ctx.restore(); }
    } else contact(ctx, env, cx, h - 3, (w >> 1) - 1, stage === 0 ? 1.4 : 2.1, 0.3, 0, 0);
    const tier = stage === 2 ? 6 : stage === 1 ? 5 : 3, phase = hash(seed, 2) % tier, lean = stage > 0 ? (((hash(seed, 3) % 3) - 1) + (jit ? ((jit & 1) ? 0.5 : -0.5) : 0)) : 0, flat = sil === 3 && stage === 2;
    // trunk: from the foot up through the crown (it shows where the sprays tuck), surface roots, knees
    const topY = stage === 0 ? folTop + 4 : folTop + Math.round(crown * 0.25);
    trunk(ctx, cx, topY, base, stage === 0 ? 0.55 : 0.8, tw * 0.5 + 0.2, flare * 0.8, lean * 0.7, 0);
    if (stage > 0) {   // knees at the base, outside the buttress (alternating sides)
      const n = 2 + (hash(seed, 1) % 3);
      for (let i = 0; i < n; i++) {
        const x = (i & 1) ? cx + (tw >> 1) + flare + 1.6 + (i >> 1) * 2 : cx - (tw >> 1) - flare - 2.4 - (i >> 1) * 2, kh = 2 + (hash(seed, 10 + i) % 3);
        if (x < 0.8 || x > w - 1.4) continue;
        B.softEllipse(ctx, x + 0.2, base + 0.3, 1.6, 0.65, AO, 0.35, 0.3);
        B.capsule(ctx, x, base - kh + 0.4, x + 0.15, base + 0.1, 0.5, 0.95, C.bark, 0.16, { amp: 0.3, flat: true });
      }
    }
    // the crown's dark interior: a narrow core the tiers overlap, so a tuck between two sprays shows shade (and the trunk), not the ground
    const hwMax = (w >> 1) - 1.3;
    B.softEllipse(ctx, cx + lean * 0.5, folTop + crown * 0.55, hwMax * 0.62, crown * 0.46, tc(autumn ? C.rustDeep : C.cypress, -0.75), 0.95, 0.5);
    // crown tiers (the pen's formula), from the lowest tier up so each upper spray overlaps the one below
    const tiers = [];
    for (let y = folTop - phase; y <= folBot; y += tier) tiers.push(y);
    for (let q = tiers.length - 1; q >= 0; q--) {
      const y0 = tiers[q], ti = q, yb = Math.min(folBot + 1, y0 + tier), yt = Math.max(folTop, y0), yc = (yt + yb) / 2 + (r() - 0.5) * (stage === 2 ? 1.0 : 0.5), tt = clamp((yc - folTop) / Math.max(1, crown), 0, 1);
      if (yb - yt < 1.2 && q > 0) continue;
      const env2 = flat ? Math.min(1, 0.45 + tt) : (tt < 0.65 ? Math.pow(tt / 0.65, 0.8) : 1 - (tt - 0.65) * 0.45);
      const tierK = stage === 0 ? 1 : 0.8 + (hash(seed, 60 + ti) % 40) / 100;
      const hw = Math.min(hwMax, 0.9 + ((w >> 1) - 1.2) * env2 * tierK + (stage === 0 ? 0 : 0.4)), tipX = cx + lean * (1 - tt), thick = (yb - yt) * 0.36 + (stage === 2 ? 1.5 : stage === 1 ? 1.2 : 0.8);
      const depth = tt;   // 0 at the tip, 1 at the lowest tier: lower sprays sit deeper in the shade
      const base0 = autumn ? B.mix(C.rust, 'cypressLeaf', 0.12 + depth * 0.22) : B.mix(C.cypress, 'highGrass', 0.16 * (1 - depth)), tMid = 0.14 - depth * 0.16;
      // the spray's soft body: lobes across the tier (a wavy lower edge, not a band), each a feathered mass with a lit left and a shaded right …
      const nl = stage === 2 ? 3 : stage === 1 ? 2 : 1;
      for (let k = 0; k < nl; k++) {
        const f = nl === 1 ? 0 : (k / (nl - 1)) * 2 - 1, lx = tipX + f * hw * 0.58, ly = yc + 0.2 + Math.abs(f) * 0.7 + (r() - 0.5) * 0.9, lw = nl === 1 ? hw : hw * (0.52 + r() * 0.12), tl = tMid + (r() - 0.5) * 0.12 - f * 0.1;
        B.softEllipse(ctx, lx, ly, lw * 1.04, thick, tc(base0, tl), 0.97, 0.45);
        B.softEllipse(ctx, lx - lw * 0.32, ly - thick * 0.25, lw * 0.6, thick * 0.65, tc(base0, tl + 0.42), 0.6, 0.3);
        B.softEllipse(ctx, lx + lw * 0.4, ly + thick * 0.2, lw * 0.5, thick * 0.7, tc(base0, tl - 0.45), 0.45, 0.3);
      }
      if (lod === 0 && stage > 0) {   // … and its drooping branchlets: the ragged, feathery edge (lit on the left, shaded on the right)
        const nb = Math.round(hw * (stage === 2 ? 1.5 : 1.2)) + 3;
        for (let k = 0; k < nb; k++) {
          const f = ((k + r() * 0.7) / nb) * 2 - 1, root = [tipX + f * hw * 0.3, yc - thick * 0.3], dx = f * hw * (0.84 + r() * 0.2), end = [tipX + dx, yc + thick * 0.8 + 0.3 + r() * 1.2 + Math.abs(f) * 0.6];
          const mid = [tipX + dx * 0.7, root[1] + (end[1] - root[1]) * 0.4 - 0.3];
          B.stroke(ctx, [root, mid, end], 0.65 + r() * 0.4, base0, 0.05 - f * 0.34 - depth * 0.1 + (r() - 0.5) * 0.16, 0.9, { smooth: true });
        }
        B.softEllipse(ctx, tipX - hw * 0.45, yc - thick * 0.5, Math.max(1.2, hw * 0.3), 0.9, tc(autumn ? B.mix(C.rust, 'highGrass', 0.2) : C.cypressNew, 0.4), 0.6, 0.3);   // new growth in the light
      }
      atop(ctx, () => B.softEllipse(ctx, tipX + 0.3, yc + thick * 0.7, hw * 0.95, stage === 0 ? 1.0 : 1.4, AO, (stage === 0 ? 0.22 : 0.17) + (hash(seed, 300 + ti) % 10) * 0.012, 0.2));   // the underside + the cast shadow on the tier below
    }
    // the lit side of the whole crown + the tip
    atop(ctx, () => B.softEllipse(ctx, cx - w * 0.2, folTop + crown * 0.45, w * 0.2, crown * 0.4, tc(autumn ? 'cypressRust' : 'cypressLeaf', 0.9), 0.22, 0.1));
    B.orb(ctx, cx + lean, folTop + (stage === 0 ? 1.2 : 1.5), stage === 0 ? 0.9 : 1.2, stage === 0 ? 1.4 : 2.1, autumn ? C.rust : C.cypress, 0.3, { noRim: true });
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // Palmetto — palmetto:<variant> (stage 0–2: 12×10, 18×15, 24×20; bit 4 = upright). The pen's frond geometry: a petiole to a hand, then a fan of
  // 5–7 tapered rays (capsules lit across their width); back row in the shade, front row lit on the left, tips highlighted.
  // ---------------------------------------------------------------------------
  function drawPalmetto(ctx, env, stage, sil, jit, w, h) {
    const lod = env.lod, seed0 = hash(0x9a1, stage * 2 + sil), seed = jit ? hash(seed0, 970 + jit) : seed0, cx = w >> 1, cy = h - 4;
    contact(ctx, env, cx, h - 2, (w >> 1) - 1, 1.5, 0.3, 0, 0);
    B.orb(ctx, cx, cy, Math.max(2.2, w >> 2), Math.max(1.5, h / 6.5), C.palm, -0.5, { noRim: true });                        // the dark base clump
    B.capsule(ctx, cx, h - 5.4, cx, h - 2.4, 0.9, 1.1, C.bark, 0.05, { amp: 0.3, flat: true });                          // the trunk stub
    const n = 4 + stage * 2, spread = sil ? 0.75 : 1.0;
    const rays = 5 + (stage > 0 ? 2 : 0), rw = stage === 0 ? 0.55 : 0.8;
    const frond = (len, tBase, a, k) => {
      const L = len * (0.85 + (hash(seed, 50 + k) % 30) / 100), hx = cx + Math.cos(a) * L * 0.55 * 1.2, hy = cy + Math.sin(a) * L * 0.55 * 0.8;
      B.capsule(ctx, cx, cy, hx, hy, 0.65, 0.4, C.palmPetiole, tBase - 0.05, { amp: 0.25, flat: true });
      for (let q = 0; q < rays; q++) {
        const ra = a + (q / (rays - 1) - 0.5) * 1.1, rl = L * 0.5 * (0.7 + 0.3 * Math.sin((q / (rays - 1)) * Math.PI));
        const ex = hx + Math.cos(ra) * rl * 1.2, ey = hy + Math.sin(ra) * rl * 0.8, side = Math.cos(ra) < 0 ? 0.08 : -0.06;
        B.capsule(ctx, hx, hy, ex, ey, rw, rw * 0.22, C.palm, tBase + side, { amp: 0.28, flat: true });
        if (lod === 0 && stage > 0 && (q & 1) === 0) B.stroke(ctx, [[hx + (ex - hx) * 0.3, hy + (ey - hy) * 0.3 - 0.2], [hx + (ex - hx) * 0.92, hy + (ey - hy) * 0.92 - 0.2]], 0.35, C.palm, tBase + 0.55, 0.7);
      }
    };
    for (let i = 0; i < n; i++) frond((h - 4) * 0.8, -0.3, -Math.PI * 0.5 + (i / (n - 1) - 0.5) * Math.PI * 0.9 * spread + ((hash(seed, i) % 7) - 3) * 0.03, i);
    for (let i = 0; i < n; i++) { const a = Math.PI + 0.25 + (Math.PI - 0.5) * (i / (n - 1)) * spread + (1 - spread) * 1.2 + ((hash(seed, 20 + i) % 7) - 3) * 0.03; frond(h - 4, Math.cos(a) < 0 ? 0.28 : 0.0, a, 20 + i); }
    B.orb(ctx, cx, cy - 0.6, Math.max(1.1, w * 0.07), 1.0, C.palm, 0.3, { noRim: true });
    atop(ctx, () => B.softEllipse(ctx, cx, cy + 1.4, (w >> 1) - 0.5, 1.6, AO, 0.26, 0.2));
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // Azalea — azalea:<variant> (stage 0: 10×6 shredded twigs; 1–2: 16×10 a mound of three leaf clusters; bit 8 = in bloom). Blossoms are
  // clusters of five petal orbs (a lit petal on the upper left, a deep centre); lod 1 keeps the bloom as soft pink masses.
  // ---------------------------------------------------------------------------
  function drawAzalea(ctx, env, stage, sil, jit, bloom, w, h) {
    const lod = env.lod, seed0 = hash(0xa2, stage * 4 + sil), seed = jit ? hash(seed0, 990 + jit) : seed0, r = rngOf(seed + 11), cx = w >> 1;
    contact(ctx, env, cx, h - 1.2, (w >> 1) - 0.5, 1.1, 0.3, 0, 0);
    if (stage === 0) {   // shredded: bare twigs, a few leaves, a bloom or two
      for (let i = 0; i < 3; i++) {
        const x = 2 + i * 3 + (sil & 1), top = 1 + (i & 1);
        B.capsule(ctx, x, top, x + 0.1, top + 3.4, 0.35, 0.5, C.bark, 0.22, { amp: 0.28, flat: true });
        B.orb(ctx, x + 1, 3, 0.95, 0.7, C.azalea, 0.2, { noRim: true });
        if (bloom && (hash(seed, i) & 1)) B.orb(ctx, x - 0.9, 2, 0.8, 0.8, C.bloom, 0.15, { noRim: true });
      }
      return { w: w, h: h };
    }
    const j = jit ? ((jit & 1) ? 0.6 : -0.6) : 0;
    const blobs = [[cx - 3 + (sil & 1) + j, 5.5, 5.5, 3.8], [cx + 3 - (sil >> 1) - j, 5.5, 5.5, 3.8], [cx + ((sil & 1) ? 1 : -1), 3.5 + (stage === 2 ? -0.5 : 0), 4.5, 3]];
    const order = [2, 0, 1];
    for (const k of order) { const b = blobs[k]; cluster(ctx, env, b[0], b[1], b[2], b[3], C.azalea, 0.12 - (b[0] - cx) * 0.03 + (k === 2 ? 0.1 : 0), r, { clump: 0.3, density: 0.55, w: w, h: h - 1 }); }
    atop(ctx, () => {
      B.softEllipse(ctx, cx - 2.5, 2.5, 4.5, 2.4, tc('azaleaLeaf', 0.85), 0.26, 0.1);
      B.softEllipse(ctx, cx + 0.5, h - 1.5, w * 0.42, 2.4, AO, 0.45, 0.28);
    });
    if (bloom) {
      const k = 5 + stage * 2;
      for (let i = 0; i < k; i++) {
        const x = 2 + (hash(seed, 100 + i) % (w - 4)) + 0.5, y = 1 + (hash(seed, 130 + i) % (h - 5)) + 0.5;
        let inside = false; for (const b of blobs) { const dx = (x - b[0]) / (b[2] * 0.92), dy = (y - b[1]) / (b[3] * 0.92); if (dx * dx + dy * dy < 1) { inside = true; break; } }
        if (!inside) continue;
        if (lod > 0) { B.orb(ctx, x, y, 1.45, 1.2, C.bloom, 0.12, { noRim: true }); continue; }
        const pr = 0.8 + (hash(seed, 160 + i) % 4) * 0.06;
        B.orb(ctx, x, y, 0.62, 0.55, C.bloom, -0.35, { noRim: true });
        for (let p = 0; p < 5; p++) {
          const a = p / 5 * Math.PI * 2 + (hash(seed, 170 + i) % 6) * 0.2, px = x + Math.cos(a) * 0.95, py = y + Math.sin(a) * 0.78;
          B.orb(ctx, px, py, pr, pr * 0.9, C.bloom, px < x ? 0.28 : 0.04, { noRim: true });
        }
        B.orb(ctx, x - 0.5, y - 0.55, 0.42, 0.34, C.bloom, 0.8, { noRim: true });
      }
    }
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // Understory shrub — shrub:<variant 0–3> (22×12, anchored at its base, ox −11 oy −10): a low mound of three leaf clusters draped with Spanish
  // moss, baked into the marsh edge by render's chunk bake (HD chunks blit the master-2 cell).
  // ---------------------------------------------------------------------------
  function drawShrub(ctx, env, v, w, h) {
    const lod = env.lod, seed = hash(0x5b, v), r = rngOf(seed + 5);
    B.softEllipse(ctx, 11, 10.8, 8.6, 1.6, AO, 0.3, 0.3);
    B.softEllipse(ctx, 11.4, 10.9, 7, 1.2, C.mud, 0.55, 0.3);
    const blobs = [[8 + (v & 1) * 2, 7, 6.5, 4], [14 - (v >> 1), 7, 6, 3.8], [11 + ((v & 1) ? -2 : 2), 4.5, 5, 3.2]];
    for (const k of [2, 0, 1]) { const b = blobs[k]; cluster(ctx, env, b[0], b[1], b[2], b[3], C.shrub, 0.12 + (k === 2 ? 0.12 : 0) - (b[0] - 11) * 0.02, r, { clump: 0.32, density: 0.5, w: w, h: h - 1 }); }
    atop(ctx, () => {
      B.softEllipse(ctx, 8.5, 3.6, 5, 2.4, tc('azaleaLeaf', 0.85), 0.26, 0.1);
      B.softEllipse(ctx, 11.5, 10.6, 9.5, 3, AO, 0.5, 0.3);
    });
    if (lod === 0) {   // moss draped over the top and hung from the lower rim
      for (let i = 0; i < 2 + (v & 1); i++) {
        const x = 3 + (hash(seed, 20 + i) % 16), y = 1.5 + (hash(seed, 30 + i) % 3);
        mossStrand(ctx, x, y, 2.4 + (i & 1) * 0.8, (i & 1) ? 0.8 : -0.8, 0.8, -0.3);
      }
      const n = 3 + (v & 1);
      for (let i = 0; i < n; i++) {
        const b = blobs[i % 2], a = Math.PI * (0.25 + 0.5 * (((hash(seed, 700 + i) % 100) + 0.5) / 100));
        mossStrand(ctx, b[0] + Math.cos(a) * b[2] * 0.85, b[1] + Math.sin(a) * b[3] * 0.85, 1.8 + (hash(seed, 750 + i) % 3) * 0.7, ((hash(seed, 800 + i) % 3) - 1) * 0.5, 0.7, -0.3);
      }
    } else atop(ctx, () => B.softEllipse(ctx, 10.5, 3.4, 6, 1.8, tc('moss', 0.1), 0.3, 0.2));   // lod 1: a moss tinge over the top, no strands
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // Registration (the cell, the anchor and the frame count are the pen's)
  // ---------------------------------------------------------------------------
  const PAINT = {
    oak: function (ctx, spec) {
      const v = spec.variant | 0, stage = clamp(v & 3, 0, 2), sil = (v >> 4) & 3, jit = (v >> 7) & 3, c = CELLS.oak[stage], g = B.begin(ctx, c[0], c[1], spec);
      drawOak(ctx, g.env, stage, sil, jit, c[0], c[1]);
      return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
    },
    cypress: function (ctx, spec) {
      const v = spec.variant | 0, stage = clamp(v & 3, 0, 2), autumn = (v & 4) !== 0, sil = (v >> 4) & 3, water = (v & 64) !== 0, jit = (v >> 7) & 3, c = CELLS.cypress[stage], g = B.begin(ctx, c[0], c[1], spec);
      drawCypress(ctx, g.env, stage, sil, jit, autumn, water, c[0], c[1]);
      return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
    },
    palmetto: function (ctx, spec) {
      const v = spec.variant | 0, stage = clamp(v & 3, 0, 2), sil = (v >> 4) & 1, jit = (v >> 7) & 3, c = CELLS.palmetto[stage], g = B.begin(ctx, c[0], c[1], spec);
      drawPalmetto(ctx, g.env, stage, sil, jit, c[0], c[1]);
      return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
    },
    azalea: function (ctx, spec) {
      const v = spec.variant | 0, stage = clamp(v & 3, 0, 2), bloom = (v & 8) !== 0, sil = (v >> 4) & 3, jit = (v >> 7) & 3, c = CELLS.azalea[stage], g = B.begin(ctx, c[0], c[1], spec);
      drawAzalea(ctx, g.env, stage, sil, jit, bloom, c[0], c[1]);
      return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
    },
    shrub: function (ctx, spec) {
      const c = CELLS.shrub[0], g = B.begin(ctx, c[0], c[1], spec);
      drawShrub(ctx, g.env, (spec.variant | 0) & 3, c[0], c[1]);
      return { w: g.w, h: g.h, ox: -11, oy: -10 };
    }
  };
  function registerAll() { for (const fam of FAMILIES) M.registerHD(fam, PAINT[fam]); }
  registerAll();
  // brush.tree (the H0 proof tree the quad, the rookery and the habitat call from sprites_buildings_hd.js) now draws the SAME cached cell as the map's
  // entities: a quad's oak is the oak sprite (stage 2, silhouette and jitter from the seed), a rookery's cypress the cypress sprite (water bit), scaled
  // to the size brush.tree always had (a 96-px canopy at stage 1, drawn 1:1 so it stays as crisp as the map's oaks). One drawImage of a cached cell instead of ~150 gradient calls per building bake; a
  // host canvas is never touched by source-atop (the cell is composited, not painted into).
  const penTree = B.tree;
  B.tree = function (ctx, x, y, kind, o, env) {
    o = o || {};
    try {
      const oak = kind === 'liveOak' || kind === 'oak', master = env && env.master === 2 ? 2 : 1, st = o.stage == null ? 2 : clamp(o.stage | 0, 0, 2), sd = o.seed | 0;
      const sil = sd & 3, jit = (sd >> 2) & 3;
      const id = oak ? 'oak' : 'cypress', cell = oak ? 2 : (st === 0 ? 1 : 2), sc = oak ? [0.8, 1, 1.25][st] : (st === 0 ? 1.25 : st === 1 ? 1 : 1.25);
      const e = M.get(id, M.treeVariant(cell, false, false, sil, !oak && !!o.inWater, jit), 0, master);
      if (e && e.canvas) {
        const k = sc / (e.zoom || master);
        ctx.drawImage(e.canvas, e.sx, e.sy, e.sw, e.sh, x + e.ox * k, y + e.oy * k, e.sw * k, e.sh * k);   // the entry's anchor is the trunk base (oy = −h + 4)
        return;
      }
    } catch (err) { /* fall through to the H0 composition */ }
    if (typeof penTree === 'function') penTree.apply(this, arguments);
  };
  M.hdVegetationFamilies = () => FAMILIES.slice();
  M.hdVegetationCells = CELLS;

  // --- selfTest (registered through BSU.sprites._tests; also callable as vegetationHDSelfTest) -------------------------------------
  function vegetationHDSelfTest() {
    const notes = [], check = (c, m) => { if (!c) notes.push(m); };
    try {
      check(FAMILIES.every((f) => M.isHD(f)), 'every vegetation family is HD-registered');
      for (const fam of FAMILIES) for (let s = 0; s < 3; s++) {
        const c = CELLS[fam][s], v = fam === 'shrub' ? s : s;
        for (const z of [1, 2]) { const e = M.get(fam, v, 0, z); check(e && e.hd && e.sw === c[0] * z && e.sh === c[1] * z, fam + ' stage ' + s + ' at master ' + z + ' keeps the pen cell'); if (e && fam !== 'shrub') check(e.ox === -(c[0] >> 1) * z && e.oy === (-c[1] + 4) * z, fam + ' trunk-base anchor'); }
      }
      const sh = M.get('shrub', 1, 0, 2); check(sh && sh.ox === -22 && sh.oy === -20, 'shrub anchor (−11, −10) at master 2');
      check(M.frames('oak') === 1 && M.frames('cypress') === 1 && M.frames('palmetto') === 1 && M.frames('azalea') === 1 && M.frames('shrub') === 1, 'vegetation frames stay 1');
    } catch (e) { notes.push('threw: ' + (e && e.message)); }
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'vegetation HD ok: ' + FAMILIES.length + ' families' };
  }
  M.vegetationHDSelfTest = vegetationHDSelfTest;
  if (Array.isArray(M._tests)) M._tests.push(vegetationHDSelfTest);
})();
