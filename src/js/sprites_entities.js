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
  function cap(R, A, B, rA, rB, m, tag) {
    const a = scr(R, A), b = scr(R, B), rm = Math.max(rA, rB) + 1, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, fn = typeof m === 'function';
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
  function orb(R, C, r, fn, tag, ry) {
    const s0 = scr(R, C); ry = ry || r;
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
      // 10. football pass E: every fb* id at both zooms, directions, poses, looks, numbers, sideline sprites
      fbSelfTest(check);
    } catch (e) { notes.push('threw: ' + (e && e.message)); }
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'entities ok' };
  }
  M.entitiesSelfTest = entitiesSelfTest;
  if (Array.isArray(M._tests)) M._tests.push(entitiesSelfTest);
})();
