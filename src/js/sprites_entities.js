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
//   * a tiny pixel-buffer toolkit (compose → outline → mirror → blit) so every
//     figure gets a per-material 1-px outline and pixel-exact mirrored directions
//     (dirs 1 and 2 are the horizontal mirrors of dirs 0 and 3; agents.js shares
//     the convention: 0 = +tx (down-right), 1 = +ty (down-left), 2 = −tx, 3 = −ty);
//   * the agent figure generator (walk/idle/flee/splash/slap/cheer/sit/wave/tube/
//     umbrella/cap/beads/foam + Tier 2 selfie/binoculars) baked lazily as ONE sheet
//     canvas per (look, anim, zoom) — the core's SpriteRef sx/sw sub-rect hands
//     frames back without a canvas per frame;
//   * the officer (walk sheet + wrangle), the Bayou Brass `band`, the walking `krewe`;
//   * gators (3 sizes × swim/walk/sun × 2), Roux, the vehicles (fogger, bus,
//     pirogue, navy), the float, the tailgate/festival props, birds and critters,
//     the two gates, the nest and the speech bubble.
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
    sheetLimitMB: 8,            // per-look agent sheets budget (mirrors sprites.CANVAS_LIMIT_MB)
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

  // ---------------------------------------------------------------------------
  // Hair styles: 8 small patterns over the 6×6 head box at (hx, hy). Back view
  // covers the back of the head (rows 0–4) with the style's silhouette.
  // ---------------------------------------------------------------------------
  const HAIR = [
    // 0 short crop
    function (b, c, back, hx, hy) { brect(b, hx, hy, 6, 1, c); bput(b, hx, hy + 1, c); bput(b, hx + 5, hy + 1, c); if (back) brect(b, hx, hy + 1, 6, 3, c); },
    // 1 bob with bangs
    function (b, c, back, hx, hy) { brect(b, hx - 1, hy, 8, 3, c); bput(b, hx - 1, hy + 3, c); bput(b, hx + 6, hy + 3, c); if (back) brect(b, hx - 1, hy + 3, 8, 2, c); },
    // 2 bun (top-right) over a short crop
    function (b, c, back, hx, hy) { brect(b, hx, hy, 6, 1, c); bput(b, hx, hy + 1, c); bput(b, hx + 5, hy + 1, c); brect(b, hx + 5, hy, 2, 2, c); bput(b, hx + 5, hy, shade(c, 1.3)); if (back) { brect(b, hx, hy + 1, 6, 4, c); brect(b, hx + 2, hy, 2, 2, shade(c, 1.25)); } },
    // 3 afro
    function (b, c, back, hx, hy) { brect(b, hx, hy, 6, 1, c); brect(b, hx - 1, hy + 1, 8, 2, c); bput(b, hx - 1, hy + 3, c); bput(b, hx + 6, hy + 3, c); if (back) { brect(b, hx - 1, hy + 3, 8, 2, c); brect(b, hx, hy + 5, 6, 1, c); } },
    // 4 cap-cut (flat top with a fade)
    function (b, c, back, hx, hy) { brect(b, hx - 1, hy, 8, 1, c); brect(b, hx, hy + 1, 6, 1, c); if (back) brect(b, hx, hy + 2, 6, 2, c); },
    // 5 long (strands down both sides to the shoulders)
    function (b, c, back, hx, hy) { brect(b, hx, hy, 6, 2, c); bput(b, hx - 1, hy + 1, c); bput(b, hx + 6, hy + 1, c); brect(b, hx - 1, hy + 2, 1, 5, c); brect(b, hx + 6, hy + 2, 1, 5, c); if (back) brect(b, hx, hy + 2, 6, 6, c); },
    // 6 mohawk (shaved sides)
    function (b, c, back, hx, hy) { brect(b, hx + 2, hy, 2, 2, c); bput(b, hx + 2, hy + 2, c); bput(b, hx + 2, hy, shade(c, 1.3)); if (back) brect(b, hx + 2, hy + 2, 2, 3, c); },
    // 7 curls (checker fringe)
    function (b, c, back, hx, hy) { brect(b, hx, hy, 6, 1, c); for (let y = 1; y < 3; y++) for (let x = -1; x < 7; x++) if (((x + y) & 1) === 0) bput(b, hx + x, hy + y, c); bput(b, hx - 1, hy + 3, c); bput(b, hx + 6, hy + 3, c); if (back) { for (let y = 3; y < 5; y++) for (let x = -1; x < 7; x++) if (((x + y) & 1) === 0) bput(b, hx + x, hy + y, c); brect(b, hx, hy + 1, 6, 2, c); } }
  ];

  // ---------------------------------------------------------------------------
  // The agent figure (GDD §7, brief §4 "Agents"): 12×20 base, front view = dir 0
  //   head 6×6 rows 0–5 (skin) · hair rows 0–2 · body 8×7 rows 6–12 (shirt, lit
  //   from the left) · backpack #3A2A1E (left edge in front view, centred behind
  //   the back view) · legs 2 px wide rows 13–16 (#2B1246) · shoes row 17 (#1B1B1B)
  //   · 1-px darker outline · 6×2 rgba(0,0,0,.25) shadow ellipse rows 18–19.
  //   cfg.y0 = the top row of the figure inside a taller cell; cfg.lift raises the
  //   head/torso/arms (breathing, bobbing) while the legs stay planted.
  // ---------------------------------------------------------------------------
  function legs(b, mode, y0, lift, tr, sh) {
    if (mode === 'hidden') return;
    const top = y0 + 13 - lift;
    const leg = (x, bottom, shoeX, shoeY) => { brect(b, x, top, 2, bottom - top + 1, tr); if (shoeY !== null) brect(b, shoeX, shoeY, 2, 1, sh); };
    switch (mode) {
      case 'walk1': leg(4, y0 + 16, 3, y0 + 17); leg(7, y0 + 15, 7, y0 + 16); break;       // left foot forward, right lifted
      case 'walk3': leg(4, y0 + 15, 4, y0 + 16); leg(7, y0 + 16, 8, y0 + 17); break;       // right foot forward, left lifted
      case 'wide0': leg(3, y0 + 16, 2, y0 + 17); leg(8, y0 + 16, 9, y0 + 17); break;       // legs wide (flee)
      case 'wide1': leg(3, y0 + 15, 3, y0 + 16); leg(8, y0 + 16, 9, y0 + 17); break;
      default: leg(4, y0 + 16, 4, y0 + 17); leg(7, y0 + 16, 7, y0 + 17); break;             // neutral (walk0 / walk2)
    }
  }
  function arm(b, side, mode, ty, shirt, skin) {
    if (!mode || mode === 'none') return;
    const x = side === 'L' ? 1 : 10, out = side === 'L' ? -1 : 1;
    const varm = (y0, len) => { for (let k = 0; k < len; k++) bput(b, x, y0 + k, k < 2 ? shirt : skin); };
    const sleeve = () => { bput(b, x, ty + 7, shirt); bput(b, x, ty + 6, shirt); };
    switch (mode) {
      case 'down': varm(ty + 7, 5); break;
      case 'swingF': varm(ty + 6, 5); break;
      case 'swingB': varm(ty + 8, 5); break;
      case 'up': sleeve(); bput(b, x, ty + 5, skin); bput(b, x, ty + 4, skin); bput(b, x, ty + 3, skin); bput(b, x + out, ty + 2, skin); break;
      case 'out': sleeve(); bput(b, x + out, ty + 7, skin); bput(b, x + out, ty + 6, skin); break;
      case 'headUp': sleeve(); bput(b, x, ty + 5, skin); bput(b, x, ty + 4, skin); bput(b, x - out, ty + 3, skin); break;
      case 'headHit': sleeve(); bput(b, x - out, ty + 5, skin); bput(b, x - out, ty + 4, skin); bput(b, x - 2 * out, ty + 3, skin); bput(b, x, ty + 3, PAL.goldHi); bput(b, x, ty + 2, PAL.gold); break;
      case 'wave0': sleeve(); bput(b, x, ty + 5, skin); bput(b, x, ty + 4, skin); bput(b, x, ty + 3, skin); bput(b, x + out, ty + 2, skin); break;
      case 'wave1': sleeve(); bput(b, x, ty + 5, skin); bput(b, x + out, ty + 4, skin); bput(b, x + out, ty + 3, skin); bput(b, x, ty + 2, skin); break;
      case 'holdUp': sleeve(); bput(b, x, ty + 5, skin); bput(b, x, ty + 4, skin); bput(b, x, ty + 3, skin); bput(b, x, ty + 2, skin); bput(b, x - out, ty + 1, skin); break;
      case 'bent': sleeve(); bput(b, x - out, ty + 5, skin); bput(b, x - 2 * out, ty + 4, skin); break;
      case 'horn': sleeve(); bput(b, x, ty + 8, shirt); bput(b, x - out, ty + 8, skin); bput(b, x - out, ty + 9, skin); break;
      case 'foam': sleeve(); bput(b, x, ty + 5, skin); break;
      default: varm(ty + 7, 5); break;
    }
  }
  /**
   * Paint one agent figure into buffer b.
   * cfg = {cols:{skin,hair,shirt}, style 0–7, back, legs, armL, armR, lift, y0, trousers, shoes, gown, hat(b,ty,back,cfg),
   *        pack, face:'normal'|'closed'|'none', hair:false to skip, extras(b,ty,back,cfg)}
   */
  function figure(b, cfg) {
    const col = cfg.cols, back = !!cfg.back, y0 = cfg.y0 | 0, lift = cfg.lift | 0, ty = y0 - lift;
    const skin = col.skin, hairC = col.hair, shirt = cfg.gown ? PAL.purple : col.shirt;
    const trousers = cfg.gown ? PAL.purple : (cfg.trousers || C.trousers), shoes = cfg.shoes || C.shoe;
    const shirtL = shade(shirt, 1.15), shirtD = shade(shirt, 0.78), skinD = shade(skin, 0.82), skinL = shade(skin, 1.1);
    // backpack peeking out behind the left side (front view)
    if (cfg.pack && !back) { brect(b, 0, ty + 8, 2, 4, C.pack); bput(b, 0, ty + 8, shade(C.pack, 1.4)); }
    legs(b, cfg.legs, y0, lift, trousers, shoes);
    // torso 8×7, three tones, darker hem
    for (let y = 0; y < 7; y++) for (let x = 0; x < 8; x++) {
      let c = x < 2 ? shirtL : x > 5 ? shirtD : shirt;
      if (y === 6) c = shade(c, 0.85);
      if (y === 0 && x >= 3 && x <= 4 && !back) c = skin;   // neck
      bput(b, 2 + x, ty + 6 + y, c);
    }
    if (cfg.gown) { for (const x of [4, 7]) { bput(b, x, ty + 7, PAL.gold); bput(b, x, ty + 8, PAL.gold); bput(b, x, ty + 9, PAL.gold); } }   // gold stole
    if (cfg.pack && !back) { bput(b, 3, ty + 7, C.pack); bput(b, 8, ty + 7, C.pack); }                                 // straps
    if (cfg.pack && back) { brect(b, 4, ty + 7, 4, 5, C.pack); bput(b, 4, ty + 7, shade(C.pack, 1.4)); bput(b, 5, ty + 7, shade(C.pack, 1.4)); brect(b, 5, ty + 9, 2, 1, shade(C.pack, 0.7)); }
    arm(b, 'L', cfg.armL, ty, shirt, skin);
    arm(b, 'R', cfg.armR, ty, shirt, skin);
    // head 6×6 with rounded corners
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      if ((y === 0 || y === 5) && (x === 0 || x === 5)) continue;
      let c = skin; if (x === 5 && y > 0) c = skinD; if (x === 1 && y === 1) c = skinL;
      bput(b, 3 + x, ty + y, c);
    }
    if (cfg.hair !== false) HAIR[cfg.style & 7](b, hairC, back, 3, ty);
    if (!back && cfg.face !== 'none') {
      if (cfg.face === 'closed') { bput(b, 4, ty + 3, skinD); bput(b, 7, ty + 3, skinD); }
      else { bput(b, 4, ty + 3, black); bput(b, 7, ty + 3, black); if (cfg.face === 'scared') { bput(b, 5, ty + 5, black); bput(b, 6, ty + 5, black); } }
    }
    if (cfg.hat) cfg.hat(b, ty, back, cfg);
    if (cfg.extras) cfg.extras(b, ty, back, cfg);
  }

  // --- props and overlays ------------------------------------------------------
  function tubeRing(b, ty, back, cfg) {
    const shirt = cfg.gown ? PAL.purple : cfg.cols.shirt;
    const hw = [4, 6, 6, 6, 6, 4];
    for (let r = 0; r < 6; r++) {
      const y = ty + 12 + r;
      for (let x = 6 - hw[r]; x < 6 + hw[r]; x++) {
        if (r >= 1 && r <= 2 && x >= 4 && x <= 7) { bput(b, x, y, shade(shirt, 0.9)); continue; }   // the waist inside the ring
        let c = ((x >> 1) & 1) ? C.red : C.offWhite;
        if (r === 5) c = shade(c, 0.8); else if (r === 0) c = shade(c, 1.08);
        bput(b, x, y, c);
      }
    }
  }
  function tubeRipples(b, cfg) { const y = (cfg.y0 | 0) + 18; for (let x = 1; x < 11; x++) if ((x + (cfg.lift | 0)) & 1) bput(b, x, y, PAL.shallows); }
  function waterLine(f) {
    return function (b, cfg) {
      const y0 = cfg.y0 | 0;
      for (let x = 1; x <= 10; x++) {
        bput(b, x, y0 + 15, ((x + f) & 1) ? shade(PAL.shallows, 1.15) : PAL.shallows);
        bput(b, x, y0 + 16, mix(PAL.shallows, PAL.waterDay, 0.4));
        bput(b, x, y0 + 17, mix(PAL.shallows, PAL.waterDay, 0.6));
      }
      if (f) { bput(b, 1, y0 + 14, C.white); bput(b, 10, y0 + 14, C.white); bput(b, 0, y0 + 13, shade(PAL.shallows, 1.2)); }
      else { bput(b, 2, y0 + 14, shade(PAL.shallows, 1.2)); bput(b, 9, y0 + 14, shade(PAL.shallows, 1.2)); }
    };
  }
  function umbrellaTop(b, ty, back) {
    brect(b, 3, 0, 6, 1, PAL.purple2); brect(b, 2, 1, 8, 1, PAL.purple); brect(b, 1, 2, 10, 1, PAL.purple);
    for (let x = 1; x <= 10; x++) bput(b, x, 3, (x & 1) ? PAL.purpleShadow : PAL.purple2);   // scalloped rim
    bput(b, 6, 0, PAL.gold); bput(b, 3, 1, PAL.purpleHi); bput(b, 4, 1, PAL.purpleHi);
    for (let y = 4; y <= ty + 1; y++) bput(b, back ? 9 : 9, y, PAL.bark);                       // the stick down to the hand at (9, ty+1)
  }
  function mortarboard(b, ty) { brect(b, 2, ty, 8, 1, black); brect(b, 3, ty + 1, 6, 1, shade(black, 1.6)); bput(b, 2, ty, shade(black, 2.4)); bput(b, 10, ty + 1, PAL.gold); bput(b, 10, ty + 2, PAL.gold); }
  function beadsChest(b, ty, back, cfg) { if (back) return; const shirt = cfg.cols.shirt; bput(b, 5, ty + 8, shirt === PAL.purple ? PAL.purpleHi : PAL.purple2); bput(b, 6, ty + 8, C.green); bput(b, 7, ty + 8, PAL.gold); bput(b, 4, ty + 7, PAL.gold); bput(b, 8, ty + 7, C.green); }
  function foamFinger(b, ty) { brect(b, 8, ty + 3, 4, 3, PAL.gold); brect(b, 8, ty + 1, 2, 2, PAL.gold); bput(b, 8, ty + 1, PAL.goldHi); bput(b, 9, ty + 1, PAL.goldHi); bput(b, 11, ty + 5, PAL.goldShadow); bput(b, 10, ty + 4, PAL.purple); }
  function selfiePhone(f) { return function (b, ty, back) { if (back) { bput(b, 11, ty + 5, black); return; } brect(b, 10, ty + 4, 2, 3, black); bput(b, 11, ty + 5, C.glass); if (f) { bput(b, 11, ty + 3, C.white); bput(b, 10, ty + 3, PAL.goldHi); } }; }
  function binocs(f) { return function (b, ty, back) { if (back) return; brect(b, 4 + f, ty + 2, 4, 2, black); bput(b, 4 + f, ty + 3, C.glass); bput(b, 7 + f, ty + 3, C.glass); bput(b, 5 + f, ty + 2, shade(black, 2)); }; }
  function rangerHat(b, ty) { brect(b, 4, ty, 4, 1, C.khakiDark); brect(b, 2, ty + 1, 8, 1, C.khaki); bput(b, 2, ty + 1, shade(C.khaki, 0.8)); bput(b, 9, ty + 1, shade(C.khaki, 0.8)); bput(b, 5, ty, shade(C.khakiDark, 1.15)); }
  function catchPole(b, cfg) {
    const ty = (cfg.y0 | 0) - (cfg.lift | 0);
    if (cfg.back) { bline(b, 0, ty + 4, 2, ty + 17, PAL.bark); brect(b, 0, ty + 2, 2, 2, C.steel); bput(b, 1, ty + 3, null); }
    else { bline(b, 11, ty + 4, 9, ty + 17, PAL.bark); brect(b, 10, ty + 2, 2, 2, C.steel); bput(b, 11, ty + 2, shade(C.steel, 1.3)); }
  }
  function shako(b, ty) { brect(b, 4, ty, 5, 3, PAL.purple); brect(b, 4, ty, 5, 1, PAL.purpleHi); brect(b, 4, ty + 2, 5, 1, PAL.gold); brect(b, 3, ty, 1, 3, PAL.gold); bput(b, 3, ty, PAL.goldHi); }
  function brassHorn(b, ty, back) { if (back) return; brect(b, 8, ty + 5, 4, 3, PAL.gold); bput(b, 11, ty + 6, PAL.goldShadow); bput(b, 8, ty + 5, PAL.goldHi); bput(b, 9, ty + 7, PAL.purple); bput(b, 7, ty + 6, PAL.goldShadow); }
  function kreweSash(b, ty, back, cfg) {
    const sash = cfg.cols.shirt === PAL.purple ? PAL.gold : PAL.purple2;
    for (let k = 0; k < 6; k++) bput(b, 3 + k, ty + 6 + k, sash);
    if (!back) { brect(b, 3, ty + 3, 6, 2, PAL.gold); bput(b, 4, ty + 3, black); bput(b, 7, ty + 3, black); bput(b, 3, ty + 4, PAL.goldShadow); bput(b, 8, ty + 4, PAL.goldShadow); bput(b, 5, ty + 8, C.green); bput(b, 7, ty + 9, PAL.purpleHi); }
  }

  // --- the anim table (per direction frame counts + cell sizes) ---------------------
  const walkArms = (f) => ({ armL: f === 1 ? 'swingF' : f === 3 ? 'swingB' : 'down', armR: f === 1 ? 'swingB' : f === 3 ? 'swingF' : 'down' });
  const ANIM = {
    walk: { n: 4, w: 12, h: 20, pose: (f) => Object.assign({ legs: 'walk' + f, lift: f === 2 ? 1 : 0 }, walkArms(f)) },
    idle: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'walk0', armL: 'down', armR: 'down', lift: f }) },
    flee: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'wide' + f, armL: 'up', armR: 'up', face: 'scared' }) },
    splash: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: f ? 'walk3' : 'walk1', armL: 'out', armR: 'out', post: waterLine(f), noShadow: true }) },
    slap: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'walk0', armL: 'down', armR: f ? 'headHit' : 'headUp', face: f ? 'closed' : 'normal' }) },
    cheer: { n: 2, w: 12, h: 22, pose: (f) => ({ legs: 'walk0', armL: 'up', armR: 'up', y0: f ? 0 : 2 }) },
    sit: { n: 1, w: 8, h: 14, custom: true },
    wave: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'walk0', armL: 'down', armR: 'wave' + f }) },
    tube: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'hidden', armL: 'out', armR: 'out', lift: f, extras: tubeRing, post: tubeRipples, noShadow: true }) },
    umbrella: { n: 4, w: 12, h: 26, pose: (f) => Object.assign({ legs: 'walk' + f, y0: 6, armR: 'holdUp', extras: umbrellaTop }, { armL: walkArms(f).armL }) },
    cap: { n: 1, w: 12, h: 20, pose: () => ({ legs: 'walk0', armL: 'down', armR: 'down', gown: true, hat: mortarboard }) },
    beads: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: f ? 'walk3' : 'walk1', armL: f ? 'swingB' : 'swingF', armR: f ? 'swingF' : 'swingB', extras: beadsChest }) },
    foam: { n: 4, w: 12, h: 20, pose: (f) => ({ legs: 'walk' + f, lift: f === 2 ? 1 : 0, armL: walkArms(f).armL, armR: 'foam', extras: foamFinger }) },
    selfie: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'walk0', armL: 'down', armR: 'out', extras: selfiePhone(f) }) },
    binoculars: { n: 2, w: 12, h: 20, pose: (f) => ({ legs: 'walk0', armL: 'bent', armR: 'bent', extras: binocs(f) }) }
  };
  const ANIM_NAMES = Object.keys(ANIM);
  const agentAnimFrames = {}; for (const k of ANIM_NAMES) agentAnimFrames[k] = ANIM[k].n;
  /** per-direction frame counts (4 directions each) and the non-directional totals */
  M.animFrames = Object.freeze({
    agent: Object.freeze(agentAnimFrames),
    officer: Object.freeze({ walk: 4, wrangle: 2 }), band: Object.freeze({ march: 4 }), krewe: Object.freeze({ march: 4 }),
    gator: Object.freeze({ swim: 2, walk: 2, sun: 2 }), roux: Object.freeze({ pace: 2, yawn: 1 }),
    fogger: 2, bus: 2, pirogue: 2, navy: 2, float: 2, tent: 1, smoker: 2, cornhole: 2, snoball: 2, bonfire: 3,
    egret: 2, spoonbill: 2, pelican: 2, armadillo: 2, nutria: 2, gate: 4, barrierGate: 4, nest: 1, bubble: 3
  });
  /** frame totals per id (what frames(id) returns once the painters are registered) */
  const FRAME_TOTALS = {};
  for (const k of ANIM_NAMES) FRAME_TOTALS[k === 'walk' ? 'agent' : 'agent:' + k] = ANIM[k].n * 4;
  FRAME_TOTALS['agent:walk'] = 16;
  Object.assign(FRAME_TOTALS, { gator: 6, roux: 3, officer: 16, 'officer:wrangle': 2, fogger: 2, bus: 2, pirogue: 2, navy: 2, float: 2, band: 4, krewe: 4, tent: 1, smoker: 2, cornhole: 2, snoball: 2, bonfire: 3, egret: 2, spoonbill: 2, pelican: 2, armadillo: 2, nutria: 2, gate: 4, barrierGate: 4, nest: 1, bubble: 3 });
  M.entityFrames = Object.freeze(Object.assign({}, FRAME_TOTALS));
  for (const id of Object.keys(FRAME_TOTALS)) M.setFrames(id, FRAME_TOTALS[id]);   // plain-object writes (definition time is allowed)

  /** dir * framesPerDir + (f mod framesPerDir); never ≥ frames(id); tolerant of garbage */
  M.agentFrame = function (anim, dir, f) {
    const A = ANIM[typeof anim === 'string' ? anim : 'walk'];
    const n = A ? A.n : 4;
    dir = Number.isFinite(dir) ? ((dir | 0) % 4 + 4) % 4 : 0;
    f = Number.isFinite(f) ? (f | 0) : 0;
    return dir * n + ((f % n) + n) % n;
  };
  /** the sprite id of an agent anim: 'agent' for walk, 'agent:<anim>' otherwise (unknown → 'agent') */
  M.agentId = function (anim) { return (typeof anim === 'string' && ANIM[anim] && anim !== 'walk') ? 'agent:' + anim : 'agent'; };
  /** cell size of an agent anim in 1× px */
  M.agentCell = function (anim) { const A = ANIM[typeof anim === 'string' ? anim : 'walk'] || ANIM.walk; return { w: A.w, h: A.h }; };
  /** gator frame: mode 0 swim / 1 walk / 2 sun (or the names), f alternates the A/B frame → 0..5 */
  M.gatorFrame = function (mode, f) {
    if (typeof mode === 'string') mode = mode === 'walk' || mode === 'WANDER' || mode === 'RETREAT' ? 1 : mode === 'sun' || mode === 'SUN' || mode === 'LOUNGE' ? 2 : 0;
    mode = Number.isFinite(mode) ? ((mode | 0) % 3 + 3) % 3 : 0;
    f = Number.isFinite(f) ? (f | 0) : 0;
    return mode + (f & 1) * 3;
  };
  M.treeVariant = M.treeVariant || function (stage, autumn, bloom) { return (Math.max(0, Math.min(2, stage | 0))) | (autumn ? 4 : 0) | (bloom ? 8 : 0); };

  /** compose one agent frame into a buffer (pure; the mirror is applied for dirs 1/2) */
  function composeAgent(anim, look, dir, f, uniform) {
    const A = ANIM[anim] || ANIM.walk;
    const b = newBuf(A.w, A.h);
    look = (look | 0) & L.lookMask;
    const cols = (uniform && uniform.cols) || (typeof M.lookColors === 'function' ? M.lookColors(look) : { skin: X.skins[look & 7] || '#E0AC69', hair: X.hairs[(look >> 3) & 7] || black, shirt: X.shirts[(look >> 6) & 3] || PAL.purple });
    dir = ((dir | 0) % 4 + 4) % 4;
    const back = dir === 2 || dir === 3;
    if (A.custom) {
      sitFigure(b, cols, look, back, uniform);
      b.shadow = { y: A.h - 2, w: 6 };
    } else {
      const cfg = Object.assign({ cols: cols, style: (look >> 3) & 7, back: back, pack: true, y0: 0, lift: 0, face: 'normal' }, A.pose(((f | 0) % A.n + A.n) % A.n), uniform || {});
      cfg.cols = cols;
      figure(b, cfg);
      boutline(b, A.h - 2, C.outlineK);
      if (cfg.post) cfg.post(b, cfg);
      if (uniform && uniform.post2) uniform.post2(b, cfg);
      b.shadow = cfg.noShadow ? null : { y: A.h - 2, w: 6 };
    }
    if (dir === 1 || dir === 2) bflipX(b);
    return b;
  }
  /** the seated figure (8×14): legs folded, arms on the knees */
  function sitFigure(b, cols, look, back, uniform) {
    const skin = cols.skin, shirt = cols.shirt, style = (look >> 3) & 7;
    const shirtL = shade(shirt, 1.15), shirtD = shade(shirt, 0.78);
    brect(b, 0, 10, 8, 2, C.trousers); brect(b, 0, 11, 2, 1, C.shoe); brect(b, 6, 11, 2, 1, C.shoe);             // folded legs, shoes at the ends
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) bput(b, x, 6 + y, x < 2 ? shirtL : x > 5 ? shirtD : shirt);
    bput(b, 3, 6, back ? shirt : skin); bput(b, 4, 6, back ? shirt : skin);
    if (back) { brect(b, 2, 7, 4, 3, C.pack); bput(b, 2, 7, shade(C.pack, 1.4)); } else { bput(b, 1, 7, C.pack); bput(b, 6, 7, C.pack); }
    bput(b, 0, 9, skin); bput(b, 7, 9, skin); bput(b, 0, 8, shirt); bput(b, 7, 8, shirt);                          // arms on the knees
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { if ((y === 0 || y === 5) && (x === 0 || x === 5)) continue; bput(b, 1 + x, y, x === 5 && y > 0 ? shade(skin, 0.82) : skin); }
    HAIR[style](b, cols.hair, back, 1, 0);
    if (!back) { bput(b, 2, 3, black); bput(b, 5, 3, black); }
    if (uniform && uniform.hat) uniform.hat(b, 0, back, { cols: cols });
    boutline(b, 12, C.outlineK);
  }
  M.composeAgent = composeAgent;

  function drawAgentFrame(P, anim, look, i, ox, oy, uniform) {
    const A = ANIM[anim] || ANIM.walk;
    const dir = Math.floor(i / A.n), f = i % A.n;
    const b = composeAgent(anim, look, dir, f, uniform);
    if (b.shadow) shadowRows(P, ox, oy, A.w >> 1, b.shadow.y, b.shadow.w);
    bblit(b, P, ox, oy);
  }

  // ---------------------------------------------------------------------------
  // Sheet families: agent (variant = look, sub = anim), officer (walk; :wrangle is
  // an own canvas), band (variant = look), krewe (variant = look)
  // ---------------------------------------------------------------------------
  const OFFICER_UNIFORM = Object.freeze({ cols: Object.freeze({ skin: X.skins ? X.skins[2] : '#C68642', hair: X.hairs ? X.hairs[1] : PAL.bark, shirt: C.khaki }), trousers: C.khakiDark, pack: false, hair: false, hat: rangerHat, post2: catchPole });
  function bandUniform(look) { return { cols: { skin: (X.skins || [])[look & 7] || '#E0AC69', hair: (X.hairs || [])[(look >> 3) & 7] || black, shirt: PAL.purple }, trousers: PAL.purple2, pack: false, hat: shako, extras: brassHorn, armR: 'horn' }; }
  function kreweUniform(look) { return { cols: typeof M.lookColors === 'function' ? M.lookColors(look) : { skin: '#E0AC69', hair: black, shirt: PAL.purple }, pack: false, extras: kreweSash }; }

  const SHEET_PAINTERS = {
    agent: function (ctx, spec) {
      const anim = spec.sub || 'walk';
      const A = ANIM[anim];
      if (!A) throw new Error('unknown agent anim "' + anim + '"');
      const look = (spec.variant | 0) & L.lookMask, total = A.n * 4;
      spec.frames = total;
      const s = getSheet('agent|' + anim + '|' + look + '|' + spec.zoom, A.w, A.h, total, spec.zoom, (P, i, ox, oy) => drawAgentFrame(P, anim, look, i, ox, oy, null));
      return sheetRef(s, spec.frame, -(A.w >> 1), -A.h + 2);
    },
    officer: function (ctx, spec) {
      if (spec.sub === 'wrangle') return paintWrangle(ctx, spec);
      if (spec.sub && spec.sub !== 'walk') throw new Error('unknown officer anim "' + spec.sub + '"');
      spec.frames = 16;
      const s = getSheet('officer|' + spec.zoom, L.officer[0], L.officer[1], 16, spec.zoom, (P, i, ox, oy) => drawAgentFrame(P, 'walk', 0, i, ox, oy, OFFICER_UNIFORM));
      return sheetRef(s, spec.frame, -(L.officer[0] >> 1), -L.officer[1] + 2);
    },
    band: function (ctx, spec) {
      const look = (spec.variant | 0) & L.lookMask; spec.frames = 4;
      const s = getSheet('band|' + look + '|' + spec.zoom, L.band[0], L.band[1], 4, spec.zoom, (P, i, ox, oy) => drawAgentFrame(P, 'walk', look, i, ox, oy, bandUniform(look)));
      return sheetRef(s, spec.frame, -(L.band[0] >> 1), -L.band[1] + 2);
    },
    krewe: function (ctx, spec) {
      const look = (spec.variant | 0) & L.lookMask; spec.frames = 4;
      const s = getSheet('krewe|' + look + '|' + spec.zoom, L.krewe[0], L.krewe[1], 4, spec.zoom, (P, i, ox, oy) => drawAgentFrame(P, 'walk', look, i, ox, oy, kreweUniform(look)));
      return sheetRef(s, spec.frame, -(L.krewe[0] >> 1), -L.krewe[1] + 2);
    }
  };
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
      for (const s of victims) { sheets.delete(s.key); try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } }
      for (const fam of Object.keys(SHEET_PAINTERS)) M.registerPainter(fam, SHEET_PAINTERS[fam]);
      return victims.length;
    } catch (e) { try { BSU.error('sprites_entities', 'gcSheets', e); } catch (e2) { /* never throw */ } return 0; }
  };
  /** drop every sheet (tests / debug) */
  M.clearSheets = function () { for (const s of sheets.values()) { try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } } sheets.clear(); for (const fam of Object.keys(SHEET_PAINTERS)) M.registerPainter(fam, SHEET_PAINTERS[fam]); };
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
  // Gators (GDD §6.3, §12.3): variant 0 juvenile 28×9 / 1 big 40×12 / 2 legend 56×17;
  // frame 0 swim, 1 walk, 2 sun, 3–5 = the B frames (tail sways, legs alternate).
  // Head to the right (render mirrors for dirs 2/3). Colours #4A5A3A back, #8A9A6A belly,
  // #1B1B1B eye (the red eye dot is light:eye in the lights pass), 1-px outline.
  // ---------------------------------------------------------------------------
  function paintGator(P, w, h, frame, v) {
    const mode = frame % 3, B = frame >= 3;
    const seed = hash(0x6a, v);
    const back = C.gatorBack, belly = C.gatorBelly, bd = shade(back, 0.72), bl = shade(back, 1.18), bellyD = shade(belly, 0.8);
    const bh = v === 0 ? 4 : v === 1 ? 5 : 7;
    const ground = h - 2;
    const raise = mode === 1 ? 2 : mode === 2 ? 1 : 0;
    const bottom = ground - 1 - raise, top = bottom - bh + 1, cy = top + (bh >> 1);
    const tailLen = Math.round(w * 0.42), headStart = w - Math.round(w * 0.28);
    shadowRows(P, 0, 0, w >> 1, ground, w - 6, mode === 0 ? C.shadowLight : C.shadow);
    // swim: the V-wake behind the neck
    if (mode === 0) {
      const nx = headStart - 1, k = Math.max(2, bh - 1), ph = B ? 1 : 0;
      P.line(nx, cy - 1, 0 + ph, cy - 1 - k, PAL.shallows);
      P.line(nx, cy + 1, 0 + ph, cy + 1 + k, shade(PAL.shallows, 0.85));
      for (let x = 2; x < nx; x += 4) P.px(x + ph, cy + ((x >> 2) & 1 ? -1 : 1) * (k + 1) + (x >> 2 & 1 ? 0 : 0), shade(PAL.shallows, 1.1));
    }
    const b = newBuf(w, h);
    for (let x = 0; x < w; x++) {
      let half;
      if (x < tailLen) half = Math.max(0.5, (x / tailLen) * (bh / 2));
      else if (x < headStart) half = bh / 2;
      else half = Math.max(1, bh / 2 - (x >= w - 2 ? 1 : 0.5));
      const sway = (B && x < tailLen * 0.5) ? -1 : 0;
      const y0 = Math.round(cy - half), y1 = Math.round(cy + half - 1);
      for (let y = y0; y <= y1; y++) {
        let c = y < cy ? back : y === cy ? mix(back, belly, 0.5) : belly;
        if (y === y0 && x < headStart && (x & 1)) c = bd;                       // scutes along the ridge
        else if (y === y0 + 1 && x < headStart && hash(seed, x) % 3 === 0) c = bl;  // lit flank speckle
        else if (y === y1 && y > cy) c = bellyD;
        if (x >= headStart && y === cy + 1 && x >= headStart + 1 && x < w - 1) c = mode === 2 ? black : bd;   // jaw line (open 1 px when sunning)
        bput(b, x, y + sway, c);
      }
    }
    // sun: the lower jaw drops 1 px under the black gap
    if (mode === 2) for (let x = headStart + 2; x < w - 1; x++) { bput(b, x, cy + 2 + (bh > 4 ? 1 : 0), belly); if (bh > 4) bput(b, x, cy + 2, belly); }
    // eye bump + eye, nostril, a legend scar
    bput(b, headStart + 1, top - 1, back); bput(b, headStart + 2, top - 1, back); bput(b, headStart + 2, top, black); if (v === 2) bput(b, headStart + 3, top, black);
    bput(b, w - 2, top + (bh > 4 ? 1 : 0), bd);
    if (v === 2) { bput(b, tailLen + 6, top + 1, bl); bput(b, tailLen + 7, top + 2, bl); bput(b, tailLen + 8, top + 1, bl); }
    // legs
    if (mode === 1) {
      const rear = [tailLen + 1, tailLen + 5], front = [headStart - 8, headStart - 4];
      const xs = [rear[0] + (B ? 1 : 0), rear[1] + (B ? 0 : 1), front[0] + (B ? 0 : 1), front[1] + (B ? 1 : 0)];
      for (let k = 0; k < 4; k++) { const x = Math.max(0, Math.min(w - 2, xs[k])); brect(b, x, bottom + 1, 2, 2, bd); bput(b, x, bottom + 1, belly); }
    } else if (mode === 2) {
      for (const x of [tailLen, headStart - 5]) { brect(b, x - 1, bottom + 1, 3, 1, bd); bput(b, x, bottom + 1, bellyD); }
    }
    boutline(b, ground, 0.5);
    bblit(b, P, 0, 0);
    // swim: the water band over the low body (body sits low in the water)
    if (mode === 0) for (let x = 0; x < w; x++) for (let y = bottom - 1; y <= bottom; y++) if (bget(b, x, y)) P.px(x, y, ((x + y + (B ? 1 : 0)) & 1) ? PAL.shallows : mix(PAL.shallows, PAL.waterDay, 0.5));
  }
  registerSimple('gator', { size: (v) => L.gatorSizes[Math.max(0, Math.min(2, v))], frames: 6, paint: (P, w, h, f, v) => paintGator(P, w, h, f, Math.max(0, Math.min(2, v))) });

  // ---------------------------------------------------------------------------
  // Roux the tiger (28×16): frames 0–1 pace, 2 yawn
  // ---------------------------------------------------------------------------
  registerSimple('roux', {
    size: fixed(L.roux), frames: 3,
    paint: function (P, w, h, f) {
      const t = C.tiger, tl = shade(t, 1.15), td = shade(t, 0.8), yawn = f === 2, alt = f === 1;
      const b = newBuf(w, h);
      shadowRows(P, 0, 0, 14, 14, 22);
      // tail (up-left, ringed)
      const tt = alt ? -1 : 0;
      bput(b, 3, 6, t); bput(b, 2, 5, black); bput(b, 1, 4 + tt, t); bput(b, 0, 3 + tt, black);
      // body 18×7 rows 5–11 x4..21, rounded
      for (let y = 5; y <= 11; y++) for (let x = 4; x <= 21; x++) {
        if ((y === 5 || y === 11) && (x === 4 || x === 21)) continue;
        let c = y === 5 ? tl : y >= 10 ? C.white : x > 18 ? td : t;
        if (y === 11 && x > 5 && x < 20) c = shade(C.white, 0.85);
        bput(b, x, y, c);
      }
      for (let i = 0; i < 5; i++) { const x = 7 + i * 3, len = 4 + (i & 1); for (let y = 5; y < 5 + len; y++) bput(b, x, y, black); }   // 5 stripes
      // legs rows 12–13 (pace: the outer pair shifts 1 px)
      const legX = [5 + (alt ? 1 : 0), 9, 16, 20 - (alt ? 1 : 0)];
      for (const x of legX) { brect(b, x, 12, 2, 2, t); bput(b, x, 13, td); bput(b, x + 1, 13, td); }
      // head 8×7 at x19..26 rows 3–9, ears, muzzle, nose, eyes
      for (let y = 3; y <= 9; y++) for (let x = 19; x <= 26; x++) { if ((y === 3 || y === 9) && (x === 19 || x === 26)) continue; bput(b, x, y, y === 3 ? tl : x >= 25 ? td : t); }
      bput(b, 20, 2, t); bput(b, 25, 2, t); bput(b, 20, 2, black); bput(b, 25, 2, td);
      brect(b, 23, 6, 4, 3, C.white); bput(b, 27, 6, C.white); bput(b, 27, 5, black); bput(b, 26, 5, black);
      if (yawn) { brect(b, 23, 8, 5, 3, black); brect(b, 23, 11, 5, 1, C.white); bput(b, 25, 9, C.red); bput(b, 22, 5, shade(t, 0.55)); bput(b, 23, 5, shade(t, 0.55)); bput(b, 25, 4, shade(t, 0.55)); }
      else { bput(b, 22, 5, black); bput(b, 25, 4, black); bput(b, 21, 4, C.white); }
      bput(b, 21, 7, black); bput(b, 24, 4, black);   // cheek stripe, brow
      boutline(b, 14, 0.5);
      bblit(b, P, 0, 0);
    }
  });

  // ---------------------------------------------------------------------------
  // Officer wrangle (20×16, 2 frames): 0 = crouched over a gator silhouette, 1 = the dust puff
  // ---------------------------------------------------------------------------
  function paintWrangle(ctx, spec) {
    spec.frames = 2;
    const g = begin(ctx, L.wrangle[0], L.wrangle[1], spec.zoom), P = pen(ctx, spec.zoom);
    const f = spec.frame & 1, w = g.w, h = g.h, seed = hash(0x0f, 0xce);
    shadowRows(P, 0, 0, 10, 14, 16);
    const b = newBuf(w, h);
    if (f === 0) {
      // the gator, flat on the ground under the officer
      for (let x = 1; x <= 18; x++) { const half = x < 7 ? Math.max(0.5, (x / 7) * 2) : x > 15 ? 1.5 : 2; for (let y = Math.round(12 - half); y <= Math.round(11 + half); y++) bput(b, x, y, y < 12 ? C.gatorBack : C.gatorBelly); }
      bput(b, 16, 10, black); bput(b, 17, 9, C.gatorBack);
      // crouched officer: head + hat, torso, arms down to the gator, bent legs, boots
      for (let y = 1; y <= 6; y++) for (let x = 7; x <= 12; x++) { if ((y === 1 || y === 6) && (x === 7 || x === 12)) continue; bput(b, x, y, OFFICER_UNIFORM.cols.skin); }
      brect(b, 8, 1, 4, 1, C.khakiDark); brect(b, 6, 2, 8, 1, C.khaki); bput(b, 8, 4, black); bput(b, 11, 4, black);
      brect(b, 6, 7, 8, 3, C.khaki); brect(b, 6, 7, 2, 3, shade(C.khaki, 1.15)); brect(b, 12, 7, 2, 3, shade(C.khaki, 0.8));
      for (const x of [5, 14]) { bput(b, x, 8, C.khaki); bput(b, x, 9, OFFICER_UNIFORM.cols.skin); bput(b, x, 10, OFFICER_UNIFORM.cols.skin); }
      brect(b, 4, 9, 2, 2, C.khakiDark); brect(b, 14, 9, 2, 2, C.khakiDark); bput(b, 3, 11, black); bput(b, 4, 11, black); bput(b, 15, 11, black); bput(b, 16, 11, black);
    } else {
      // the puff: a dithered 16×10 cloud with a hat, a tail and a boot poking out
      for (let y = 2; y < 13; y++) for (let x = 2; x < 18; x++) {
        const v = P.ellipseTest(x + 0.5, y + 0.5, 10, 7.5, 8, 5.5); if (v <= 0) continue;
        const n = hash(seed, x + y * 31) % 100;
        if (v < 0.15 && (n & 1)) continue;
        bput(b, x, y, n < 45 ? C.dust : n < 80 ? shade(C.dust, 0.9) : shade(C.dust, 1.12));
      }
      brect(b, 12, 0, 4, 1, C.khaki); brect(b, 13, -1 + 1, 2, 1, C.khakiDark); bput(b, 14, 0, C.khakiDark);
      bput(b, 0, 9, C.gatorBack); bput(b, 1, 8, C.gatorBack); brect(b, 18, 10, 2, 1, black); bput(b, 19, 9, C.khakiDark);
      bput(b, 3, 3, PAL.goldHi); bput(b, 17, 4, PAL.goldHi); bput(b, 9, 1, PAL.goldHi);
    }
    boutline(b, 14, 0.55);
    bblit(b, P, 0, 0);
    return { w: w, h: h, ox: -(w >> 1), oy: -h + 2 };
  }

  // ---------------------------------------------------------------------------
  // Vehicles: fogger 20×10, bus 24×12, pirogue 22×8, navy 22×8 (2 frames each; wheels/paddles alternate)
  // ---------------------------------------------------------------------------
  registerSimple('fogger', {
    size: fixed(L.fogger), frames: 2,
    paint: function (P, w, h, f) {
      const st = C.steel;
      P.rect(2, 9, 16, 1, C.shadow);
      P.rect(1, 2, 12, 5, st); P.rect(2, 1, 10, 1, shade(st, 1.25)); P.rect(1, 6, 12, 1, shade(st, 0.7)); P.rect(12, 2, 1, 5, shade(st, 0.8)); P.rect(1, 3, 1, 3, shade(st, 1.1));   // the tank
      P.rect(3, 3, 8, 1, PAL.purple); P.px(6, 3, PAL.gold); P.px(7, 3, PAL.gold);                                                                                                         // BSU band
      P.rect(13, 2, 6, 5, C.offWhite); P.rect(14, 1, 4, 1, C.white); P.rect(13, 6, 6, 1, shade(C.offWhite, 0.75)); P.rect(17, 2, 2, 3, C.glass); P.rect(15, 2, 1, 5, shade(C.offWhite, 0.85)); P.px(19, 5, PAL.gold);   // cab, windshield, door, headlight
      P.px(15, 0, f ? C.red : shade(C.red, 0.5)); P.px(16, 0, f ? shade(C.red, 1.3) : shade(C.red, 0.5));                                                                                // beacon
      P.rect(0, 4, 1, 2, C.steelDark); P.px(0, 3, f ? shade(C.offWhite, 0.9) : C.steelDark);                                                                                             // rear nozzle (the ribbon is particles)
      P.rect(1, 7, 18, 1, black);
      for (const x of [2, 15]) { P.rect(x, 7, 2, 2, black); P.px(f ? x + 1 : x, f ? 8 : 7, st); }                                                                                          // wheels rotate
    }
  });
  registerSimple('bus', {
    size: fixed(L.bus), frames: 2,
    paint: function (P, w, h, f) {
      P.rect(2, 11, 20, 1, C.shadow);
      P.rect(1, 1, 22, 8, PAL.purple); P.rect(2, 0, 20, 1, PAL.purpleHi); P.rect(1, 1, 22, 1, PAL.purpleHi); P.rect(1, 8, 22, 1, PAL.purpleShadow); P.rect(22, 1, 1, 8, PAL.purpleShadow);
      for (const x of [3, 8, 13, 18]) { P.rect(x, 2, 3, 3, C.glass); P.rect(x, 2, 3, 1, shade(C.glass, 1.15)); P.px(x + 2, 4, shade(C.glass, 0.85)); }
      P.rect(1, 6, 22, 1, PAL.gold); P.rect(21, 3, 2, 5, PAL.purple2); P.px(21, 3, C.glass); P.px(23, 5, PAL.goldHi); P.rect(23, 6, 1, 3, C.steel);
      for (const x of [3, 17]) { P.rect(x, 9, 3, 2, black); P.px(x + 1, f ? 10 : 9, C.steel); }
    }
  });
  function hull(P) {
    P.rect(1, 4, 20, 1, shade(PAL.bark, 1.3)); P.px(0, 4, shade(PAL.bark, 1.3)); P.px(21, 4, shade(PAL.bark, 1.3));
    P.rect(2, 5, 18, 1, PAL.bark); P.rect(4, 6, 14, 1, shade(PAL.bark, 0.7)); P.rect(6, 4, 10, 1, shade(PAL.bark, 0.55));
  }
  function paddler(P, x, shirt, right) {
    P.rect(x + 1, 0, 2, 2, X.skins ? X.skins[1] : '#E0AC69'); P.rect(x + 1, 0, 2, 1, PAL.bark); P.rect(x, 2, 4, 3, shirt);
    if (right) { P.line(x + 4, 2, x + 8, 7, PAL.bark); P.rect(x + 8, 6, 2, 2, shade(PAL.bark, 1.3)); }
    else { P.line(x - 1, 2, x - 5, 7, PAL.bark); P.rect(x - 6, 6, 2, 2, shade(PAL.bark, 1.3)); }
  }
  registerSimple('pirogue', {
    size: fixed(L.pirogue), frames: 2,
    paint: function (P, w, h, f) { P.rect(3, 7, 16, 1, C.shadowLight); hull(P); paddler(P, 9, PAL.purple, f === 0); P.px(f ? 2 : 19, 7, PAL.shallows); P.px(f ? 3 : 18, 7, PAL.shallows); }
  });
  registerSimple('navy', {
    size: fixed(L.navy), frames: 2,
    paint: function (P, w, h, f) {
      P.rect(3, 7, 16, 1, C.shadowLight); hull(P);
      paddler(P, 4, C.vest, f === 1); paddler(P, 11, C.vest, f === 0);
      P.rect(18, 0, 1, 5, C.steel); P.rect(19, 0, 3, 5, PAL.gold); P.rect(19, 0, 3, 1, PAL.goldHi); P.px(20, 1, PAL.purple); P.px(20, 3, PAL.purple); P.px(19, 2, PAL.purple);   // the "CN" flag
    }
  });

  // ---------------------------------------------------------------------------
  // Mardi Gras float 32×16 (2 roll frames): purple deck, green/gold bunting, a 6×8 tiger head, two krewe riders
  // ---------------------------------------------------------------------------
  registerSimple('float', {
    size: fixed(L.float), frames: 2,
    paint: function (P, w, h, f) {
      P.rect(3, 14, 26, 1, C.shadow); P.rect(5, 15, 22, 1, C.shadow);
      for (const x of [4, 25]) { P.rect(x, 12, 3, 2, black); P.px(x + 1, f ? 13 : 12, C.steel); }
      P.rect(1, 7, 30, 5, PAL.purple); P.rect(1, 7, 30, 1, PAL.gold); P.rect(1, 11, 30, 1, PAL.purpleShadow);
      for (let x = 1; x < 31; x++) { const k = ((x + f) / 3 | 0) % 3; P.rect(x, 9, 1, 2, k === 0 ? PAL.purple2 : k === 1 ? C.green : PAL.gold); }
      for (let x = 2; x < 30; x += 3) { P.px(x, 8, C.green); P.px(x + 1, 8, PAL.goldHi); P.px(x + 2, 8, f ? PAL.purpleHi : PAL.purple2); }
      P.rect(10, 3, 12, 4, PAL.purple2); P.rect(10, 3, 12, 1, PAL.purpleHi); P.rect(10, 6, 12, 1, PAL.purpleShadow);
      P.rect(13, 0, 6, 8, C.tiger); P.px(13, 0, black); P.px(18, 0, black); P.px(15, 0, black); P.px(16, 0, black); P.px(13, 2, black); P.px(18, 2, black);
      P.px(14, 3, C.white); P.px(17, 3, C.white); P.px(14, 4, black); P.px(17, 4, black); P.rect(15, 5, 2, 2, C.white); P.px(15, 5, black); P.px(16, 7, black);
      for (const x of [5, 25]) { P.rect(x, 3, 2, 1, X.skins ? X.skins[2] : '#C68642'); P.rect(x, 4, 2, 3, x < 16 ? PAL.gold : C.green); if (f) P.px(x < 16 ? x + 2 : x - 1, 3, X.skins ? X.skins[2] : '#C68642'); }
      P.rect(0, 8, 1, 3, PAL.goldShadow); P.rect(31, 8, 1, 3, PAL.goldShadow);
    }
  });

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

  // ---------------------------------------------------------------------------
  // Birds and critters (GDD §6.7): egret 10×14, spoonbill 10×14, pelican 12×10, armadillo 10×6, nutria 12×6
  // ---------------------------------------------------------------------------
  registerSimple('egret', {
    size: fixed(L.egret), frames: 2,
    paint: function (P, w, h, f) {
      const b = newBuf(w, h), wt = C.white, wd = shade(C.white, 0.82);
      if (f === 0) {
        shadowRows(P, 0, 0, 5, 12, 6);
        brect(b, 3, 4, 5, 1, wt); brect(b, 2, 5, 7, 2, wt); brect(b, 3, 7, 5, 1, wd); bput(b, 1, 5, wd); bput(b, 0, 5, wd);   // body + tail
        bput(b, 6, 3, wt); bput(b, 7, 2, wt); bput(b, 7, 1, wt); brect(b, 7, 0, 2, 2, wt); bput(b, 9, 1, C.beak); bput(b, 8, 0, black);   // neck, head, beak, eye
        bput(b, 4, 8, black); bput(b, 4, 9, black); bput(b, 4, 10, black); bput(b, 6, 8, black); bput(b, 6, 9, black); bput(b, 6, 10, black); bput(b, 3, 11, black); bput(b, 7, 11, black);   // legs
      } else {
        P.rect(3, 13, 4, 1, C.shadowLight);
        brect(b, 0, 4, 10, 1, wt); brect(b, 1, 5, 8, 1, wt); bput(b, 0, 4, wd); bput(b, 9, 4, wd); bput(b, 0, 3, wd); bput(b, 9, 3, wd);   // wings 10 wide
        brect(b, 3, 6, 4, 2, wt); bput(b, 2, 7, wd); bput(b, 1, 8, wd);
        bput(b, 7, 3, wt); bput(b, 8, 2, wt); brect(b, 8, 0, 2, 2, wt); bput(b, 9, 0, black); bput(b, 9, 2, C.beak);   // wait: keep the beak inside the 10-px cell
        bput(b, 3, 8, black); bput(b, 2, 9, black); bput(b, 5, 8, black); bput(b, 4, 9, black);   // trailing legs
      }
      boutline(b, 12, 0.6);
      bblit(b, P, 0, 0);
    }
  });
  registerSimple('spoonbill', {
    size: fixed(L.spoonbill), frames: 2,
    paint: function (P, w, h, f) {
      const b = newBuf(w, h), pk = C.spoonbill, pd = shade(pk, 0.8);
      P.rect(3, 13, 4, 1, C.shadowLight);
      if (f === 0) { brect(b, 0, 5, 10, 1, pk); brect(b, 1, 6, 8, 1, pd); bput(b, 0, 5, pd); bput(b, 9, 5, pd); }
      else { for (let k = 0; k < 3; k++) { bput(b, k, 3 + k, k === 0 ? pd : pk); bput(b, 9 - k, 3 + k, k === 0 ? pd : pk); } brect(b, 3, 6, 4, 1, pd); }
      brect(b, 3, 6, 4, 2, pk); brect(b, 3, 8, 4, 1, pd); bput(b, 3, 5, C.red); bput(b, 6, 5, C.red);   // body + the red shoulder patches
      brect(b, 7, 4, 2, 2, pk); bput(b, 8, 4, black); bput(b, 9, 5, C.steel); bput(b, 9, 6, C.steel); bput(b, 9, 7, shade(C.steel, 1.2));   // head + spatula bill
      bput(b, 2, 9, pd); bput(b, 1, 10, pd);   // trailing legs
      boutline(b, 12, 0.6);
      bblit(b, P, 0, 0);
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
  registerSimple('nutria', {
    size: fixed(L.nutria), frames: 2,
    paint: function (P, w, h, f) {
      const b = newBuf(w, h), br = C.nutria, bd = shade(br, 0.75);
      shadowRows(P, 0, 0, 6, 4, 10);
      brect(b, 3, 0, 6, 1, shade(br, 1.15)); brect(b, 2, 1, 8, 2, br); brect(b, 9, 0, 3, 3, br); bput(b, 9, 0, shade(br, 1.15));
      bput(b, 10, 1, black); bput(b, 11, 2, C.ember); bput(b, 11, 1, bd);   // eye, the orange teeth, nose
      bline(b, 0, 2, 2, 2, bd); bput(b, 0, 1, bd);                          // rat tail
      for (const x of [3, 5, 8]) bput(b, x + f, 3, bd);
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

  // ---------------------------------------------------------------------------
  // Init: pre-bake the entity sprites the first frame is likely to need (≤ 20 ms)
  // ---------------------------------------------------------------------------
  M.initEntities = function () {
    try {
      for (let v = 0; v < 3; v++) for (let f = 0; f < 6; f++) M.get('gator', v, f, 1);
      for (let f = 0; f < 3; f++) M.get('roux', 0, f, 1);
      M.get('officer', 0, 0, 1); M.get('officer:wrangle', 0, 0, 1); M.get('officer:wrangle', 0, 1, 1);
      for (const id of ['fogger', 'bus', 'pirogue', 'navy', 'float', 'smoker', 'cornhole', 'snoball', 'egret', 'spoonbill', 'pelican', 'armadillo', 'nutria']) { M.get(id, 0, 0, 1); M.get(id, 0, 1, 1); }
      for (let f = 0; f < 3; f++) { M.get('bonfire', 0, f, 1); M.get('bubble', 0, f, 1); }
      for (let f = 0; f < 4; f++) { M.get('gate', 0, f, 1); M.get('barrierGate', 0, f, 1); M.get('band', 0, f, 1); M.get('krewe', 0, f, 1); }
      M.get('tent', 0, 0, 1); M.get('nest', 0, 0, 1);
      const look0 = M.agentLook(0); M.get('agent', look0, 0, 1); M.get('agent:idle', look0, 0, 1);
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
  const SIZES = { agent: [12, 20], roux: L.roux, officer: L.officer, 'officer:wrangle': L.wrangle, fogger: L.fogger, bus: L.bus, pirogue: L.pirogue, navy: L.navy, float: L.float, band: L.band, krewe: L.krewe, tent: L.tent, smoker: L.smoker, cornhole: L.cornhole, snoball: L.snoball, bonfire: L.bonfire, egret: L.egret, spoonbill: L.spoonbill, pelican: L.pelican, armadillo: L.armadillo, nutria: L.nutria, gate: L.gate, barrierGate: L.barrierGate, nest: L.nest, bubble: L.bubble };
  M.entitySizes = Object.freeze(Object.assign({}, SIZES));
  function entitiesSelfTest() {
    const notes = [];
    const check = (c, m) => { if (!c) notes.push(m); };
    const g = (id, v, f) => M.get(id, v | 0, f | 0, 1);
    try {
      // 1. sizes
      for (const id of Object.keys(SIZES)) { const e = g(id, 0, 0); check(e && e.sw === SIZES[id][0] && e.sh === SIZES[id][1], id + ' is ' + SIZES[id].join('×') + (e ? ' (got ' + e.sw + '×' + e.sh + ')' : ' (null)')); }
      for (let v = 0; v < 3; v++) { const e = g('gator', v, 0); check(e && e.sw === L.gatorSizes[v][0] && e.sh === L.gatorSizes[v][1], 'gator v' + v + ' size'); }
      check(g('oak', 2, 0) && g('oak', 2, 0).sw === 96 && g('oak', 2, 0).sh === 56, 'oak stage 2 is 96×56');
      check(g('cypress', 2, 0) && g('cypress', 2, 0).sw === 24 && g('cypress', 2, 0).sh === 80, 'cypress stage 2 is 24×80');
      // 2. frame totals
      for (const id of Object.keys(FRAME_TOTALS)) check(M.frames(id) === FRAME_TOTALS[id], 'frames(' + id + ') = ' + FRAME_TOTALS[id] + ' (got ' + M.frames(id) + ')');
      check(M.frames('oak') === 1 && M.frames('cypress') === 1 && M.frames('palmetto') === 1 && M.frames('azalea') === 1, 'tree frames 1');
      // 3. agentFrame
      check(M.agentFrame('walk', 3, 5) === 13 && M.agentFrame('sit', 2, 9) === 2 && M.agentFrame('umbrella', 1, 4) === 4, 'agentFrame packing');
      for (const a of ANIM_NAMES) for (let d = 0; d < 4; d++) for (let f = -3; f < 9; f++) check(M.agentFrame(a, d, f) < FRAME_TOTALS[M.agentId(a)], 'agentFrame < frames');
      check(M.agentFrame('nope', NaN, Infinity) === 0 && M.agentFrame(null, -1, -1) === 3 * 4 + 3, 'agentFrame tolerates garbage');
      check(M.gatorFrame('swim', 1) === 3 && M.gatorFrame(2, 0) === 2 && M.gatorFrame('WANDER', 3) === 4 && M.gatorFrame(NaN, NaN) === 0, 'gatorFrame');
      // 4. anchors
      const a0 = g('agent', 0, 0); check(a0 && a0.ox === -6 && a0.oy === -18, 'agent anchor (−6, −18)');
      check(g('oak', 2, 0) && g('oak', 2, 0).oy === -52, 'oak stage 2 oy −52');
      check(g('gate', 0, 0).ox === -16 && g('gate', 0, 0).oy === -20 && g('barrierGate', 0, 3).oy === -20, 'gate anchors (−16, −20)');
      check(g('gator', 1, 0).ox === -20 && g('gator', 1, 0).oy === -10 && g('roux', 0, 0).oy === -14 && g('pirogue', 0, 0).oy === -6, 'entity foot anchors (ox −w/2, oy −h+2)');
      check(g('agent:sit', 0, 0).sw === 8 && g('agent:sit', 0, 0).oy === -12 && g('agent:cheer', 0, 0).sh === 22 && g('agent:umbrella', 0, 0).sh === 26, 'sit 8×14, cheer 12×22, umbrella 12×26 cells');
      // 5. every anim × 4 dirs × frames resolves for look 0; the max look resolves
      for (const a of ANIM_NAMES) {
        const id = M.agentId(a), n = ANIM[a].n, cell = M.agentCell(a);
        for (let d = 0; d < 4; d++) for (let f = 0; f < n; f++) { const e = g(id, 0, d * n + f); check(e && e.sw === cell.w && e.sh === cell.h && e.sx === (d * n + f) * cell.w, id + ' dir ' + d + ' frame ' + f); }
      }
      check(g('agent', L.lookMask, 0) && g('agent', L.lookMask, 15), 'look 511 resolves');
      check(g('band', 100, 3) && g('krewe', 77, 2) && g('officer', 0, 15), 'band/krewe looks, officer frame 15');
      check(g('agent', 0, 17) === g('agent', 0, 1), 'agent frame 17 wraps to 1');
      // 6. treeVariant
      check(M.treeVariant(2, true, false) === 6 && M.treeVariant(1, false, true) === 9, 'treeVariant packing');
      // 7. mirrored directions are pixel-exact mirrors; composition is deterministic
      for (const a of ['walk', 'flee', 'umbrella', 'sit']) {
        const n = ANIM[a].n;
        for (let f = 0; f < n; f++) {
          const b0 = composeAgent(a, 37, 0, f), b1 = composeAgent(a, 37, 1, f), b3 = composeAgent(a, 37, 3, f), b2 = composeAgent(a, 37, 2, f);
          check(bequal(bflipX(composeAgent(a, 37, 0, f)), b1), a + ' dir 1 mirrors dir 0 (frame ' + f + ')');
          check(bequal(bflipX(composeAgent(a, 37, 3, f)), b2), a + ' dir 2 mirrors dir 3 (frame ' + f + ')');
          check(bequal(b0, composeAgent(a, 37, 0, f)) && bequal(b3, composeAgent(a, 37, 3, f)), a + ' deterministic');
          check(!bequal(b0, b3), a + ' front and back differ');
        }
      }
      const w0 = composeAgent('walk', 0, 0, 0), w1 = composeAgent('walk', 0, 0, 1), w2 = composeAgent('walk', 0, 0, 2);
      check(!bequal(w0, w1) && !bequal(w0, w2) && !bequal(w1, w2), 'walk frames 0/1/2 differ (0.5× draws 0 and 2)');
      check(bget(w0, 4, 17) === C.shoe && bget(w0, 6, 9) !== null && bget(w0, 4, 3) === black && bget(composeAgent('walk', 8, 3, 0), 4, 3) !== black, 'base figure: shoes row 17, shirt row 9, eyes only in front view');
      // 8. sheets: one canvas per (look, anim, zoom); sub-rects share it; memory accounted
      const s1 = g('agent', 5, 0), s2 = g('agent', 5, 9); check(s1 && s2 && s1.canvas === s2.canvas && s1.sx !== s2.sx, 'frames of one look share a sheet');
      check(M.sheetCount() > 0 && M.sheetMemoryMB() > 0 && M.sheetMemoryMB() < M.SHEET_LIMIT_MB, 'sheet memory ' + M.sheetMemoryMB().toFixed(3) + ' MB');
      check(M.gcSheets(1) === 0, 'gcSheets below budget drops nothing');
      // 9. zoom 2 entries double the cell and the anchor
      const z2 = M.get('agent', 0, 0, 2); if (M.ZOOM2) check(z2 && z2.sw === 24 && z2.sh === 40 && z2.ox === -12 && z2.oy === -36, '2× agent sheet 24×40 at (−12, −36)');
      const gz = M.get('gator', 2, 3, 2); if (M.ZOOM2) check(gz && gz.sw === 112 && gz.sh === 34, '2× legend gator');
    } catch (e) { notes.push('threw: ' + (e && e.message)); }
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'entities ok' };
  }
  M.entitiesSelfTest = entitiesSelfTest;
  if (Array.isArray(M._tests)) M._tests.push(entitiesSelfTest);
})();
