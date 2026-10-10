'use strict';
// ============================================================================
// BAYOU STATE — sprites_entities.js (module 12; extends BSU.sprites)
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: ARCHITECTURE.md §1 row 12, §6.1 (entity ids, anchors, the frame
// table), §6.3 pass 4 (2-frame agents at 0.5×, trees atlas-only at 0.5×),
// §11.2 #3–4 (Tier 2 critter sprites, fogger polish, officer wrangle);
// docs/briefs/sprites_entities.md (Tier 1 complete + Tier 2: 2× sheets, selfie /
// binoculars props, wrangle animation); GDD §12.3 (the sprite table), §7 (agent
// sprite: 12×20, 6 skin × 8 hair × shirt 55/25/20, backpack, props, anims), §6.3
// (gator sizes, eyes), §6.7 (birds and critters), §8 (the Bayou Brass), §14.3
// (floats, krewe), §4.9 (trees — the core painters in sprites.js already
// implement the brief's oak/cypress/palmetto/azalea line by line, so they are
// KEPT rather than re-registered; this file asserts their sizes/anchors).
//
// What lives here:
//   * a tiny pixel-buffer toolkit (compose → ramp outline → blit) and the lazily baked sheet machinery (one canvas per
//     (family, anim, look, facing, zoom); a per-frame bake budget hands out the default student's sheet while a look queues);
//   * the football skeleton rig (pass E): joints → two-bone IK → yaw → projection → depth buffer, 8 real facings;
//   * art pass B4 (characters), on the same rig: students (15 anims × 8 facings, 112 pooled looks with 6 skin tones, 16 outfits,
//     6 hair styles, hats, carried items), the Wildlife Officer (and his wrangle scene), the Bayou Brass and the krewe; gators
//     (3 sizes × swim / walk / bask / lunge), Roux on all fours, the nutria, egrets and spoonbills (stand, preen, flap); the
//     fogger truck with its plume start, the bus, pirogues and Cajun Navy boats with paddlers, four parade floats;
//   * the frame API render calls (agentFrame, gatorFrame, officerFrame, vehicleFrame, rouxFrame, birdFrame, paradeFrame,
//     critterFrame): every directional sprite is frame = facing × per + k with facing the football fbDir octant;
//   * the props that stayed 2D: tailgate tent / smoker / cornhole / sno-ball stand / bonfire, pelican, armadillo, the two
//     gates, the nest and the speech bubble.
//
// Rules honoured: no DOM/timers at definition time (registerPainter and setFrames
// are plain-object writes; canvases are created inside get/init only), no
// Math.random / rng.fx (every jitter is BSU.rng.hash-seeded, so a re-bake is
// pixel-identical), integer pixel art only (fillRect through the core's pen; no
// arc/lineTo/fillText/gradients), every public function guarded so nothing throws.
//
// Numbers the GDD/brief state but BSU.params does not carry (local constants in L
// below; see docs/INTEGRATION_NOTES.md): the juvenile 28×9 / legend 17-tall gator
// cells, every non-agent sprite size in the §12.3 table, the anim frame counts,
// the sheet memory budget (8 MB, mirrors sprites.CANVAS_LIMIT_MB), and the brief's
// extra hexes (khaki #C2B280, gator #4A5A3A/#8A9A6A, spoonbill #F4A6C0, …).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU && BSU.sprites;
  if (!M || typeof M.registerPainter !== 'function' || typeof M.pen !== 'function') {
    if (BSU && typeof BSU.error === 'function') { try { BSU.error('sprites_entities', 'load', new Error('BSU.sprites core missing: sprites.js must load before sprites_entities.js')); } catch (e) { /* SELFTEST rethrow */ } }
    return;
  }
  const PAL = M.palette || BSU.params.palette;
  const X = M.extra || {};
  const PR = (BSU.params && BSU.params.render) || {};
  const shade = M.shade, mix = M.mix, hash = M.hash, pen = M.pen, begin = M.begin;
  const black = X.black || '#1B1B1B';

  // ---------------------------------------------------------------------------
  // Local constants (GDD §12.3 / brief numbers that params does not carry)
  // ---------------------------------------------------------------------------
  const L = Object.freeze({
    agentW: (PR.agentPx && PR.agentPx[0]) || 12, agentH: (PR.agentPx && PR.agentPx[1]) || 20,   // params.render.agentPx
    gatorSizes: Object.freeze([Object.freeze([28, 9]), Object.freeze([(PR.gatorPx && PR.gatorPx[0]) || 40, (PR.gatorPx && PR.gatorPx[1]) || 12]), Object.freeze([PR.leGrandPx || 56, 17])]),
    roux: Object.freeze([28, 16]), officer: Object.freeze([12, 20]), wrangle: Object.freeze([20, 16]),
    fogger: Object.freeze([20, 10]), bus: Object.freeze([24, 12]), pirogue: Object.freeze([22, 8]), navy: Object.freeze([22, 8]),
    float: Object.freeze([32, 16]), band: Object.freeze([12, 20]), krewe: Object.freeze([12, 20]),
    tent: Object.freeze([16, 12]), smoker: Object.freeze([10, 8]), cornhole: Object.freeze([12, 6]), snoball: Object.freeze([14, 12]), bonfire: Object.freeze([12, 16]),
    egret: Object.freeze([10, 14]), spoonbill: Object.freeze([10, 14]), pelican: Object.freeze([12, 10]), armadillo: Object.freeze([10, 6]), nutria: Object.freeze([12, 6]),
    gate: Object.freeze([32, 24]), barrierGate: Object.freeze([32, 24]), nest: Object.freeze([6, 4]), bubble: Object.freeze([10, 8]),
    sheetLimitMB: 6,             // per-look agent sheets budget (mirrors sprites.CANVAS_LIMIT_MB)
    lookMask: 511               // skin 3 bits | hair 3 bits | shirt 2 bits
  });
  // Brief-named hexes that are neither in params.palette nor in sprites.extra.
  const C = Object.freeze({
    trousers: PAL.purpleShadow, shoe: black, pack: PAL.bark, outlineK: 0.5, shadow: 'rgba(0,0,0,0.25)', shadowLight: 'rgba(0,0,0,0.12)',
    khaki: '#C2B280', khakiDark: '#8E845A', gatorBack: '#4A5A3A', gatorBelly: '#8A9A6A',
    tiger: X.tigerOrange || '#E07020', white: X.white || '#FFFFFF', offWhite: X.offWhite || '#E8E8E8', red: PAL.danger,
    flame: X.flame || '#FFCB6B', ember: X.ember || '#E07020', spoonbill: '#F4A6C0', green: X.green || '#2E8B57',
    glass: X.glass || '#A0D0FF', dust: PAL.gravel, steel: X.steel || '#8A8A8E', steelDark: X.steelDark || '#6A6A70', concrete: X.concrete || '#B8B8BC',
    pelican: '#8C7B6B', nutria: '#6B4423', armadillo: '#A89F8C', beak: '#E8B84A', vest: '#F07830'
  });
  M.entityConst = L; M.entityColors = C;

  // ---------------------------------------------------------------------------
  // Pixel buffer toolkit: compose a figure at 1× in an array of colour strings,
  // outline it, mirror it, then blit through the pen (which applies the zoom).
  // ---------------------------------------------------------------------------
  function newBuf(w, h) { return { w: w, h: h, d: new Array(w * h).fill(null) }; }
  function bput(b, x, y, c) { x = x | 0; y = y | 0; if (c && x >= 0 && y >= 0 && x < b.w && y < b.h) b.d[y * b.w + x] = c; }
  function brect(b, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bput(b, x + i, y + j, c); }
  function bget(b, x, y) { return (x < 0 || y < 0 || x >= b.w || y >= b.h) ? null : b.d[y * b.w + x]; }
  /** Bresenham into the buffer */
  function bline(b, x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, n = 0;
    for (;;) { bput(b, x0, y0, c); if ((x0 === x1 && y0 === y1) || ++n > 512) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  /** horizontal mirror in place (pixel-exact: the same array reversed per row) */
  function bflipX(b) { for (let y = 0; y < b.h; y++) { const o = y * b.w; for (let x = 0; x < (b.w >> 1); x++) { const t = b.d[o + x]; b.d[o + x] = b.d[o + b.w - 1 - x]; b.d[o + b.w - 1 - x] = t; } } return b; }
  /** 1-px outline: every empty pixel (rows < maxY) 4-adjacent to a filled one takes a darkened copy of that neighbour */
  function boutline(b, maxY, k) {
    const src = b.d.slice(), w = b.w; maxY = Math.min(b.h, maxY | 0);
    for (let y = 0; y < maxY; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (src[i]) continue;
      const n = (y > 0 && src[i - w]) || (y + 1 < maxY && src[i + w]) || (x > 0 && src[i - 1]) || (x + 1 < w && src[i + 1]);
      if (n) b.d[i] = shade(n, k);
    }
  }
  function bblit(b, P, ox, oy) { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = b.d[y * b.w + x]; if (c) P.px(ox + x, oy + y, c); } }
  function bequal(a, b) { if (!a || !b || a.w !== b.w || a.h !== b.h) return false; for (let i = 0; i < a.d.length; i++) if (a.d[i] !== b.d[i]) return false; return true; }
  /** the 2-row shadow ellipse under a foot point: row y is `w` wide, row y+1 is w−2 */
  function shadowRows(P, ox, oy, cx, y, w, c) { c = c || C.shadow; const h1 = w >> 1; P.rect(ox + cx - h1, oy + y, w, 1, c); if (w > 2) P.rect(ox + cx - h1 + 1, oy + y + 1, w - 2, 1, c); }
  M._buf = { newBuf: newBuf, put: bput, rect: brect, get: bget, line: bline, flipX: bflipX, outline: boutline, blit: bblit, equal: bequal };
  // ---------------------------------------------------------------------------
  // Sheets: one canvas per (family, look, anim, zoom) holding every frame in a row.
  // The painter returns the core's {canvas, sx, sy, sw, sh} sub-rect form.
  // ---------------------------------------------------------------------------
  const sheets = new Map();
  let sheetFrame = 0;
  M.SHEET_LIMIT_MB = L.sheetLimitMB;
  function getSheet(key, cellW, cellH, n, zoom, drawFrame) {
    let s = sheets.get(key);
    if (s) { s.used = sheetFrame; return s; }
    const S = zoom === 2 ? 2 : 1;
    const canvas = M.newCanvas(cellW * n * S, cellH * S);
    const ctx = M.ctx2d(canvas);
    const P = pen(ctx, zoom);
    for (let f = 0; f < n; f++) drawFrame(P, f, f * cellW, 0);
    s = { key: key, canvas: canvas, cellW: cellW, cellH: cellH, n: n, zoom: zoom, S: S, used: sheetFrame, bytes: cellW * n * S * cellH * S * 4 };
    sheets.set(key, s);
    return s;
  }
  function sheetRef(s, frame, ox, oy) {
    const f = ((frame % s.n) + s.n) % s.n;
    return { w: s.cellW, h: s.cellH, ox: ox, oy: oy, canvas: s.canvas, sx: f * s.cellW * s.S, sy: 0, sw: s.cellW * s.S, sh: s.cellH * s.S };
  }
  /** bytes held by the lazily baked per-look sheets (not counted by sprites.memoryMB) */
  M.sheetBytes = function () { let b = 0; for (const s of sheets.values()) b += s.bytes; return b; };
  M.sheetMemoryMB = function () { return M.sheetBytes() / 1048576; };
  M.sheetCount = function () { return sheets.size; };
  /** atlas canvases + agent sheets, in MB (render adds chunks/composites) */
  M.totalMemoryMB = function () { let a = 0; try { a = M.memoryMB(); } catch (e) { a = 0; } return a + M.sheetMemoryMB(); };

  const SHEET_PAINTERS = {};
  for (const fam of Object.keys(SHEET_PAINTERS)) M.registerPainter(fam, SHEET_PAINTERS[fam]);

  /** drop sheets unused for GC_FRAMES when over SHEET_LIMIT_MB; re-registers the sheet families so stale SpriteRefs re-bake */
  M.gcSheets = function (frame) {
    try {
      sheetFrame = Number.isFinite(frame) ? (frame | 0) : sheetFrame + 1;
      if (M.sheetMemoryMB() <= M.SHEET_LIMIT_MB) return 0;
      const keep = Number.isFinite(M.GC_FRAMES) ? M.GC_FRAMES : 600;
      const victims = [];
      for (const s of sheets.values()) if (sheetFrame - s.used >= keep) victims.push(s);
      if (!victims.length) return 0;
      for (const s of victims) { sheets.delete(s.key); if (s.nk !== undefined) numSheets.delete(s.nk); try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } }
      for (const fam of Object.keys(SHEET_PAINTERS)) M.registerPainter(fam, SHEET_PAINTERS[fam]);
      return victims.length;
    } catch (e) { try { BSU.error('sprites_entities', 'gcSheets', e); } catch (e2) { /* never throw */ } return 0; }
  };
  /** drop every sheet (tests / debug) */
  M.clearSheets = function () { for (const s of sheets.values()) { try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } } sheets.clear(); numSheets.clear(); BAKE.queue.length = 0; for (const fam of Object.keys(SHEET_PAINTERS)) M.registerPainter(fam, SHEET_PAINTERS[fam]); };
  if (typeof M.gc === 'function' && !M._gcWrapped) {
    const coreGc = M.gc;
    M.gc = function (frame) { let n = 0; try { n = coreGc(frame) | 0; } catch (e) { n = 0; } return n + M.gcSheets(frame); };
    M._gcWrapped = true;
  }

  // ---------------------------------------------------------------------------
  // Own-canvas painters share one wrapper: size/frames/paint/anchor per family.
  // ---------------------------------------------------------------------------
  function registerSimple(family, opts) {
    M.registerPainter(family, function (ctx, spec) {
      const v = spec.variant | 0;
      const sz = opts.size(v), w = sz[0], h = sz[1];
      const n = Math.max(1, opts.frames | 0);
      spec.frames = n;
      const g = begin(ctx, w, h, spec.zoom);
      const P = pen(ctx, spec.zoom);
      opts.paint(P, g.w, g.h, ((spec.frame % n) + n) % n, v, hash(spec.seed | 0, 0xe7));
      const a = opts.anchor ? opts.anchor(g.w, g.h, v) : [-(g.w >> 1), -g.h + 2];
      return { w: g.w, h: g.h, ox: a[0], oy: a[1] };
    });
    M.setFrames(family, Math.max(1, opts.frames | 0));
  }
  const fixed = (sz) => () => sz;

  // ---------------------------------------------------------------------------
  // Tailgate / heat / festival props
  // ---------------------------------------------------------------------------
  registerSimple('tent', {
    size: fixed(L.tent), frames: 1,
    paint: function (P, w, h) {
      P.rect(2, 10, 12, 1, C.shadow); P.rect(4, 11, 8, 1, C.shadow);
      P.rect(2, 7, 2, 3, PAL.bark); P.rect(12, 7, 2, 3, PAL.bark); P.rect(4, 8, 8, 1, shade(PAL.bark, 0.7));   // legs + a table edge
      for (let r = 1; r <= 6; r++) { const x0 = 7 - r, x1 = 8 + r; for (let x = x0; x <= x1; x++) P.px(x, r, x < 8 ? (r === 1 ? PAL.purpleHi : PAL.purple) : shade(PAL.purple, 0.8)); }
      for (let x = 0; x < 16; x++) P.px(x, 7, (x & 1) ? PAL.purpleShadow : PAL.purple2);   // scalloped edge
      P.px(7, 0, PAL.gold); P.px(8, 0, PAL.goldHi); P.px(9, 0, PAL.gold);
    }
  });
  registerSimple('smoker', {
    size: fixed(L.smoker), frames: 2,
    paint: function (P, w, h, f) {
      const barrel = shade(black, 1.7);
      P.rect(1, 3, 8, 4, barrel); P.rect(2, 3, 1, 4, shade(black, 2.4)); P.rect(8, 3, 1, 4, black); P.rect(1, 6, 8, 1, black);
      P.rect(8, 0, 1, 2, C.steel); P.px(2, 7, C.steelDark); P.px(7, 7, C.steelDark);
      const ly = f ? 0 : 2; P.rect(2, ly, 6, 1, C.steelDark); P.px(4, ly, C.steel); P.px(5, ly, C.steel);
      if (f) { P.px(4, 2, C.ember); P.px(5, 2, C.flame); P.px(3, 2, shade(C.ember, 0.7)); }
    }
  });
  registerSimple('cornhole', {
    size: fixed(L.cornhole), frames: 2,
    paint: function (P, w, h, f) {
      P.rect(2, 2, 8, 1, PAL.purpleHi); P.rect(1, 3, 10, 2, PAL.purple); P.rect(1, 4, 10, 1, PAL.purpleShadow); P.px(8, 3, black); P.px(2, 3, PAL.gold);
      P.px(1, 5, PAL.bark); P.px(10, 5, PAL.bark);
      if (f) { P.rect(4, 0, 2, 1, C.red); } else { P.rect(3, 3, 2, 1, C.red); }
    }
  });
  registerSimple('snoball', {
    size: fixed(L.snoball), frames: 2,
    paint: function (P, w, h, f) {
      P.rect(2, 10, 10, 1, C.shadow);
      for (let x = 1; x <= 12; x++) { P.px(x, 2, ((x >> 1) & 1) ? PAL.purple : C.white); P.px(x, 3, ((x >> 1) & 1) ? PAL.purpleShadow : shade(C.white, 0.85)); }
      P.px(2, 4, C.steel); P.px(11, 4, C.steel);
      P.rect(2, 5, 10, 5, C.offWhite); P.rect(2, 9, 10, 1, shade(C.offWhite, 0.75)); P.rect(2, 5, 10, 1, C.white);
      P.px(4, 6, C.red); P.px(6, 6, PAL.waterBlue); P.px(8, 6, PAL.gold); P.px(10, 6, PAL.azalea);
      P.rect(4, 8, 6, 1, PAL.purple); P.px(5, 8, PAL.gold); P.px(8, 8, PAL.gold);
      P.rect(3, 10, 2, 2, black); P.rect(9, 10, 2, 2, black);
      P.rect(1, 0, 1, 5, C.steel); P.rect(2, 0, 2, 2, PAL.gold); if (f) { P.px(3, 0, PAL.goldHi); P.px(4, 1, PAL.gold); } else P.px(3, 0, PAL.goldHi);
    }
  });
  registerSimple('bonfire', {
    size: fixed(L.bonfire), frames: 3,
    paint: function (P, w, h, f, v, seed) {
      P.rect(2, 15, 8, 1, C.shadow);
      P.rect(1, 13, 10, 1, PAL.bark); P.rect(2, 14, 8, 1, shade(PAL.bark, 0.7)); P.line(2, 12, 9, 14, shade(PAL.bark, 1.3)); P.px(1, 13, shade(PAL.bark, 1.5)); P.px(10, 13, shade(PAL.bark, 1.5));
      const top = [3, 1, 2][f], lean = [0, 1, -1][f];
      for (let y = top; y <= 12; y++) {
        const t = (y - top) / (12 - top);
        const hw = Math.round(4.5 * Math.sin(t * Math.PI * 0.8 + 0.25)) - (y === 12 ? 1 : 0);
        const cx = 6 + Math.round(lean * (1 - t) * 1.5);
        for (let x = cx - hw; x <= cx + hw; x++) {
          if (x < 0 || x >= w) continue;
          const d = Math.abs(x - cx) / (hw + 0.5), n = hash(seed + f, x + y * 17) % 100;
          let c = C.red; if (d < 0.8 || t > 0.6) c = C.ember; if (t > 0.3 && d < 0.5) c = C.flame; if (t > 0.75 && d < 0.3) c = PAL.goldHi;
          if (n < 8 && d > 0.6) continue;   // ragged edge
          P.px(x, y, c);
        }
      }
      if (top > 0) P.px(6 + lean, top - 1, C.flame);
      for (let i = 0; i < 2; i++) P.px(3 + (hash(seed, 50 + i + f * 7) % 6), (hash(seed, 60 + i + f * 7) % 3), PAL.goldHi);   // sparks
    }
  });

  registerSimple('pelican', {
    size: fixed(L.pelican), frames: 2,
    paint: function (P, w, h, f) {
      const b = newBuf(w, h), bd = C.pelican, dk = shade(bd, 0.75);
      shadowRows(P, 0, 0, 6, 8, 8);
      brect(b, 2, 4, 8, 3, bd); bput(b, 1, 5, dk); bput(b, 0, 5, dk); brect(b, 3, 7, 6, 1, dk);
      if (f === 0) brect(b, 2, 3, 6, 1, dk); else { brect(b, 0, 1, 6, 1, dk); bput(b, 6, 2, dk); bput(b, 5, 2, bd); bput(b, 4, 3, bd); }
      brect(b, 9, 1, 2, 3, C.offWhite); bput(b, 10, 2, black);
      brect(b, 8, 3, 4, 1, C.beak); brect(b, 8, 4, 3, 1, shade(C.beak, 0.8)); bput(b, 11, 4, shade(C.beak, 0.8));
      bput(b, 5, 7, C.beak); bput(b, 7, 7, C.beak);
      boutline(b, 8, 0.6);
      bblit(b, P, 0, 0);
    }
  });
  registerSimple('armadillo', {
    size: fixed(L.armadillo), frames: 2,
    paint: function (P, w, h, f) {
      const b = newBuf(w, h), sh = C.armadillo, sd = shade(sh, 0.8);
      shadowRows(P, 0, 0, 5, 4, 8);
      brect(b, 2, 0, 6, 1, shade(sh, 1.12)); brect(b, 1, 1, 8, 2, sh); for (const x of [3, 5, 7]) bput(b, x, 1, sd);
      brect(b, 8, 2, 2, 1, sd); bput(b, 9, 2, black); bput(b, 0, 2, sd); bput(b, 0, 3, sd);
      for (const x of [2, 4, 6]) bput(b, x + f, 3, sd);
      boutline(b, 4, 0.6);
      bblit(b, P, 0, 0);
    }
  });
  // ---------------------------------------------------------------------------
  // Gates (32×24, anchor = the tile centre at (16, 20)): the floodgate plate slides
  // from raised (frame 0) to dropped (frame 3); the barrier's sector gate rotates down.
  // ---------------------------------------------------------------------------
  const gateAnchor = () => [-16, -20];
  registerSimple('gate', {
    size: fixed(L.gate), frames: 4, anchor: gateAnchor,
    paint: function (P, w, h, f) {
      P.rect(10, 20, 12, 2, PAL.waterNight); P.rect(10, 20, 12, 1, shade(PAL.waterNight, 1.3));           // the canal bed under the plate
      P.rect(9, 1, 1, 21, PAL.goldShadow); P.rect(22, 1, 1, 21, PAL.goldShadow); P.rect(9, 1, 14, 1, PAL.gold); P.rect(9, 0, 14, 1, PAL.goldHi);   // guide posts + beam
      const y = 3 + f * 3;
      P.rect(10, y, 12, 10, PAL.purple); P.rect(10, y, 12, 1, PAL.purpleHi); P.rect(10, y, 1, 10, PAL.purpleHi); P.rect(10, y + 9, 12, 1, PAL.purpleShadow); P.rect(21, y, 1, 10, PAL.purpleShadow);
      P.rect(12, y + 3, 8, 1, PAL.purpleShadow); P.rect(12, y + 6, 8, 1, PAL.purpleShadow);
      if (f === 3) P.rect(10, y, 12, 1, PAL.gold);
      P.rect(11, y + 10, 10, 1, C.shadow);
    }
  });
  registerSimple('barrierGate', {
    size: fixed(L.barrierGate), frames: 4, anchor: gateAnchor,
    paint: function (P, w, h, f) {
      P.rect(4, 22, 24, 1, C.concrete); P.rect(4, 23, 24, 1, shade(C.concrete, 0.7));   // the sill
      P.rect(6, 18, 4, 4, C.steelDark); P.px(7, 19, C.steel);                           // the hinge block
      const a = (-90 + 30 * f) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      for (let t = 0; t < 14; t++) {
        const px = 8 + cs * t, py = 20 + sn * t;
        const stripe = (t % 4) === 1 || (t % 4) === 2;
        for (let k = -1; k <= 1; k++) {
          const x = Math.round(px - sn * k), y = Math.round(py + cs * k);
          P.px(x, y, k === -1 ? (stripe ? PAL.goldHi : shade(C.steel, 1.25)) : k === 0 ? (stripe ? PAL.gold : C.steel) : (stripe ? PAL.goldShadow : C.steelDark));
        }
      }
      const tx = Math.round(8 + cs * 13), ty = Math.round(20 + sn * 13); P.px(tx, ty, C.steelDark);
    }
  });

  // ---------------------------------------------------------------------------
  // nest 6×4 (bottom-centre) and the speech bubble 10×8 × 3 (`!`, zzz, ♥)
  // ---------------------------------------------------------------------------
  registerSimple('nest', {
    size: fixed(L.nest), frames: 1,
    paint: function (P) { P.ellipse(3, 2, 3, 2, PAL.bark); P.ellipse(3, 2, 2, 1, shade(PAL.bark, 1.4)); P.px(3, 2, C.offWhite); P.px(1, 1, shade(PAL.bark, 1.6)); P.px(5, 3, shade(PAL.bark, 1.6)); }
  });
  registerSimple('bubble', {
    size: fixed(L.bubble), frames: 3,
    paint: function (P, w, h, f) {
      P.rect(1, 0, 8, 6, PAL.purple); P.rect(0, 1, 10, 4, PAL.purple); P.rect(1, 0, 8, 1, PAL.purpleHi); P.px(0, 1, PAL.purpleHi); P.rect(1, 5, 8, 1, PAL.purpleShadow); P.px(9, 4, PAL.purpleShadow);
      P.px(4, 6, PAL.purpleShadow); P.px(4, 7, PAL.purpleShadow);   // the tail down to the head
      if (f === 0) { P.rect(4, 1, 2, 3, PAL.gold); P.rect(4, 0, 2, 1, PAL.goldHi); P.rect(4, 5, 2, 1, PAL.gold); P.px(4, 4, PAL.purple); P.px(5, 4, PAL.purple); }
      else if (f === 1) {
        const z = (x, y, c) => { P.rect(x, y, 3, 1, c); P.px(x + 1, y + 1, c); P.rect(x, y + 2, 3, 1, c); };
        z(1, 3, PAL.text); z(4, 1, PAL.goldHi); P.px(8, 0, PAL.gold); P.px(7, 0, PAL.gold); P.px(8, 1, PAL.gold);
      } else { P.px(3, 1, PAL.azalea); P.px(4, 1, PAL.azalea); P.px(6, 1, PAL.azalea); P.px(7, 1, PAL.azalea); P.rect(2, 2, 7, 1, PAL.azalea); P.rect(3, 3, 5, 1, C.red); P.rect(4, 4, 3, 1, C.red); P.px(5, 5, C.red); P.px(3, 2, shade(PAL.azalea, 1.2)); }
    }
  });

  // @@FB-BEGIN
  // ---------------------------------------------------------------------------
  // FOOTBALL PASS E (docs/PLAN_FOOTBALL.md §2.2): the football sprite family.
  // Every humanoid (players, referee, chain crew, cheerleaders, band, coaches, fans, Roux) is drawn by ONE tiny
  // skeleton rig: joints in a figure-local frame (x = its right hand, y up, z forward) → two-bone IK for knees and
  // elbows → yaw by the facing direction → orthographic projection → per-pixel depth buffer (capsules for limbs, a
  // slab stack for the torso, shaded spheres for helmets/heads) → 1-px outline → blit through the pen (so 1× and 2×
  // come from the same code). The 8 facing directions are 8 real yaws, not mirrors. Pure + deterministic (no rng).
  // Ids (docs/INTEGRATION_NOTES.md '## football pass E'): fbplayer[:pose], fbball, fbref, fbcrew, fbdown, fbstick,
  // fbcheer, fbband, fbstaff, fbroux, fbfan:<pose>.
  // ---------------------------------------------------------------------------
  let CURPJ = null;
  const FBL = Object.freeze({ cw: 18, ch: 24, gy: 22, pitch: 0.42 });
  const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v3mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const v3len = (a) => Math.sqrt(v3dot(a, a));
  const v3lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
  const FPI = Math.PI;
  const matCache = new Map();
  function mat(c) { let m = matCache.get(c); if (!m) { m = { c: c, l: shade(c, 1.2), d: shade(c, 0.72), hl: mix(c, '#FFFFFF', 0.5) }; matCache.set(c, m); } return m; }

  // --- the depth-buffered pixel rig ------------------------------------------------------------
  function newRig(w, h, cx, gy) { return { w: w, h: h, cx: cx, gy: gy, c: new Array(w * h).fill(null), z: new Float32Array(w * h).fill(-1e9), t: new Uint8Array(w * h) }; }
  /** world (x right, y up, z toward the viewer) → [screen x, screen y, depth] */
  function scr(R, p) { return [R.cx + p[0], R.gy - p[1] - p[2] * FBL.pitch, p[2]]; }
  function rput(R, x, y, c, d, tag) {
    if (x < 0 || y < 0 || x >= R.w || y >= R.h) return;
    const i = y * R.w + x;
    if (d >= R.z[i]) { R.z[i] = d; R.c[i] = c; R.t[i] = tag; }
  }
  /** tapered capsule A→B (world points); m = a material {c,l,d} or fn(t, u, x, y) → colour */
  function cap(R, A, B, rA, rB, m, tag, PJ) {
    const a = (PJ || CURPJ || scr)(R, A), b = (PJ || CURPJ || scr)(R, B), rm = Math.max(rA, rB) + 1, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, fn = typeof m === 'function';
    for (let y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.ceil(Math.max(a[1], b[1]) + rm); y++)
      for (let x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.ceil(Math.max(a[0], b[0]) + rm); x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = l2 > 1e-6 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (a[0] + dx * t), ey = py - (a[1] + dy * t), r = rA + (rB - rA) * t, d2 = ex * ex + ey * ey;
        if (d2 > r * r) continue;
        const u = ex / r;
        rput(R, x, y, fn ? m(t, u, x, y) : (u < -0.4 ? m.l : u > 0.45 ? m.d : m.c), a[2] + (b[2] - a[2]) * t + Math.sqrt(r * r - d2) * 0.8, tag);
      }
  }
  /** shaded sphere at world point C; fn(nx, ny, nz, x, y) → colour | null (nx right, ny up, nz toward the viewer) */
  function orb(R, C, r, fn, tag, ry, PJ) {
    const s0 = (PJ || CURPJ || scr)(R, C); ry = ry || r;
    for (let y = Math.floor(s0[1] - ry - 1); y <= Math.ceil(s0[1] + ry + 1); y++)
      for (let x = Math.floor(s0[0] - r - 1); x <= Math.ceil(s0[0] + r + 1); x++) {
        const dx = (x + 0.5 - s0[0]) / r, dy = (y + 0.5 - s0[1]) / ry, d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2), col = fn(dx, -dy, nz, x, y);
        if (col) rput(R, x, y, col, C[2] + nz * r, tag);
      }
  }
  const orbMat = (m) => (dx, ny) => (dx < -0.4 || ny > 0.55 ? m.l : dx > 0.45 || ny < -0.6 ? m.d : m.c);

  // --- two-bone IK + the pose solver -----------------------------------------------------------
  function ik2(A, T, l1, l2, pole) {
    let d = v3sub(T, A), L = v3len(d);
    const mx = (l1 + l2) * 0.998;
    if (L > mx) { d = v3mul(d, mx / L); L = mx; T = v3add(A, d); }
    if (L < 0.3) return [v3add(A, [0, -l1, 0.3]), T];
    const dir = v3mul(d, 1 / L);
    let q = v3sub(pole, v3mul(dir, v3dot(pole, dir))), ql = v3len(q);
    if (ql < 1e-4) { q = v3sub([0, 0, 1], v3mul(dir, dir[2])); ql = v3len(q) || 1; }
    q = v3mul(q, 1 / ql);
    const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    return [v3add(A, v3add(v3mul(dir, a), v3mul(q, h))), T];
  }
  /** local joints for a build B and pose p (all in the figure frame, after body tilt/scale/grounding) */
  function solve(B, p) {
    const py = p.py !== undefined ? p.py : B.hipY, pz = p.pz || 0, Ln = p.lean || 0, tw = p.tw || 0, TL = p.tilt || 0, sc = p.scale || 1;
    const cL = Math.cos(Ln), sL = Math.sin(Ln), cw = Math.cos(tw), sw = Math.sin(tw);
    const uT = [0, cL, sL], f0 = [0, -sL, cL];
    const lat = v3add([cw, 0, 0], v3mul(f0, sw)), fT = v3sub(v3mul(f0, cw), [sw, 0, 0]);
    const P = [0, py, pz], N = v3add(P, v3mul(uT, B.torso));
    const sb = v3sub(N, v3mul(uT, 0.8)), sx = B.sw - 0.6;
    const S2 = [v3add(sb, v3mul(lat, sx)), v3sub(sb, v3mul(lat, sx))];
    const hip = [[B.hw, py, pz], [-B.hw, py, pz]], th = (B.hipY + 0.8) / 2;
    const feet = [p.fr || [B.hw + 0.3, 0, 0], p.fl || [-B.hw - 0.3, 0, 0]];
    const kn = [], an = [], toe = [], elb = [], hands = [];
    for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, r = ik2(hip[s], v3add(feet[s], [0, 0.9, 0]), th, th, (s ? p.kpL : p.kpR) || [0.12 * sg, 0.2, 1]);
      kn.push(r[0]); an.push(r[1]); toe.push(v3add(r[1], [0, -0.55, 2.0]));
    }
    for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, rel = s ? p.hl : p.hr, ab = s ? p.hal : p.har;
      const tgt = ab || v3add(S2[s], rel || [0.5 * sg, -5.9, 0.3]);
      const r = ik2(S2[s], tgt, B.upper, B.fore, (s ? p.epL : p.epR) || [0.55 * sg, -1, -0.45]);
      elb.push(r[0]); hands.push(r[1]);
    }
    const H = v3add(N, [0, B.headR * 0.82 + (p.hu || 0), 0.3 + (p.hf || 0)]);
    const cT = Math.cos(TL), sT = Math.sin(TL);
    const tp = (q) => { const y = q[1] - py, z = q[2] - pz; return [q[0] * sc, (y * cT - z * sT + py) * sc, (z * cT + y * sT + pz) * sc]; };
    const tv = (v) => [v[0], v[1] * cT - v[2] * sT, v[2] * cT + v[1] * sT];
    const J = { P: tp(P), N: tp(N), lat: tv(lat), fT: tv(fT), uT: tv(uT), sh: S2.map(tp), el: elb.map(tp), ha: hands.map(tp), hip: hip.map(tp), kn: kn.map(tp), an: an.map(tp), toe: toe.map(tp), H: tp(H), sc: sc };
    if (p.ground !== undefined) {   // lying poses: rest the lowest joint on the ground
      let lo = 1e9; for (const k of ['sh', 'el', 'ha', 'hip', 'kn', 'an', 'toe']) for (const q of J[k]) lo = Math.min(lo, q[1] - (k === 'toe' || k === 'an' ? 0.9 : 0.8)); lo = Math.min(lo, J.H[1] - B.headR * sc);
      const dy = p.ground - lo; for (const k of ['sh', 'el', 'ha', 'hip', 'kn', 'an', 'toe']) for (const q of J[k]) q[1] += dy; J.P[1] += dy; J.N[1] += dy; J.H[1] += dy;
    }
    return J;
  }

  // --- the human renderer ------------------------------------------------------------------------
  /** style S: {m:{jersey,pants,sock,shoe,skin,glove,sleeve}, head:'helmet'|'bare'|'tiger', ...} — see the style builders below */
  function drawHuman(R, B, S, p, yaw, opt) {
    const J = solve(B, p), sY = Math.sin(yaw), cY = Math.cos(yaw), sc = J.sc, m = S.m;
    const W = (q) => [-q[0] * cY + q[2] * sY, q[1], q[0] * sY + q[2] * cY];
    const ctx = { R: R, B: B, S: S, J: J, W: W, p: p, yaw: yaw, sc: sc, opt: opt || {} };
    // legs: thigh (pants), shin (sock or long pants), shoe
    for (let s = 0; s < 2; s++) {
      const hip = W(J.hip[s]), kn = W(J.kn[s]), an = W(J.an[s]), toe = W(J.toe[s]), lr = B.legR * sc;
      cap(R, hip, kn, lr, lr * 0.95, S.legFn ? S.legFn(0) : m.pants, 4);
      cap(R, kn, an, lr * 0.92, lr * 0.8, S.legFn ? S.legFn(1) : (S.longPants ? m.pants : m.sock), 4);
      cap(R, an, toe, 0.95 * sc, 0.85 * sc, m.shoe, 4);
    }
    // torso: a slab stack from the pelvis to the neck (wedge: narrow waist, wide shoulders)
    const Pw = W(J.P), Nw = W(J.N), latW = W(J.lat), fW = W(J.fT), pk = FBL.pitch, nS = 28;
    for (let k = 0; k <= nS; k++) {
      const t = k / nS, c = v3lerp(Pw, Nw, t), sm = clamp01((t - 0.1) / 0.7), sm2 = sm * sm * (3 - 2 * sm);
      const a = (B.hw + 0.8 + (B.sw - B.hw - 0.8) * sm2) * sc, b = B.sd * (0.9 + 0.2 * sm2) * sc;
      const hx = Math.max(0.4, a * Math.abs(latW[0]) + b * Math.abs(fW[0])), hv = Math.max(0.3, a * (Math.abs(latW[1]) + Math.abs(latW[2]) * pk) + b * (Math.abs(fW[1]) + Math.abs(fW[2]) * pk));
      const s0 = scr(R, c), dep = c[2] + (b * Math.abs(fW[2]) + a * Math.abs(latW[2])) * 0.9;
      for (let y = Math.ceil(s0[1] - hv - 0.5); y <= Math.floor(s0[1] + hv - 0.5); y++)
        for (let x = Math.ceil(s0[0] - hx - 0.5); x <= Math.floor(s0[0] + hx - 0.5); x++) {
          const u = (x + 0.5 - s0[0]) / hx;
          let col;
          if (t < 0.07) col = m.pants.c;
          else if (S.jerseyFn) col = S.jerseyFn(t, u, x, y);
          else col = u < -0.45 ? m.jersey.l : u > 0.5 ? m.jersey.d : m.jersey.c;
          rput(R, x, y, col, dep, 1);
        }
    }
    // arms (sleeve with an optional stripe, forearm, glove) and shoulder pads
    for (let s = 0; s < 2; s++) {
      const sh = W(J.sh[s]), el = W(J.el[s]), ha = W(J.ha[s]), ar = B.armR * sc;
      if (B.pad) orb(R, sh, B.pad * sc, orbMat(m.jersey), 7);
      cap(R, sh, el, ar + 0.15, ar, S.sleeveFn || m.sleeve, 3);
      cap(R, el, ha, ar, ar * 0.9, S.armFn ? S.armFn() : (S.longSleeve ? m.sleeve : m.skin), 3);
      if (!S.noGlove) orb(R, ha, ar + 0.35, orbMat(m.glove), 3);
    }
    // the ball tucked/held (only when the variant asks for it, or the pose always carries it)
    if (p.ball && (ctx.opt.carry || p.ballAlways)) {
      const R0 = W(J.ha[0]), L0 = W(J.ha[1]);
      const c = p.ball === 'both' ? v3add(v3lerp(R0, L0, 0.5), [0, 0.3, 0.9]) : v3add(R0, p.ball === 'ear' ? [0.4, 0.9, 0] : [-0.2, 0.4, 0.5]);
      const ax = p.ball === 'both' ? W([1, 0, 0]) : W([0, 0.15, 1]), bm = mat('#8B4A1E');
      cap(R, v3sub(c, v3mul(ax, 1.7)), v3add(c, v3mul(ax, 1.7)), 1.15, 1.15, bm, 5);
      cap(R, v3add(c, [0, 1.0, 0]), v3add(c, v3add([0, 1.0, 0], v3mul(ax, 0.1))), 0.6, 0.6, mat('#F4F4F4'), 5);
    }
    // the head
    const Hc = W(J.H), hr = B.headR * sc, yh = yaw + (p.ht || 0), sYh = Math.sin(yh), cYh = Math.cos(yh);
    const hp = (l, u, f) => [Hc[0] - cYh * l * hr + sYh * f * hr, Hc[1] + u * hr, Hc[2] + sYh * l * hr + cYh * f * hr];
    ctx.Hc = Hc; ctx.hr = hr; ctx.hp = hp; ctx.yh = yh;
    orb(R, Hc, hr, (dx, ny, nz) => headShade(S, dx, ny, nz, dx * sYh + nz * cYh, -dx * cYh + nz * sYh), 2);
    if (S.head === 'helmet') {
      const mm = S.mask, mf = (t) => (t < 0.3 ? mm.hl : mm.c);
      cap(R, hp(-0.58, 0.0, 0.84), hp(0.58, 0.0, 0.84), 0.6, 0.6, mf, 5);                       // brow bar
      cap(R, hp(-0.4, -0.62, 0.78), hp(0.4, -0.62, 0.78), 0.6, 0.6, mm, 5);                      // chin bar
      cap(R, hp(0, 0.04, 0.94), hp(0, -0.62, 0.84), 0.55, 0.55, mm, 5);                         // centre bar
      cap(R, hp(-0.6, 0.0, 0.8), hp(-0.4, -0.62, 0.78), 0.55, 0.55, mm, 5);
      cap(R, hp(0.6, 0.0, 0.8), hp(0.4, -0.62, 0.78), 0.55, 0.55, mm, 5);
    } else if (S.cap) {
      const cm = mat(S.cap.bill || S.cap.c);
      cap(R, hp(-0.62, 0.18, 0.95), hp(0.62, 0.18, 0.95), 0.6, 0.6, cm, 5);
      cap(R, hp(-0.42, 0.14, 1.32), hp(0.42, 0.14, 1.32), 0.55, 0.55, cm, 5);
    }
    if (S.extras) S.extras(ctx);
    if (S.digits && !(p.tilt && Math.abs(p.tilt) > 0.5)) overlayNumber(R, J, W, S, B);
    return ctx;
  }
  function headShade(S, dx, ny, nz, fwd, lat) {
    const k = S.head;
    if (k === 'helmet') {
      if (fwd > 0.48 && ny < 0.22 && ny > -0.85 && Math.abs(lat) < 0.86) return S.faceDark;
      if (Math.abs(lat) < 0.2 && ny > 0.02) return S.stripe;
      if (Math.abs(lat) > 0.8 && ny > -0.15 && ny < 0.45 && fwd > -0.25 && fwd < 0.5) return S.logo;
      const sm = S.shell;
      if (ny > 0.5 && dx < -0.1 && dx > -0.6) return sm.hl;
      return dx < -0.42 ? sm.l : (dx > 0.46 || ny < -0.58) ? sm.d : sm.c;
    }
    if (k === 'tiger') {
      const o = S.fur, aLat = Math.abs(lat);
      if (fwd > 0.5 && ny > 0.02 && ny < 0.34 && aLat > 0.22 && aLat < 0.55) return aLat < 0.4 ? '#FFE680' : '#1B1B1B';      // eyes
      if (fwd > 0.7 && ny > -0.18 && ny < -0.04 && aLat < 0.16) return '#1B1B1B';                                           // nose
      if (fwd > 0.55 && ny > -0.6 && ny < -0.04 && aLat < 0.52) return '#F4EEE2';                                           // muzzle
      if (ny > 0.42 && fwd > 0 && (aLat < 0.1 || (aLat > 0.4 && aLat < 0.55))) return '#1B1B1B';                          // forehead stripes
      if (aLat > 0.62 && ny > -0.3 && ny < 0.05 && fwd > -0.2) return '#1B1B1B';                                           // cheek stripe
      return dx < -0.42 ? o.l : (dx > 0.46 || ny < -0.58) ? o.d : o.c;
    }
    // bare head: skin, hair cap on top/back, two eyes, an optional cap
    if (S.cap && ny > 0.12) return dx < -0.42 ? mat(S.cap.c).l : dx > 0.45 ? mat(S.cap.c).d : S.cap.c;
    if (fwd > 0.55 && ny > -0.08 && ny < 0.2 && Math.abs(lat) > 0.22 && Math.abs(lat) < 0.55) return '#1B1B1B';
    if (S.hairC && (ny > 0.38 || (fwd < -0.1 && ny > -0.5) || (S.longHair && fwd < 0.2 && ny > -0.8 && Math.abs(lat) > 0.55))) return dx < -0.42 ? S.hairC.l : dx > 0.45 ? S.hairC.d : S.hairC.c;
    const sk = S.m.skin;
    return dx < -0.42 ? sk.l : (dx > 0.46 || ny < -0.6) ? sk.d : sk.c;
  }
  /** stamp S.digits (a 1–2 digit string) on whichever torso face (chest / back) points at the viewer, foreshortened by the facing */
  function overlayNumber(R, J, W, S, B) {
    const fW = W(J.fT), k = Math.abs(fW[2]);
    if (k < 0.3) return;
    const digits = S.digits, texW = digits.length * 4 - 1, front = fW[2] > 0;
    const c = v3lerp(W(J.P), W(J.N), 0.5), s0 = scr(R, c), fx = s0[0] + (front ? 1 : -1) * B.sd * 0.9 * fW[0] * J.sc, y0 = Math.round(s0[1] - 2.5);
    for (let y = 0; y < 5; y++) for (let x = Math.floor(fx - 5); x <= Math.ceil(fx + 5); x++) {
      if (x < 0 || x >= R.w || y0 + y < 0 || y0 + y >= R.h) continue;
      const i = (y0 + y) * R.w + x;
      if (R.t[i] !== 1) continue;
      const tx = Math.floor((x + 0.5 - fx) / k + texW / 2);
      if (tx < 0 || tx >= texW || (tx & 3) === 3) continue;
      const g = M.FONT[digits[tx >> 2]]; if (!g) continue;
      if ((g[y] >> (2 - (tx & 3))) & 1) R.c[i] = S.numCol;
    }
  }

  // --- builds (px; hipY = pelvis height standing) ------------------------------------------------
  const BUILD = {
    line:  { hipY: 7.2, torso: 6.0, hw: 2.5, sw: 4.3, sd: 2.7, legR: 1.7, armR: 1.45, headR: 3.3, pad: 1.9, upper: 3.3, fore: 3.2, num: 66, skin: 3 },
    skill: { hipY: 8.6, torso: 6.5, hw: 1.7, sw: 3.1, sd: 2.0, legR: 1.15, armR: 1.05, headR: 3.0, pad: 1.2, upper: 3.4, fore: 3.2, num: 84, skin: 2 },
    qb:    { hipY: 8.8, torso: 6.7, hw: 1.9, sw: 3.5, sd: 2.2, legR: 1.25, armR: 1.15, headR: 3.0, pad: 1.4, upper: 3.5, fore: 3.2, num: 12, skin: 0 },
    k:     { hipY: 8.4, torso: 6.2, hw: 1.7, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 2.9, pad: 0.9, upper: 3.3, fore: 3.1, num: 3, skin: 5 },
    back:  { hipY: 7.9, torso: 6.3, hw: 2.0, sw: 3.6, sd: 2.3, legR: 1.4, armR: 1.2, headR: 3.1, pad: 1.5, upper: 3.3, fore: 3.2, num: 28, skin: 4 },
    civ:   { hipY: 8.4, torso: 6.4, hw: 1.8, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 2.9, pad: 0, upper: 3.3, fore: 3.1 },
    cheer: { hipY: 8.0, torso: 6.0, hw: 1.6, sw: 2.7, sd: 1.7, legR: 1.05, armR: 0.95, headR: 2.8, pad: 0, upper: 3.1, fore: 3.0 },
    roux:  { hipY: 8.6, torso: 7.0, hw: 2.5, sw: 3.8, sd: 3.0, legR: 1.7, armR: 1.5, headR: 4.5, pad: 0, upper: 3.7, fore: 3.5 }
  };
  const ROLES = ['line', 'skill', 'qb', 'k', 'back'];
  const POSES = { stance: 1, run: 6, throw: 2, catch: 2, tackle: 2, tackled: 1, celebrate: 2, huddle: 1 };

  // --- players: poses ----------------------------------------------------------------------------
  function playerPose(kind, role, f) {
    const B = BUILD[role], hw = B.hw, L = role === 'line', Q = role === 'qb';
    switch (kind) {
      case 'stance':
        if (L) return { py: 5.1, pz: -2.0, lean: 1.12, har: [3.0, 1.2, 4.1], hl: [-1.4, -4.6, -2.2], fr: [hw + 1.0, 0, -0.6], fl: [-hw - 1.0, 0, 0.6], ball: 'tuck' };
        if (role === 'back') return { py: 6.2, pz: -0.8, lean: 0.62, har: [hw + 0.9, 5.2, 2.3], hal: [-hw - 0.9, 5.2, 2.3], fr: [hw + 1.0, 0, -0.4], fl: [-hw - 1.0, 0, 0.4], ball: 'tuck' };
        if (Q) return { py: 8.0, lean: 0.14, hr: [-2.8, -3.6, 2.8], hl: [2.8, -3.6, 2.8], fr: [hw + 0.6, 0, -0.4], fl: [-hw - 0.6, 0, 0.4], ball: 'both' };
        if (role === 'k') return { py: 8.2, lean: 0.1, hr: [0.7, -5.4, 0.6], hl: [-0.7, -5.4, 0.6], fr: [hw + 0.4, 0, -0.5], fl: [-hw - 0.4, 0, 0.5] };
        return { py: 7.3, pz: -0.4, lean: 0.34, hr: [0.4, -4.9, 2.2], hl: [-0.4, -4.9, 2.2], fr: [hw + 0.8, 0, -0.7], fl: [-hw - 0.8, 0, 0.6], ball: 'tuck' };
      case 'run': {
        const ph = f / 6 * FPI * 2, S3 = L ? 2.6 : 3.4, LF = L ? 2.3 : 3.0;
        const leg = (th, sg) => [sg * (hw + 0.2), Math.max(0, Math.cos(th)) * LF, Math.sin(th) * S3];
        const arm = (th, sg) => [0.3 * sg, -3.7 + 1.5 * Math.max(0, Math.cos(th)), Math.sin(th) * 3.4 + 0.6];
        return { py: B.hipY - 0.7 + 0.45 * Math.cos(2 * ph), lean: L ? 0.36 : Q ? 0.2 : 0.3, tw: -0.17 * Math.sin(ph), fr: leg(ph, 1), fl: leg(ph + FPI, -1),
          hr: arm(ph + FPI, 1), hl: arm(ph, -1), ball: 'tuckRun' };
      }
      case 'throw':
        if (role === 'k') return f === 0
          ? { py: 8.0, pz: -0.4, lean: 0.06, tw: 0.2, fr: [hw + 0.3, 2.4, -4.4], fl: [-hw - 0.3, 0, 0.8], hr: [3.0, -1.5, 0.5], hl: [-3.0, -3.8, 1.0], kpR: [0, 0.3, 1] }
          : { py: 8.0, lean: -0.22, tw: -0.2, fr: [hw + 0.4, 5.2, 7.0], fl: [-hw - 0.4, 0, -0.2], hr: [3.6, -0.8, -0.5], hl: [-2.6, -3.0, 1.4] };
        return f === 0
          ? { py: B.hipY - 0.8, pz: -0.4, lean: -0.05, tw: -0.7, hr: [1.0, 2.4, -1.2], hl: [-1.0, -0.4, 4.6], fr: [hw + 0.6, 0, -2.4], fl: [-hw - 0.6, 0, 2.2], epR: [1, -0.3, -0.3], ball: 'ear' }
          : { py: B.hipY - 0.6, pz: 0.5, lean: 0.28, tw: 0.55, hr: [0.4, -1.0, 5.2], hl: [-1.8, -3.6, -0.2], fr: [hw + 0.4, 1.4, -3.0], fl: [-hw - 0.5, 0, 2.4] };
      case 'catch':
        return f === 0
          ? { py: B.hipY + 0.1, lean: -0.08, hr: [-1.2, 4.4, 3.6], hl: [1.2, 4.4, 3.6], fr: [hw + 0.5, 0.5, -0.8], fl: [-hw - 0.5, 0, 0.9], epR: [1, 0.2, -0.2], epL: [-1, 0.2, -0.2], hu: 0.3 }
          : { py: B.hipY - 0.9, lean: 0.2, hr: [-1.6, -3.6, 2.6], hl: [1.6, -3.6, 2.6], fr: [hw + 0.5, 0, -0.6], fl: [-hw - 0.5, 0, 0.8], ball: 'both', ballAlways: true };
      case 'tackle':
        return f === 0
          ? { py: 7.0, pz: 0.5, lean: 0.25, tilt: 0.7, hr: [-1.4, 2.0, 4.8], hl: [1.4, 2.0, 4.8], fr: [hw + 0.5, 0, -1.2], fl: [-hw - 0.5, 0, 1.0], epR: [1, 0, 0], epL: [-1, 0, 0] }
          : { py: 5.2, pz: 1.2, lean: 0.2, tilt: 1.15, hr: [-0.9, 2.6, 4.2], hl: [0.9, 2.6, 4.2], fr: [hw + 0.4, 1.6, -1.6], fl: [-hw - 0.4, 0.8, -0.6], epR: [1, 0, 0], epL: [-1, 0, 0] };
      case 'tackled':
        return { py: 3.4, lean: 0, tilt: -1.4, scale: 0.88, ground: 0.2, hr: [3.4, -2.2, 0.2], hl: [-3.4, -2.2, 0.2], fr: [hw + 0.4, 3.2, 1.0], fl: [-hw - 0.4, 2.4, 1.6], kpR: [0.2, 0.3, 1], kpL: [-0.2, 0.3, 1], epR: [0.3, -1, 0], epL: [-0.3, -1, 0] };
      case 'celebrate':
        return f === 0
          ? { py: B.hipY - 0.6, lean: -0.05, hr: [2.4, 5.2, 0.6], hl: [-2.4, 5.2, 0.6], fr: [hw + 0.9, 0, 0], fl: [-hw - 0.9, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] }
          : { py: B.hipY + 0.8, lean: -0.12, hr: [1.6, 5.9, 0.5], hl: [-1.6, 5.9, 0.5], fr: [hw + 0.5, 1.2, -0.8], fl: [-hw - 0.5, 0.6, 0.3], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] };
      case 'huddle':
        return { py: 6.1, pz: -0.9, lean: 0.9, har: [hw + 1.6, 5.0, 2.4], hal: [-hw - 1.6, 5.0, 2.4], fr: [hw + 1.2, 0, -0.9], fl: [-hw - 1.2, 0, -0.9], hu: -0.6 };
    }
    return {};
  }
  // run: the carried ball tucks the right arm (the 'tuckRun' ball mode)
  function playerPoseCarry(kind, role, f, carry) {
    const p = playerPose(kind, role, f);
    if (kind === 'run' && carry) { p.hr = [-1.8, -3.5, 2.5]; p.epR = [1, -1, -0.2]; p.tw = (p.tw || 0) * 0.4; p.ball = 'tuck'; }
    return p;
  }

  // --- looks (team colours) ---------------------------------------------------------------------
  const lum = (h) => { const c = M.hex(h); return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; };
  const readable = (fg, bg) => (Math.abs(lum(fg) - lum(bg)) >= 70 ? fg : (lum(bg) > 128 ? '#1B1B1B' : '#FFFFFF'));
  const dynLooks = new Map(), FB_SCRIM = 62;
  function oppKeys() { return Object.keys((BSU.data && BSU.data.opponents) || {}); }
  function strHashLocal(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  /** a look id (0–63) from 'home' | an opponent key | a {colors:[c0,c1]} object | a number */
  M.fbLook = function (a) {
    if (a === undefined || a === null || a === 'home' || a === 'bsu' || a === 0) return 0;
    if (a === 'scrim' || a === 'gold') return FB_SCRIM;
    if (typeof a === 'number') return a & 63;
    if (typeof a === 'string') {
      const i = oppKeys().indexOf(a);
      if (i >= 0) return Math.min(39, 1 + i);
      const h = strHashLocal(a), id = 40 + (h % 22);
      dynLooks.set(id, [mix('#2B6CB0', '#B22222', (h & 255) / 255), '#F4EEE2']);
      return id;
    }
    if (typeof a === 'object' && Array.isArray(a.colors) && a.colors.length >= 2) {
      const id = 40 + (strHashLocal(String(a.colors[0]) + String(a.colors[1])) % 22);
      dynLooks.set(id, [a.colors[0], a.colors[1]]);
      return id;
    }
    return 1;
  };
  /** {jersey, pants, helmet, stripe, num, sock, glove} for a look id */
  function lookDef(look) {
    look = look | 0;
    if (look === 0) return { jersey: PAL.purple, pants: PAL.gold, helmet: PAL.gold, stripe: PAL.purple, logo: PAL.purple, num: PAL.gold, sock: '#F4F4F4', glove: '#F4F4F4' };
    if (look === FB_SCRIM) return { jersey: PAL.gold, pants: PAL.purple, helmet: PAL.purple, stripe: PAL.gold, logo: PAL.gold, num: PAL.purple, sock: '#F4F4F4', glove: '#F4F4F4' };
    let cols = dynLooks.get(look);
    if (!cols) { const o = BSU.data && BSU.data.opponents && BSU.data.opponents[oppKeys()[look - 1]]; cols = (o && o.colors) || ['#4A5A6A', '#E8E8E8']; }
    const c0 = cols[0], c1 = cols[1];
    return { jersey: c0, pants: c1, helmet: shade(c0, 0.92), stripe: c1, logo: c1, num: readable(c1, c0), sock: c1, glove: c1 };
  }
  /** pack a player variant: look 0–63 | role 0–4 << 6 | jersey number 0–99 << 9 (0 = the role default) | carry << 16 */
  M.fbVariant = function (look, role, num, carry) {
    const r = typeof role === 'string' ? M.fbRole(role) : (role | 0);
    return ((M.fbLook(look) & 63) | ((r > 4 || r < 0 ? 1 : r) << 6) | (((num | 0) & 127) << 9) | (carry ? 1 << 16 : 0)) >>> 0;
  };
  /** rated position / formation role → role group 0 line, 1 skill, 2 qb, 3 k, 4 back (unknown → skill) */
  M.fbRole = function (pos) {
    const map = (BSU.data && BSU.data.football && BSU.data.football.roles) || {};
    const r = map[pos] || pos;
    return { OL: 0, DL: 0, WR: 1, DB: 1, QB: 2, K: 3, RB: 4, LB: 4 }[r] !== undefined ? { OL: 0, DL: 0, WR: 1, DB: 1, QB: 2, K: 3, RB: 4, LB: 4 }[r] : 1;
  };
  /** the 8 facing directions: dir = round(atan2(dty, dtx) / 45°) mod 8 — 0 SE (+tx), 1 S (+tx+ty), 2 SW (+ty), 3 W, 4 NW (−tx), 5 N, 6 NE (−ty), 7 E */
  M.fbDir = function (dtx, dty) {
    if (!Number.isFinite(dtx) || !Number.isFinite(dty) || (dtx === 0 && dty === 0)) return 1;
    return ((Math.round(Math.atan2(dty, dtx) / (FPI / 4)) % 8) + 8) % 8;
  };
  const dirYaw = (dir) => (1 - dir) * FPI / 4;
  const SKINS = X.skins || ['#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3A1E', '#FFDBAC'], HAIRS = X.hairs || ['#1B1B1B', '#3A2A1E', '#6B4423', '#B0723C', '#E6C27A', '#A8A8A8', '#5E2CA5', '#C7692B'];

  function playerStyle(v) {
    const look = v & 63, role = ROLES[(v >> 6) & 7] || 'skill', num = (v >> 9) & 127, B = BUILD[role], D = lookDef(look);
    const skin = SKINS[num ? num % 6 : B.skin], digits = String(num || B.num);
    const towel = role === 'qb' ? (c) => { const P = c.W(c.J.P); cap(c.R, v3add(P, [0, 0.4, 0]), v3add(P, [0, -3.2, 0]), 0.9, 1.1, mat('#F4F4F4'), 6); } : null;
    return {
      extras: towel, noGlove: role === 'k',
      m: { jersey: mat(D.jersey), pants: mat(D.pants), sock: mat(D.sock), shoe: mat(role === 'k' ? '#F0F0F0' : '#1E1E22'), skin: mat(skin), glove: mat(D.glove), sleeve: mat(D.jersey) },
      sleeveFn: (t, u) => (t > 0.62 && t < 0.86 ? D.stripe : (u < -0.4 ? mat(D.jersey).l : u > 0.45 ? mat(D.jersey).d : D.jersey)),
      head: 'helmet', shell: mat(D.helmet), stripe: D.stripe, logo: D.logo, faceDark: shade(skin, 0.5), mask: mat('#CFD3D8'),
      digits: digits, numCol: D.num
    };
  }
  function composePlayer(pose, v, dir, f, noNumber) {
    const role = ROLES[(v >> 6) & 7] || 'skill', R = newRig(FBL.cw, FBL.ch, FBL.cw >> 1, FBL.gy), p = playerPoseCarry(pose, role, f, (v >> 16) & 1), S = playerStyle(v);
    if (noNumber) S.digits = '';
    drawHuman(R, BUILD[role], S, p, dirYaw(dir), { carry: (v >> 16) & 1 });
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    boutline(b, R.h, 0.5);
    b.shadow = pose === 'tackled' ? 14 : (pose === 'tackle' ? 10 : 8);
    return b;
  }
  // --- sheet families (one canvas per (family, sub-pose, variant, facing, zoom); frame = dir * n + f) -----------------------
  function shadowFb(P, ox, oy, cx, gy, w) { const h = w >> 1; P.rect(ox + cx - h + 1, oy + gy - 1, w - 2, 1, C.shadow); P.rect(ox + cx - h, oy + gy, w, 1, C.shadow); P.rect(ox + cx - h + 1, oy + gy + 1, w - 2, 1, C.shadow); }
  const FB_FAM = {}, bufCache = new Map();
  /** composed cell buffers are kept briefly so the 1× and 2× bakes of one sheet compose each cell once (bounded; cleared by clearFootball) */
  function memoBuf(key, fn) { let b = bufCache.get(key); if (!b) { b = fn(); bufCache.set(key, b); if (bufCache.size > 160) bufCache.delete(bufCache.keys().next().value); } return b; }
  function fbFamily(name, o) {
    FB_FAM[name] = o;
    return function (ctx, spec) {
      const sub = spec.sub || o.def, v = spec.variant | 0, n = o.nOf(sub, v);
      if (!n) throw new Error('unknown ' + name + ' sub "' + sub + '"');
      spec.frames = n * 8;
      const fr = ((spec.frame % (n * 8)) + n * 8) % (n * 8), dir = (fr / n) | 0, d = o.dim(sub);
      // one lazily baked sheet per (sub-pose, variant, facing, zoom): only the directions a game actually uses cost memory
      const s = getSheet(name + '|' + sub + '|' + v + '|' + dir + '|' + spec.zoom, d.cw, d.ch, n, spec.zoom, (P, f, ox, oy) => {
        const b = memoBuf(name + '|' + sub + '|' + v + '|' + dir + '|' + f, () => o.cell(sub, v, dir, f));
        shadowFb(P, ox, oy, d.cw >> 1, d.gy, b.shadow || 8);
        bblit(b, P, ox, oy);
      });
      return sheetRef(s, fr % n, -(d.cw >> 1), -d.gy);
    };
  }
  const FB_PAINTERS = {};
  FB_PAINTERS.fbplayer = fbFamily('fbplayer', { dim: () => ({ cw: FBL.cw, ch: FBL.ch, gy: FBL.gy }), def: 'stance', nOf: (sub) => POSES[sub] || 0, cell: (sub, v, dir, f) => composePlayer(sub, v, dir, f) });
  // --- the other humans: civilians' style, poses, props ------------------------------------------------------------
  function civStyle(o) {
    const sk = o.skin || SKINS[1];
    return {
      m: { jersey: mat(o.jersey), pants: mat(o.pants), sock: mat(o.sock || o.pants), shoe: mat(o.shoe || '#1E1E22'), skin: mat(sk), glove: mat(o.glove || sk), sleeve: mat(o.sleeve || o.jersey) },
      head: 'bare', hairC: o.hair ? mat(o.hair) : null, longHair: !!o.longHair, cap: o.cap || null, longPants: !!o.longPants, longSleeve: !!o.longSleeve, noGlove: o.noGlove !== false,
      jerseyFn: o.jerseyFn || null, extras: o.extras || null, faceDark: shade(sk, 0.5)
    };
  }
  function composeHuman(B, S, p, dir, cw, ch, gy, shadow) {
    const R = newRig(cw, ch, cw >> 1, gy);
    drawHuman(R, B, S, p, dirYaw(dir), null);
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    boutline(b, R.h, 0.5);
    b.shadow = shadow || 8;
    return b;
  }
  const skinOf = (n) => SKINS[((n % 6) + 6) % 6], hairOf = (n) => HAIRS[((n % 8) + 8) % 8];
  const fuzz = (dx, ny, nz, x, y) => ['#FDD023', '#FFE680', '#F4F4F4', '#FDD023', '#F5B700'][(x * 3 + y * 5 + (dx < 0 ? 0 : 1)) % 5];
  const shadeBand = (base) => (t, u) => (u < -0.4 ? mat(base).l : u > 0.45 ? mat(base).d : base);

  // referee: 1-px black/white stripes, white cap, black pants; 0 = stand, 1 = signal (both arms up: touchdown)
  function composeRef(v, dir, f) {
    const S = civStyle({ jersey: '#F2F2F2', pants: '#1E1E22', shoe: '#101012', skin: skinOf(v), hair: hairOf(1), cap: { c: '#F4F4F4', bill: '#1B1B1B' }, longPants: true });
    S.jerseyFn = (t, u, x) => ((x & 1) ? '#1B1B1B' : '#F2F2F2');
    S.sleeveFn = (t) => ((t * 7 | 0) & 1 ? '#1B1B1B' : '#F2F2F2');
    const p = f === 0 ? { py: 8.4, hr: [0.7, -5.2, 0.6], hl: [-0.7, -5.2, 0.6], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] }
      : { py: 8.5, hr: [0.5, 6.0, 0.3], hl: [-0.5, 6.0, 0.3], fr: [2.1, 0, 0], fl: [-2.1, 0, 0], epR: [1, 0, 0], epL: [-1, 0, 0] };
    return composeHuman(BUILD.civ, S, p, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  // chain crew: orange vest over a white long-sleeve shirt, dark pants, white cap
  function composeCrew(v, dir, f) {
    const S = civStyle({ jersey: '#F07830', pants: '#2B2B33', sleeve: '#EDEDED', longSleeve: true, skin: skinOf(v), hair: hairOf(v >> 3), cap: { c: '#EDEDED', bill: '#EDEDED' }, longPants: true });
    return composeHuman(BUILD.civ, S, { py: 8.4, hr: [0.9, -4.6, 1.8], hl: [-0.9, -4.6, 1.8], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] }, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  // cheerleaders: purple top, gold skirt, gold/white pom-poms, ponytail; 4-frame routine (V, T, hip-pop, jump)
  const CHEER_CW = 18, CHEER_CH = 28, CHEER_GY = 25;
  function composeCheer(v, dir, f) {
    const S = civStyle({ jersey: PAL.purple, pants: '#F4F4F4', sock: '#F4F4F4', shoe: '#F4F4F4', skin: skinOf(v), hair: hairOf((v >> 3) + 1), longHair: false });
    S.extras = (c) => {
      const Pw = c.W(c.J.P);
      cap(c.R, v3add(Pw, [0, 0.5, 0]), v3add(Pw, [0, -3.4, 0]), 2.4, 3.4, (t) => (t > 0.86 ? PAL.purple : t < 0.25 ? mat(PAL.gold).l : PAL.gold), 6);
      cap(c.R, c.hp(0, 0.35, -0.85), c.hp(0, -0.85, -1.2), 0.95, 0.7, S.hairC, 6);
      orb(c.R, c.hp(0, 0.5, -0.9), 0.75, orbMat(mat(PAL.gold)), 6);
      for (let s = 0; s < 2; s++) orb(c.R, v3add(c.W(c.J.ha[s]), [0, 0.9, 0]), 2.1, fuzz, 6);
    };
    const P4 = [
      { py: 8.0, hr: [2.4, 5.0, 0.7], hl: [-2.4, 5.0, 0.7], fr: [1.3, 0, 0], fl: [-1.3, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] },
      { py: 8.0, hr: [5.2, 0.4, 0.4], hl: [-5.2, 0.4, 0.4], fr: [2.4, 0, 0], fl: [-2.4, 0, 0], epR: [1, 0.2, 0], epL: [-1, 0.2, 0] },
      { py: 7.7, tw: 0.2, hr: [2.2, 5.2, 0.6], hl: [0.9, -3.8, 1.0], fr: [2.6, 0, 0], fl: [-1.8, 0, 0.4], epR: [1, 0, -0.3], epL: [-1, -0.2, -0.2] },
      { py: 10.0, hr: [1.5, 5.6, 0.5], hl: [-1.5, 5.6, 0.5], fr: [1.0, 2.2, -1.2], fl: [-1.0, 2.2, 1.6], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] }
    ];
    return composeHuman(BUILD.cheer, S, P4[f], dir, CHEER_CW, CHEER_CH, CHEER_GY);
  }
  // band: purple coat with a gold front stripe, white trousers, shako with a plume; v = instrument 0 snare / 1 trumpet / 2 bass drum | skin << 2 | hair << 5
  const BAND_CW = 18, BAND_CH = 30, BAND_GY = 27;
  function composeBand(v, dir, f) {
    const inst = (v & 3) > 2 ? 0 : (v & 3), B = BUILD.civ;
    const S = civStyle({ jersey: PAL.purple, pants: '#F4F4F4', shoe: '#1E1E22', skin: skinOf(v >> 2), hair: hairOf(v >> 5), longPants: true, longSleeve: true, sleeve: PAL.purple });
    S.jerseyFn = (t, u) => (Math.abs(u) < 0.2 ? PAL.gold : u < -0.45 ? mat(PAL.purple).l : u > 0.5 ? mat(PAL.purple).d : PAL.purple);
    S.extras = (c) => {
      const top = v3add(c.Hc, [0, c.hr * 0.5, 0]), end = v3add(top, [0, 3.6, 0]);
      cap(c.R, top, end, 2.1, 2.0, (t, u) => (t < 0.18 ? PAL.gold : u < -0.4 ? mat(PAL.purple).l : u > 0.45 ? mat(PAL.purple).d : PAL.purple), 6);
      cap(c.R, end, v3add(end, [0, 1.8, 0]), 0.65, 0.4, mat('#F4F4F4'), 6);
      const Pw = c.W(c.J.P), py = c.p.py, W = c.W;
      if (inst === 0) {          // snare drum on the waist
        cap(c.R, W([0, py + 1.0, 2.5]), W([0, py + 3.6, 2.5]), 2.3, 2.3, (t) => (t > 0.8 ? '#F4F4F4' : t < 0.2 ? PAL.gold : mat(PAL.gold).c), 6);
      } else if (inst === 1) {   // trumpet: a gold tube from the mouth with a flared bell
        const m0 = c.hp(0, -0.5, 0.95), m1 = c.hp(0, -0.35, 2.6);
        cap(c.R, m0, m1, 0.7, 0.7, mat(PAL.gold), 6);
        orb(c.R, m1, 1.7, orbMat(mat(PAL.gold)), 6);
      } else {                   // bass drum: a fat disc on the chest
        cap(c.R, W([0, py + 2.6, 2.1]), W([0, py + 2.6, 3.5]), 3.5, 3.5, (t, u) => (u < -0.55 || u > 0.55 ? PAL.purple : '#F4F4F4'), 6);
      }
    };
    const hands = inst === 1 ? { hr: [-1.6, 0.2, 3.0], hl: [1.6, 0.4, 4.4] } : { hr: [-0.6, -3.0, 3.3], hl: [0.6, -3.0, 3.3] };
    const p = f === 0 ? { py: 8.4, fr: [2.0, 2.8, 1.4], fl: [-2.0, 0, -0.6] } : { py: 8.4, fr: [2.0, 0, -0.6], fl: [-2.0, 2.8, 1.4] };
    return composeHuman(B, S, Object.assign(p, hands), dir, BAND_CW, BAND_CH, BAND_GY);
  }
  // staff: v & 3 = 0 head coach (purple, gold cap, headset), 1 assistant (white polo, purple cap, headset), 2 trainer (white, no cap), 3 water boy (grey tee, jug) | skin << 2 | hair << 5
  function composeStaff(v, dir, f) {
    const kind = v & 3, skin = skinOf(v >> 2), hair = hairOf(v >> 5);
    const o = [
      { jersey: PAL.purple, pants: '#23232B', cap: { c: PAL.gold, bill: PAL.goldShadow }, longSleeve: true },
      { jersey: '#EDEDED', pants: '#8E845A', cap: { c: PAL.purple, bill: PAL.purple }, longSleeve: false },
      { jersey: '#EDEDED', pants: '#23232B', cap: null, longSleeve: false },
      { jersey: '#9AA0A8', pants: '#8E845A', cap: { c: '#9AA0A8', bill: '#9AA0A8' }, longSleeve: false }][kind];
    const S = civStyle({ jersey: o.jersey, pants: o.pants, skin: skin, hair: hair, cap: o.cap, longPants: true, longSleeve: o.longSleeve, sleeve: o.jersey });
    S.extras = (c) => {
      if (kind < 2) {   // headset: band over the crown, ear cups, a mic boom
        const hp = c.hp, d = mat('#2A2A30');
        cap(c.R, hp(-1.0, 0.1, 0), hp(0, 1.04, 0), 0.5, 0.5, d, 6); cap(c.R, hp(0, 1.04, 0), hp(1.0, 0.1, 0), 0.5, 0.5, d, 6);
        orb(c.R, hp(-1.02, 0, 0), 0.85, orbMat(d), 6); orb(c.R, hp(1.02, 0, 0), 0.85, orbMat(d), 6);
        cap(c.R, hp(-0.95, -0.2, 0.2), hp(-0.3, -0.55, 0.95), 0.5, 0.5, d, 6);
      }
      if (kind === 3) { const h = c.W(c.J.ha[0]); cap(c.R, v3add(h, [0, 0.8, 0]), v3add(h, [0, -2.8, 0]), 1.6, 1.6, (t) => (t < 0.18 ? '#F4F4F4' : '#F07830'), 6); }
    };
    const p = f === 0 ? { py: 8.4, hr: [0.6, -5.4, 0.6], hl: [-0.6, -5.4, 0.6], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] } :
      kind === 3 ? { py: 8.4, hr: [0.8, -4.8, 1.0], hl: [-0.5, -5.6, -1.2], fr: [2.0, 0, 2.0], fl: [-2.0, 0, -2.0] } :
        { py: 8.4, tw: -0.2, hr: [1.4, -0.9, 5.4], hl: [-0.2, -3.6, 0.8], fr: [2.2, 0, 0.4], fl: [-2.2, 0, -0.4], epL: [-1, -0.5, -0.2] };
    return composeHuman(BUILD.civ, S, p, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  // fans: v = look 0–63 (shirt colour) | skin << 6 | hair << 9 | cap << 12; poses seated 1, standing 2 (clap open / clap), wave 2 (arms up, alternating)
  const FAN_DIM = { seated: [14, 20, 17], standing: [14, 26, 22], wave: [14, 26, 22] };
  function composeFan(sub, v, dir, f) {
    const look = v & 63, D = lookDef(look), skin = skinOf((v >> 6) & 7), hair = hairOf((v >> 9) & 7), dim = FAN_DIM[sub];
    const shirt = look === 0 ? PAL.purple : D.jersey, S = civStyle({ jersey: shirt, pants: '#3B4F86', shoe: '#2A2A30', skin: skin, hair: hair, cap: ((v >> 12) & 1) ? { c: look === 0 ? PAL.gold : D.pants, bill: look === 0 ? PAL.gold : D.pants } : null, longPants: true });
    const mid = look === 0 ? PAL.gold : D.pants;
    S.jerseyFn = (t, u) => (t > 0.3 && t < 0.52 && Math.abs(u) < 0.55 ? mid : u < -0.45 ? mat(shirt).l : u > 0.5 ? mat(shirt).d : shirt);
    const hw = BUILD.civ.hw;
    let p;
    if (sub === 'seated') p = { py: 4.6, lean: 0.05, hr: [0.3, -3.3, 1.8], hl: [-0.3, -3.3, 1.8], fr: [hw + 0.3, 0, 4.2], fl: [-hw - 0.3, 0, 4.2], kpR: [0, 1, 0.8], kpL: [0, 1, 0.8] };
    else if (sub === 'standing') p = f === 0 ? { py: 8.4, hr: [-0.8, -3.2, 3.2], hl: [0.8, -3.2, 3.2], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] } : { py: 8.4, hr: [-2.6, -3.0, 3.4], hl: [2.6, -3.0, 3.4], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] };
    else p = f === 0 ? { py: 8.7, hr: [2.2, 5.4, 0.4], hl: [-2.0, 4.2, 0.6], fr: [hw + 0.5, 0, 0], fl: [-hw - 0.5, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] } : { py: 8.2, hr: [1.8, 4.2, 0.6], hl: [-2.2, 5.4, 0.4], fr: [hw + 0.5, 0, 0], fl: [-hw - 0.5, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] };
    return composeHuman(BUILD.civ, S, p, dir, dim[0], dim[1], dim[2], 6);
  }
  // Roux: the tiger mascot (upright, purple jersey #1, orange fur with black stripes); 3 frames: idle, wave, pounce
  const ROUX_CW = 24, ROUX_CH = 32, ROUX_GY = 29;
  function composeRoux(v, dir, f) {
    const fur = '#E07020', S = civStyle({ jersey: PAL.purple, pants: fur, sock: fur, shoe: '#2A2A30', skin: fur, glove: fur, noGlove: false });
    S.head = 'tiger'; S.fur = mat(fur); S.digits = '1'; S.numCol = PAL.gold;
    const stripe = (base) => (t, u) => ((t > 0.38 && t < 0.52) || (t > 0.78 && t < 0.9) ? '#1B1B1B' : u < -0.4 ? mat(base).l : u > 0.45 ? mat(base).d : base);
    S.legFn = () => stripe(fur); S.armFn = () => stripe(fur);
    S.sleeveFn = (t, u) => (u < -0.4 ? mat(PAL.purple).l : u > 0.45 ? mat(PAL.purple).d : PAL.purple);
    S.jerseyFn = (t, u) => (u < -0.45 ? mat(PAL.purple).l : u > 0.5 ? mat(PAL.purple).d : t > 0.82 ? PAL.gold : PAL.purple);
    S.extras = (c) => {
      const W = c.W, p = c.p, py = p.py === undefined ? BUILD.roux.hipY : p.py, pz = p.pz || 0;
      const tail = (t) => (t > 0.8 ? '#1B1B1B' : t > 0.45 && t < 0.58 ? '#1B1B1B' : fur);
      cap(c.R, W([0, py + 0.2, pz - 1.4]), W([0, py + 1.2, pz - 4.4]), 1.0, 0.9, tail, 6);
      cap(c.R, W([0, py + 1.2, pz - 4.4]), W([0.5, py + 4.6, pz - 5.2]), 0.9, 0.8, tail, 6);
      for (let s = -1; s <= 1; s += 2) { orb(c.R, c.hp(0.78 * s, 0.86, -0.12), c.hr * 0.36, orbMat(mat(fur)), 6); orb(c.R, c.hp(0.78 * s, 0.86, 0.04), c.hr * 0.2, () => '#F4A6C0', 6); }
    };
    const hw = BUILD.roux.hw;
    const P3 = [
      { py: 8.6, hr: [1.4, -5.6, 0.8], hl: [-1.4, -5.6, 0.8], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] },
      { py: 8.2, tw: -0.1, hr: [2.8, 4.2, 1.0], hl: [-0.6, -3.2, 1.6], fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0], epR: [1, 0, -0.3] },
      { py: 7.4, pz: 1.0, lean: 0.5, tilt: 0.2, hr: [-0.8, 0.8, 5.6], hl: [0.8, 0.8, 5.6], fr: [hw + 0.4, 1.8, -3.2], fl: [-hw - 0.4, 0, 1.6], epR: [1, -0.2, 0], epL: [-1, -0.2, 0] }
    ];
    return composeHuman(BUILD.roux, S, P3[f], dir, ROUX_CW, ROUX_CH, ROUX_GY, 12);
  }
  const dimOf = (cw, ch, gy) => () => ({ cw: cw, ch: ch, gy: gy });
  FB_PAINTERS.fbref = fbFamily('fbref', { dim: dimOf(FBL.cw, FBL.ch, FBL.gy), def: 'stand', nOf: () => 2, cell: (sub, v, dir, f) => composeRef(v, dir, f) });
  FB_PAINTERS.fbcrew = fbFamily('fbcrew', { dim: dimOf(FBL.cw, FBL.ch, FBL.gy), def: 'stand', nOf: () => 1, cell: (sub, v, dir, f) => composeCrew(v, dir, f) });
  FB_PAINTERS.fbcheer = fbFamily('fbcheer', { dim: dimOf(CHEER_CW, CHEER_CH, CHEER_GY), def: 'cheer', nOf: () => 4, cell: (sub, v, dir, f) => composeCheer(v, dir, f) });
  FB_PAINTERS.fbband = fbFamily('fbband', { dim: dimOf(BAND_CW, BAND_CH, BAND_GY), def: 'march', nOf: () => 2, cell: (sub, v, dir, f) => composeBand(v, dir, f) });
  FB_PAINTERS.fbstaff = fbFamily('fbstaff', { dim: dimOf(FBL.cw, FBL.ch, FBL.gy), def: 'stand', nOf: () => 2, cell: (sub, v, dir, f) => composeStaff(v, dir, f) });
  FB_PAINTERS.fbroux = fbFamily('fbroux', { dim: dimOf(ROUX_CW, ROUX_CH, ROUX_GY), def: 'idle', nOf: () => 3, cell: (sub, v, dir, f) => composeRoux(v, dir, f) });
  FB_PAINTERS.fbfan = fbFamily('fbfan', { dim: (sub) => { const d = FAN_DIM[sub] || FAN_DIM.standing; return { cw: d[0], ch: d[1], gy: d[2] }; }, def: 'standing', nOf: (sub) => ({ seated: 1, standing: 2, wave: 2 }[sub] || 0), cell: (sub, v, dir, f) => composeFan(sub, v, dir, f) });
  // --- static sprites: the football (4 spin frames × 8 axis angles), the down marker, the line-to-gain stick ----------
  // fbball: variant = the ball's axis angle on screen, k × 22.5° up from horizontal (0–7); frames 0–3 = the spin (laces up, front, hidden, down)
  FB_PAINTERS.fbball = function (ctx, spec) {
    const k = (((spec.variant | 0) % 8) + 8) % 8, f = (((spec.frame | 0) % 4) + 4) % 4;
    spec.frames = 4;
    begin(ctx, 10, 10, spec.zoom);
    const P = pen(ctx, spec.zoom), a = k * FPI / 8, ca = Math.cos(a), sa = Math.sin(a), lp = [-0.95, 0, 9, 0.95][f];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const rx = x + 0.5 - 5, ry = y + 0.5 - 5, u = rx * ca - ry * sa, v = rx * sa + ry * ca;
      if ((u * u) / 10.89 + (v * v) / 3.42 <= 1) {
        let c = v < -0.55 ? '#A86228' : v > 0.7 ? '#5A3016' : '#8A4B1F';
        if (Math.abs(u) > 1.75 && Math.abs(u) < 2.5) c = '#F4F4F4';
        if (Math.abs(u) < 1.35 && Math.abs(v - lp) < 0.55) c = '#F4F4F4';
        P.px(x, y, c);
      } else if ((u * u) / 17.64 + (v * v) / 7.56 <= 1) P.px(x, y, '#2A160A');
    }
    return { w: 10, h: 10, ox: -5, oy: -5 };
  };
  // fbdown: the down marker on its pole; variant = the down 1–4 (3×5 digit on an orange plate); anchor = the base
  FB_PAINTERS.fbdown = function (ctx, spec) {
    const d = Math.max(1, Math.min(4, (spec.variant | 0) || 1));
    spec.frames = 1;
    begin(ctx, 11, 30, spec.zoom);
    const P = pen(ctx, spec.zoom);
    P.rect(2, 28, 7, 1, C.shadow); P.rect(3, 29, 5, 1, C.shadow);
    P.rect(2, 27, 7, 1, '#3A3A42'); P.rect(3, 26, 5, 1, '#5A5A64'); P.rect(5, 11, 1, 15, '#9AA0A8'); P.rect(4, 11, 1, 15, '#C8CCD2');
    P.rect(0, 0, 11, 11, '#4A2208'); P.rect(1, 1, 9, 9, '#F07830'); P.rect(1, 1, 9, 1, '#FFA868'); P.rect(1, 9, 9, 1, '#B8501A');
    P.glyph(String(d), 4, 3, '#FFFFFF');
    return { w: 11, h: 30, ox: -5, oy: -28 };
  };
  FB_PAINTERS.fbstick = function (ctx, spec) {
    spec.frames = 1;
    begin(ctx, 7, 28, spec.zoom);
    const P = pen(ctx, spec.zoom);
    P.rect(1, 26, 5, 1, C.shadow); P.rect(2, 27, 3, 1, C.shadow);
    P.rect(1, 25, 5, 1, '#3A3A42'); P.rect(3, 4, 1, 21, '#E8E8E8'); P.rect(2, 4, 1, 21, '#FFFFFF');
    for (let y = 8; y < 22; y += 4) P.rect(2, y, 2, 2, '#F07830');
    P.rect(1, 0, 5, 4, '#B22222'); P.rect(1, 0, 5, 1, '#E05050'); P.rect(2, 2, 3, 1, '#F4F4F4');
    return { w: 7, h: 28, ox: -3, oy: -26 };
  };
  // --- registration + public helpers ----------------------------------------------------------------------------
  Object.assign(SHEET_PAINTERS, FB_PAINTERS);
  for (const fam of Object.keys(FB_PAINTERS)) M.registerPainter(fam, FB_PAINTERS[fam]);
  const FB_FRAMES = { fbplayer: POSES.stance * 8, fbref: 16, 'fbref:signal': 16, fbcrew: 8, fbcheer: 32, fbband: 16, fbstaff: 16, fbroux: 24, fbball: 4, fbdown: 1, fbstick: 1, fbfan: 16, 'fbfan:standing': 16, 'fbfan:seated': 8, 'fbfan:wave': 16 };
  for (const pose of Object.keys(POSES)) FB_FRAMES['fbplayer:' + pose] = POSES[pose] * 8;
  const FB_SIZES = { fbplayer: [FBL.cw, FBL.ch], fbref: [FBL.cw, FBL.ch], fbcrew: [FBL.cw, FBL.ch], fbcheer: [CHEER_CW, CHEER_CH], fbband: [BAND_CW, BAND_CH], fbstaff: [FBL.cw, FBL.ch], fbroux: [ROUX_CW, ROUX_CH], fbball: [10, 10], fbdown: [11, 30], fbstick: [7, 28], fbfan: [14, 26], 'fbfan:standing': [14, 26], 'fbfan:wave': [14, 26], 'fbfan:seated': [14, 20] };
  const FB_ANCHOR = { fbball: [-5, -5], fbdown: [-5, -28], fbstick: [-3, -26] };   // everything else: (−cw/2, −gy), the feet
  const FB_GY = { fbplayer: FBL.gy, fbref: FBL.gy, fbcrew: FBL.gy, fbcheer: CHEER_GY, fbband: BAND_GY, fbstaff: FBL.gy, fbroux: ROUX_GY, fbfan: 22, 'fbfan:standing': 22, 'fbfan:wave': 22, 'fbfan:seated': 17 };
  for (const id of Object.keys(FB_FRAMES)) M.setFrames(id, FB_FRAMES[id]);
  M.fbFrames = Object.freeze(Object.assign({}, FB_FRAMES));
  M.fbSizes = Object.freeze(Object.assign({}, FB_SIZES));
  M.fbPoses = Object.freeze(Object.assign({}, POSES));
  M.fbRoles = Object.freeze(ROLES.slice());
  M.fbCompose = { player: composePlayer, ref: composeRef, crew: composeCrew, cheer: composeCheer, band: composeBand, staff: composeStaff, roux: composeRoux, fan: composeFan };
  /** frame index for a directional football id: dir (0–7, see fbDir) * framesPerDir + (f mod framesPerDir); `id` may be a pose name ('run') or a full id ('fbcheer') */
  M.fbFrame = function (id, dir, f) {
    const full = POSES[id] ? 'fbplayer:' + id : id, tot = FB_FRAMES[full] || FB_FRAMES[String(full).split(':')[0]] || 8, n = Math.max(1, tot / 8);
    dir = Number.isFinite(dir) ? (((dir | 0) % 8) + 8) % 8 : 1; f = Number.isFinite(f) ? (f | 0) : 0;
    return dir * n + (((f % n) + n) % n);
  };
  /** the sprite id of a player pose (unknown → stance) */
  M.fbId = function (pose) { return POSES[pose] ? 'fbplayer:' + pose : 'fbplayer:stance'; };
  /** the foot anchor of a football id at 1× as [ox, oy] (add to the feet position; multiply by the zoom for the atlas entry) */
  M.fbAnchor = function (id) { if (FB_ANCHOR[id]) return FB_ANCHOR[id].slice(); const s = M.fbSize(id), gy = FB_GY[id] || FB_GY[String(id).split(':')[0]] || FBL.gy; return [-(s[0] >> 1), -gy]; };
  /** drop every football sheet and the compose cache (call after the game; gcSheets also reclaims them by age) */
  M.clearFootball = function () {
    let n = 0;
    for (const [k, s] of Array.from(sheets.entries())) if (k.slice(0, 2) === 'fb') { sheets.delete(k); n++; try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } }
    bufCache.clear();
    for (const fam of Object.keys(FB_PAINTERS)) M.registerPainter(fam, FB_PAINTERS[fam]);
    return n;
  };
  /** the 1× cell size of a football id as [w, h] */
  M.fbSize = function (id) { const s = FB_SIZES[id] || FB_SIZES[String(id).split(':')[0]] || [18, 24]; return s.slice(); };
  /** pre-bake a look's stance + run sheets for every facing (all five role groups, or just `role`) at `zoom`; returns the sheets touched. ~10–20 ms per role in Chrome — call it per role to spread the cost at kickoff */
  M.fbWarm = function (look, zoom, role) {
    let n = 0;
    try {
      for (let r = 0; r < 5; r++) {
        if (role !== undefined && role !== null && (typeof role === 'string' ? M.fbRole(role) : role | 0) !== r) continue;
        const v = M.fbVariant(look, r);
        for (let d = 0; d < 8; d++) { if (M.get('fbplayer:stance', v, d, zoom)) n++; if (M.get('fbplayer:run', v, d * 6, zoom)) n++; }
      }
    } catch (e) { try { BSU.error('sprites_entities', 'fbWarm', e); } catch (e2) { /* never throw */ } }
    return n;
  };
  M.fbSheetBytes = function () { let b = 0; for (const [k, s] of sheets.entries()) if (k.slice(0, 2) === 'fb') b += s.bytes; return b; };

  /** selfTest block 10 (called from entitiesSelfTest): every football id bakes at both zooms with the documented size/anchor/frame count */
  function fbSelfTest(check) {
    const pix = (b) => b.d.filter((c) => c).length;
    for (const id of Object.keys(FB_FRAMES)) {
      check(M.frames(id) === FB_FRAMES[id], 'frames(' + id + ') = ' + FB_FRAMES[id] + ' (got ' + M.frames(id) + ')');
      const sz = M.fbSize(id), an = M.fbAnchor(id);
      for (const z of [1, 2]) {
        for (const f of [0, FB_FRAMES[id] - 1]) {
          const e = M.get(id, 0, f, z);
          check(e && e.sw === sz[0] * z && e.sh === sz[1] * z && e.ox === an[0] * z && e.oy === an[1] * z, id + ' f' + f + ' @' + z + '× is ' + sz.join('×') + ' with anchor ' + an.join(','));
        }
      }
    }
    check(M.get('fbplayer:run', 0, 36, 1).canvas === M.get('fbplayer:run', 0, 41, 1).canvas && M.get('fbplayer:run', 0, 36, 1).canvas !== M.get('fbplayer:run', 0, 6, 1).canvas, 'run frames of one facing share a sheet (one lazy sheet per direction)');
    check(M.get('fbplayer:run', 0, 48, 1) === M.get('fbplayer:run', 0, 0, 1), 'player frame indices wrap');
    // directions
    check(M.fbDir(1, 0) === 0 && M.fbDir(1, 1) === 1 && M.fbDir(0, 1) === 2 && M.fbDir(-1, 1) === 3 && M.fbDir(-1, 0) === 4 && M.fbDir(-1, -1) === 5 && M.fbDir(0, -1) === 6 && M.fbDir(1, -1) === 7 && M.fbDir(0, 0) === 1 && M.fbDir(NaN, 1) === 1, 'fbDir octants');
    check(M.fbFrame('run', 3, 7) === 3 * 6 + 1 && M.fbFrame('fbcheer', 7, 5) === 7 * 4 + 1 && M.fbFrame('stance', -1, 9) === 7 && M.fbFrame('nope', NaN, NaN) === 1, 'fbFrame packing');
    // looks / roles / variants
    const opp = oppKeys();
    check(M.fbLook('home') === 0 && M.fbLook(null) === 0 && M.fbLook('scrim') === FB_SCRIM && (!opp.length || M.fbLook(opp[0]) === 1) && (opp.length < 3 || M.fbLook(opp[2]) === 3), 'fbLook resolution');
    const odd = M.fbLook('no-such-school'); check(odd >= 40 && odd < 62 && M.fbLook('no-such-school') === odd && M.fbLook({ colors: ['#123456', '#FEDCBA'] }) >= 40, 'unknown opponents get a stable dynamic look');
    check(M.fbRole('QB') === 2 && M.fbRole('K') === 3 && M.fbRole('OL') === 0 && M.fbRole('LB') === 4 && M.fbRole('WR') === 1 && M.fbRole('LT') === 0 && M.fbRole('nope') === 1, 'fbRole mapping');
    check(M.fbVariant('home', 'QB', 12, true) === (0 | (2 << 6) | (12 << 9) | (1 << 16)) && M.fbVariant(1, 0, 0, false) === 1, 'fbVariant packing');
    // compose: deterministic, directional, role/pose/look sensitive
    const cp = M.fbCompose.player, v0 = M.fbVariant(0, 'WR'), vQ = M.fbVariant(0, 'QB'), vL = M.fbVariant(0, 'OL');
    check(bequal(cp('stance', v0, 1, 0), cp('stance', v0, 1, 0)), 'player compose deterministic');
    const dirs = []; for (let d = 0; d < 8; d++) dirs.push(cp('stance', v0, d, 0));
    let same = 0; for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if (bequal(dirs[i], dirs[j])) same++;
    check(same === 0, '8 facing directions are 8 distinct images');
    const runs = []; for (let f = 0; f < 6; f++) runs.push(cp('run', v0, 7, f));
    let rs = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (bequal(runs[i], runs[j])) rs++;
    check(rs === 0, 'run cycle: 6 distinct frames');
    for (const pose of Object.keys(POSES)) for (let f = 0; f < POSES[pose]; f++) check(pix(cp(pose, v0, 1, f)) > 60, pose + ' f' + f + ' draws a figure');
    check(!bequal(cp('throw', v0, 1, 0), cp('throw', v0, 1, 1)) && !bequal(cp('stance', v0, 1, 0), cp('run', v0, 1, 0)) && !bequal(cp('celebrate', v0, 1, 0), cp('celebrate', v0, 1, 1)), 'poses and frames differ');
    check(pix(cp('stance', vL, 1, 0)) > pix(cp('stance', v0, 1, 0)) && !bequal(cp('stance', vQ, 1, 0), cp('stance', v0, 1, 0)), 'role groups differ (line bulkier than skill; QB is its own build)');
    const colors = (b) => new Set(b.d.filter((c) => c));
    const homeC = colors(cp('stance', v0, 1, 0)), awayC = colors(cp('stance', M.fbVariant(1, 'WR'), 1, 0));
    check(homeC.has(mat(PAL.purple).c) && homeC.has(PAL.gold) && !awayC.has(PAL.gold), 'home look is purple and gold; an away look is not');
    if (opp.length) check(awayC.has(mat(lookDef(1).jersey).c), 'away jersey colour comes from data.opponents[id].colors[0]');
    // numbers: the QB number shows on the chest and the back, hidden from the side
    const numPix = (v, d) => { const a = cp('stance', v, d, 0), b = cp('stance', v, d, 0, true); let n = 0; for (let i = 0; i < a.d.length; i++) if (a.d[i] !== b.d[i]) n++; return n; };
    check(numPix(vQ, 1) >= 6 && numPix(vQ, 5) >= 6 && numPix(vQ, 7) === 0 && numPix(vQ, 3) === 0, 'jersey number visible front and back, hidden from the side');
    check(bequal(cp('stance', M.fbVariant(0, 'QB', 7), 5, 0), cp('stance', M.fbVariant(0, 'QB', 7), 5, 0)) && !bequal(cp('stance', M.fbVariant(0, 'QB', 7), 5, 0), cp('stance', M.fbVariant(0, 'QB', 12), 5, 0)), 'an explicit number changes the sprite');
    // ball / ref / sideline
    check(M.get('fbball', 3, 0, 1) && M.get('fbball', 3, 1, 1) && M.get('fbball', 3, 0, 1) !== M.get('fbball', 3, 1, 1), 'ball spin frames are separate entries');
    check(M.get('fbdown', 4, 0, 1) && M.get('fbdown', 99, 0, 1) && M.get('fbdown', 0, 0, 1), 'down marker clamps its digit');
    check(!bequal(M.fbCompose.ref(0, 1, 0), M.fbCompose.ref(0, 1, 1)), 'referee: stand and signal differ');
    for (let f = 1; f < 4; f++) check(!bequal(M.fbCompose.cheer(0, 1, 0), M.fbCompose.cheer(0, 1, f)), 'cheer frame ' + f + ' differs from 0');
    check(!bequal(M.fbCompose.band(0, 1, 0), M.fbCompose.band(1, 1, 0)) && !bequal(M.fbCompose.band(1, 1, 0), M.fbCompose.band(2, 1, 0)) && !bequal(M.fbCompose.band(0, 1, 0), M.fbCompose.band(0, 1, 1)), 'band: 3 instruments × 2 frames differ');
    check(!bequal(M.fbCompose.roux(0, 1, 0), M.fbCompose.roux(0, 1, 2)) && !bequal(M.fbCompose.staff(0, 1, 0), M.fbCompose.staff(1, 1, 0)), 'Roux pounce / staff kinds differ');
    check(!bequal(M.fbCompose.fan('seated', 0, 1, 0), M.fbCompose.fan('standing', 0, 1, 0)) && !bequal(M.fbCompose.fan('wave', 0, 1, 0), M.fbCompose.fan('wave', 0, 1, 1)) && !bequal(M.fbCompose.fan('standing', 0, 1, 0), M.fbCompose.fan('standing', 1, 1, 0)), 'fans: seated / standing / wave, home vs opponent colours');
    check(M.fbSheetBytes() > 0 && M.fbSheetBytes() < M.SHEET_LIMIT_MB * 1048576, 'football sheets stay within the sheet budget (' + (M.fbSheetBytes() / 1048576).toFixed(2) + ' MB)');
  }
  // @@FB-END
  // @@B4-BEGIN
  // ---------------------------------------------------------------------------
  // ART PASS B4 — characters (docs/ART_STYLE.md, INTEGRATION_NOTES '## art pass B4').
  // Students, the Wildlife Officer, the Bayou Brass and the krewe are drawn by the football skeleton rig above (joints → two-bone
  // IK → yaw → projection → depth buffer), re-skinned with 5-tone ramps (BSU.sprites.makeRamp: deep, shadow, base, light, highlight;
  // upper-left key light through a 4×4 Bayer dither), a ramp-aware 1-px outline (the neighbour's tone 0 on the shadow side and the
  // bottom, tone 1 on the lit side) and a per-look style. 8 real facings, one lazily baked sheet per (anim, look, facing, zoom)
  // (frame = facing × n + f, facing = the football fbDir octant: 0 SE (+tx), 1 S, 2 SW (+ty), 3 W, 4 NW (−tx), 5 N, 6 NE (−ty), 7 E),
  // so a game only pays for the facings it shows; a bake budget swaps a not-yet-baked sheet for the default student's for a few
  // frames instead of hitching (render arms it through agentFrame's agent argument).
  // ---------------------------------------------------------------------------
  const SA = {            // anim → frames per facing, cell class (a 14×24, b 16×28 arms-up, u 18×30 umbrella), water line (rows above the feet)
    walk: { n: 8, c: 'a' }, idle: { n: 3, c: 'a' }, flee: { n: 4, c: 'b' }, splash: { n: 6, c: 'a', water: 4 }, slap: { n: 2, c: 'a' }, cheer: { n: 2, c: 'b' },
    sit: { n: 2, c: 'a' }, wave: { n: 2, c: 'b' }, tube: { n: 4, c: 'a', water: 1 }, umbrella: { n: 4, c: 'u' }, cap: { n: 8, c: 'b' }, beads: { n: 8, c: 'a' },
    foam: { n: 8, c: 'b' }, selfie: { n: 2, c: 'a' }, binoculars: { n: 2, c: 'a' }
  };
  const SC = { a: { cw: 14, ch: 24, gy: 22 }, b: { cw: 16, ch: 28, gy: 26 }, u: { cw: 18, ch: 30, gy: 28 } };
  const SANIMS = Object.keys(SA);
  const FACINGS = 8;

  // --- ramps, tone selection ---------------------------------------------------------------------------------------------------
  const R5 = new Map();
  /** 5-tone ramp of a base hex (cached): 0 deep, 1 shadow, 2 base, 3 light, 4 highlight */
  const ramp5 = (hx) => { let r = R5.get(hx); if (!r) { r = M.makeRamp(hx); R5.set(hx, r); } return r; };
  const TH5 = [0.07, 0.24, 0.52, 0.8];
  /** u (−1 lit left … +1 shadow right) on a limb or torso cross-section → ramp index, Bayer-dithered */
  const tone5 = (u, x, y) => M.toneAt(0.5 - u * 0.5, x, y, TH5, 0.1);
  /** lambert-ish tone for a sphere normal (dx right, ny up, nz toward the viewer): light from the upper left */
  const sph5 = (dx, ny, nz, x, y) => M.toneAt(0.5 + 0.5 * (-dx * 0.62 + ny * 0.5 + nz * 0.3), x, y, TH5, 0.09);
  const limb = (r) => (t, u, x, y) => r[tone5(u, x, y)];
  const ball = (r) => (dx, ny, nz, x, y) => r[sph5(dx, ny, nz, x, y)];

  // --- the looks ---------------------------------------------------------------------------------------------------------------
  // look = skin 0–5 | hair colour 0–7 << 3 | outfit family 0–2 << 6 (0 purple top, 1 gold, 2 other) | glasses << 8 | outfit 0–15 << 9
  //        | hair style 0–5 << 13 | carry 0–6 << 16 | hat 0–3 << 19 | build 0–2 << 21 | accent colour 0–7 << 23.
  // The low 9 bits keep the pass-A meaning (lookColors, saved games); a look < 512 gets the other fields from its own hash.
  const SKIN6 = (X.skins || ['#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3A1E', '#FFDBAC']).slice(0, 6);
  const HAIR8 = ['#1B1B1B', '#3A2A1E', '#6B4423', '#B0723C', '#E6C27A', '#C7692B', '#5E2CA5', '#EDE3CE'];
  const ACC8 = ['#2A2A33', PAL.purple, PAL.gold, '#7C828C', '#3B4F86', '#B8A27A', '#2E7D7A', '#D96B52'];
  const P1 = PAL.purple, P2 = PAL.purple2, GD = PAL.gold, DEN = '#3B5BA0', KHK = '#B8A27A', WHT = '#EDEDED', BLK = '#23232B';
  const OUTFITS = [
    { top: P2, kind: 'tee', bot: DEN, bk: 'long', shoe: WHT },                                       // 0 purple tee, jeans, white sneakers
    { top: GD, kind: 'tee', bot: '#2B3350', bk: 'long', shoe: BLK },                                  // 1 gold tee, dark jeans
    { top: P2, kind: 'tee', bot: KHK, bk: 'shorts', shoe: WHT, pat: 'stripeG' },                      // 2 purple tee with a gold stripe, khaki shorts
    { top: GD, kind: 'hood', bot: '#5A5F6A', bk: 'long', shoe: WHT },                                 // 3 gold hoodie, grey joggers
    { top: P1, kind: 'hood', bot: BLK, bk: 'long', shoe: GD, fixed: true },                                        // 4 purple hoodie, black jeans, gold sneakers
    { top: WHT, kind: 'tee', bot: P1, bk: 'shorts', shoe: BLK, fixed: true },                                      // 5 white tee, purple shorts
    { top: '#8A909A', kind: 'tee', bot: DEN, bk: 'long', shoe: P2, pat: 'logoP' },                    // 6 grey tee with a purple logo
    { top: '#4A6FB0', kind: 'jacket', bot: KHK, bk: 'long', shoe: '#6B4A2E', pat: 'block', fixed: true },          // 7 denim jacket over a purple tee
    { top: BLK, kind: 'tee', bot: '#3B4550', bk: 'long', shoe: WHT, pat: 'logoG' },                   // 8 black tee with a gold logo
    { top: '#2E7D7A', kind: 'tee', bot: KHK, bk: 'long', shoe: WHT },                                 // 9 teal tee
    { top: '#D96B52', kind: 'tee', bot: WHT, bk: 'shorts', shoe: KHK, fixed: true },                               // 10 coral tee, white shorts
    { top: WHT, kind: 'polo', bot: KHK, bk: 'long', shoe: '#6B4A2E', pat: 'hoopsP', fixed: true },                 // 11 purple-striped polo
    { top: GD, kind: 'tee', bot: P1, bk: 'shorts', shoe: WHT, fixed: true },                                       // 12 gold tee, purple shorts
    { top: P1, kind: 'polo', bot: KHK, bk: 'long', shoe: BLK },                                       // 13 purple polo
    { top: '#2A2A33', kind: 'hood', bot: DEN, bk: 'long', shoe: BLK, pat: 'logoG' },                  // 14 black hoodie with a gold logo
    { top: '#6FA8DC', kind: 'tee', bot: DEN, bk: 'long', shoe: WHT }                                  // 15 sky tee
  ];
  const OUTFIT_BY_FAM = [[0, 2, 4, 13], [1, 3, 12], [5, 6, 7, 8, 9, 10, 11, 14, 15]], FAM_OUTFIT_W = [[4, 2, 2, 2], [3, 2, 2], [3, 2, 1, 2, 1, 1, 2, 2, 1]];
  const LOOK_POOL = 112;
  function pickW(w, r) { let s = 0; for (let i = 0; i < w.length; i++) s += w[i]; let k = r % s; for (let i = 0; i < w.length; i++) { if (k < w[i]) return i; k -= w[i]; } return 0; }
  const packLook = (F) => (F.skin | (F.hairC << 3) | (F.fam << 6) | (F.glasses << 8) | (F.outfit << 9) | (F.style << 13) | (F.carry << 16) | (F.hat << 19) | (F.build << 21) | (F.acc << 23)) >>> 0;
  function makeLook(seed, fam, outfit) {
    const r = (k) => hash(seed, 0x40 + k);
    return packLook({
      skin: r(2) % 6, hairC: pickW([22, 22, 16, 10, 10, 8, 5, 7], r(3)), fam: fam, glasses: (r(4) % 100) < 12 ? 1 : 0, outfit: outfit, style: r(5) % 6,
      carry: pickW([34, 8, 14, 9, 6, 12, 17], r(6)), hat: pickW([72, 14, 6, 8], r(7)), build: pickW([25, 50, 25], r(8)), acc: r(9) % 8
    });
  }
  let LOOKS = null;
  /** the packed look of an agent seed: one of LOOK_POOL stable looks (bounds the number of baked sheets); the pool is stratified 55 / 25 / 20 purple / gold / other tops (GDD §7) */
  M.agentLook = function (seed) {
    seed = Number.isFinite(seed) ? (seed | 0) : 0;
    if (!LOOKS) {
      const fams = []; for (let i = 0; i < LOOK_POOL; i++) fams.push(i < 62 ? 0 : i < 90 ? 1 : 2);
      for (let i = fams.length - 1; i > 0; i--) { const j = hash(i, 0x5eed) % (i + 1), t = fams[i]; fams[i] = fams[j]; fams[j] = t; }
      // outfits are dealt out of a weighted deck per family, so every outfit appears in the pool
      const decks = OUTFIT_BY_FAM.map((list, f) => { const d = []; list.forEach((o, k) => { for (let n = 0; n < FAM_OUTFIT_W[f][k]; n++) d.push(o); }); for (let i = d.length - 1; i > 0; i--) { const j = hash(i + 100 * f, 0xdec) % (i + 1), t = d[i]; d[i] = d[j]; d[j] = t; } return d; }), used = [0, 0, 0];
      LOOKS = fams.map((f, i) => makeLook(i * 31 + 7, f, decks[f][used[f]++ % decks[f].length]));
    }
    return LOOKS[hash(seed, 1) % LOOK_POOL];
  };
  const fieldCache = new Map();
  function fieldsOf(look) {
    look = Number.isFinite(look) ? (look >>> 0) : 0;
    let F = fieldCache.get(look); if (F) return F;
    if (look < 512) {   // a pass-A look (a saved game): keep skin / hair colour / family, derive the rest from the look itself
      const r = (k) => hash(look + 1, 0x90 + k), fam = Math.min(2, (look >> 6) & 3), list = OUTFIT_BY_FAM[fam];
      F = { skin: Math.min(5, look & 7), hairC: (look >> 3) & 7, fam: fam, glasses: (r(1) % 100) < 12 ? 1 : 0, outfit: list[r(2) % list.length], style: r(3) % 6, carry: pickW([34, 8, 14, 9, 6, 12, 17], r(4)), hat: pickW([72, 14, 6, 8], r(5)), build: pickW([25, 50, 25], r(6)), acc: r(7) % 8 };
    } else F = { skin: Math.min(5, look & 7), hairC: (look >> 3) & 7, fam: (look >> 6) & 3, glasses: (look >> 8) & 1, outfit: (look >> 9) & 15, style: Math.min(5, (look >> 13) & 7), carry: Math.min(6, (look >> 16) & 7), hat: (look >> 19) & 3, build: Math.min(2, (look >> 21) & 3), acc: (look >> 23) & 7 };
    fieldCache.set(look, F); if (fieldCache.size > 4096) fieldCache.clear();
    return F;
  }
  M.lookFields = fieldsOf; M.lookPack = function (o) { return packLook(Object.assign({ skin: 1, hairC: 1, fam: 0, glasses: 0, outfit: 0, style: 0, carry: 6, hat: 0, build: 1, acc: 0 }, o || {})); };
  M.lookColors = function (look) { const F = fieldsOf(look); return { skin: SKIN6[F.skin], hair: HAIR8[F.hairC], shirt: OUTFITS[F.outfit].top }; };

  // --- builds ------------------------------------------------------------------------------------------------------------------
  const SB = [
    { hipY: 7.4, torso: 5.6, hw: 1.6, sw: 2.8, sd: 1.8, legR: 1.1, armR: 0.95, headR: 3.3, pad: 0, upper: 3.0, fore: 2.8 },     // slim
    { hipY: 7.8, torso: 5.9, hw: 1.8, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 3.45, pad: 0, upper: 3.1, fore: 2.9 },    // regular
    { hipY: 8.2, torso: 6.2, hw: 2.0, sw: 3.4, sd: 2.1, legR: 1.25, armR: 1.1, headR: 3.6, pad: 0, upper: 3.2, fore: 3.0 }     // broad
  ];

  // --- the per-look style: materials, hair, hat, props ---------------------------------------------------------------------------
  const styleCache = new Map();
  function stuStyle(look) {
    let S = styleCache.get(look); if (S) return S;
    const F = fieldsOf(look); S = buildStyle(F, OUTFITS[F.outfit]);
    styleCache.set(look, S); if (styleCache.size > 400) styleCache.clear();
    return S;
  }
  const PURPLES = [P2, P1, '#6B3FB5', P2], GOLDS = [GD, PAL.gold2, GD, '#FFD84A'];
  const LONGS = [DEN, '#2B3350', BLK, KHK, '#5A5F6A', '#4A5A3A', '#6F7F99', DEN], SHORTS = [KHK, '#2B3350', BLK, P1, '#5A5F6A', WHT, DEN, '#4A5A3A'], SHOES = [WHT, BLK, GD, '#8A909A', '#6B4A2E', '#D96B52', WHT, P2];
  /** per-look colour variation of an outfit: a purple / gold shade, the bottoms and the shoes (outfits flagged `fixed` keep their own) */
  function varyOutfit(F, O) {
    if (O.fixed) return O;
    const h = (k) => hash(F.skin * 977 + F.hairC * 131 + F.acc * 29 + F.build * 7 + F.style, 0x300 + k), o = Object.assign({}, O);
    if (O.top === P1 || O.top === P2) o.top = PURPLES[h(1) & 3]; else if (O.top === GD) o.top = GOLDS[h(1) & 3];
    if (O.bot === DEN || O.bot === KHK || O.bot === '#2B3350' || O.bot === BLK || O.bot === '#5A5F6A') o.bot = (O.bk === 'shorts' ? SHORTS : LONGS)[h(2) & 7];
    if (O.shoe === WHT || O.shoe === BLK) o.shoe = SHOES[h(3) & 7];
    return o;
  }
  function buildStyle(F, O0) {
    let S;
    const O = varyOutfit(F, O0);
    const skinR = ramp5(SKIN6[F.skin]), hairR = ramp5(HAIR8[F.hairC]), topR = ramp5(O.top), botR = ramp5(O.bot), shoeR = ramp5(O.shoe), accR = ramp5(ACC8[F.acc]);
    const goldR = ramp5(GD), purpR = ramp5(P1), purp2R = ramp5(P2);
    const hood = O.kind === 'hood', longSleeve = hood || O.kind === 'jacket';
    S = { F: F, O: O, skinR: skinR, hairR: hairR, topR: topR, botR: botR, shoeR: shoeR, accR: accR, B: SB[F.build], longSleeve: longSleeve,
      skin: limb(skinR), hair: limb(hairR), top: limb(topR), bot: limb(botR), shoe: limb(shoeR), acc: limb(accR), gold: limb(goldR), purp: limb(purpR),
      packR: F.carry === 0 || F.carry === 1 ? accR : null };
    S.ramps = [skinR, hairR, topR, botR, shoeR, accR, goldR, purpR, purp2R];
    // the torso: t 0 hem … 1 neck, u −1 lit … +1 shadow, fz > 0 facing the viewer
    S.torso = function (t, u, x, y, fz) {
      const k = tone5(u, x, y), front = fz > 0.18, back = fz < -0.18;
      let c = topR[k];
      switch (O.pat) {
        case 'stripeG': if (t > 0.4 && t < 0.56) c = goldR[k]; break;
        case 'hoopsP': if (((t * 11) | 0) & 1) c = purpR[k]; break;
        case 'block': if (front && Math.abs(u) < 0.3 && t < 0.93) c = purp2R[k]; break;
        case 'logoP': if (front && u < -0.05 && u > -0.5 && t > 0.62 && t < 0.8) c = purpR[k]; break;
        case 'logoG': if (front && u < -0.05 && u > -0.5 && t > 0.62 && t < 0.8) c = goldR[k]; break;
        case 'badge': if (front && u < -0.1 && u > -0.45 && t > 0.66 && t < 0.78) c = goldR[k]; break;
        case 'stole': if (front && Math.abs(u) > 0.2 && Math.abs(u) < 0.42 && t > 0.3) c = goldR[k]; break;
        case 'sash': if (Math.abs((0.5 - u * 0.5) - (1 - t) * 1.0) < 0.13) c = goldR[k]; break;
      }
      if (O.belt && t > 0.07 && t < 0.16) c = ramp5(O.belt)[k];
      if (O.kind === 'polo') { if (t > 0.88) c = topR[Math.min(4, k + 1)]; else if (front && Math.abs(u) < 0.14 && t > 0.6) c = topR[Math.max(0, k - 1)]; }
      if (hood) { if (front && t < 0.34 && Math.abs(u) < 0.58 && t > 0.08) c = topR[Math.max(0, k - 1)]; if (front && t > 0.6 && (Math.abs(u) > 0.2 && Math.abs(u) < 0.34)) c = topR[4]; }
      if (t > 0.9 && front && Math.abs(u) < 0.26 && O.kind !== 'polo' && !hood) c = skinR[Math.max(0, k - (u > 0.1 ? 1 : 0))];       // the neckline
      if (front && S.packR && Math.abs(u) > 0.46 && Math.abs(u) < 0.64 && t > 0.18) c = S.packR[1];                                      // backpack straps
      if (S.toteStrap && front && u > 0.1 && u < 0.3 && t > 0.1) c = shade(S.toteStrap, 0.9);
      return c;
    };
    S.upper = (t, u, x, y) => topR[tone5(u, x, y)];
    S.fore = longSleeve ? S.upper : S.skin;
    S.leg = S.bot; S.shin = O.bk === 'shorts' ? S.skin : S.bot;
    return S;
  }

  // --- the ramp-aware outline ---------------------------------------------------------------------------------------------------
  const deepCache = new Map();
  function deepMap(S) {
    let m = deepCache.get(S); if (m) return m;
    m = new Map();
    for (const r of S.ramps) for (let i = 0; i < 5; i++) { if (!m.has(r[i])) m.set(r[i], [r[0], r[1]]); }
    deepCache.set(S, m); return m;
  }
  /** every empty pixel 4-adjacent to a filled one takes that neighbour's tone 0 (tone 1 where the empty pixel is above or to the left of it: the lit side) */
  function rampOutline(b, maxY, S, extra) {
    const src = b.d.slice(), w = b.w, dm = deepMap(S); maxY = Math.min(b.h, maxY | 0);
    const pick = (c, lit) => { const e = (extra && extra.get(c)) || dm.get(c); return e ? e[lit ? 1 : 0] : shade(c, lit ? 0.62 : 0.5); };
    for (let y = 0; y < maxY; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (src[i]) continue;
      let c = null, lit = false;
      if (y + 1 < maxY && src[i + w]) { c = src[i + w]; lit = true; }          // the filled pixel is below: the outline is its top edge (lit)
      else if (x + 1 < w && src[i + 1]) { c = src[i + 1]; lit = true; }        // to the right: its left edge (lit)
      else if (y > 0 && src[i - w]) c = src[i - w];                              // above: the bottom edge (shadow)
      else if (x > 0 && src[i - 1]) c = src[i - 1];                              // to the left: the right edge (shadow)
      if (c) b.d[i] = pick(c, lit);
    }
  }

  // --- hair + hats on the head sphere ---------------------------------------------------------------------------------------------
  function hairCover(style, ny, fwd, aLat) {
    switch (style) {
      case 0: return ny > 0.4 || (fwd < 0.12 && ny > 0.02) || (aLat > 0.82 && ny > 0.1);                 // short crop
      case 1: return ny > 0.3 || (fwd < 0.32 && ny > -0.6);                                              // bob
      case 2: return ny > 0.4 || (fwd < 0.12 && ny > 0.0) || (aLat > 0.82 && ny > 0.1);                  // ponytail (the tail is a prop)
      case 3: return ny > 0.36 || (fwd < 0.15 && ny > 0.0) || (aLat > 0.8 && ny > 0.1);                  // bun on top (the bun is a prop)
      case 4: return ny > 0.3 || (fwd < 0.28 && ny > -0.4);                                              // afro (the volume is a prop)
      default: return ny > 0.34 || (fwd < 0.42 && ny > -0.8) || (aLat > 0.68 && ny > -0.8);              // long
    }
  }
  function stuHead(S, c, dx, ny, nz, x, y, mood) {
    const sYh = c.sYh, cYh = c.cYh, fwd = dx * sYh + nz * cYh, lat = -dx * cYh + nz * sYh, aLat = Math.abs(lat), F = S.F;
    const k = sph5(dx, ny, nz, x, y);
    if (S.hatCover) { const hc = S.hatCover(S, ny, fwd, aLat, k); if (hc) return hc; }
    if (F.hat === 3 && (ny > 0.0 || (fwd < 0.2 && ny > -0.25))) return (ny > 0.04 && ny < 0.3 && fwd > -0.3) ? S.accR[Math.min(4, k + 1)] : S.accR[k];   // beanie with a rolled cuff
    if (F.hat === 1 && (ny > 0.14 || (fwd < 0.1 && ny > -0.05))) return S.accR[k];                                                                    // ball cap
    if (F.hat === 2 && ny > 0.3) return S.accR[k];                                                                                                     // bucket-hat crown
    if (F.glasses && fwd > 0.42 && ny > -0.08 && ny < 0.26 && aLat < 0.7) return (aLat > 0.1 && aLat < 0.62 && ny > 0.04 && ny < 0.2) ? '#15151B' : S.shoeR[0] === '#15151B' ? '#15151B' : '#3A3A48';
    if (fwd > 0.5 && ny > -0.1 && ny < 0.22 && aLat > 0.2 && aLat < 0.58) return mood === 'closed' ? S.skinR[0] : S.skinR[0];                          // the eyes
    if (mood === 'open' && fwd > 0.62 && ny > -0.62 && ny < -0.3 && aLat < 0.2) return '#3A1418';                                                       // a shout / scream
    if (hairCover(F.style, ny, fwd, aLat)) return S.hairR[k];
    if (fwd > 0.7 && ny < -0.3 && ny > -0.5 && aLat < 0.2) return S.skinR[Math.max(0, k - 1)];                                                         // the mouth line
    return S.skinR[k];
  }

  // --- poses (the rig's joint targets; see solve()) ---------------------------------------------------------------------------------
  function footPath(u, sg, hx, SL, LIFT) {
    u -= Math.floor(u);
    if (u < 0.5) return [sg * hx, 0, SL - 2 * SL * (u / 0.5)];                                           // stance: the foot slides back under the hips
    const s = (u - 0.5) / 0.5; return [sg * hx, LIFT * Math.sin(Math.PI * s), -SL + 2 * SL * s];            // swing: lifted forward
  }
  /** a walk / run cycle of n frames: the right foot leads at frame 0; arms swing against the legs; the pelvis dips at contact */
  function walkPose(f, B, o) {
    const n = o.n || 8, ph = f / n, SL = o.SL || 2.5, LIFT = o.LIFT || 1.3, AS = o.AS === undefined ? 2.0 : o.AS, hx = B.hw + 0.25;
    const fr = footPath(ph, 1, hx, SL, LIFT), fl = footPath(ph + 0.5, -1, hx, SL, LIFT);
    const bob = 0.5 - 0.5 * Math.cos(4 * Math.PI * ph);
    return { py: B.hipY - (o.dip === undefined ? 0.75 : o.dip) + (o.bob === undefined ? 0.65 : o.bob) * bob, lean: o.lean === undefined ? 0.07 : o.lean, tw: (o.tw === undefined ? 0.11 : o.tw) * Math.sin(2 * Math.PI * ph),
      fr: fr, fl: fl, hr: [0.35, -5.6 + 0.5 * Math.max(0, -fr[2] / SL), -fr[2] / SL * AS], hl: [-0.35, -5.6 + 0.5 * Math.max(0, -fl[2] / SL), -fl[2] / SL * AS], sway: Math.sin(2 * Math.PI * ph + 1) };
  }
  /** what a student holds, as a static arm (the item prop follows the hand) */
  function carryPose(p, F, deep) {
    switch (F.carry) {
      case 1: p.hr = [0.45, -3.5, 2.1]; p.epR = [0.9, -1, -0.2]; break;          // coffee in the right hand
      case 2: p.hl = [-0.45, -3.3, 1.9]; p.epL = [-0.9, -1, -0.2]; break;        // books at the left hip
      case 4: p.hr = [0.15, -2.0, 2.5]; p.epR = [0.9, -0.8, -0.2]; break;        // the po'boy at chest height
      case 5: p.hr = [0.3, -1.5, 2.3]; p.epR = [0.9, -0.6, -0.2]; p.hu = -0.2; p.hf = 0.45; break;   // thumbs on a phone
    }
    return p;
  }
  function stuPose(anim, f, B, F) {
    const hw = B.hw;
    switch (anim) {
      case 'walk': return carryPose(walkPose(f, B, {}), F);
      case 'beads': { const p = walkPose(f, B, { SL: 2.3, LIFT: 1.2 }); return p; }
      case 'umbrella': { const p = walkPose(f, B, { n: 4, AS: 1.6, lean: 0.04 }); p.hr = [1.3, 4.6, 0.9]; p.epR = [1, 0.3, -0.2]; return p; }
      case 'foam': { const p = walkPose(f, B, { AS: 1.8 }); p.hr = [1.2, 4.9, 0.7]; p.epR = [1, 0.2, -0.3]; return p; }
      case 'cap': { const p = walkPose(f, B, { SL: 2.0, LIFT: 1.0, AS: 1.4, dip: 0.5, bob: 0.4 }); p.hu = 0.25; return p; }
      case 'idle': {
        let p;
        if (f === 0) p = { py: B.hipY - 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.45, -5.7, 0.2], hl: [-0.45, -5.7, 0.2] };
        else if (f === 1) p = { py: B.hipY - 0.45, tw: 0.1, fr: [hw + 0.45, 0, 0.9], fl: [-hw - 0.75, 0, -0.6], hr: [0.65, -5.5, 0.7], hl: [-0.5, -5.7, -0.1] };
        else {   // use the item: sip, bite, read, or check the phone
          p = { py: B.hipY - 0.3, lean: 0.1, fr: [hw + 0.55, 0, 0.3], fl: [-hw - 0.55, 0, 0.2], hr: [0.3, -1.7, 2.4], hl: [-0.45, -5.6, 0.3], hu: -0.2, hf: 0.5, epR: [0.9, -0.6, -0.2], usePhone: true };
          if (F.carry === 1) { p.hr = [-0.35, 2.0, 2.3]; p.hu = 0.15; p.hf = 0; p.usePhone = false; }
          else if (F.carry === 4) { p.hr = [-0.25, 1.8, 2.5]; p.hu = 0.1; p.hf = 0.2; p.usePhone = false; }
          else if (F.carry === 2) { p.hr = [0.55, -2.1, 2.3]; p.hl = [-0.55, -2.1, 2.3]; p.hu = -0.3; p.usePhone = false; }
        }
        if (f < 2) carryPose(p, F);
        return p;
      }
      case 'flee': { const p = walkPose(f, B, { n: 4, SL: 3.2, LIFT: 2.3, lean: 0.3, dip: 1.0, bob: 1.1, tw: 0.2 }); p.hr = [1.7, 3.5 + (f & 1) * 1.1, 0.8]; p.hl = [-1.7, 3.5 + ((f + 1) & 1) * 1.1, 0.8]; p.epR = [1, 0.3, -0.2]; p.epL = [-1, 0.3, -0.2]; p.mood = 'open'; return p; }
      case 'splash': { const p = walkPose(f, B, { n: 6, SL: 1.9, LIFT: 2.6, AS: 0.6, dip: 0.6, bob: 0.4, lean: 0.05 }); p.hr = [2.3, -3.1, 1.2 + 0.7 * Math.sin(f)]; p.hl = [-2.3, -3.1, 1.2 - 0.7 * Math.sin(f)]; p.epR = [1, -0.3, 0]; p.epL = [-1, -0.3, 0]; return p; }
      case 'slap': return f === 0 ? { py: hw + 6.7, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [-0.6, 1.4, 1.2], hl: [-0.45, -5.7, 0.2], epR: [1, 0.3, -0.5], hu: -0.1 } : { py: hw + 6.5, tw: 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [-1.3, 0.9, 0.9], hl: [-0.45, -5.7, 0.2], epR: [1, 0.3, -0.5], hu: -0.25, mood: 'closed' };
      case 'cheer': return f === 0 ? { py: B.hipY - 0.6, fr: [hw + 0.8, 0, 0], fl: [-hw - 0.8, 0, 0], hr: [1.9, 5.2, 0.4], hl: [-1.9, 5.2, 0.4], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], mood: 'open' } : { py: B.hipY + 1.0, fr: [hw + 0.5, 1.6, -0.6], fl: [-hw - 0.5, 1.2, 0.4], hr: [1.4, 5.8, 0.4], hl: [-1.4, 5.8, 0.4], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], mood: 'open' };
      case 'wave': return f === 0 ? { py: B.hipY - 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.9, 4.9, 0.5], hl: [-0.45, -5.7, 0.2], epR: [1, 0.2, -0.3] } : { py: B.hipY - 0.2, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.7, 5.3, 0.5], hl: [-0.45, -5.7, 0.2], epR: [1, 0.2, -0.3] };
      case 'sit': { const base = { py: 2.3, lean: 0.12, fr: [hw + 0.5, 0, 3.6], fl: [-hw - 0.5, 0, 3.6], kpR: [0.1, 1, 0.5], kpL: [-0.1, 1, 0.5], hr: [0.5, -2.7, 2.7], hl: [-0.5, -2.7, 2.7], hu: -0.15 }; if (f === 1) { base.hr = [0.9, 0.8, 2.6]; base.epR = [1, 0.4, -0.2]; base.fan = true; base.hu = 0.1; } return base; }
      case 'tube': { const bob = (f & 1) ? 0.5 : 0; return { py: 6.2 + bob, lean: 0.03, fr: [hw + 0.4, 0, 0.4], fl: [-hw - 0.4, 0, -0.4], hr: [2.5, -2.4 + (f > 1 ? 1.2 : 0), 1.4], hl: [-2.5, -2.4 + (f > 1 ? 0 : 1.2), 1.4], epR: [1, -0.3, 0], epL: [-1, -0.3, 0] }; }
      case 'selfie': return f === 0 ? { py: B.hipY - 0.2, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.0, -0.4, 4.6], hl: [-0.45, -5.7, 0.2], epR: [0.6, 0.6, -0.2], hu: 0.1, usePhone: true } : { py: B.hipY - 0.4, tw: 0.1, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.3, 0.4, 4.4], hl: [-0.45, -5.7, 0.2], epR: [0.6, 0.6, -0.2], hu: 0.15, usePhone: true };
      case 'binoculars': return { py: B.hipY - 0.2 - (f & 1) * 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.8, 1.9, 2.3], hl: [-0.8, 1.9, 2.3], epR: [1, 0.5, -0.3], epL: [-1, 0.5, -0.3], hu: 0.1 + (f & 1) * 0.1, binocs: true };
    }
    return walkPose(f, B, {});
  }

  // --- the student renderer ---------------------------------------------------------------------------------------------------------
  const lerp3 = v3lerp;
  function drawStudent(R, B, S, p, yaw, o) {
    const J = solve(B, p), sY = Math.sin(yaw), cY = Math.cos(yaw), sc = J.sc;
    const W = (q) => [-q[0] * cY + q[2] * sY, q[1], q[0] * sY + q[2] * cY];
    const c = { R: R, B: B, S: S, J: J, W: W, p: p, yaw: yaw, sc: sc, o: o || {} }, PJ = c.o.PJ || scr, prevPJ = CURPJ;
    CURPJ = c.o.PJ || null;
    try {
    for (let s = 0; s < 2; s++) {   // legs: thigh, shin, shoe
      const hip = W(J.hip[s]), kn = W(J.kn[s]), an = W(J.an[s]), toe = W(J.toe[s]), lr = B.legR * sc;
      cap(R, hip, kn, lr, lr * 0.95, S.leg, 4);
      cap(R, kn, an, lr * 0.92, lr * 0.8, S.shin, 4);
      cap(R, an, toe, 0.95 * sc, 0.85 * sc, S.shoe, 4);
    }
    const Pw = W(J.P), Nw = W(J.N), latW = W(J.lat), fW = W(J.fT), pk = FBL.pitch, nS = 22, bulk = S.longSleeve ? 1.1 : 1;
    const Ps = PJ(R, Pw), Ns = PJ(R, Nw), ax = Ns[0] - Ps[0], ay = Ns[1] - Ps[1], al2 = ax * ax + ay * ay || 1;
    for (let k = 0; k <= nS; k++) {   // torso: a slab stack, wedge-shaped, lit from the left
      const t = k / nS, ctr = lerp3(Pw, Nw, t), sm = clamp01((t - 0.1) / 0.7), sm2 = sm * sm * (3 - 2 * sm);
      const a = (B.hw + 0.8 + (B.sw - B.hw - 0.8) * sm2) * sc * bulk, b = B.sd * (0.9 + 0.2 * sm2) * sc * bulk;
      const hx = Math.max(0.4, a * Math.abs(latW[0]) + b * Math.abs(fW[0])), hv = Math.max(0.3, a * (Math.abs(latW[1]) + Math.abs(latW[2]) * pk) + b * (Math.abs(fW[1]) + Math.abs(fW[2]) * pk));
      const s0 = PJ(R, ctr), dep = ctr[2] + (b * Math.abs(fW[2]) + a * Math.abs(latW[2])) * 0.9;
      for (let y = Math.ceil(s0[1] - hv - 0.5); y <= Math.floor(s0[1] + hv - 0.5); y++)
        for (let x = Math.ceil(s0[0] - hx - 0.5); x <= Math.floor(s0[0] + hx - 0.5); x++) {
          const u = (x + 0.5 - s0[0]) / hx, tt = clamp01(((x + 0.5 - Ps[0]) * ax + (y + 0.5 - Ps[1]) * ay) / al2);
          rput(R, x, y, tt < 0.07 ? S.bot(tt, u, x, y) : S.torso(tt, u, x, y, fW[2]), dep, 1);
        }
    }
    for (let s = 0; s < 2; s++) {   // arms: shoulder cap, sleeve, forearm, hand
      const sh = W(J.sh[s]), el = W(J.el[s]), ha = W(J.ha[s]), ar = B.armR * sc;
      orb(R, sh, ar + 0.4, ball(S.topR), 7);
      cap(R, sh, el, ar + 0.1, ar, S.upper, 3);
      cap(R, el, ha, ar, ar * 0.9, S.fore, 3);
      orb(R, ha, ar + 0.3, ball(S.skinR), 3);
    }
    const Hc = W(J.H), hr = B.headR * sc, yh = yaw + (p.ht || 0), sYh = Math.sin(yh), cYh = Math.cos(yh);
    const hp = (l, u, f) => [Hc[0] - cYh * l * hr + sYh * f * hr, Hc[1] + u * hr, Hc[2] + sYh * l * hr + cYh * f * hr];
    c.Hc = Hc; c.hr = hr; c.hp = hp; c.sYh = sYh; c.cYh = cYh; c.fW = fW; c.latW = latW; c.Pw = Pw; c.Nw = Nw;
    orb(R, Hc, hr, (dx, ny, nz, x, y) => stuHead(S, c, dx, ny, nz, x, y, p.mood), 2);
    stuHeadProps(c);
    stuBodyProps(c);
    if (S.extras) S.extras(c);
    } finally { CURPJ = prevPJ; }
    return c;
  }
  const gownCache = new Map();
  /** graduation: a purple gown to the shins with a gold stole, over the student's own head, hair and shoes */
  function gownStyle(S0) {
    let G = gownCache.get(S0); if (G) return G;
    const F = S0.F, O = { top: P1, kind: 'jacket', bot: P1, bk: 'long', shoe: S0.O.shoe, pat: 'stole' };
    G = buildStyle(Object.assign({}, F, { carry: 6 }), O);
    const gR = ramp5(P1), sR = ramp5(GD);
    G.extras = (c) => {
      const W = c.W, J = c.J, a = W(v3add(J.P, [0, 1.2, 0])), b = W(v3add(J.P, [0, -3.4, 0]));
      cap(c.R, a, b, 3.1, 3.7, (t, u, x, y) => { const k = tone5(u, x, y); return (c.fW[2] > 0.2 && Math.abs(u) > 0.22 && Math.abs(u) < 0.42) ? sR[k] : gR[k]; }, 5);
    };
    gownCache.set(S0, G); if (gownCache.size > 400) gownCache.clear();
    return G;
  }
  function stuHeadProps(c) {
    const S = c.S, F = S.F, R = c.R, hp = c.hp, hr = c.hr, hair = S.hair, hat = F.hat, sway = c.p.sway || 0;
    if (S.hatX) { S.hatX(c); return; }
    if (hat === 0 || hat === 2) switch (F.style) {
      case 1: orb(R, hp(-0.88, -0.15, 0.0), hr * 0.34, ball(S.hairR), 6); orb(R, hp(0.88, -0.15, 0.0), hr * 0.34, ball(S.hairR), 6); break;                       // bob: side volume
      case 2: cap(R, hp(0, 0.55, -0.9), hp(sway * 0.6, -0.9, -1.55), 0.85, 0.65, hair, 6); orb(R, hp(0, 0.55, -0.95), 0.65, ball(S.accR), 6); break;                   // ponytail + tie
      case 3: if (hat === 0) orb(R, hp(0, 0.92, -0.52), hr * 0.46, ball(S.hairR), 6); break;                                                            // bun
      case 4: if (hat === 0) orb(R, hp(0, 0.42, -0.38), hr * 1.28, ball(S.hairR), 6, hr * 1.2); break;                                                // afro
      case 5: cap(R, hp(-0.86, 0.12, 0.0), hp(-0.96, -1.6, -0.3), 0.75, 0.7, hair, 6); cap(R, hp(0.86, 0.12, 0.0), hp(0.96, -1.6, -0.3), 0.75, 0.7, hair, 6); cap(R, hp(0, 0.1, -0.88), hp(0, -1.7, -1.0), 1.3, 1.0, hair, 6); break;   // long
    }
    if (hat === 1) { cap(R, hp(-0.62, 0.2, 0.95), hp(0.62, 0.2, 0.95), 0.6, 0.6, S.acc, 6); cap(R, hp(-0.42, 0.16, 1.34), hp(0.42, 0.16, 1.34), 0.55, 0.55, S.acc, 6); }
    else if (hat === 2) orb(R, hp(0, 0.28, 0.05), hr * 1.42, ball(S.accR), 6, hr * 0.46);
  }
  function stuBodyProps(c) {
    const S = c.S, F = S.F, R = c.R, W = c.W, J = c.J, B = c.B, p = c.p, anim = c.o.anim;
    const P = c.Pw, uT = W(J.uT), fT = W(J.fT), lat = W(J.lat);
    const at = (up, fwd, side) => [P[0] + uT[0] * up + fT[0] * fwd + lat[0] * side, P[1] + uT[1] * up + fT[1] * fwd + lat[1] * side, P[2] + uT[2] * up + fT[2] * fwd + lat[2] * side];
    const hand = (s, d) => W(v3add(J.ha[s], d));
    if ((F.carry === 0 || F.carry === 1) && !c.o.noPack) {   // backpack: two fat capsules, a flap and the accent colour
      const g = B.sd + 1.25;
      cap(R, at(1.7, -g, -0.75), at(4.5, -g, -0.75), 1.15, 1.15, S.acc, 6); cap(R, at(1.7, -g, 0.75), at(4.5, -g, 0.75), 1.15, 1.15, S.acc, 6);
      orb(R, at(5.0, -g, 0), 1.0, ball(S.accR), 6);
    }
    if (F.carry === 3) { const col = ramp5('#D9C9A1'); cap(R, at(-0.2, -0.2, -(B.sw + 0.9)), at(2.0, -0.2, -(B.sw + 0.9)), 1.4, 1.4, limb(col), 6); S.toteStrap = '#D9C9A1'; }
    if (F.carry === 2 || (anim === 'idle' && F.carry === 2 && p.hl)) {   // books
      const hL = J.ha[1], bk = (dy, col) => cap(R, W(v3add(hL, [-1.5, dy, 0.7])), W(v3add(hL, [1.5, dy, 0.7])), 0.7, 0.7, limb(col), 6);
      bk(-0.9, ramp5(P1)); bk(0.0, ramp5(GD)); bk(0.9, ramp5('#E8E8E8'));
    }
    if (F.carry === 1) { const cupR = ramp5('#E8E8E8'), lid = ramp5('#4A3426'); cap(R, hand(0, [0, -1.5, 0.5]), hand(0, [0, 0.7, 0.5]), 0.95, 1.0, (t, u, x, y) => (t > 0.75 ? lid[tone5(u, x, y)] : (t > 0.3 && t < 0.55) ? ramp5('#8A5A3A')[tone5(u, x, y)] : cupR[tone5(u, x, y)]), 6); }
    if (F.carry === 4) { const br = ramp5('#C9964F'), pa = ramp5('#EDEDED'); cap(R, hand(0, [-1.9, 0.2, 0.9]), hand(0, [1.9, 0.2, 0.9]), 1.1, 1.0, (t, u, x, y) => ((t < 0.4) ? pa : br)[tone5(u, x, y)], 6); orb(R, hand(0, [1.7, 0.9, 0.9]), 0.65, ball(ramp5('#4E9A3A')), 6); }
    if (F.carry === 5 || p.usePhone) { const ph = ramp5('#2A2A33'); cap(R, hand(0, [0, 0.4, 0.5]), hand(0, [0, 1.9, 0.3]), 0.6, 0.6, limb(ph), 6); orb(R, hand(0, [0, 1.6, 0.9]), 0.38, () => '#9ADCFF', 6); }
    if (p.binocs) { const bn = ramp5('#2A2A33'), a = c.hp(-0.4, 0.05, 1.05), b = c.hp(0.4, 0.05, 1.05); orb(R, a, 1.1, ball(bn), 6); orb(R, b, 1.1, ball(bn), 6); }
    if (anim === 'umbrella') {   // the shaft up from the right hand and the open canopy over the head
      const hR = J.ha[0], sh = ramp5('#3A3A44'), second = F.acc === 2 ? ramp5('#EDEDED') : F.acc === 1 ? ramp5(GD) : ramp5(P1);
      cap(R, W(v3add(hR, [0, -0.7, 0])), W(v3add(hR, [-0.9, 9.0, 0])), 0.45, 0.45, limb(sh), 6);
      const cc = W(v3add(hR, [-0.9, 9.4, 0.3]));
      orb(R, cc, 6.8, (dx, ny, nz, x, y) => {
        const gore = ((Math.floor((Math.atan2(ny * 2.2, dx) + Math.PI) / (Math.PI / 3))) & 1) ? second : S.accR;
        let k = M.toneAt(0.62 + 0.5 * (-dx * 0.5 + ny * 0.5 + nz * 0.3), x, y, TH5, 0.09);
        if (nz < 0.22) k = Math.max(1, k - 1);
        if (ny > 0.78 && Math.abs(dx) < 0.12) return gore[4];
        return gore[k];
      }, 6, 3.5);
    }
    if (anim === 'foam') { const gr = ramp5(GD), h = J.ha[0]; cap(R, W(v3add(h, [0, 0.2, 0])), W(v3add(h, [0, 3.1, 0])), 1.3, 1.3, limb(gr), 6); cap(R, W(v3add(h, [0.1, 3.0, 0])), W(v3add(h, [0.1, 5.4, 0])), 0.62, 0.52, limb(gr), 6); }
    if (anim === 'tube') {   // the inner tube: a ring of orbs at the waist
      const Pl = J.P, rc = ramp5('#E8E8E8'), rr = ramp5('#D94A4A');
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; orb(R, W([Pl[0] + Math.cos(a) * 3.7, Pl[1] + 0.2, Pl[2] + Math.sin(a) * 3.7]), 1.15, ball((k & 2) ? rr : rc), 6); }
    }
  }
  function stuPost(b, c, anim) {   // screen-space marks painted after the rig: beads, mortarboard
    const R = c.R, S = c.S;
    if (anim === 'beads' && c.fW[2] > 0.3) {
      const s0 = scr(R, lerp3(c.Pw, c.Nw, 0.74)), cx = Math.round(s0[0]), cy = Math.round(s0[1]);
      const cols = [P2, GD, '#2E8B57'];
      const arc = [[-2, 0], [-2, 1], [-1, 2], [0, 2], [1, 2], [2, 1], [2, 0]];
      for (let i = 0; i < arc.length; i++) bput(b, cx + arc[i][0], cy + arc[i][1], cols[i % 3]);
      for (let i = 1; i < arc.length - 1; i++) bput(b, cx + arc[i][0], cy + arc[i][1] + 1, cols[(i + 1) % 3]);
    }
    if (anim === 'cap') {
      const s0 = scr(R, c.Hc), hx = Math.round(s0[0]), top = Math.round(s0[1] - c.hr) - 1;
      const dk = ramp5('#2A2A33');
      for (let x = -3; x <= 3; x++) bput(b, hx + x, top - 1, dk[(x < -1) ? 3 : x > 1 ? 1 : 2]);
      for (let x = -4; x <= 4; x++) bput(b, hx + x, top, dk[(x < -1) ? 2 : x > 2 ? 0 : 1]);
      for (let x = -2; x <= 2; x++) bput(b, hx + x, top + 1, dk[0]);
      bput(b, hx + 4, top + 1, GD); bput(b, hx + 4, top + 2, GD); bput(b, hx + 4, top + 3, ramp5(GD)[3]);
    }
  }
  function waterLine(b, cell, rows, f, S) {   // splash / tube: everything below the water line takes the water's colour, with a ripple row
    const yw = cell.gy - rows, w = b.w, water = PAL.shallows, wd = ramp5(PAL.shallows);
    for (let y = yw; y < b.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = b.d[i];
      if (c) b.d[i] = y === yw ? wd[3] : mix(c, wd[2], 0.55);
    }
    for (let x = 1; x < w - 1; x++) if (((x + f + (yw & 1)) & 3) === 0) { const i = yw * w + x; if (!b.d[i]) b.d[i] = wd[4]; else if (b.d[i] !== wd[3]) b.d[i] = wd[4]; }
    for (let x = 2; x < w - 2; x++) if (((x * 3 + f) & 3) === 0 && yw + 2 < b.h) { const i = (yw + 1) * w + x; if (!b.d[i]) b.d[i] = wd[1]; }
  }
  /** one student cell (pure): anim, look, facing 0–7, frame; `ov` swaps the style (officer, band, krewe) */
  function composeStudent(anim, look, dir, f, ov) {
    const A = SA[anim] || SA.walk, cell = SC[A.c]; let S = (ov && ov.style) || stuStyle(look); const B = S.B;
    if (anim === 'cap') S = gownStyle(S);
    f = ((f | 0) % A.n + A.n) % A.n; dir = ((dir | 0) % 8 + 8) % 8;
    const R = newRig(cell.cw, cell.ch, cell.cw >> 1, cell.gy);
    const p = stuPose(anim, f, B, S.F);
    if (ov && ov.pose) ov.pose(p, anim, f);
    const c = drawStudent(R, B, S, p, dirYaw(dir), { anim: anim, f: f, noPack: !!(ov && ov.noPack) });
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    stuPost(b, c, anim);
    if (A.water) waterLine(b, cell, A.water, f, S);
    rampOutline(b, R.h, S, ov && ov.outlineMap);
    b.shadow = A.water ? 0 : 9;
    return b;
  }
  M.stuFar = (anim, look, dir, k) => composeFar(anim, look, dir, k);
  M.stuCompose = composeStudent; M.stuStyle = stuStyle; M.stuAnims = Object.freeze(Object.assign({}, SA));

  // --- sheets: one lazy canvas per (family, anim, look, facing, zoom), with a per-frame bake budget -------------------------------
  const nowMs = () => BAKE.clock ? BAKE.clock() : ((typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : 0);
  const BAKE = { armed: false, clock: null, budget: 3.2, win: 0, spent: 0, queue: [], placeholders: 0, deferred: 0, pumped: 0 };
  M._bake = BAKE;   // tests tune the budget
  /** bytes of the lazily baked sheets by family|anim @ zoom (diagnostics; the notes' memory table comes from this) */
  M.sheetStats = function () { const o = {}; for (const s of sheets.values()) { const k = s.key.split('|').slice(0, 2).join('|') + '@' + s.zoom; o[k] = (o[k] || 0) + s.bytes; } return o; };
  function bakeWindow() { const t = nowMs(); if (t - BAKE.win > 14) { BAKE.win = t; BAKE.spent = 0; } return t; }
  /** finish deferred sheets inside the frame's budget (called from agentFrame, i.e. once per visible agent per frame) */
  function pumpBakes() {
    if (!BAKE.queue.length) return;
    let t = bakeWindow();
    while (BAKE.queue.length && BAKE.spent < BAKE.budget) {
      const j = BAKE.queue.shift();
      if (sheets.get(j.s.key) !== j.s || j.s.canvas.width <= 1) continue;
      j.run(); const t2 = nowMs(); BAKE.spent += t2 - t; t = t2; BAKE.pumped++;
    }
  }
  M.pumpBakes = function (all) { let n = 0; while (BAKE.queue.length) { const j = BAKE.queue.shift(); if (sheets.get(j.s.key) === j.s && j.s.canvas.width > 1) { j.run(); n++; } if (!all && n >= 4) break; } return n; };
  M.bakeStats = function () { return { queued: BAKE.queue.length, deferred: BAKE.deferred, pumped: BAKE.pumped, armed: BAKE.armed }; };
  /** a sheet of one facing: cell composed per frame (memoised so the 1× and 2× bakes share the compose), shadow baked underneath */
  const numSheets = new Map();
  const ANIM_IX = {}; SANIMS.forEach((k, i) => { ANIM_IX[k] = i; });
  /** a numeric key for the per-frame use stamp (no string building per agent per frame) */
  const numKey = (far, anim, look, dir, zoom) => (((look * 16 + ANIM_IX[anim]) * 8 + dir) * 2 + (far ? 1 : 0)) * 2 + (zoom === 2 ? 1 : 0);
  function stuSheet(fam, anim, look, dir, zoom, ov) {
    const A = SA[anim], cell = SC[A.c], far = fam === 'agentfar', nF = far ? 2 : A.n, key = fam + '|' + anim + '|' + look + '|' + dir + '|' + zoom;
    let s = sheets.get(key); if (s) { s.used = sheetFrame; return s; }
    const nk = (fam === 'agent' || far) && ANIM_IX[anim] !== undefined ? numKey(far, anim, look, dir, zoom) : -1;
    const reg = (sh) => { if (nk >= 0) { sh.nk = nk; numSheets.set(nk, sh); } return sh; };
    const draw = (P, f, ox, oy) => {
      const b = memoBuf(key.slice(0, key.lastIndexOf('|')) + '|' + f, () => far ? composeFar(anim, look, dir, f) : composeStudent(anim, look, dir, f, ov && ov.get ? ov.get(look) : ov));
      if (b.shadow) shadowFb(P, ox + 1, oy, cell.cw >> 1, cell.gy, b.shadow);
      bblit(b, P, ox, oy);
    };
    if (BAKE.armed && nowMs()) {
      const t = bakeWindow();
      if (BAKE.spent >= BAKE.budget && look !== STU_DEFAULT) {   // over budget: the default student of this pose stands in while the real look queues
        const def = stuSheet(fam, anim, STU_DEFAULT, dir, zoom, null);
        const S = zoom === 2 ? 2 : 1, canvas = M.newCanvas(cell.cw * nF * S, cell.ch * S), ctx = M.ctx2d(canvas);
        try { ctx.imageSmoothingEnabled = false; ctx.drawImage(def.canvas, 0, 0); } catch (e) { /* stub */ }
        s = { key: key, canvas: canvas, cellW: cell.cw, cellH: cell.ch, n: nF, zoom: zoom, S: S, used: sheetFrame, bytes: cell.cw * nF * S * cell.ch * S * 4 };
        sheets.set(key, s); BAKE.deferred++;
        BAKE.queue.push({ s: s, run: () => { const g = M.ctx2d(s.canvas), P = pen(g, zoom); g.clearRect(0, 0, s.canvas.width, s.canvas.height); for (let f = 0; f < nF; f++) draw(P, f, f * cell.cw, 0); } });
        return reg(s);
      }
      s = reg(getSheet(key, cell.cw, cell.ch, nF, zoom, draw));
      BAKE.spent += nowMs() - t;
      return s;
    }
    return reg(getSheet(key, cell.cw, cell.ch, nF, zoom, draw));
  }
  /** the 0.5× version of a student frame: the 1× entry is drawn at half size, so a 2×2 block reduction is baked into 2×2 blocks of the same cell (the box filter keeps the shirt's colour, no sparkle) */
  function composeFar(anim, look, dir, k) {
    const A = SA[anim], f = A.n > 1 ? (k & 1) * (A.n >> 1) : 0, b = composeStudent(anim, look, dir, f), out = newBuf(b.w, b.h);
    for (let y = 0; y + 1 < b.h; y += 2) for (let x = 0; x + 1 < b.w; x += 2) {
      let n = 0, r = 0, g2 = 0, bl = 0, dark = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const c = b.d[(y + j) * b.w + x + i]; if (!c) continue; const h = M.hex(c); n++; r += h[0]; g2 += h[1]; bl += h[2]; }
      if (n < 2) continue;
      const c = M.rgba ? null : null, col = '#' + [r / n, g2 / n, bl / n].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
      out.d[y * b.w + x] = col; out.d[y * b.w + x + 1] = col; out.d[(y + 1) * b.w + x] = col; out.d[(y + 1) * b.w + x + 1] = col;
    }
    out.shadow = b.shadow;
    return out;
  }
  const STU_DEFAULT = (function () { let l = 0; l |= 1 | (1 << 3) | (0 << 6) | (0 << 9) | (0 << 13) | (0 << 16) | (0 << 19) | (1 << 21) | (1 << 23); return l >>> 0; })();
  /** the facing (0–7) and in-facing frame of a sheet frame index */
  const stuSplit = (anim, frame) => { const n = SA[anim].n, tot = n * FACINGS, fr = ((frame % tot) + tot) % tot; return { dir: (fr / n) | 0, f: fr % n, fr: fr }; };

  // --- uniforms: the Wildlife Officer, the Bayou Brass, the krewe ----------------------------------------------------------------
  const officerStyleCache = {};
  function officerStyle() {
    if (officerStyleCache.S) return officerStyleCache.S;
    const F = { skin: 2, hairC: 1, fam: 2, glasses: 1, outfit: 0, style: 0, carry: 6, hat: 0, build: 2, acc: 0 };
    const O = { top: C.khaki, kind: 'long', bot: '#4A5A3A', bk: 'long', shoe: '#3A2A1E', pat: 'badge', belt: '#4A3426' };
    const S = buildStyle(F, O);
    const hatR = ramp5(C.khaki), hatB = ramp5(shade(C.khaki, 0.8));
    S.hatCover = (st, ny, fwd, aLat, k) => (ny > 0.18 ? hatR[k] : null);
    S.hatX = (c) => { orb(c.R, c.hp(0, 0.34, 0.1), c.hr * 1.62, ball(hatB), 6, c.hr * 0.5); orb(c.R, c.hp(0, 0.95, -0.02), c.hr * 0.62, ball(hatR), 6); };
    S.ramps.push(hatR, hatB, ramp5('#4A4A52'), ramp5(PAL.gold));
    S.extras = (c) => {   // the catch pole: a long steel shaft with an orange loop, carried forward in the right hand
      const h = c.J.ha[0], W = c.W, st = ramp5('#8A8A8E'), lp = ramp5('#E07020');
      cap(c.R, W(v3add(h, [0, -2.0, -1.2])), W(v3add(h, [0.3, 2.4, 6.2])), 0.42, 0.42, limb(st), 6);
      orb(c.R, W(v3add(h, [0.3, 2.8, 7.0])), 1.2, ball(lp), 6);
    };
    S.officer = true;
    officerStyleCache.S = S; return S;
  }
  const bandStyles = new Map();
  function bandStyle(v) {   // v: any int; skin from bits 0–2, hair colour from bits 3–5, instrument from bits 6–7
    const key = v & 255; let S = bandStyles.get(key); if (S) return S;
    const F = { skin: (key & 7) % 6, hairC: (key >> 3) & 7, fam: 0, glasses: 0, outfit: 0, style: 0, carry: 6, hat: 0, build: 1, acc: 2 };
    const O = { top: P1, kind: 'long', bot: WHT, bk: 'long', shoe: '#1E1E22', pat: 'sash' };
    S = buildStyle(F, O);
    const shR = ramp5(P1), shG = ramp5(GD), shW = ramp5('#F4F4F4');
    S.hatCover = (st, ny, fwd, aLat, k) => (ny > 0.4 ? shR[k] : null);
    S.hatX = (c) => {   // the shako: a tall purple cylinder, gold band, white plume
      const top = v3add(c.Hc, [0, c.hr * 0.55, -0.2]), end = v3add(top, [0, 3.0, 0]);
      cap(c.R, top, end, 2.0, 1.9, (t, u, x, y) => (t < 0.2 ? shG[tone5(u, x, y)] : shR[tone5(u, x, y)]), 6);
      cap(c.R, end, v3add(end, [0.3, 2.2, 0]), 0.7, 0.45, limb(shW), 6);
    };
    S.ramps.push(shR, shG, shW);
    const inst = (key >> 6) & 3;
    S.extras = (c) => {
      const W = c.W, J = c.J, h = J.ha[0], br = ramp5(GD);
      if (inst === 0) { orb(c.R, W(v3add(h, [-0.5, 0.2, 0.9])), 1.3, ball(br), 6); cap(c.R, W(v3add(h, [-0.5, 0.2, 0.9])), W(v3add(h, [-1.4, 0.2, 2.6])), 0.6, 1.2, limb(br), 6); }        // a horn
      else if (inst === 1) cap(c.R, W([-1.8, c.p.py + 1.0, 2.2]), W([1.8, c.p.py + 1.0, 2.2]), 1.9, 1.9, (t, u, x, y) => (t > 0.85 || t < 0.15 ? shW : shG)[tone5(u, x, y)], 6);      // a snare on the belly
      else orb(c.R, W([0, c.p.py + 2.4, 2.4]), 2.6, (dx, ny, nz, x, y) => (Math.abs(dx) > 0.7 ? shR : shW)[sph5(dx, ny, nz, x, y)], 6);                                              // a bass drum
    };
    S.inst = inst;
    bandStyles.set(key, S); return S;
  }
  const kreweStyles = new Map();
  function kreweStyle(v) {
    const key = v & 255; let S = kreweStyles.get(key); if (S) return S;
    const F = { skin: (key & 7) % 6, hairC: (key >> 3) & 7, fam: 0, glasses: 0, outfit: 0, style: (key >> 6) % 6, carry: 6, hat: 0, build: 1, acc: 2 };
    const topList = [P1, '#2E8B57', GD, P2];
    const O = { top: topList[(key >> 5) & 3], kind: 'tee', bot: key & 1 ? '#23232B' : WHT, bk: 'long', shoe: '#23232B', pat: 'sash' };
    S = buildStyle(F, O);
    const hpR = ramp5(P2), hgR = ramp5(GD);
    S.hatCover = (st, ny, fwd, aLat, k) => (ny > 0.16 ? hpR[k] : null);
    S.hatX = (c) => {   // a tricorn: purple crown, gold brim, a green feather
      orb(c.R, c.hp(0, 0.3, 0.05), c.hr * 1.4, ball(hgR), 6, c.hr * 0.5);
      orb(c.R, c.hp(0.7, 0.9, -0.2), 0.8, ball(ramp5('#2E8B57')), 6);
    };
    S.ramps.push(hpR, hgR, ramp5('#2E8B57'));
    kreweStyles.set(key, S); return S;
  }
  const marchPose = (S) => (p, anim, f) => { const hi = (f & 1); p.fr = [p.fr[0], p.fr[1] * 1.6, p.fr[2]]; p.fl = [p.fl[0], p.fl[1] * 1.6, p.fl[2]]; };
  const BAND_ANIM = { march: { n: 4 } };
  SA.march = { n: 4, c: 'b' };

  // --- painters ---------------------------------------------------------------------------------------------------------------------
  const B4_PAINTERS = {};
  B4_PAINTERS.agent = function (ctx, spec) {
    const anim = spec.sub || 'walk', A = SA[anim];
    if (!A || anim === 'march') throw new Error('unknown agent anim "' + anim + '"');
    spec.frames = A.n * FACINGS;
    const sp = stuSplit(anim, spec.frame), cell = SC[A.c];
    return sheetRef(stuSheet('agent', anim, spec.variant >>> 0, sp.dir, spec.zoom, null), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  B4_PAINTERS.agentfar = function (ctx, spec) {
    const anim = spec.sub || 'walk', A = SA[anim];
    if (!A || anim === 'march') throw new Error('unknown agentfar anim "' + anim + '"');
    spec.frames = 2 * FACINGS;
    const tot = 2 * FACINGS, fr = ((spec.frame % tot) + tot) % tot, cell = SC[A.c];
    return sheetRef(stuSheet('agentfar', anim, spec.variant >>> 0, fr >> 1, spec.zoom, null), fr & 1, -(cell.cw >> 1), -cell.gy);
  };
  /** the officer: walk (8 facings × 8) and 'wrangle' (set up with the creature rig below) */
  B4_PAINTERS.officer = function (ctx, spec) {
    if (spec.sub === 'wrangle') return paintWrangle(ctx, spec);
    if (spec.sub && spec.sub !== 'walk') throw new Error('unknown officer anim "' + spec.sub + '"');
    spec.frames = SA.walk.n * FACINGS;
    const sp = stuSplit('walk', spec.frame), cell = SC.a, ov = { style: officerStyle(), noPack: true };
    return sheetRef(stuSheet('officer', 'walk', 0, sp.dir, spec.zoom, { get: () => ov }), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  B4_PAINTERS.band = function (ctx, spec) {
    const v = spec.variant | 0; spec.frames = SA.march.n * FACINGS;
    const sp = stuSplit('march', spec.frame), cell = SC.b;
    const ov = { get: () => ({ style: bandStyle(v), noPack: true, pose: marchPose() }) };
    return sheetRef(stuSheet('band', 'march', v & 255, sp.dir, spec.zoom, ov), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  B4_PAINTERS.krewe = function (ctx, spec) {
    const v = spec.variant | 0; spec.frames = SA.march.n * FACINGS;
    const sp = stuSplit('march', spec.frame), cell = SC.b;
    const ov = { get: () => ({ style: kreweStyle(v), noPack: true, pose: (p, anim, f) => { if (f === 1 || f === 3) { p.hr = [1.6, 4.6, 0.8]; p.epR = [1, 0.2, -0.3]; } } }) };
    return sheetRef(stuSheet('krewe', 'march', (v & 255) + 256, sp.dir, spec.zoom, ov), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  Object.assign(SHEET_PAINTERS, B4_PAINTERS);
  for (const fam of Object.keys(B4_PAINTERS)) M.registerPainter(fam, B4_PAINTERS[fam]);

  // --- the public agent API render uses -----------------------------------------------------------------------------------------------
  const agentFrames = {}, FRAME_TABLE = {};
  for (const k of SANIMS) { agentFrames[k] = SA[k].n; FRAME_TABLE[k === 'walk' ? 'agent' : 'agent:' + k] = SA[k].n * FACINGS; }
  FRAME_TABLE['agent:walk'] = SA.walk.n * FACINGS;
  for (const k of SANIMS) FRAME_TABLE['agentfar:' + k] = 2 * FACINGS;
  Object.assign(FRAME_TABLE, { officer: SA.walk.n * FACINGS, band: SA.march.n * FACINGS, krewe: SA.march.n * FACINGS });
  for (const id of Object.keys(FRAME_TABLE)) M.setFrames(id, FRAME_TABLE[id]);
  M.animFrames = Object.freeze({ agent: Object.freeze(agentFrames), officer: Object.freeze({ walk: 8 }), band: Object.freeze({ march: 4 }), krewe: Object.freeze({ march: 4 }), facings: FACINGS });
  /** the sprite id of an agent anim; `a` (the agent) lets a graduation cap and gown replace the walk / idle / cheer sheets */
  M.agentId = function (anim, a, zoom) {
    if (zoom < 1 && typeof anim === 'string' && SA[anim] && anim !== 'march') { if (a && a.prop === 'cap' && (anim === 'walk' || anim === 'idle' || anim === 'cheer' || anim === 'wave')) return 'agentfar:cap'; return 'agentfar:' + anim; }
    if (a && a.prop === 'cap' && (anim === 'walk' || anim === 'idle' || anim === 'cheer' || anim === 'wave')) return 'agent:cap';
    return (typeof anim === 'string' && SA[anim] && anim !== 'walk' && anim !== 'march') ? 'agent:' + anim : 'agent';
  };
  /** cell size of an agent anim in 1× px */
  M.agentCell = function (anim) { const A = SA[typeof anim === 'string' && anim !== 'march' ? anim : 'walk'] || SA.walk, c = SC[A.c]; return { w: c.cw, h: c.ch, gy: c.gy, n: A.n }; };
  const ph8 = (id) => hash(id | 0, 0x51);
  const MOVING = { walk: 1, umbrella: 1, beads: 1, foam: 1, cap: 1, flee: 1, splash: 1, tube: 1 };
  /**
   * The frame (facing × n + f) of an agent's sheet.
   *   agentFrame(anim, dir, f)                       → pass-A semantics: dir 0–3 (+tx, +ty, −tx, −ty) → facings 0, 2, 4, 6, f mod n
   *   agentFrame(anim, dir, f, a, zoom, tick)        → render's call: `a` the agent (id, px/py → tx/ty, dir), zoom the camera zoom, tick the frame counter;
   *                                                    8 facings from the last step's heading (idle ones turn a stable ±2 octants), a per-agent phase so a crowd does
   *                                                    not march in step, the cycle rate follows the speed, idle fidgets (shift, shift back, use the item) on a 4–6 s loop,
   *                                                    two poses at 0.5×; arms the bake budget and pumps the deferred sheets
   */
  M.agentFrame = function (anim, dir, f, a, zoom, tick) {
    const name = (typeof anim === 'string' && SA[anim] && anim !== 'march') ? anim : 'walk', A = SA[name], n = A.n;
    dir = Number.isFinite(dir) ? (dir | 0) : 0;
    if (!a || typeof a !== 'object') { const d = ((dir % 4) + 4) % 4; return d * 2 * n + (((Number.isFinite(f) ? (f | 0) : 0) % n) + n) % n; }
    BAKE.armed = true; pumpBakes();
    const id = a.id | 0, ph = ph8(id), t = Number.isFinite(tick) ? tick : (Number.isFinite(f) ? f * 6 : 0), far = zoom < 1;
    let d8, fr;
    if (MOVING[name]) {
      const dx = (a.tx - a.px), dy = (a.ty - a.py), L2 = dx * dx + dy * dy;
      d8 = L2 > 0.0004 ? M.fbDir(dx, dy) : ((dir & 3) * 2);
      const sp = L2 > 0.0004 ? Math.sqrt(L2) : 0.12, rate = name === 'flee' ? 20 : name === 'splash' ? 9 : name === 'tube' ? 6 : Math.max(10, Math.min(19, 7 + sp * 32));
      const k = Math.floor(t * rate / 60) + ph;
      fr = far ? ((k >> 2) & 1) : ((k % n) + n) % n;
    } else {
      d8 = (((dir & 3) * 2 + ([0, -1, 1, 0, 2, -2][ph % 6])) + 8) & 7;
      const k = Math.floor(t / 6);
      if (name === 'idle') {
        const CL = 40 + (ph % 24), u = (k + ph * 7) % CL;
        fr = far ? 0 : (u >= CL - 11 ? 2 : (((u / 13) | 0) & 1));
      } else if (name === 'sit') fr = far ? 0 : (((k + ph) / 9) | 0) & 1;
      else fr = far ? (((k + ph) >> 1) & 1) : (((k + ph) >> (name === 'selfie' || name === 'binoculars' ? 2 : 1)) % n + n) % n;
    }
    const us = numSheets.get(numKey(far, name === 'umbrella' ? 'umbrella' : name, Number.isFinite(a.look) ? (a.look >>> 0) : 0, d8, zoom >= 2 ? 2 : 1)); if (us) us.used = sheetFrame;
    return far ? d8 * 2 + fr : d8 * n + fr;
  };

  // ---------------------------------------------------------------------------
  // B4 creatures on the same rig: gators (3 sizes × swim / walk / bask / lunge × 8 facings), Roux the tiger (pace / idle / lie / yawn),
  // the nutria and the wrangle scene. Creatures lie on the ground plane, so they use their own projection (a 2:1 iso ground: a
  // point 1 px toward the viewer lies 0.5 px lower on screen) through the rig's cap/orb.
  // ---------------------------------------------------------------------------
  const scrC = (R, p) => [R.cx + p[0], R.gy - p[1] + p[2] * 0.5, p[2]];
  const capC = (R, A, B, rA, rB, m, tag) => cap(R, A, B, rA, rB, m, tag, scrC);
  const orbC = (R, C0, r, fn, tag, ry) => orb(R, C0, r, fn, tag, ry, scrC);
  const wYaw = (yaw) => { const sY = Math.sin(yaw), cY = Math.cos(yaw); return (q) => [-q[0] * cY + q[2] * sY, q[1], q[0] * sY + q[2] * cY]; };
  const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  /** a dithered ripple ring on the ground plane (centre c, semi-axes a × b in local x/z): `front` selects the half nearer the viewer */
  function ripples(R, W, a, b, ph, cols, front, gap) {
    const n = Math.max(16, Math.round((a + b) * 3));
    for (let i = 0; i < n; i++) {
      const th = i / n * Math.PI * 2 + ph; if (((i + (ph > 1 ? 1 : 0)) % 3) === 2) continue;
      const wp = W([Math.cos(th) * b, 0, Math.sin(th) * a]), s = scrC(R, wp), x = Math.round(s[0]), y = Math.round(s[1]);
      if ((wp[2] > 0) !== front) continue;
      if (x < 0 || y < 0 || x >= R.w || y >= R.h) continue;
      const j = y * R.w + x; if (R.z[j] > -1e8 && !front) continue;
      R.c[j] = cols[(i + (gap | 0)) % cols.length]; R.z[j] = front ? 50 : -50; R.t[j] = 9;
    }
  }

  // --- gators ---------------------------------------------------------------------------------------------------------------------
  const GATORS = [{ L: 26, rb: 1.55, cw: 36, ch: 30 }, { L: 36, rb: 2.15, cw: 48, ch: 36 }, { L: 52, rb: 3.2, cw: 66, ch: 46 }];
  const GPER = 10, GMODES = { swim: 0, walk: 2, bask: 6, lunge: 8 };
  const gBack = ramp5(C.gatorBack), gLegend = ramp5('#3C4A33'), gFlank = ramp5('#6A7A48'), gBelly = ramp5(C.gatorBelly), gMouth = ramp5('#C8707A'), gEye = ramp5('#C9B037');
  const gRipple = ['#6FA895', '#4C6E69', '#8FC6AB', '#4C6E69'];
  /** the spine of a gator: 14 points from the tail tip to the snout: {x, y, z, r} in the local frame (z forward) */
  function gatorSpine(G, mode, f, ph, lunge) {
    const pts = [], L = G.L, rb = G.rb;
    for (let i = 0; i <= 13; i++) {
      const u = i / 13; let k;
      if (u < 0.40) k = 0.14 + 0.76 * Math.pow(u / 0.40, 0.85); else if (u < 0.70) k = 0.9 + 0.1 * Math.sin((u - 0.4) / 0.3 * Math.PI); else if (u < 0.78) k = 0.8; else if (u < 0.88) k = 0.82; else k = 0.5 - 0.12 * ((u - 0.88) / 0.12);
      const r = rb * k, sunk = mode === 'swim' ? 0.38 : 0.95;
      let y = r * sunk + (mode === 'walk' ? rb * 0.55 : 0), x = 0;
      if (u < 0.5) x = rb * (mode === 'walk' ? 0.9 : mode === 'swim' ? 0.7 : 0.35) * Math.sin(ph * Math.PI * 2 - u * 7) * (1 - u / 0.5);
      else if (mode === 'walk' || mode === 'swim') x = rb * 0.25 * Math.sin(ph * Math.PI * 2 - u * 7 + 1.4) * (u - 0.5);
      if (lunge) y += lunge * rb * smooth01((u - 0.38) / 0.55) * 2.6;
      pts.push({ x: x, y: y, z: -L / 2 + L * u, r: r, u: u });
    }
    return pts;
  }
  function composeGator(v, dir, k) {
    v = Math.max(0, Math.min(2, v | 0)); const G = GATORS[v], rb = G.rb, L = G.L;
    k = ((k | 0) % GPER + GPER) % GPER; dir = ((dir | 0) % 8 + 8) % 8;
    const mode = k < 2 ? 'swim' : k < 6 ? 'walk' : k < 8 ? 'bask' : 'lunge', f = mode === 'swim' ? k : mode === 'walk' ? k - 2 : mode === 'bask' ? k - 6 : k - 8;
    const gyc = G.ch - 9, R = newRig(G.cw, G.ch, G.cw >> 1, gyc), W = wYaw(dirYaw(dir));
    const ph = mode === 'walk' ? f / 4 : mode === 'swim' ? f * 0.5 : f * 0.25, lunge = mode === 'lunge' ? (f === 0 ? 1.0 : 0.55) : 0;
    const sp = gatorSpine(G, mode, f, ph, lunge), legend = v === 2, back = legend ? gLegend : gBack;
    const bf = limb(back), ff = limb(gFlank);
    const mid = (t, u, x, y) => { let t5 = tone5(u, x, y); if (((x * 3 + y * 2) % 5) === 0 && t5 > 1) t5--; else if (((x + y * 3) % 7) === 0 && t5 < 4) t5++; return back[t5]; };
    if (mode === 'swim') ripples(R, W, L * 0.5 + 2.4, rb * 1.9 + 1.4, f * 0.6, gRipple, false);
    // body: a centre chain (the back, with scutes) and two flank chains, then the legs, the head and the tail
    const P = (p, dx, dy) => W([p.x + (dx || 0), p.y + (dy || 0), p.z]);
    for (let i = 0; i < sp.length - 1; i++) {
      const a = sp[i], b = sp[i + 1];
      if (i < 10) {   // flanks stay behind the neck
        capC(R, P(a, -rb * 0.5 * a.r / rb, -a.r * 0.3), P(b, -rb * 0.5 * b.r / rb, -b.r * 0.3), a.r * 0.72, b.r * 0.72, ff, 4);
        capC(R, P(a, rb * 0.5 * a.r / rb, -a.r * 0.3), P(b, rb * 0.5 * b.r / rb, -b.r * 0.3), a.r * 0.72, b.r * 0.72, ff, 4);
      }
      capC(R, P(a), P(b), a.r, b.r, i >= 11 ? bf : mid, 3);
    }
    // legs (not while swimming): thigh + shin by two-bone IK to a foot on the ground
    if (mode !== 'swim') {
      const stride = mode === 'walk' ? 1.9 : 0, lift = mode === 'walk' ? 1.5 : 0;
      for (const leg of [[0.66, 1, 0], [0.66, -1, 1], [0.36, 1, 1], [0.36, -1, 0]]) {
        const u = leg[0], s = leg[1], sh = sp[Math.round(u * 13)], t = ((f / 4) + (leg[2] ? 0.5 : 0)) % 1;
        const fz = sh.z + (mode === 'walk' ? (t < 0.5 ? stride - 2 * stride * (t / 0.5) : -stride + 2 * stride * ((t - 0.5) / 0.5)) : (leg[0] > 0.5 ? 1.2 : -1.0)), fy = mode === 'walk' && t >= 0.5 ? lift * Math.sin(Math.PI * (t - 0.5) / 0.5) : 0;
        const spread = mode === 'walk' ? 1.75 : 2.05, A0 = [sh.x + s * rb * 0.85, sh.y - sh.r * 0.2, sh.z], T = [sh.x + s * (rb * spread + 0.6), fy + 0.3, fz];
        const r = ik2(A0, T, rb * 1.25 + 0.5, rb * 1.1 + 0.5, [s * 1, 1.4, 0]);
        const lr = rb * 0.36 + 0.28;
        capC(R, W(A0), W(r[0]), lr, lr * 0.9, bf, 4); capC(R, W(r[0]), W(r[1]), lr * 0.9, lr * 0.75, bf, 4);
        orbC(R, W([r[1][0], r[1][1] + 0.1, r[1][2] + 0.5]), lr * 1.15, ball(gFlank), 4);
      }
    }
    // head: skull, upper and lower jaw (open when basking or lunging), eyes on bumps, nostrils
    const sk = sp[11], tip = sp[13], jaw = mode === 'bask' ? (f === 0 ? 0.55 : 0.85) : mode === 'lunge' ? (f === 0 ? 1.15 : 0.35) : 0;
    const snoutUp = jaw * rb * 0.32, jawDrop = jaw * rb * 0.95;
    const up0 = [sk.x, sk.y + sk.r * 0.12, sk.z + sk.r * 0.2], up1 = [tip.x, tip.y + snoutUp, tip.z + 0.4];
    const lo0 = [sk.x, sk.y - sk.r * 0.42, sk.z + sk.r * 0.1], lo1 = [tip.x, tip.y - rb * 0.18 - jawDrop, tip.z];
    if (jaw > 0.1) {   // the mouth: pink floor between the jaws, behind the teeth
      capC(R, W([lo0[0], lo0[1] + 0.2, lo0[2]]), W([lo1[0], lo1[1] + 0.4, lo1[2] - 0.5]), rb * 0.34, rb * 0.26, limb(gMouth), 5);
    }
    capC(R, W(lo0), W(lo1), sk.r * 0.7, rb * 0.3, (t, u, x, y) => gBelly[Math.min(4, tone5(u, x, y) + 1)], 5);
    capC(R, W(up0), W(up1), sk.r * 0.82, rb * 0.34, bf, 6);
    orbC(R, W([sk.x, sk.y + sk.r * 0.1, sk.z]), sk.r * 0.95, ball(back), 6);
    if (jaw > 0.1) for (let i = 0; i < 4; i++) { const tq = 0.3 + i * 0.2; orbC(R, W([up0[0] + (up1[0] - up0[0]) * tq, up0[1] + (up1[1] - up0[1]) * tq - rb * 0.32, up0[2] + (up1[2] - up0[2]) * tq]), Math.max(0.3, rb * 0.13), () => '#F4F0E0', 7); }
    for (const s of [-1, 1]) {   // eyes: bumps on top of the skull with a yellow iris
      const ep = W([sk.x + s * sk.r * 0.55, sk.y + sk.r * 0.78 + snoutUp * 0.3, sk.z + sk.r * 0.35]);
      orbC(R, ep, Math.max(0.55, rb * 0.34), (dx, ny, nz, x, y) => (nz > 0.55 && ny > -0.2 && Math.abs(dx) < 0.5 ? (ny > 0.2 && dx < 0 ? '#FFF2A0' : '#15151B') : gEye[sph5(dx, ny, nz, x, y)]), 8);
    }
    orbC(R, W([tip.x + 0.45, up1[1] + rb * 0.1, tip.z + 0.2]), Math.max(0.35, rb * 0.16), () => '#1B1B1B', 8);
    // moss and a scar on the legend
    if (legend) {
      const mo = ramp5('#8FA074');
      for (let i = 3; i < 9; i += 2) { const p = sp[i]; capC(R, W([p.x + rb * 0.3, p.y + p.r * 0.85, p.z]), W([p.x + rb * 0.9, p.y + p.r * 0.2, p.z - 1.2]), 0.55, 0.3, limb(mo), 8); }
      capC(R, W([sk.x - sk.r * 0.7, sk.y + sk.r * 0.3, sk.z + 1.5]), W([sk.x - sk.r * 0.7, sk.y + sk.r * 0.3, sk.z + 4.5]), 0.3, 0.3, () => '#B9C79A', 8);
    }
    if (mode === 'swim') {   // the V of the wake, then the front ripples over the lower body
      ripples(R, W, L * 0.5 + 2.4, rb * 1.9 + 1.4, f * 0.6, gRipple, true, 1);
      const wk = [[-1, 1], [1, 1]];
      for (const s of [-1, 1]) for (let i = 0; i < 9; i++) { const t = i / 9, wp = W([s * (rb * 0.8 + t * L * 0.34), 0, L * 0.34 - t * L * 0.55]), q = scrC(R, wp), x = Math.round(q[0]), y = Math.round(q[1]); if (x >= 0 && y >= 0 && x < R.w && y < R.h && ((i + f) & 1) === 0) { const j = y * R.w + x; R.c[j] = gRipple[1 + (i & 1)]; R.z[j] = 60; R.t[j] = 9; } }
    }
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    const S = { ramps: [back, gFlank, gBelly, gMouth, gEye, ramp5('#8FA074'), ramp5(PAL.shallows)] };
    rampOutline(b, R.h, S);
    b.shadow = mode === 'swim' ? 0 : Math.round(L * 0.6) | 1;
    b.gy = gyc;
    return b;
  }
  M.gatorCompose = composeGator;
  B4_PAINTERS.gator = function (ctx, spec) {
    const v = Math.max(0, Math.min(2, spec.variant | 0)), G = GATORS[v], tot = GPER * FACINGS; spec.frames = tot; spec.framesPerVariant = false;
    const fr = ((spec.frame % tot) + tot) % tot, dir = (fr / GPER) | 0, key = 'gator|' + v + '|' + dir + '|' + spec.zoom;
    const gyc = G.ch - 9;
    const s = getSheet(key, G.cw, G.ch, GPER, spec.zoom, (P, f, ox, oy) => {
      const b = memoBuf('gator|' + v + '|' + dir + '|' + f, () => composeGator(v, dir, f));
      if (b.shadow) P.rect(ox + (G.cw >> 1) - (b.shadow >> 1) + 1, oy + gyc + 1, b.shadow, 1, C.shadowLight);
      bblit(b, P, ox, oy);
    });
    return sheetRef(s, fr % GPER, -(G.cw >> 1), -gyc);
  };

  // --- Roux the tiger (the loose / habitat tiger on all fours): pace 0–3, idle 4–5, lie 6–7, yawn 8–9 per facing ------------------------------
  const RX = { cw: 40, ch: 34, gy: 24, L: 26, rb: 3.0 };
  const RPER = 10, RMODES = { pace: 0, idle: 4, lie: 6, yawn: 8 };
  const tFur = ramp5(C.tiger), tBelly = ramp5('#F4EEE2'), tDark = ramp5('#1B1B1B');
  function legIK(R, W, A0, T, l1, l2, pole, r, m, paw) {
    const q = ik2(A0, T, l1, l2, pole);
    capC(R, W(A0), W(q[0]), r, r * 0.9, m, 4); capC(R, W(q[0]), W(q[1]), r * 0.9, r * 0.75, m, 4);
    if (paw) orbC(R, W([q[1][0], q[1][1] + 0.1, q[1][2] + 0.5]), r * 1.1, paw, 4);
  }
  function composeRoux4(dir, k) {
    k = ((k | 0) % RPER + RPER) % RPER; dir = ((dir | 0) % 8 + 8) % 8;
    const mode = k < 4 ? 'pace' : k < 6 ? 'idle' : k < 8 ? 'lie' : 'yawn', f = mode === 'pace' ? k : mode === 'idle' ? k - 4 : mode === 'lie' ? k - 6 : k - 8;
    const R = newRig(RX.cw, RX.ch, RX.cw >> 1, RX.gy), W = wYaw(dirYaw(dir)), rb = RX.rb, L = RX.L;
    const lieDown = mode === 'lie', ph = f / 4, breath = lieDown ? 0.25 * f : 0;
    const legH = lieDown ? 0.6 : 3.6, by = legH + rb * (lieDown ? 0.85 : 0.95) + breath * 0.5;
    const stripeAt = (i) => (t, u, x, y) => { const k5 = tone5(u, x, y), q = (i + t) * 2.1; return (q - Math.floor(q) < 0.3 && k5 > 0) ? tDark[Math.max(1, k5 - 1)] : tFur[k5]; };
    const belly = limb(tBelly);
    // torso: 5 segments, shoulders (front) higher than the hips; a slight sway while pacing
    const sp = [];
    for (let i = 0; i <= 5; i++) { const u = i / 5; sp.push({ x: mode === 'pace' ? 0.45 * Math.sin(ph * 6.28 + u * 2) : 0, y: by + (u - 0.5) * 0.7, z: -L * 0.32 + L * 0.64 * u, r: rb * (0.88 + 0.22 * Math.sin(u * 3.1)) }); }
    const tailSway = Math.sin(ph * 6.28 + 1) * (mode === 'idle' ? 1.6 * (f ? 1 : -1) : 1.1);
    // tail: curves up behind the hips with black rings
    const tl = [[sp[0].x, sp[0].y + 0.2, sp[0].z - 1.2], [tailSway * 0.4, sp[0].y + 0.4, sp[0].z - 4], [tailSway * 0.8, sp[0].y + 2.0, sp[0].z - 6.4], [tailSway, sp[0].y + 4.4, sp[0].z - 7.0], [tailSway * 1.1, sp[0].y + 6.6, sp[0].z - 6.2]];
    for (let i = 0; i < tl.length - 1; i++) capC(R, W(tl[i]), W(tl[i + 1]), 0.85 - i * 0.07, 0.8 - i * 0.07, (t, u, x, y) => ((i >= 2 && (((i * 2 + (t > 0.5 ? 1 : 0)) % 3) === 1 || i === tl.length - 2)) ? tDark[tone5(u, x, y)] : tFur[tone5(u, x, y)]), 3);
    for (let i = 0; i < 5; i++) {
      capC(R, W([sp[i].x, sp[i].y - sp[i].r * 0.66, sp[i].z]), W([sp[i + 1].x, sp[i + 1].y - sp[i + 1].r * 0.66, sp[i + 1].z]), sp[i].r * 0.62, sp[i + 1].r * 0.62, belly, 3);           // the pale belly, under the flank
      capC(R, W([sp[i].x, sp[i].y + sp[i].r * 0.05, sp[i].z]), W([sp[i + 1].x, sp[i + 1].y + sp[i + 1].r * 0.05, sp[i + 1].z]), sp[i].r * 1.02, sp[i + 1].r * 1.02, stripeAt(i), 4);
    }
    // legs
    const legs = [[0.88, 1, 0], [0.88, -1, 1], [0.12, 1, 1], [0.12, -1, 0]];
    for (const lg of legs) {
      const sh = sp[Math.round(lg[0] * 5)], s = lg[1], t = ((ph) + (lg[2] ? 0.5 : 0)) % 1, st = 2.6, lf = 1.9;
      let fz = sh.z + 0.3, fy = 0;
      if (mode === 'pace') { fz = sh.z + (t < 0.5 ? st - 2 * st * (t / 0.5) : -st + 2 * st * ((t - 0.5) / 0.5)); fy = t >= 0.5 ? lf * Math.sin(Math.PI * (t - 0.5) / 0.5) : 0; }
      else if (lieDown) fz = sh.z + (lg[0] > 0.5 ? 3.0 : -1.2);
      const A0 = [sh.x + s * rb * 0.62, sh.y - sh.r * 0.1, sh.z], T = [sh.x + s * (rb * 0.72 + (lieDown ? 1.0 : 0.1)), fy + 0.4, fz];
      legIK(R, W, A0, T, 2.7, 2.6, [0, 1.5, lg[0] > 0.5 ? -0.4 : 0.9], 1.15, (t, u, x, y) => { const k5 = tone5(u, x, y); return (t > 0.3 && t < 0.5 && k5 > 0) ? tDark[Math.max(1, k5 - 1)] : tFur[k5]; }, ball(ramp5('#F4EEE2')));
    }
    // head: skull, muzzle, ears, eyes, nose, whiskers; the yawn drops the jaw
    const hd = sp[5], hy = lieDown ? hd.y + 1.8 : hd.y + 1.6, hz = hd.z + 3.4, jaw = mode === 'yawn' ? (f ? 1.0 : 0.6) : 0, hr = 2.6;
    const H = [0, hy + (jaw ? 0.6 : 0), hz];
    capC(R, W([0, hd.y + 0.2, hd.z + 0.5]), W([0, hy - 0.6, hz - 0.8]), 1.9, 1.9, limb(tFur), 5);   // the neck
    const headFn = (dx, ny, nz, x, y) => {
      const yh = dirYaw(dir), fwd = dx * Math.sin(yh) + nz * Math.cos(yh), lat = -dx * Math.cos(yh) + nz * Math.sin(yh), aLat = Math.abs(lat), k5 = sph5(dx, ny, nz, x, y);
      if (fwd > 0.5 && ny > 0.0 && ny < 0.3 && aLat > 0.22 && aLat < 0.55) return aLat < 0.4 ? '#FFE680' : '#15151B';
      if (fwd > 0.7 && ny > -0.18 && ny < 0.0 && aLat < 0.16) return '#E7869A';
      if (fwd > 0.45 && ny > -0.72 && ny < 0.0 && aLat < 0.55) return tBelly[Math.max(1, k5)];
      if (ny > 0.42 && fwd > -0.2 && (aLat < 0.1 || (aLat > 0.4 && aLat < 0.58))) return tDark[1];
      if (aLat > 0.66 && ny > -0.3 && ny < 0.1 && fwd > -0.3) return tDark[2];
      return tFur[k5];
    };
    orbC(R, W(H), hr, headFn, 6);
    for (const s of [-1, 1]) { orbC(R, W([s * 1.8, H[1] + 2.0, H[2] - 0.6]), 0.95, ball(tFur), 6); orbC(R, W([s * 1.8, H[1] + 2.0, H[2] - 0.2]), 0.5, () => '#E7869A', 6); }
    if (jaw) { capC(R, W([0, H[1] - 1.0, H[2] + 0.6]), W([0, H[1] - 1.0 - jaw * 2.4, H[2] + 2.8]), 1.0, 0.8, limb(tBelly), 7); orbC(R, W([0, H[1] - 0.4 - jaw * 1.0, H[2] + 2.2]), 1.5, () => '#C8505C', 7); for (const s of [-1, 1]) orbC(R, W([s * 0.9, H[1] - 0.3, H[2] + 2.6]), 0.4, () => '#F4F4F4', 8); }
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    rampOutline(b, R.h, { ramps: [tFur, tBelly, tDark] });
    b.shadow = lieDown ? 24 : 20; b.gy = RX.gy;
    return b;
  }
  M.rouxCompose = composeRoux4;
  B4_PAINTERS.roux = function (ctx, spec) {
    const tot = RPER * FACINGS; spec.frames = tot;
    const fr = ((spec.frame % tot) + tot) % tot, dir = (fr / RPER) | 0, key = 'roux|' + dir + '|' + spec.zoom;
    const s = getSheet(key, RX.cw, RX.ch, RPER, spec.zoom, (P, f, ox, oy) => {
      const b = memoBuf('roux|' + dir + '|' + f, () => composeRoux4(dir, f));
      shadowFb(P, ox + 1, oy, RX.cw >> 1, RX.gy, b.shadow); bblit(b, P, ox, oy);
    });
    return sheetRef(s, fr % RPER, -(RX.cw >> 1), -RX.gy);
  };

  // --- the nutria (8 facings × 2 scurry frames) --------------------------------------------------------------------------------------------------
  const NU = { cw: 18, ch: 14, gy: 10 };
  const nFur = ramp5(C.nutria), nTeeth = ramp5('#E8892A');
  function composeNutria(dir, f) {
    dir = ((dir | 0) % 8 + 8) % 8; f &= 1;
    const R = newRig(NU.cw, NU.ch, NU.cw >> 1, NU.gy), W = wYaw(dirYaw(dir)), fl = limb(nFur);
    const by = 2.0 + (f ? 0.35 : 0);
    capC(R, W([0, by, -3.4]), W([0, by + 0.2, 1.2]), 1.6, 1.9, fl, 4);                         // body
    orbC(R, W([0, by + 0.5, 2.8]), 1.45, (dx, ny, nz, x, y) => { const k5 = sph5(dx, ny, nz, x, y); return (nz > 0.8 && ny > 0.1 && Math.abs(dx) > 0.25 && Math.abs(dx) < 0.55) ? '#15151B' : nFur[k5]; }, 6);   // head
    orbC(R, W([0, by + 0.1, 4.0]), 0.8, ball(ramp5('#B89870')), 6);                           // muzzle
    orbC(R, W([0, by - 0.4, 4.5]), 0.4, ball(nTeeth), 7);                                       // the orange teeth
    for (const s of [-1, 1]) orbC(R, W([s * 0.9, by + 1.7, 2.1]), 0.5, ball(nFur), 6);          // ears
    capC(R, W([0, by - 0.3, -3.4]), W([0.4, by - 0.9, -7.2 - (f ? 0.6 : 0)]), 0.45, 0.25, limb(ramp5('#5A4A3A')), 3);   // the rat tail
    for (const lg of [[1.6, 1, 0], [1.6, -1, 1], [-2.4, 1, 1], [-2.4, -1, 0]]) { const sw = ((lg[2] + f) & 1) ? 1.1 : -1.1; capC(R, W([lg[1] * 1.0, by - 0.5, lg[0]]), W([lg[1] * 1.2, 0.25, lg[0] + sw]), 0.6, 0.5, fl, 4); }
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    rampOutline(b, R.h, { ramps: [nFur, nTeeth, ramp5('#B89870')] });
    b.shadow = 9; b.gy = NU.gy;
    return b;
  }
  M.nutriaCompose = composeNutria;
  B4_PAINTERS.nutria = function (ctx, spec) {
    const tot = 2 * FACINGS; spec.frames = tot;
    const fr = ((spec.frame % tot) + tot) % tot, dir = fr >> 1, key = 'nutria|' + dir + '|' + spec.zoom;
    const s = getSheet(key, NU.cw, NU.ch, 2, spec.zoom, (P, f, ox, oy) => { const b = memoBuf('nutria|' + dir + '|' + f, () => composeNutria(dir, f)); shadowFb(P, ox + 1, oy, NU.cw >> 1, NU.gy, b.shadow); bblit(b, P, ox, oy); });
    return sheetRef(s, fr & 1, -(NU.cw >> 1), -NU.gy);
  };

  // --- the officer wrangling a gator (8 facings × 2): f0 crouched over the pinned gator, f1 the dust puff and a lashing tail --------------------------
  const WR = { cw: 36, ch: 32, gy: 24 };
  function composeWrangle(dir, f) {
    dir = ((dir | 0) % 8 + 8) % 8; f &= 1;
    const gb = composeGator(0, dir, f ? 8 : 6), b = newBuf(WR.cw, WR.ch);
    const gx = (WR.cw - GATORS[0].cw) >> 1, gy0 = WR.gy - gb.gy;
    for (let y = 0; y < gb.h; y++) for (let x = 0; x < gb.w; x++) { const c = gb.d[y * gb.w + x]; if (c) bput(b, gx + x, gy0 + y, c); }
    const S = officerStyle(), R = newRig(14, 24, 7, 22), B = S.B;
    const hw = B.hw, p = { py: 4.6, lean: 0.8, fr: [hw + 1.1, 0, -0.6], fl: [-hw - 1.1, 0, 0.4], hr: [1.0, -4.4, 3.4 + f * 0.6], hl: [-1.0, -4.4, 3.0 - f * 0.6], kpR: [0.3, 1, 1], kpL: [-0.3, 1, 1], epR: [1, -0.5, 0], epL: [-1, -0.5, 0], hu: -0.5, hf: 0.5 };
    drawStudent(R, B, S, p, dirYaw(dir), { anim: 'wrangle', noPack: true });
    const ob = { w: 14, h: 24, d: R.c.slice() }; rampOutline(ob, 24, S);
    const ox = (WR.cw - 14) >> 1, oy = WR.gy - 22 - 1;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 14; x++) { const c = ob.d[y * 14 + x]; if (c) bput(b, ox + x, oy + y, c); }
    if (f) {   // the puff
      const dust = ramp5(C.dust);
      for (let y = 8; y < 30; y++) for (let x = 3; x < 33; x++) {
        const v = ((x - 18) * (x - 18)) / 196 + ((y - 20) * (y - 20)) / 70; if (v > 1) continue;
        const n = hash(0x77, x + y * 41 + dir * 7) % 100;
        if (v > 0.55 && n < 60) continue; if (bget(b, x, y)) continue;
        bput(b, x, y, n < 40 ? dust[3] : n < 75 ? dust[2] : dust[1]);
      }
    }
    b.shadow = 0; b.gy = WR.gy;
    return b;
  }
  M.wrangleCompose = composeWrangle;
  function paintWrangle(ctx, spec) {
    const tot = 2 * FACINGS; spec.frames = tot;
    const fr = ((spec.frame % tot) + tot) % tot, dir = fr >> 1, key = 'wrangle|' + dir + '|' + spec.zoom;
    const s = getSheet(key, WR.cw, WR.ch, 2, spec.zoom, (P, f, ox, oy) => { const b = memoBuf('wrangle|' + dir + '|' + f, () => composeWrangle(dir, f)); shadowFb(P, ox + 1, oy, WR.cw >> 1, WR.gy, 20); bblit(b, P, ox, oy); });
    return sheetRef(s, fr & 1, -(WR.cw >> 1), -WR.gy);
  }

  // --- birds (egret, spoonbill): 8 facings × (stand, preen, wings up, wings down) ----------------------------------------------------------------------------
  const BD = { cw: 26, ch: 22, gy: 17 };
  const bSkins = {
    egret: { body: ramp5('#F4F4F4'), neck: ramp5('#F4F4F4'), wing: ramp5('#F4F4F4'), beak: ramp5('#E8B84A'), leg: ramp5('#2A2A30'), bill: 'pointed' },
    spoonbill: { body: ramp5('#F4A6C0'), neck: ramp5('#FBE4EC'), wing: ramp5('#F08CAE'), beak: ramp5('#9AA0A8'), leg: ramp5('#B8506A'), bill: 'spoon' }
  };
  function composeBird(kind, dir, f) {
    const K = bSkins[kind] || bSkins.egret; dir = ((dir | 0) % 8 + 8) % 8; f = ((f | 0) % 4 + 4) % 4;
    const R = newRig(BD.cw, BD.ch, BD.cw >> 1, BD.gy), W = wYaw(dirYaw(dir)), flap = f >= 2, up = f === 2, preen = f === 1;
    const by = flap ? (up ? 8.4 : 7.6) : 7.2;
    // legs
    for (const s of [-1, 1]) {
      const hip = [s * 0.7, by - 0.6, 0.2], ft = flap ? [s * 0.8, by - 3.6, -1.8] : [s * 0.8, 0.2, 0.3 + (s > 0 && preen ? 0.6 : 0)];
      capC(R, W(hip), W(ft), 0.38, 0.3, limb(K.leg), 4);
      if (!flap) orbC(R, W([ft[0], 0.25, ft[2] + 0.5]), 0.5, ball(K.leg), 4);
    }
    capC(R, W([0, by, -3.2]), W([0, by + 0.5, 2.2]), 1.45, 1.35, limb(K.body), 3);                       // body
    capC(R, W([0, by + 0.1, -2.6]), W([0, by - 0.6, -5.6]), 0.5, 0.3, limb(K.body), 3);                   // tail
    // neck: an S-curve (the preen frame tucks the head down), then the head and bill
    const nk = preen ? [[0, by + 0.8, 2.1], [0, by + 2.2, 2.9], [0, by + 3.0, 3.0], [0, by + 2.4, 3.8]] : flap ? [[0, by + 0.8, 2.1], [0, by + 2.4, 3.3], [0, by + 3.6, 3.7], [0, by + 4.4, 4.9]] : [[0, by + 0.8, 2.1], [0, by + 3.0, 3.2], [0, by + 5.0, 2.0], [0, by + 6.2, 3.2]];
    for (let i = 0; i < 3; i++) capC(R, W(nk[i]), W(nk[i + 1]), 0.7, 0.62, limb(K.neck), 5);
    const hd = nk[3];
    orbC(R, W(hd), 1.05, (dx, ny, nz, x, y) => (nz > 0.7 && ny > 0.0 && ny < 0.4 && Math.abs(dx) > 0.35 ? '#15151B' : K.neck[sph5(dx, ny, nz, x, y)]), 6);
    const bl = kind === 'spoonbill' ? 3.2 : 3.6;
    capC(R, W([hd[0], hd[1] - 0.2, hd[2] + 0.7]), W([hd[0], hd[1] - (preen ? 0.6 : 0.5), hd[2] + 0.7 + bl]), 0.5, kind === 'spoonbill' ? 0.9 : 0.3, limb(K.beak), 7);
    // wings: folded along the flanks, or a fan of three feather blades per side
    for (const s of [-1, 1]) {
      const sh = [s * 1.2, by + 0.9, 0.6];
      if (!flap) { capC(R, W(sh), W([s * 1.45, by - 0.4, -3.8]), 0.95, 0.6, limb(K.wing), 5); continue; }
      const ang = up ? [[5.4, 6.4, -0.6], [4.8, 7.8, -2.4], [3.6, 8.6, -3.8]] : [[5.8, -1.6, -0.4], [5.2, -3.0, -2.2], [4.0, -3.8, -3.6]];
      for (let i = 0; i < 3; i++) { const a = ang[i]; capC(R, W(sh), W([s * a[0], sh[1] + a[1], a[2] + 0.4]), 0.9 - i * 0.12, 0.5, (t, u, x, y) => K.wing[Math.min(4, tone5(u, x, y) + (i === 0 ? 0 : 0))], 5); }
    }
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    rampOutline(b, R.h, { ramps: [K.body, K.neck, K.wing, K.beak, K.leg] });
    b.shadow = flap ? 0 : 7; b.gy = BD.gy;
    return b;
  }
  M.birdCompose = composeBird;
  for (const kind of ['egret', 'spoonbill']) {
    B4_PAINTERS[kind] = function (ctx, spec) {
      const tot = 4 * FACINGS; spec.frames = tot;
      const fr = ((spec.frame % tot) + tot) % tot, dir = fr >> 2, key = kind + '|' + dir + '|' + spec.zoom;
      const s = getSheet(key, BD.cw, BD.ch, 4, spec.zoom, (P, f, ox, oy) => { const b = memoBuf(kind + '|' + dir + '|' + f, () => composeBird(kind, dir, f)); if (b.shadow) shadowFb(P, ox + 1, oy, BD.cw >> 1, BD.gy, b.shadow); bblit(b, P, ox, oy); });
      return sheetRef(s, fr & 3, -(BD.cw >> 1), -BD.gy);
    };
  }
  Object.assign(SHEET_PAINTERS, B4_PAINTERS);
  for (const fam of Object.keys(B4_PAINTERS)) M.registerPainter(fam, B4_PAINTERS[fam]);
  /** where the eyes of a gator sprite are, in 1× px relative to its anchor (the body centre on the ground): [x1, y1, x2, y2] for a gator frame (`gatorFrame` index) of a variant; the lights pass can hang the night eye-glow there */
  M.gatorEyes = function (v, frame) {
    v = Math.max(0, Math.min(2, v | 0)); const G = GATORS[v], rb = G.rb, tot = GPER * FACINGS, fr = ((frame | 0) % tot + tot) % tot, dir = (fr / GPER) | 0, k = fr % GPER;
    const mode = k < 2 ? 'swim' : k < 6 ? 'walk' : k < 8 ? 'bask' : 'lunge', f = mode === 'swim' ? k : mode === 'walk' ? k - 2 : mode === 'bask' ? k - 6 : k - 8;
    const ph = mode === 'walk' ? f / 4 : mode === 'swim' ? f * 0.5 : f * 0.25, lunge = mode === 'lunge' ? (f === 0 ? 1.0 : 0.55) : 0, sp = gatorSpine(G, mode, f, ph, lunge), sk = sp[11], W = wYaw(dirYaw(dir)), out = [];
    const jaw = mode === 'bask' ? (f === 0 ? 0.55 : 0.85) : mode === 'lunge' ? (f === 0 ? 1.15 : 0.35) : 0, snoutUp = jaw * rb * 0.32;
    for (const s of [-1, 1]) { const w = W([sk.x + s * sk.r * 0.55, sk.y + sk.r * 0.78 + snoutUp * 0.3, sk.z + sk.r * 0.35]); out.push(Math.round(w[0]), Math.round(-w[1] + w[2] * 0.5)); }
    return out;
  };

  // ---------------------------------------------------------------------------
  // B4 vehicles on the ground-plane projection: boxes sampled face by face (lit from the upper left), capsule hulls, student crews from the
  // rig. Fogger truck (plume start at the nozzle), campus bus, pirogue and Cajun Navy boat with paddlers, parade floats (3 + the king cake).
  // ---------------------------------------------------------------------------
  const VIEW_D = [0, 0.4472, 0.8944], LIGHT_D = (() => { const v = [-0.55, 0.72, 0.42], l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  /** an axis-aligned (in the local frame) box: centre c, half sizes hs; the faces that look at the viewer are sampled and shaded by the key light.
   *  pat(face, a, b, k) may return a colour for the sample at face coordinates (a, b) in px from the face centre (face '+x' '-x' '+y' '+z' '-z'). */
  function boxC(R, W, c, hs, ramp, pat, tag) {
    const F = [['+x', [1, 0, 0], [0, 0, 1], [0, 1, 0], hs[0], hs[2], hs[1]], ['-x', [-1, 0, 0], [0, 0, 1], [0, 1, 0], hs[0], hs[2], hs[1]], ['+y', [0, 1, 0], [1, 0, 0], [0, 0, 1], hs[1], hs[0], hs[2]],
      ['+z', [0, 0, 1], [1, 0, 0], [0, 1, 0], hs[2], hs[0], hs[1]], ['-z', [0, 0, -1], [1, 0, 0], [0, 1, 0], hs[2], hs[0], hs[1]]];
    for (const f of F) {
      const nw = W(f[1]); if (nw[0] * VIEW_D[0] + nw[1] * VIEW_D[1] + nw[2] * VIEW_D[2] <= 0.02) continue;
      const k = M.toneAt(0.5 + 0.5 * (nw[0] * LIGHT_D[0] + nw[1] * LIGHT_D[1] + nw[2] * LIGHT_D[2]), 0, 0, TH5, 0), t1 = f[2], t2 = f[3];
      for (let a = -f[5]; a <= f[5] + 0.001; a += 0.4) for (let b = -f[6]; b <= f[6] + 0.001; b += 0.4) {
        const p = [c[0] + f[1][0] * f[4] + t1[0] * a + t2[0] * b, c[1] + f[1][1] * f[4] + t1[1] * a + t2[1] * b, c[2] + f[1][2] * f[4] + t1[2] * a + t2[2] * b];
        const w = W(p), s = scrC(R, w), x = Math.round(s[0] - 0.5), y = Math.round(s[1] - 0.5);
        const col = (pat && pat(f[0], a, b, k)) || ramp[M.toneAt(0.5 + 0.5 * (nw[0] * LIGHT_D[0] + nw[1] * LIGHT_D[1] + nw[2] * LIGHT_D[2]), x, y, TH5, 0.03)];
        rput(R, x, y, col, w[2] + w[1] * 0.5, tag || 3);
      }
    }
  }
  const wheelC = (R, W, x, y, z, rad, f, hub) => {   // a wheel: a fat capsule across the axle with a hub dot that turns with the frame
    const s = x < 0 ? -1 : 1, tire = ramp5('#23232B');
    capC(R, W([x - s * 0.7, y, z]), W([x + s * 0.7, y, z]), rad, rad, limb(tire), 4);
    orbC(R, W([x + s * 0.9, y + (f & 1 ? rad * 0.45 : 0), z + (f & 1 ? 0 : rad * 0.45)]), 0.55, () => hub || '#9AA0A8', 6);
  };
  function finishVeh(R, extraRamps, shadowW) {
    const b = { w: R.w, h: R.h, d: R.c.slice() };
    rampOutline(b, R.h, { ramps: extraRamps || [] });
    b.shadow = shadowW | 0; b.gy = R.gy;
    return b;
  }
  const steelR = ramp5('#8A8A8E'), creamR = ramp5('#E8E8E8'), purpR5 = ramp5(P1), goldR5 = ramp5(GD), glassR = ramp5('#6FA0C8'), purp2R5 = ramp5(P2);

  // --- fogger truck: 8 facings × 4 frames (wheels turn, the beacon blinks, the plume puffs) ----------------------------------------------------
  const FG = { cw: 44, ch: 30, gy: 21, per: 4 };
  function composeFogger(dir, f) {
    const R = newRig(FG.cw, FG.ch, FG.cw >> 1, FG.gy), W = wYaw(dirYaw(dir));
    for (const sz of [-5.6, 5.6]) for (const sx of [-3.4, 3.4]) wheelC(R, W, sx, 1.5, sz, 1.6, f + (sz > 0 ? 1 : 0));
    boxC(R, W, [0, 3.0, -1.0], [2.9, 0.9, 7.6], ramp5('#4A4A52'), null, 3);                                                                          // chassis
    capC(R, W([0, 6.0, -6.4]), W([0, 6.0, 0.8]), 2.7, 2.7, (t, u, x, y) => { const k = tone5(u, x, y); return (t > 0.42 && t < 0.56) ? purpR5[k] : (t > 0.56 && t < 0.62 ? goldR5[k] : steelR[k]); }, 4);   // the tank, a purple band and a gold line
    orbC(R, W([0, 6.0, -6.6]), 2.55, ball(steelR), 4);
    boxC(R, W, [0, 5.0, 4.6], [2.9, 2.3, 2.4], creamR, (face, a, b) => (face === '+z' && b > 0.2 && b < 2.2 && Math.abs(a) < 2.3 ? glassR[(a < -0.5 ? 3 : 2)] : (face.length === 2 && face[1] === 'x' && b > 0.3 && Math.abs(a) < 1.6 ? glassR[2] : null)), 5);   // cab with glass
    boxC(R, W, [0, 3.6, 7.8], [2.5, 0.9, 0.8], steelR, null, 5);                                                                                     // bonnet
    orbC(R, W([1.7, 4.3, 8.5]), 0.45, () => '#FFF1A8', 7); orbC(R, W([-1.7, 4.3, 8.5]), 0.45, () => '#FFF1A8', 7);
    orbC(R, W([0, 7.8, 4.6]), 0.8, () => (f & 1 ? '#FF6A5A' : '#7A2A2A'), 8);                                                                          // beacon
    capC(R, W([0, 4.4, -7.2]), W([0, 4.2, -9.4]), 0.65, 0.65, limb(ramp5('#5A5A62')), 6);                                                            // the nozzle
    // the plume's first puffs: pale mist rolling off the nozzle, growing frame by frame
    const mist = [ramp5('#F4F6F8'), ramp5('#D8E0E6')];
    for (let i = 0; i < 4; i++) {
      const ph = (f + i) % 4, r = 0.9 + ph * 0.7, back = 10.4 + ph * 2.2 + i * 0.6, up = 4.3 + ph * 0.5 + (i & 1 ? 0.6 : -0.2), side = ((i * 7 + f) % 3 - 1) * 0.9;
      orbC(R, W([side, up, -back]), r, (dx, ny, nz, x, y) => { if (((x + y + i) & 1) && ph > 1) return null; return mist[(ph > 2 ? 1 : 0)][Math.min(4, 2 + sph5(dx, ny, nz, x, y) - 1 + (ph ? 0 : 1))]; }, 9);
    }
    return finishVeh(R, [steelR, creamR, purpR5, goldR5, glassR, ramp5('#4A4A52'), ramp5('#F4F6F8'), ramp5('#D8E0E6'), ramp5('#23232B'), ramp5('#5A5A62')], 20);
  }
  // --- campus bus: 8 facings × 2 frames ------------------------------------------------------------------------------------------------------
  const BS = { cw: 46, ch: 30, gy: 21, per: 2 };
  function composeBus(dir, f) {
    const R = newRig(BS.cw, BS.ch, BS.cw >> 1, BS.gy), W = wYaw(dirYaw(dir));
    for (const sz of [-8.4, 8.0]) for (const sx of [-3.9, 3.9]) wheelC(R, W, sx, 1.5, sz, 1.7, f);
    boxC(R, W, [0, 5.2, 0], [3.8, 3.4, 12.6], purpR5, (face, a, b) => {
      if (face === '+y') return null;
      if (b > -0.8 && b < 0.2) return goldR5[face === '+x' || face === '-x' ? 3 : 2];                                                                   // the gold belt line
      if ((face === '+x' || face === '-x') && b > 0.9 && b < 3.0 && ((a + 40) % 5.2) < 3.6 && Math.abs(a) < 11.5) return glassR[b > 2.1 ? 3 : 2];
      if (face === '+z' && b > 0.7 && b < 3.0 && Math.abs(a) < 3.2) return glassR[a < 0 ? 3 : 2];
      if (face === '+z' && b < -1.8 && Math.abs(a) > 2.4) return '#FFF1A8';
      return null;
    }, 4);
    boxC(R, W, [0, 8.9, 0], [3.5, 0.5, 12.0], purp2R5, null, 5);                                                                                      // roof
    return finishVeh(R, [purpR5, goldR5, glassR, purp2R5, ramp5('#23232B'), ramp5('#9AA0A8')], 26);
  }
  // --- boats: a hull of bark-brown capsules, paddlers from the student rig ---------------------------------------------------------------------------
  const BT = { cw: 36, ch: 28, gy: 16, per: 4 };
  const barkR = ramp5(PAL.bark), barkD = ramp5(shade(PAL.bark, 0.75));
  const waterRip = [PAL.shallows, '#8FC6AB', '#B2E1BC'];
  function paddlerStyle(vest, skin, hairC) {
    const key = 'pad' + vest + skin + hairC; let S = bandStyles.get(key); if (S) return S;
    const F = { skin: skin, hairC: hairC, fam: 0, glasses: 0, outfit: 0, style: (skin + hairC) % 6, carry: 6, hat: (skin + hairC) % 3 === 0 ? 1 : 0, build: 1, acc: vest ? 2 : 1 };
    S = buildStyle(F, vest ? { top: '#F07830', kind: 'long', bot: '#2B3350', bk: 'long', shoe: '#23232B', pat: 'stole' } : { top: P1, kind: 'tee', bot: KHK, bk: 'shorts', shoe: '#6B4A2E' });
    bandStyles.set(key, S); return S;
  }
  function composeBoat(navy, dir, f) {
    const R = newRig(BT.cw, BT.ch, BT.cw >> 1, BT.gy), W = wYaw(dirYaw(dir)), L = 12;
    ripples(R, W, L + 2.5, 3.8, f * 0.9, waterRip, false);
    // the hull: five short capsules along z (bow and stern rise), an inner floor
    const prof = [[-L, 0.35, 0.3], [-L * 0.62, 1.55, 0.15], [-L * 0.2, 1.95, 0.05], [L * 0.2, 1.95, 0.05], [L * 0.62, 1.55, 0.15], [L, 0.35, 0.3]];
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i], b = prof[i + 1];
      for (const s of [-1, 1]) capC(R, W([s * a[1] * 0.55, 1.0 + a[2] * 6, a[0]]), W([s * b[1] * 0.55, 1.0 + b[2] * 6, b[0]]), 0.9, 0.9, limb(barkR), 3);
      capC(R, W([0, 0.55, a[0]]), W([0, 0.55, b[0]]), 1.05, 1.05, limb(barkD), 2);
    }
    // the crew: kneeling students facing the bow, a paddle each (the stroke goes through the 4 frames)
    const crew = [[-4.4, 0, 'R'], [3.6, 1, 'L']];
    const ramps = [barkR, barkD];
    crew.forEach((cr, i) => {
      const S = paddlerStyle(navy ? 1 : 0, 1 + ((i * 2 + (dir & 3)) % 4), i * 3 + 1), B = S.B, hw = B.hw, side = cr[2] === 'R' ? 1 : -1;
      const ph = ((f + (i ? 2 : 0)) % 4) / 4, reach = Math.sin(ph * Math.PI * 2);
      const p = { py: 3.0, pz: cr[0], lean: 0.18, fr: [hw + 0.2, 0.3, cr[0] + 3.0], fl: [-hw - 0.2, 0.3, cr[0] + 3.0], kpR: [0.2, 1, 0.6], kpL: [-0.2, 1, 0.6],
        hr: [side * 1.5 + 1.0, -1.2 + 0.8 * reach, 1.6 + reach * 1.6], hl: [side * 1.5 - 0.6, 1.4 - 0.5 * reach, 1.0 + reach * 1.2], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], tw: 0.25 * side * reach };
      drawStudent(R, B, S, p, dirYaw(dir), { anim: 'row', noPack: true, PJ: scrC });
      // the paddle: from the upper hand down to the blade in the water on this side
      const bx = side * 3.2, bz = cr[0] + 1.0 + reach * 3.2;
      capC(R, W([side * 2.0, 6.0, cr[0] + 1.2]), W([bx, 0.9, bz]), 0.32, 0.32, limb(ramp5('#B08D5E')), 7);
      orbC(R, W([bx, 0.8, bz]), 1.0, ball(ramp5('#B08D5E')), 7, 0.6);
      for (const r of S.ramps) ramps.push(r);
    });
    if (navy) { capC(R, W([0, 1.5, -L + 0.6]), W([0, 9.6, -L + 0.6]), 0.3, 0.3, limb(steelR), 7); boxC(R, W, [0.0, 8.4, -L - 0.6], [0.2, 1.2, 1.6], goldR5, (face, a, b) => (face === '+x' || face === '-x') && Math.abs(b) < 0.3 && Math.abs(a) < 0.8 ? P1 : null, 8); }
    ripples(R, W, L + 2.5, 3.8, f * 0.9, waterRip, true, 1);
    return finishVeh(R, ramps.concat([goldR5, steelR, ramp5('#B08D5E')]), 0);
  }

  // --- parade floats: 4 variants (tiger, gator, fleur-de-lis, king cake), 8 facings × 2 frames ---------------------------------------------------
  const FL = { cw: 80, ch: 66, gy: 48, per: 2 };
  function composeFloat(variant, dir, f) {
    variant = ((variant | 0) % 4 + 4) % 4;
    const R = newRig(FL.cw, FL.ch, FL.cw >> 1, FL.gy), W = wYaw(dirYaw(dir)), crepe = [P2, GD, '#2E8B57', P1];
    for (const sz of [-11, 11]) for (const sx of [-6.8, 6.8]) wheelC(R, W, sx, 1.8, sz, 2.0, f);
    // the trailer deck and its crepe-paper skirt: vertical bands of purple, gold and green
    boxC(R, W, [0, 3.8, 0], [6.6, 1.8, 16.0], purpR5, (face, a, b) => {
      if (face === '+y') return (Math.abs(a) > 4.6 || Math.abs(b) > 12.1) ? goldR5[3] : null;
      const idx = Math.floor((a + 40) / 1.6 + (f ? 0.5 : 0)) % 3, cols = [ramp5(P2), goldR5, ramp5('#2E8B57')];
      return cols[idx][face === '+z' || face === '-z' ? 3 : 2];
    }, 4);
    const top = 5.6;
    if (variant === 0) {          // the tiger: a big orange head on a purple plinth, with a gold crown of stars
      boxC(R, W, [0, top + 1.8, -4.0], [5.0, 1.8, 6.0], purp2R5, null, 5);
      orbC(R, W([0, top + 9.6, -4.0]), 8.0, (dx, ny, nz, x, y) => {
        const yh = dirYaw(dir), fwd = dx * Math.sin(yh) + nz * Math.cos(yh), lat = -dx * Math.cos(yh) + nz * Math.sin(yh), aLat = Math.abs(lat), k5 = sph5(dx, ny, nz, x, y);
        if (fwd > 0.45 && ny > 0.05 && ny < 0.3 && aLat > 0.22 && aLat < 0.5) return aLat < 0.38 ? '#FFE680' : '#15151B';
        if (fwd > 0.7 && ny > -0.2 && ny < 0.02 && aLat < 0.15) return '#E7869A';
        if (fwd > 0.4 && ny > -0.75 && ny < 0.0 && aLat < 0.55) return tBelly[Math.max(1, k5)];
        if (ny > 0.4 && fwd > -0.1 && (aLat < 0.1 || (aLat > 0.36 && aLat < 0.5))) return tDark[1];
        return tFur[k5];
      }, 6);
      for (const s of [-1, 1]) orbC(R, W([s * 6.0, top + 16.0, -4.6]), 2.5, ball(tFur), 6);
    } else if (variant === 1) {   // the bayou: a green gator head rising from cypress knees, with moss
      const gr = ramp5('#4A7A3A');
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) capC(R, W([s * 5.2, top, -11 + i * 5]), W([s * 5.2, top + 8.5 + i * 2.2, -11 + i * 5]), 1.5, 0.8, limb(ramp5('#7A5A3A')), 6);
      capC(R, W([0, top + 3.2, -9]), W([0, top + 4.6, 3.5]), 4.0, 3.4, limb(gr), 5);
      orbC(R, W([0, top + 5.4, 5.0]), 4.4, ball(gr), 6);
      capC(R, W([0, top + 4.6, 6.5]), W([0, top + 4.2, 14]), 2.8, 2.0, limb(gr), 6);
      for (const s of [-1, 1]) orbC(R, W([s * 2.0, top + 8.8, 5.8]), 1.2, (dx, ny, nz) => (nz > 0.5 ? '#FFE680' : '#2E5A2A'), 7);
    } else if (variant === 2) {   // the fleur-de-lis: three gold petals on a purple stem, purple and gold balloon arches
      capC(R, W([0, top, -2]), W([0, top + 11, -2]), 2.2, 2.0, limb(goldR5), 5);
      orbC(R, W([0, top + 15.5, -2]), 4.4, ball(goldR5), 6, 7.8);
      for (const s of [-1, 1]) { orbC(R, W([s * 5.2, top + 12.2, -2]), 3.4, ball(goldR5), 6, 5.4); capC(R, W([s * 2.0, top + 7.0, -2]), W([s * 6.2, top + 10.6, -2]), 1.2, 1.2, limb(goldR5), 5); }
      capC(R, W([-6.0, top + 4.0, -2]), W([6.0, top + 4.0, -2]), 1.3, 1.3, limb(purpR5), 5);
      for (let i = 0; i < 6; i++) { const z = -14 + i * 5; for (const s of [-1, 1]) orbC(R, W([s * 5.8, top + 2.0 + (i & 1) * 1.0, z]), 1.9, ball(i & 1 ? ramp5(P2) : goldR5), 6); }
    } else {                      // the king cake: a ring of sugar-banded dough with the baby on top
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, band = [ramp5(P2), goldR5, ramp5('#2E8B57')][k % 3]; orbC(R, W([Math.cos(a) * 6.6, top + 4.0, Math.sin(a) * 6.6 - 3.0]), 3.2, ball(band), 6); }
      for (let k = 0; k < 14; k++) { const a = (k + 0.5) / 14 * Math.PI * 2; orbC(R, W([Math.cos(a) * 6.6, top + 5.8, Math.sin(a) * 6.6 - 3.0]), 2.5, ball(ramp5('#C9964F')), 6); }
      orbC(R, W([4.6, top + 10.2, 1.6]), 1.3, ball(ramp5('#F4D4B0')), 7);                                                                                // the little baby
    }
    // two riders waving from the front corners of the deck (krewe costumes from the student rig, a little smaller than a student)
    [[-4.4, 11.8], [4.4, 11.8]].forEach((rd, i) => {
      const S = kreweStyle((variant * 40 + i * 17 + 9) & 255), B = S.B, hw = B.hw, w = (f + i) & 1;
      const p = { py: B.hipY - 0.2, scale: 0.72, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0], hr: [1.9, 4.9 + w * 0.5, 0.5], hl: [-1.2, 1.0 - w * 3.0, 1.2], epR: [1, 0.2, -0.3] };
      const off = W([rd[0], 0, rd[1]]);
      const PJ2 = (R_, q) => [R_.cx + q[0] + off[0], R_.gy - (q[1] + top + off[1]) + (q[2] + off[2]) * 0.5, q[2] + off[2]];
      drawStudent(R, B, S, p, dirYaw(dir), { anim: 'ride', noPack: true, PJ: PJ2 });
    });
    return finishVeh(R, [purpR5, goldR5, purp2R5, ramp5(P2), ramp5('#2E8B57'), ramp5('#4A7A3A'), tFur, tBelly, tDark, ramp5('#C9964F'), ramp5('#7A5A3A'), ramp5('#23232B')], 0);
  }
  // sheets for the vehicle families
  function vehFamily(name, dim, per, cell) {
    B4_PAINTERS[name] = function (ctx, spec) {
      const v = name === 'float' ? ((spec.variant | 0) & 3) : 0, tot = per * FACINGS; spec.frames = tot; spec.framesPerVariant = false;
      const fr = ((spec.frame % tot) + tot) % tot, dir = (fr / per) | 0, key = name + '|' + v + '|' + dir + '|' + spec.zoom;
      const s = getSheet(key, dim.cw, dim.ch, per, spec.zoom, (P, f, ox, oy) => { const b = memoBuf(name + '|' + v + '|' + dir + '|' + f, () => cell(v, dir, f)); if (b.shadow) shadowFb(P, ox + 1, oy, dim.cw >> 1, dim.gy, b.shadow); bblit(b, P, ox, oy); });
      return sheetRef(s, fr % per, -(dim.cw >> 1), -dim.gy);
    };
  }
  vehFamily('fogger', FG, FG.per, (v, d, f) => composeFogger(d, f));
  vehFamily('bus', BS, BS.per, (v, d, f) => composeBus(d, f));
  vehFamily('pirogue', BT, BT.per, (v, d, f) => composeBoat(false, d, f));
  vehFamily('navy', BT, BT.per, (v, d, f) => composeBoat(true, d, f));
  vehFamily('float', FL, FL.per, (v, d, f) => composeFloat(v, d, f));
  M.vehCompose = { fogger: composeFogger, bus: composeBus, boat: composeBoat, float: composeFloat };
  Object.assign(SHEET_PAINTERS, B4_PAINTERS);
  for (const fam of Object.keys(B4_PAINTERS)) M.registerPainter(fam, B4_PAINTERS[fam]);

  // ---------------------------------------------------------------------------
  // The frame API render uses for everything but agents (docs/INTEGRATION_NOTES.md '## art pass B4'): every directional sprite is
  // frame = facing × per + k, facing = the football fbDir octant (0 SE, 1 S, 2 SW, 3 W, 4 NW, 5 N, 6 NE, 7 E).
  // ---------------------------------------------------------------------------
  const ENT_FRAMES = { gator: GPER * 8, roux: RPER * 8, nutria: 16, egret: 32, spoonbill: 32, officer: 64, 'officer:wrangle': 16, fogger: 32, bus: 16, pirogue: 32, navy: 32, float: 16, band: 32, krewe: 32 };
  for (const id of Object.keys(ENT_FRAMES)) M.setFrames(id, ENT_FRAMES[id]);
  M.entFrames = Object.freeze(Object.assign({}, ENT_FRAMES));
  /** heading octant of a mover with previous (px, py) and current (tx, ty) tile positions; falls back to its 0–3 `dir` (agents.js convention) */
  function head8(m, fallback) {
    if (m && Number.isFinite(m.tx) && Number.isFinite(m.px)) { const dx = m.tx - m.px, dy = m.ty - m.py; if (dx * dx + dy * dy > 0.0004) return M.fbDir(dx, dy); }
    const d = Number.isFinite(m && m.dir) ? (m.dir | 0) : (Number.isFinite(fallback) ? fallback | 0 : 1);
    return (((d % 4) + 4) % 4) * 2;
  }
  M.head8 = head8;
  const GMODE_OF = { SWIM: 'swim', WANDER: 'walk', RETREAT: 'walk', RETURN: 'walk', WALK: 'walk' };
  /** gator frame. gatorFrame(state, f, gator, lunge): state is the gator's state string (or 'swim' | 'walk' | 'bask' | 'lunge'), f the animation counter (render passes frameNo >> 3),
   *  lunge true while a student is fleeing from it */
  M.gatorFrame = function (st, f, ga, lunge) {
    f = Number.isFinite(f) ? (f | 0) : 0;
    let mode = typeof st === 'string' ? (GMODE_OF[st] || (st === 'swim' || st === 'walk' || st === 'bask' || st === 'lunge' ? st : 'bask')) : (st === 0 ? 'swim' : st === 1 ? 'walk' : 'bask');
    if (lunge) mode = 'lunge';
    const id = ga && Number.isFinite(ga.id) ? ga.id | 0 : 0, moving = ga && Number.isFinite(ga.px) && Math.abs(ga.tx - ga.px) + Math.abs(ga.ty - ga.py) > 0.004;
    if (mode === 'walk' && ga && !moving) mode = 'bask';
    const d8 = moving ? head8(ga, 0) : ((((ga && Number.isFinite(ga.dir) ? ga.dir & 3 : 0) * 2 + ([0, 1, -1, 0, 2, -2][hash(id, 0x61) % 6])) + 8) & 7);
    const n = mode === 'walk' ? 4 : 2, k = mode === 'swim' ? (f + id) & 1 : mode === 'walk' ? (f + id) & 3 : mode === 'bask' ? ((f >> 2) + id) & 1 : (f >> 1) & 1;
    return d8 * GPER + GMODES[mode] + k;
  };
  /** officer frame (walk 8 facings × 8, or wrangle 8 × 2); `o` any {tx, ty, px, py, dir} mover; tick the render frame counter */
  M.officerFrame = function (o, tick, wrangle) {
    const d8 = head8(o, 1), t = Number.isFinite(tick) ? tick : 0, moving = o && Number.isFinite(o.px) && Math.abs(o.tx - o.px) + Math.abs(o.ty - o.py) > 0.004;
    if (wrangle) return d8 * 2 + ((t >> 3) & 1);
    return d8 * 8 + (moving ? ((t >> 2) & 7) : 0);
  };
  /** frame of a vehicle sprite ('fogger' 4/facing, 'bus' 2, 'pirogue' / 'navy' 4, 'officer' crew car walks) */
  M.vehicleFrame = function (id, v, tick) {
    const t = Number.isFinite(tick) ? tick : 0, d8 = head8(v, 1);
    switch (id) {
      case 'fogger': return d8 * 4 + ((t >> 3) & 3);
      case 'bus': return d8 * 2 + ((t >> 3) & 1);
      case 'pirogue': case 'navy': return d8 * 4 + ((t >> 3) & 3);
      case 'officer': return M.officerFrame(v, t, false);
    }
    return d8 * 2 + ((t >> 3) & 1);
  };
  /** parade members have no heading: floats and the krewe's walkers show their 3/4 SE view, the Bayou Brass marches toward the viewer */
  M.paradeFrame = function (kind, tick, facing) {
    const t = Number.isFinite(tick) ? tick : 0, d = Number.isFinite(facing) ? (facing & 7) : (kind === 'float' ? 0 : 1);
    return kind === 'float' ? d * 2 + ((t >> 3) & 1) : d * 4 + ((t >> 3) & 3);
  };
  /** Roux on all fours: r.state 'YAWN' → yawn, 'LIE' → lie, 'IDLE' → idle, anything moving → pace */
  M.rouxFrame = function (r, tick) {
    const t = Number.isFinite(tick) ? tick : 0, d8 = head8(r, 1), st = r && r.state;
    if (st === 'YAWN') return d8 * RPER + 8 + ((t >> 5) & 1);
    if (st === 'LIE') return d8 * RPER + 6 + ((t >> 5) & 1);
    const moving = r && Number.isFinite(r.px) && Math.abs(r.tx - r.px) + Math.abs(r.ty - r.py) > 0.002;
    if (st === 'IDLE' || !moving) return d8 * RPER + 4 + ((t >> 4) & 1);
    return d8 * RPER + ((t >> 3) & 3);
  };
  /** birds: standing (0, 1 preening) most of the time, a wing cycle (2, 3) now and then or always when `flying`; facing 0–7 */
  M.birdFrame = function (kind, k, tick, d8, flying) {
    const t = Number.isFinite(tick) ? tick : 0, id = k | 0, ph = hash(id, 0x77) % 400;
    d8 = Number.isFinite(d8) ? (d8 & 7) : (hash(id, 0x33) & 7);
    if (flying) return d8 * 4 + 2 + ((t >> 3) & 1);
    const u = (t + ph) % 520;
    if (u > 480) return d8 * 4 + 2 + ((t >> 3) & 1);          // a short flap
    return d8 * 4 + (((u % 160) > 120) ? 1 : 0);              // stand, with an occasional preen
  };
  /** nutria / critters with 2 frames per facing */
  M.critterFrame = function (kind, frame, d8) { return ((Number.isFinite(d8) ? d8 & 7 : 1)) * 2 + ((frame | 0) & 1); };
  M.entityFacings = FACINGS;
  // @@B4-END

  // ---------------------------------------------------------------------------
  // Init: pre-bake the sheets the first frame is likely to need (the default student's walk, every facing: the stand-in while a look bakes)
  // ---------------------------------------------------------------------------
  M.initEntities = function () {
    try {
      for (let d = 0; d < FACINGS; d++) M.get('agent', STU_DEFAULT, d * SA.walk.n, 1);
      M.get('gator', 1, 0, 1); M.get('officer', 0, 0, 1);
      for (const id of ['smoker', 'cornhole', 'snoball', 'pelican', 'armadillo']) { M.get(id, 0, 0, 1); M.get(id, 0, 1, 1); }
      for (let f = 0; f < 3; f++) { M.get('bonfire', 0, f, 1); M.get('bubble', 0, f, 1); }
      for (let f = 0; f < 4; f++) { M.get('gate', 0, f, 1); M.get('barrierGate', 0, f, 1); }
      M.get('tent', 0, 0, 1); M.get('nest', 0, 0, 1);
    } catch (e) { try { BSU.error('sprites_entities', 'init', e); } catch (e2) { /* never throw */ } }
  };
  if (typeof M.init === 'function' && !M._initWrappedEntities) {
    const coreInit = M.init;
    M.init = function (state) { coreInit(state); M.initEntities(); };
    M._initWrappedEntities = true;
  }

  // ---------------------------------------------------------------------------
  // selfTest (registered through BSU.sprites._tests; also callable as entitiesSelfTest)
  // ---------------------------------------------------------------------------
  const CELLS = {   // 1× cell sizes [w, h] and feet anchors of the B4 sprites (anchor = (−w/2, −gy))
    agent: [14, 24, 22], 'agent:idle': [14, 24, 22], 'agent:sit': [14, 24, 22], 'agent:splash': [14, 24, 22], 'agent:slap': [14, 24, 22], 'agent:tube': [14, 24, 22], 'agent:beads': [14, 24, 22], 'agent:selfie': [14, 24, 22], 'agent:binoculars': [14, 24, 22],
    'agent:flee': [16, 28, 26], 'agent:cheer': [16, 28, 26], 'agent:wave': [16, 28, 26], 'agent:cap': [16, 28, 26], 'agent:foam': [16, 28, 26], 'agent:umbrella': [18, 30, 28],
    officer: [14, 24, 22], 'officer:wrangle': [WR.cw, WR.ch, WR.gy], band: [16, 28, 26], krewe: [16, 28, 26], roux: [RX.cw, RX.ch, RX.gy], nutria: [NU.cw, NU.ch, NU.gy], egret: [BD.cw, BD.ch, BD.gy], spoonbill: [BD.cw, BD.ch, BD.gy],
    fogger: [FG.cw, FG.ch, FG.gy], bus: [BS.cw, BS.ch, BS.gy], pirogue: [BT.cw, BT.ch, BT.gy], navy: [BT.cw, BT.ch, BT.gy], float: [FL.cw, FL.ch, FL.gy]
  };
  const SIZES = { pelican: L.pelican, armadillo: L.armadillo, tent: L.tent, smoker: L.smoker, cornhole: L.cornhole, snoball: L.snoball, bonfire: L.bonfire, gate: L.gate, barrierGate: L.barrierGate, nest: L.nest, bubble: L.bubble };
  M.entitySizes = Object.freeze(Object.assign({}, SIZES, (function () { const o = {}; for (const k of Object.keys(CELLS)) o[k] = [CELLS[k][0], CELLS[k][1]]; return o; })()));
  M.entityCells = Object.freeze(CELLS);
  M.entityConst = L;
  let selfRuns = 0;
  function entitiesSelfTest() {
    const notes = [];
    const check = (c, m) => { if (!c) notes.push(m); };
    const g = (id, v, f, z) => M.get(id, v | 0, f | 0, z || 1);
    const pix = (b) => b.d.filter((c) => c).length;
    const differ = (list) => { let same = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (bequal(list[i], list[j])) same++; return same; };
    try {
      // 1. sizes and anchors of every B4 id (and the kept tailgate / gate props), first and last frame
      for (const id of Object.keys(CELLS)) {
        const tot = M.frames(id), c = CELLS[id];
        for (const f of [0, tot - 1]) { const e = g(id, 0, f); check(e && e.sw === c[0] && e.sh === c[1] && e.ox === -(c[0] >> 1) && e.oy === -c[2], id + ' f' + f + ' is ' + c[0] + '×' + c[1] + ' with the feet anchor (−' + (c[0] >> 1) + ', −' + c[2] + ')' + (e ? ' (got ' + e.sw + '×' + e.sh + ' @ ' + e.ox + ',' + e.oy + ')' : ' (null)')); }
      }
      for (const id of Object.keys(SIZES)) { const e = g(id, 0, 0); check(e && e.sw === SIZES[id][0] && e.sh === SIZES[id][1], id + ' is ' + SIZES[id].join('×') + (e ? ' (got ' + e.sw + '×' + e.sh + ')' : ' (null)')); }
      for (let v = 0; v < 3; v++) { const e = g('gator', v, 0), G = GATORS[v]; check(e && e.sw === G.cw && e.sh === G.ch && e.ox === -(G.cw >> 1) && e.oy === -(G.ch - 9), 'gator v' + v + ' cell ' + G.cw + '×' + G.ch); }
      for (let v = 0; v < 4; v++) check(g('float', v, 0) && g('float', v, 0).sw === FL.cw, 'float variant ' + v + ' resolves');
      check(g('oak', 2, 0) && g('oak', 2, 0).sw === 96 && g('oak', 2, 0).sh === 56, 'oak stage 2 is 96×56');
      check(g('cypress', 2, 0) && g('cypress', 2, 0).sw === 24 && g('cypress', 2, 0).sh === 80, 'cypress stage 2 is 24×80');
      // 2. frame totals: 8 facings × frames per facing
      const want = { agent: 64, 'agent:idle': 24, 'agent:flee': 32, 'agent:splash': 48, 'agent:slap': 16, 'agent:cheer': 16, 'agent:sit': 16, 'agent:wave': 16, 'agent:tube': 32, 'agent:umbrella': 32, 'agent:cap': 64, 'agent:beads': 64, 'agent:foam': 64, 'agent:selfie': 16, 'agent:binoculars': 16 };
      for (const id of Object.keys(want)) check(M.frames(id) === want[id], 'frames(' + id + ') = ' + want[id] + ' (got ' + M.frames(id) + ')');
      for (const id of Object.keys(ENT_FRAMES)) check(M.frames(id) === ENT_FRAMES[id], 'frames(' + id + ') = ' + ENT_FRAMES[id] + ' (got ' + M.frames(id) + ')');
      check(M.frames('oak') === 1 && M.frames('cypress') === 1 && M.frames('palmetto') === 1 && M.frames('azalea') === 1, 'tree frames 1');
      // 3. the frame API: pass-A semantics without an agent, 8 facings with one; always inside the sheet
      check(M.agentFrame('walk', 3, 5) === 6 * 8 + 5 && M.agentFrame('sit', 2, 9) === 4 * 2 + 1 && M.agentFrame('umbrella', 1, 4) === 2 * 4 + 0 && M.agentFrame('nope', NaN, Infinity) === 0, 'agentFrame (dir, f) packing: dir 0–3 → facings 0, 2, 4, 6');
      const fake = (id, dir, tx, ty, px, py) => ({ id: id, dir: dir, tx: tx, ty: ty, px: px, py: py, prop: 'none' });
      for (const a of SANIMS) for (let id = 0; id < 12; id++) for (let tick = 0; tick < 400; tick += 37) for (const zoom of [0.5, 1, 2]) {
        const fr = M.agentFrame(a, id & 3, Math.floor(tick / 6), fake(id, id & 3, 5.5 + (id & 1), 4.5, 5.5, 4.5 + (id & 2) * 0.1), zoom, tick);
        if (!(fr >= 0 && fr < want[M.agentId(a)])) { check(false, 'agentFrame(' + a + ') ' + fr + ' inside ' + want[M.agentId(a)]); break; }
      }
      check(M.agentId('walk') === 'agent' && M.agentId('umbrella') === 'agent:umbrella' && M.agentId('walk', { prop: 'cap' }) === 'agent:cap' && M.agentId('flee', { prop: 'cap' }) === 'agent:flee', 'agentId (a graduation cap swaps the walk sheet)');
      const a1 = fake(7, 1, 6.2, 4.5, 5.8, 4.5), a2 = fake(8, 1, 6.2, 4.5, 5.8, 4.5);
      check(((M.agentFrame('walk', 1, 3, a1, 1, 20) / 8) | 0) === 0 && ((M.agentFrame('walk', 1, 3, fake(7, 1, 5.5, 5.0, 5.5, 4.6), 1, 20) / 8) | 0) === 2 && ((M.agentFrame('walk', 1, 3, fake(7, 1, 6.0, 5.0, 5.6, 4.6), 1, 20) / 8) | 0) === 1, 'walk facing follows the last step: +x → SE 0, +y → SW 2, diagonal → S 1');
      let diff = 0; for (let tick = 0; tick < 200; tick += 7) if (M.agentFrame('walk', 1, 0, a1, 1, tick) !== M.agentFrame('walk', 1, 0, a2, 1, tick)) diff++;
      check(diff > 15, 'two walkers are out of step (per-agent phase): ' + diff + ' of 29 ticks differ');
      const seen = new Set(); for (let tick = 0; tick < 3000; tick += 6) seen.add(M.agentFrame('idle', 1, 0, fake(3, 1, 5.5, 4.5, 5.5, 4.5), 1, tick) % 3);
      check(seen.size === 3, 'an idle student visits all 3 fidget frames (shift, shift back, use the item): ' + [...seen].join(','));
      const half = new Set(); for (let tick = 0; tick < 300; tick += 6) half.add(M.agentFrame('walk', 1, 0, a1, 0.5, tick) % 2);
      check(half.size === 2 && half.has(0) && half.has(1) && M.agentFrame('walk', 1, 0, a1, 0.5, 40) < 16, 'at 0.5× a walker shows two opposite poses of the agentfar sheet (frame = facing × 2 + pose): ' + [...half].join(','));
      // 4. looks: a stable pool, 6 skin tones, 16 outfits, 6 hair styles, hats, carried items, three builds; saved-game looks stay valid
      const looks = new Set(), sk = new Set(), of = new Set(), st = new Set(), hat = new Set(), cr = new Set(), bd = new Set(); let purpleGold = 0;
      for (let s = 0; s < 3000; s++) { const l = M.agentLook(s), F = fieldsOf(l); looks.add(l); sk.add(F.skin); of.add(F.outfit); st.add(F.style); hat.add(F.hat); cr.add(F.carry); bd.add(F.build); if (F.fam < 2) purpleGold++; }
      check(looks.size <= LOOK_POOL && looks.size >= 60 && sk.size === 6 && of.size === 16 && st.size === 6 && hat.size === 4 && cr.size === 7 && bd.size === 3, 'look pool: ' + looks.size + ' looks, ' + sk.size + ' skins, ' + of.size + ' outfits, ' + st.size + ' hair styles, ' + hat.size + ' hat kinds, ' + cr.size + ' carry kinds, ' + bd.size + ' builds');
      check(purpleGold / 3000 > 0.7 && purpleGold / 3000 < 0.9, 'purple or gold tops on ' + Math.round(100 * purpleGold / 3000) + ' % of students (0.5× legibility)');
      check(M.agentLook(77) === M.agentLook(77) && M.agentLook(NaN) === M.agentLook(0), 'agentLook deterministic');
      const lg = fieldsOf(0b101001001), lg2 = fieldsOf(0b101001001);
      check(lg === lg2 && lg.outfit >= 0 && lg.outfit < 16 && lg.skin === (0b001) && ((0b101001001 >> 6) & 3) === lg.fam, 'a pass-A look (< 512) keeps skin / hair / family and gets a stable full look');
      const lc = M.lookColors(M.agentLook(5)); check(/^#[0-9A-Fa-f]{6}$/.test(lc.skin) && /^#[0-9A-Fa-f]{6}$/.test(lc.hair) && /^#[0-9A-Fa-f]{6}$/.test(lc.shirt), 'lookColors still answers {skin, hair, shirt}');
      // 5. composition: deterministic, 8 distinct facings, 8 distinct walk frames, one look is one person in every frame
      const lk = M.agentLook(11), c0 = composeStudent('walk', lk, 0, 0);
      check(bequal(c0, composeStudent('walk', lk, 0, 0)) && pix(c0) > 120, 'student compose is deterministic and draws a figure (' + pix(c0) + ' px)');
      check(differ([0, 1, 2, 3, 4, 5, 6, 7].map((d) => composeStudent('walk', lk, d, 0))) === 0, 'the 8 facings are 8 distinct images');
      check(differ([0, 1, 2, 3, 4, 5, 6, 7].map((f) => composeStudent('walk', lk, 0, f))) === 0, 'the walk cycle has 8 distinct frames');
      check(differ([0, 1, 2].map((f) => composeStudent('idle', lk, 1, f))) === 0 && differ([0, 1, 2, 3].map((f) => composeStudent('flee', lk, 1, f))) === 0 && differ([0, 1, 2, 3, 4, 5].map((f) => composeStudent('splash', lk, 1, f))) === 0, 'idle (3), flee (4) and wade (6) frames differ');
      for (const a of SANIMS) { const n = SA[a].n; for (let f = 0; f < n; f++) { const b = composeStudent(a, lk, 1, f); if (pix(b) < 100) { check(false, a + ' f' + f + ' draws a figure'); break; } } }
      check(!bequal(composeStudent('walk', M.agentLook(11), 1, 0), composeStudent('walk', M.agentLook(12), 1, 0)) && !bequal(composeStudent('walk', M.lookPack({ skin: 0 }), 1, 0), composeStudent('walk', M.lookPack({ skin: 4 }), 1, 0)), 'looks differ (skin, outfit, hair)');
      const wetB = composeStudent('splash', lk, 1, 0), dryB = composeStudent('walk', lk, 1, 0); check(!bequal(wetB, dryB) && wetB.shadow === 0, 'wading has its own water-coloured legs and no ground shadow');
      const umb = composeStudent('umbrella', lk, 1, 0), mid = M.hex ? M.hex(PAL.purple) : null; check(pix(umb) > pix(dryB) + 40, 'an umbrella adds a canopy (' + pix(umb) + ' vs ' + pix(dryB) + ' px)');
      check(pix(composeStudent('idle', M.lookPack({ carry: 2 }), 1, 0)) !== pix(composeStudent('idle', M.lookPack({ carry: 6 }), 1, 0)) && !bequal(composeStudent('walk', M.lookPack({ carry: 0 }), 5, 0), composeStudent('walk', M.lookPack({ carry: 6 }), 5, 0)), 'carried items (backpack, books) change the sprite');
      const colorsOf = (b) => new Set(b.d.filter((c) => c));
      check([0, 1, 2, 3, 4, 5].every((s2) => !bequal(composeStudent('idle', M.lookPack({ style: s2 }), 1, 0), composeStudent('idle', M.lookPack({ style: (s2 + 1) % 6 }), 1, 0))), 'the 6 hair styles differ');
      // 6. sheets: one canvas per (anim, look, facing, zoom); sub-rects share it; memory accounted; 2× doubles
      const s1 = g('agent', 5, 0), s2 = g('agent', 5, 7), s3 = g('agent', 5, 8); check(s1 && s2 && s3 && s1.canvas === s2.canvas && s1.canvas !== s3.canvas && s1.sx !== s2.sx, 'frames of one facing share a sheet, another facing is its own sheet');
      check(M.sheetCount() > 0 && M.sheetMemoryMB() > 0 && M.sheetMemoryMB() < M.SHEET_LIMIT_MB * 4, 'sheet memory ' + M.sheetMemoryMB().toFixed(3) + ' MB (the budget is the GC trigger, not a cap)');
      check(M.gcSheets(1) === 0, 'gcSheets below budget drops nothing');
      if (M.ZOOM2) { const z2 = M.get('agent', 0, 0, 2); check(z2 && z2.sw === 28 && z2.sh === 48 && z2.ox === -14 && z2.oy === -44, '2× agent sheet 28×48 at (−14, −44)'); const gz = M.get('gator', 2, 3, 2); check(gz && gz.sw === GATORS[2].cw * 2 && gz.sh === GATORS[2].ch * 2, '2× legend gator'); }
      // 7. the bake budget: over budget a look gets the default student's sheet at once and bakes later
      const wasArmed = BAKE.armed, wasBudget = BAKE.budget, wasClock = BAKE.clock; BAKE.armed = true; BAKE.budget = -1; BAKE.clock = () => 1e6; const q0 = BAKE.queue.length, d0 = BAKE.deferred;
      const run = selfRuns++, ld = M.lookPack({ outfit: 9, style: 3, skin: 5, hat: 2, acc: 6, hairC: run & 7, build: (run >> 3) % 3, glasses: (run >> 5) & 1 }); const placeholder = g('agent', ld, 40);
      check(placeholder && placeholder.sw === 14 && BAKE.deferred === d0 + 1 && BAKE.queue.length === q0 + 1, 'over budget: a placeholder sheet is handed out and the real look queues (' + BAKE.deferred + ' deferred)');
      BAKE.budget = wasBudget; check(M.pumpBakes(true) >= 1 && BAKE.queue.length === 0, 'pumpBakes finishes the queue'); BAKE.armed = wasArmed; BAKE.clock = wasClock;
      // 8. gators: 3 sizes × 8 facings × (swim 2, walk 4, bask 2, lunge 2)
      for (let v = 0; v < 3; v++) {
        const bs = []; for (let d = 0; d < 8; d++) bs.push(composeGator(v, d, 2));
        check(differ(bs) === 0, 'gator v' + v + ': 8 facings differ');
        check(differ([2, 3, 4, 5].map((k) => composeGator(v, 1, k))) === 0 && !bequal(composeGator(v, 3, 0), composeGator(v, 3, 1)), 'gator v' + v + ': walk 4 frames and swim 2 frames differ');
        check(!bequal(composeGator(v, 3, 6), composeGator(v, 3, 7)) && !bequal(composeGator(v, 3, 6), composeGator(v, 3, 8)) && !bequal(composeGator(v, 3, 8), composeGator(v, 3, 9)), 'gator v' + v + ': basking (mouth open), lunging and snapping differ');
      }
      check(pix(composeGator(2, 3, 6)) > pix(composeGator(1, 3, 6)) * 1.4 && pix(composeGator(1, 3, 6)) > pix(composeGator(0, 3, 6)) * 1.3, 'Le Grand is bigger than a big gator, which is bigger than a juvenile');
      check(M.gatorFrame('SWIM', 0, { id: 0, tx: 5, ty: 5, px: 4.9, py: 5, dir: 0 }) === 0 * GPER + GMODES.swim && M.gatorFrame('WANDER', 0, { id: 0, tx: 5, ty: 5, px: 4.9, py: 5, dir: 0 }) === 0 * GPER + GMODES.walk && M.gatorFrame('SUN', 9, { id: 0, tx: 5, ty: 5, px: 5, py: 5, dir: 0 }, true) % GPER >= GMODES.lunge, 'gatorFrame maps states to modes and facings');
      for (const st2 of ['SWIM', 'WANDER', 'SUN', 'LOUNGE', 'RETREAT', 'WRANGLED', 'nope']) for (let f = 0; f < 20; f++) { const fr = M.gatorFrame(st2, f, { id: f, tx: 5 + f, ty: 5, px: 5, py: 5, dir: f & 3 }, f % 5 === 0); if (!(fr >= 0 && fr < GPER * 8)) { check(false, 'gatorFrame(' + st2 + ') inside 80 frames'); break; } }
      const eyes = M.gatorEyes(1, 3 * GPER + 6); check(eyes.length === 4 && (eyes[0] !== eyes[2] || eyes[1] !== eyes[3]) && eyes[1] <= 0, 'gatorEyes gives two eye offsets above the ground anchor: ' + eyes.join(','));
      // 9. Roux on all fours, nutria, birds, officer, vehicles, floats
      check(differ([0, 1, 2, 3, 4, 5, 6, 7].map((d) => composeRoux4(d, 0))) === 0 && !bequal(composeRoux4(3, 0), composeRoux4(3, 8)) && !bequal(composeRoux4(3, 8), composeRoux4(3, 9)) && !bequal(composeRoux4(3, 4), composeRoux4(3, 6)), 'Roux: 8 facings, pace / idle / lie / yawn differ');
      check(M.rouxFrame({ tx: 5, ty: 5, px: 5, py: 5, dir: 1, state: 'YAWN' }, 0) === 2 * RPER + 8 && M.rouxFrame({ tx: 5, ty: 5, px: 5, py: 5, dir: 1, state: 'LIE' }, 0) === 2 * RPER + 6 && M.rouxFrame({ tx: 5.3, ty: 5, px: 5, py: 5, dir: 1, state: 'LOOSE' }, 0) === 0 * RPER, 'rouxFrame');
      check(differ([0, 1, 2, 3, 4, 5, 6, 7].map((d) => composeNutria(d, 0))) === 0 && !bequal(composeNutria(2, 0), composeNutria(2, 1)), 'nutria: 8 facings × 2 frames');
      for (const kind of ['egret', 'spoonbill']) check(differ([0, 1, 2, 3].map((f) => composeBird(kind, 0, f))) === 0 && differ([0, 1, 2, 3, 4, 5, 6, 7].map((d) => composeBird(kind, d, 0))) === 0, kind + ': stand, preen and two wing frames; 8 facings');
      check(M.birdFrame('egret', 3, 100) < 32 && M.birdFrame('spoonbill', 1, 5, 2, true) % 4 >= 2, 'birdFrame (flying birds always show a wing frame)');
      check(differ([0, 1, 2, 3].map((f) => composeFogger(0, f))) === 0 && !bequal(composeFogger(0, 0), composeFogger(3, 0)) && !bequal(composeBus(0, 0), composeBus(0, 1)) && !bequal(composeBus(0, 0), composeBus(2, 0)), 'fogger (4 frames: the plume puffs) and bus (2) differ by frame and facing');
      for (const nv of [false, true]) check(differ([0, 1, 2, 3].map((f) => composeBoat(nv, 1, f))) === 0 && !bequal(composeBoat(nv, 0, 0), composeBoat(nv, 3, 0)), (nv ? 'navy' : 'pirogue') + ': the paddle stroke has 4 frames, 8 facings');
      check(differ([0, 1, 2, 3].map((v) => composeFloat(v, 0, 0))) === 0 && !bequal(composeFloat(0, 0, 0), composeFloat(0, 0, 1)), 'floats: 4 variants (tiger, bayou, fleur-de-lis, king cake), 2 roll frames');
      check(!bequal(composeWrangle(1, 0), composeWrangle(1, 1)) && differ([0, 1, 2, 3, 4, 5, 6, 7].map((d) => composeWrangle(d, 0))) === 0 && !bequal(composeStudent('walk', 0, 1, 0, { style: officerStyle() }), composeStudent('walk', 0, 1, 0)), 'the officer: a uniform of his own, wrangling in 8 facings');
      check(M.officerFrame({ tx: 5.4, ty: 5, px: 5, py: 5, dir: 0 }, 0, false) === 0 && M.officerFrame({ tx: 5, ty: 5, px: 5, py: 5, dir: 2 }, 8, true) === 4 * 2 + 1 && M.vehicleFrame('fogger', { tx: 5, ty: 5.4, px: 5, py: 5, dir: 1 }, 0) === 2 * 4 && M.vehicleFrame('pirogue', { dir: 3 }, 8) === 6 * 4 + 1, 'officerFrame / vehicleFrame');
      check(M.paradeFrame('float', 0) === 0 && M.paradeFrame('band', 8) === 1 * 4 + 1 && M.critterFrame('nutria', 3, 4) === 4 * 2 + 1, 'paradeFrame / critterFrame');
      // 10. football pass E: every fb* id at both zooms, directions, poses, looks, numbers, sideline sprites
      fbSelfTest(check);
    } catch (e) { notes.push('threw: ' + (e && e.message) + (e && e.stack ? ' @ ' + String(e.stack).split('\n')[1] : '')); }
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'entities ok' };
  }
  M.entitiesSelfTest = entitiesSelfTest;
  if (Array.isArray(M._tests)) M._tests.push(entitiesSelfTest);
})();
