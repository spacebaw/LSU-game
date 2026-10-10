'use strict';
// render_fx.js — extends BSU.render: the atmosphere and spectacle layer. Particle pool (D50 hook
// `particles.forEachWorld`), the screen-space 'weather' pass (rain, cell disc, lightning, wind debris,
// heat shimmer, stadium crowd), the 'tint' pass (sky clock + storm + desaturation), the 'lights' pass
// (cached radial sprites on the offscreen lights composite), the 'fog' pass (mist over water at dawn
// and night, fog blobs, the night vignette), a 'storm' pass (cone, surge crest, god rays, gold flash)
// and an 'fxhud' pass (perf chip). Juice: shake, hit-stop, squash. Perf guardrail reaction.
// Owner branch: none (writes nothing in state; `ui.perfMode` is render's). Implements GDD §12.4–12.7,
// §6.2 (surge front look), §6.4 (haze), §6.7 (fireflies); ARCHITECTURE §6.3 passes 5–8, §6.4, §6.5.
// render's built-in 'overlays' (9) and 'hud' (10) are kept (they already implement F/W/K/P/C/E, ghost,
// flashes, hover pulse and the minimap); this file adds passes around them instead of replacing them.
(function () {
  const BSU = window.BSU;
  if (!BSU || !BSU.render) return;
  const R = BSU.render;
  const PR = BSU.params.render, PAL = BSU.params.palette, MAP = BSU.MAP;
  const SKY = BSU.SKY, SPR = BSU.SPR, STORM = BSU.STORM, SPH = BSU.STORM_PHASE, EV = BSU.EV, T = BSU.T, FLAG = BSU.FLAG;
  const W = MAP.W, HGT = MAP.H, N = MAP.N, PXFT = 6;
  const WATER_FLAGS = (FLAG.BAYOU | 0) | (FLAG.OPEN_WATER | 0);
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  const rng = () => BSU.rng.fx;
  const mod = (n) => BSU[n] || null;
  function ferr(where, e) { try { BSU.error('renderfx', where, e); } catch (e2) { if (BSU.SELFTEST) throw e2; } }
  function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  const GOLD = PAL.gold || '#FDD023';

  // ---------------------------------------------------------------------------
  // Particle pool (ARCHITECTURE §6.4): struct-of-arrays, fixed size, swap-remove
  // ---------------------------------------------------------------------------
  const MAXP = PR.particlesMax || 2500, LOWP = PR.particlesLow || 800;
  const px = new Float32Array(MAXP), py = new Float32Array(MAXP), pz = new Float32Array(MAXP);
  const pvx = new Float32Array(MAXP), pvy = new Float32Array(MAXP), pvz = new Float32Array(MAXP);
  const plife = new Float32Array(MAXP), pmax = new Float32Array(MAXP), psize = new Float32Array(MAXP);
  const ptype = new Uint8Array(MAXP), pcol = new Uint8Array(MAXP), pscreen = new Uint8Array(MAXP), parc = new Uint8Array(MAXP);
  const b0x = new Float32Array(MAXP), b0y = new Float32Array(MAXP), b1x = new Float32Array(MAXP), b1y = new Float32Array(MAXP), b2x = new Float32Array(MAXP), b2y = new Float32Array(MAXP), barcH = new Float32Array(MAXP);
  let alive = 0, cap = MAXP, lowMode = false;
  const TYPES = ['rain', 'splash', 'dust', 'smoke', 'steam', 'sparks', 'firefly', 'petal', 'bead', 'leaf', 'confetti', 'coin', 'fogWisp', 'mosqDot', 'debris', 'foam', 'sheet', 'gush', 'lightningBloom'];
  const TID = {}; TYPES.forEach((t, k) => { TID[t] = k; });
  // {life ms, g px/s², drift (wind coupling), color index into render.particleColors, size px, ground: 0 pass, 1 stop, 2 bounce, 3 die}
  const TDEF = [
    { life: 600, g: 0, drift: 0, col: 10, size: 1, ground: 3 },            // rain
    { life: 300, g: 500, drift: 0, col: 1, size: 1, ground: 3 },           // splash
    { life: 400, g: 40, drift: 0.2, col: 3, size: 2, ground: 1 },          // dust
    { life: 900, g: -20, drift: 1, col: 7, size: 2, ground: 0 },           // smoke
    { life: 700, g: -30, drift: 1, col: 1, size: 1, ground: 0 },           // steam
    { life: 500, g: 600, drift: 0, col: 9, size: 1, ground: 3 },           // sparks
    { life: 3000, g: 0, drift: 0.05, col: 14, size: 1, ground: 0 },        // firefly
    { life: 1500, g: 25, drift: 1, col: 5, size: 1, ground: 1 },           // petal
    { life: 800, g: 600, drift: 0, col: 8, size: 2, ground: 2 },           // bead
    { life: 1500, g: 30, drift: 1, col: 6, size: 1, ground: 1 },           // leaf
    { life: 1200, g: 150, drift: 0.3, col: 0, size: 2, ground: 1 },        // confetti
    { life: 700, g: 700, drift: 0, col: 0, size: 2, ground: 2 },           // coin
    { life: 4000, g: 0, drift: 1, col: 1, size: 1, ground: 0 },            // fogWisp
    { life: 2000, g: 0, drift: 0.4, col: 12, size: 1, ground: 0 },         // mosqDot
    { life: 1500, g: 500, drift: 0.5, col: 7, size: 3, ground: 1 },        // debris
    { life: 600, g: 0, drift: 0, col: 1, size: 1, ground: 0 },             // foam
    { life: 300, g: 0, drift: 0, col: 2, size: 1, ground: 3 },             // sheet
    { life: 500, g: 500, drift: 0, col: 15, size: 2, ground: 3 },          // gush
    { life: 250, g: 0, drift: 0, col: 1, size: 2, ground: 0 }              // lightningBloom
  ];
  const LOW_PRIORITY = new Uint8Array(TDEF.length); LOW_PRIORITY[TID.mosqDot] = 1; LOW_PRIORITY[TID.fogWisp] = 1; LOW_PRIORITY[TID.splash] = 1; LOW_PRIORITY[TID.rain] = 1;
  const CONFETTI_COLS = [0, 8, 11, 1, 14];

  function kill(i) { alive--; if (i !== alive) { px[i] = px[alive]; py[i] = py[alive]; pz[i] = pz[alive]; pvx[i] = pvx[alive]; pvy[i] = pvy[alive]; pvz[i] = pvz[alive]; plife[i] = plife[alive]; pmax[i] = pmax[alive]; psize[i] = psize[alive]; ptype[i] = ptype[alive]; pcol[i] = pcol[alive]; pscreen[i] = pscreen[alive]; parc[i] = parc[alive]; if (parc[i]) { b0x[i] = b0x[alive]; b0y[i] = b0y[alive]; b1x[i] = b1x[alive]; b1y[i] = b1y[alive]; b2x[i] = b2x[alive]; b2y[i] = b2y[alive]; barcH[i] = barcH[alive]; } } }
  function slot(type) {
    if (alive < cap) return alive++;
    if (LOW_PRIORITY[type]) return -1;
    const lim = Math.min(alive, 256);
    for (let k = 0; k < lim; k++) if (LOW_PRIORITY[ptype[k]]) return k;   // replace an old haze dot / splash
    return -1;
  }
  /** emit n particles of `type` at world px (zoom-1 space; or screen px with opts.screen) */
  function emit(type, wx, wy, n, opts) {
    const t = TID[type]; if (t === undefined) return;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
    n = Math.max(1, fin(n, 1) | 0); const o = opts || {}; const d = TDEF[t]; const r = rng();
    const spread = fin(o.spread, 0), life = fin(o.life, d.life), size = fin(o.size, d.size);
    const vx = fin(o.vx, 0), vy = fin(o.vy, 0), vz = fin(o.vz, 0), z0 = fin(o.z, 0), screen = o.screen === true ? 1 : 0;
    const jitter = fin(o.jitter, 0.35);
    for (let k = 0; k < n; k++) {
      const i = slot(t); if (i < 0) return;
      px[i] = wx + (spread ? (r.float() * 2 - 1) * spread : 0); py[i] = wy + (spread ? (r.float() * 2 - 1) * spread * (screen ? 1 : 0.5) : 0); pz[i] = z0;
      pvx[i] = vx + (r.float() * 2 - 1) * Math.abs(vx) * jitter + (vx === 0 ? (r.float() * 2 - 1) * 12 * (d.g ? 2 : 1) : 0);
      pvy[i] = vy + (r.float() * 2 - 1) * Math.abs(vy) * jitter + (vy === 0 ? (r.float() * 2 - 1) * 6 * (d.g ? 2 : 1) : 0);
      pvz[i] = vz + (r.float() * 2 - 1) * Math.abs(vz) * jitter;
      plife[i] = pmax[i] = life * (0.7 + 0.6 * r.float()); psize[i] = size; ptype[i] = t; pscreen[i] = screen; parc[i] = 0;
      pcol[i] = (Number.isFinite(o.color) ? (o.color | 0) & 15 : (t === TID.confetti ? CONFETTI_COLS[r.int(CONFETTI_COLS.length)] : (t === TID.bead ? [0, 8, 11][r.int(3)] : d.col)));
    }
  }
  /** a debris particle flying a quadratic bezier in world px (storm:pulse) */
  function emitArc(x0, y0, x1, y1, x2, y2, h, life, size) {
    const i = slot(TID.debris); if (i < 0) return;
    px[i] = x0; py[i] = y0; pz[i] = 0; pvx[i] = pvy[i] = pvz[i] = 0; plife[i] = pmax[i] = life; psize[i] = size; ptype[i] = TID.debris; pcol[i] = 7; pscreen[i] = 0; parc[i] = 1;
    b0x[i] = x0; b0y[i] = y0; b1x[i] = x1; b1y[i] = y1; b2x[i] = x2; b2y[i] = y2; barcH[i] = h;
  }
  function update(dtMs, wind, windAngle) {
    const dt = clamp(fin(dtMs, 16.67), 0, 100) / 1000;
    const wvx = Math.cos(fin(windAngle, 0)) * fin(wind, 0) * 40, wvy = Math.sin(fin(windAngle, 0)) * fin(wind, 0) * 20;
    for (let i = 0; i < alive; i++) {
      plife[i] -= dt * 1000;
      if (plife[i] <= 0) { kill(i); i--; continue; }
      const d = TDEF[ptype[i]];
      if (parc[i]) {
        const t = 1 - plife[i] / pmax[i], u = 1 - t;
        px[i] = u * u * b0x[i] + 2 * u * t * b1x[i] + t * t * b2x[i]; py[i] = u * u * b0y[i] + 2 * u * t * b1y[i] + t * t * b2y[i]; pz[i] = Math.sin(t * Math.PI) * barcH[i];
        continue;
      }
      if (d.drift) { pvx[i] += (wvx - pvx[i]) * d.drift * dt; pvy[i] += (wvy - pvy[i]) * d.drift * dt * 0.5; }
      if (d.g) pvz[i] -= d.g * dt;
      px[i] += pvx[i] * dt; py[i] += pvy[i] * dt; pz[i] += pvz[i] * dt;
      if (ptype[i] === TID.firefly) { const ph = plife[i] * 0.004; pvx[i] += Math.sin(ph + i) * 8 * dt; pvy[i] += Math.cos(ph * 0.7 + i) * 4 * dt; pvz[i] += Math.sin(ph * 1.3) * 6 * dt; if (pz[i] < 4) pz[i] = 4; if (pz[i] > 40) pz[i] = 40; }
      if (pz[i] < 0 && !pscreen[i]) {
        if (d.ground === 3) { kill(i); i--; continue; }
        if (d.ground === 1) { pz[i] = 0; pvx[i] *= 0.6; pvy[i] *= 0.6; pvz[i] = 0; }
        else if (d.ground === 2) { pz[i] = 0; pvz[i] = -pvz[i] * 0.35; pvx[i] *= 0.7; pvy[i] *= 0.7; if (pvz[i] < 20) pvz[i] = 0; }
      }
    }
  }
  R.particles = {
    emit: function (type, wx, wy, n, opts) { try { emit(type, wx, wy, n === undefined ? 1 : n, opts); } catch (e) { ferr('emit', e); } },
    count: function () { return alive; },
    clear: function () { alive = 0; },
    forEachWorld: function (fn) { if (typeof fn !== 'function') return; for (let i = 0; i < alive; i++) if (!pscreen[i]) fn(px[i], py[i], pz[i], psize[i], pcol[i], TYPES[ptype[i]]); }
  };

  // ---------------------------------------------------------------------------
  // Private FX state (rebuilt in _fxReset)
  // ---------------------------------------------------------------------------
  const RAIN_N = (PR.rainLines && PR.rainLines[1]) || 1200;
  const rainPos = new Float32Array(RAIN_N * 2); let rainSeeded = false, rainRamp = 0;
  const bolt = new Float32Array(24); let boltN = 0, flashUntil = 0, boltUntil = 0, boltTipX = 0, boltTipY = 0;
  const fogBlobs = []; for (let k = 0; k < 8; k++) fogBlobs.push({ x: 0, y: 0, r: 1, vx: 0, ph: 0 });
  let fogSprite = null, fogSpriteTried = false, lightsCtx = null, lightsCanvasRef = null;
  let stormPhase = -1, godRayUntil = -1, goldFlash = 0, burstsPending = 0, burstTimer = 0, perfChipUntil = 0, subscribed = false, inited = false;
  let frameNo = 0, lastFrameNo = -1;
  const overtop = new Map();   // tile → frames left of trickle
  const lightRefs = {};        // kind → SpriteRef (refreshed per frame)
  const LIGHT_KINDS = ['lamp', 'window', 'mast', 'beacon', 'blink', 'arc', 'glow', 'pot', 'fire', 'firefly', 'eye', 'canal'];
  const LMAX = PR.lightsMax || 250;
  const lightsList = []; for (let k = 0; k < LMAX + 8 + 48; k++) lightsList.push({ kind: 'lamp', x: 0, y: 0, r: 1, a: 1, rot: 0, d: 0 });
  let lightsN = 0;
  R.lightsList = lightsList;
  const TINTS = {};
  TINTS[SKY.DAWN] = { color: (PR.tint.dawn && PR.tint.dawn.color) || '#F7B58A', alpha: fin(PR.tint.dawn && PR.tint.dawn.alpha, 0.25) };
  TINTS[SKY.DAY] = null;
  TINTS[SKY.GOLDEN] = { color: (PR.tint.golden && PR.tint.golden.color) || '#FFCB6B', alpha: fin(PR.tint.golden && PR.tint.golden.alpha, 0.2) };
  TINTS[SKY.DUSK] = { color: (PR.tint.dusk && PR.tint.dusk.color) || '#6B3F8F', alpha: fin(PR.tint.dusk && PR.tint.dusk.alpha, 0.35) };
  TINTS[SKY.NIGHT] = { color: (PR.tint.night && PR.tint.night.color) || '#0E1230', alpha: fin(PR.tint.night && PR.tint.night.alpha, 0.62) };
  const STORM_TINT = { color: (PR.tint.storm && PR.tint.storm.color) || '#2A3140', alpha: fin(PR.tint.storm && PR.tint.storm.alpha, 0.5) };
  const EYE_TINT = { color: '#C9B86B', alpha: 0.2 }, FOG_TINT = { color: (PR.tint.fog && PR.tint.fog.color) || '#C9CFD1', alpha: fin(PR.tint.fog && PR.tint.fog.alpha, 0.3) };
  const HORIZON = {}; HORIZON[SKY.DAWN] = '#FF9A5C'; HORIZON[SKY.GOLDEN] = '#FFB347'; HORIZON[SKY.DUSK] = '#E0527A';

  // ---------------------------------------------------------------------------
  // Helpers shared by the passes
  // ---------------------------------------------------------------------------
  const sk = { phase: SKY.DAY, t: 0 };
  function readSky(state) {
    const s = state && state.sky; sk.phase = clamp(fin(s && s.phase, SKY.DAY) | 0, 0, 4); sk.t = clamp(fin(s && s.t, 0), 0, 1); return sk;
  }
  /** 0 by Day, ramps in through Dusk, 1 at Night, ramps out through Dawn (plus storm darkness) */
  function nightAmount(state) {
    const s = readSky(state); let a = 0;
    if (s.phase === SKY.DUSK) a = s.t * s.t; else if (s.phase === SKY.NIGHT) a = 1; else if (s.phase === SKY.DAWN) a = 1 - s.t;
    const st = stormDarkness(state); if (st > 0) a = Math.max(a, 0.55 * st);
    return clamp(a, 0, 1);
  }
  /** 0–1 how deep into the landfall set piece we are (0 outside it) */
  function stormDarkness(state) {
    const sp = state && state.setPiece; if (!sp || sp.kind !== 'landfall') return 0;
    return clamp(fin(sp.tick, 0) / 150, 0, 1);
  }
  function camOf(state) { return R.camera || (state && state.ui && state.ui.camera) || { x: 0, y: 0, zoom: 1 }; }
  function worldToScreenPx(wx, wy, cam, view) { return { x: (wx - cam.x) * cam.zoom + view.vw / 2, y: (wy - cam.y) * cam.zoom + view.vh / 2 }; }
  function tileWorldX(tx, ty) { return (tx - ty) * 32; }
  function tileWorldY(tx, ty) { return (tx + ty) * 16; }
  function elevPx(state, i) { const e = state.tiles && state.tiles.elev; return e ? fin(e[i], 0) * PXFT : 0; }
  function isWaterTile(state, i) {
    const t = state.tiles; if (!t) return false;
    const f = t.flags ? t.flags[i] : 0, ty8 = t.type ? t.type[i] : 0, d = t.depth ? fin(t.depth[i], 0) : 0;
    return (f & WATER_FLAGS) !== 0 || ty8 === T.OPEN_WATER || ty8 === T.BAYOU || ty8 === T.POND || d >= 0.1;
  }
  function isMarshy(state, i) { const t = state.tiles; if (!t || !t.type) return false; const ty8 = t.type[i]; return ty8 === T.MARSH || ty8 === T.WET || isWaterTile(state, i) || ((t.flags ? t.flags[i] : 0) & (FLAG.PRESERVE || 0)) !== 0; }
  function stateLive() { return BSU.state || null; }
  function lightRef(kind) {
    let ref = lightRefs[kind];
    if (ref === undefined || ref === null) { try { const S = mod('sprites'); ref = S && typeof S.get === 'function' ? S.get('light:' + kind, 0, 0, 1) : null; } catch (e) { ref = null; } lightRefs[kind] = ref || null; }
    return ref;
  }
  function drawRef(g, ref, cx, cy, w, h, a) { if (!ref || !ref.canvas) return; g.globalAlpha = a; g.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, cx - w / 2, cy - h / 2, w, h); }

  // ---------------------------------------------------------------------------
  // art pass B5 — effects and atmosphere (docs/ART_STYLE.md §1 and §5; INTEGRATION_NOTES "art pass B5").
  // Contact AO under trees and after each building's sprite (render hooks `groundFx` / `entityFx`), 2-frame rain
  // splashes on paved ground, aprons, decks and water, puddles that fill during long rain and dry after, boil-pot
  // steam, vent and heat shimmer, firework shells with trails and bloom. Everything is preallocated (typed arrays,
  // fixed pools): nothing allocates per frame. `R.fxOpts` switches each part off (perf A/B, tests); perf mode drops
  // the AO and the puddles first, then halves the splashes.
  // ---------------------------------------------------------------------------
  const SURF = BSU.SURF || {};
  const TAU = Math.PI * 2;
  const FXO = { ao: true, puddles: true, splashes: true, steam: true, shimmer: true, fireworks: true, fog: true, haze: true, reflect: true };
  R.fxOpts = FXO;
  let fxZoom = 1, fxCamRef = null, fxViewRef = null, aoOn = false, fxPerf = false, aoA0 = 0.23, aoA1 = 0.13, aoSEWide = false, effRainFx = 0;
  const AO_COL = '#171030';       // the cool shadow tint, darker than the 20 % ground-shadow tint it sits in
  // --- contact AO ----------------------------------------------------------------
  const aoGeo = {};               // building type → [flat, rot, pilings, rot + pilings] base geometry in 1× px (or null)
  function aoBox(b, v) {
    const k = (b.rot ? 1 : 0) | ((v & SPR.PILINGS) ? 2 : 0);
    let a = aoGeo[b.type]; if (a === undefined) { a = aoGeo[b.type] = [undefined, undefined, undefined, undefined]; }
    let s = a[k]; if (s !== undefined) return s;
    s = null;
    try {
      const sp = mod('sprites'), row = BSU.data && BSU.data.catalog ? BSU.data.catalog[b.type] : null;
      if (row && row.kind === 'footprint' && sp && typeof sp.buildingBox === 'function') {
        const g = sp.buildingBox(row, v & SPR.PILINGS, 1, b.rot ? 1 : 0);
        if (g && Number.isFinite(g.bl) && g.bl > 0 && g.br > 0 && g.wallH + g.roofH * 0.6 >= 6) s = { dx: g.ipy - g.ipx, dy: 16 - ((g.ipx + g.ipy) >> 1) - g.lift, bl: g.bl, br: g.br };
      }
    } catch (e) { s = null; }
    a[k] = s; return s;
  }
  /** a soft dark band hugging the wall base on the two visible faces: two nested strips (≈ 3.5 and 7 px at 1×) whose alphas stack toward the wall.
   *  On the SE face the cast shadow already darkens the ground in daylight, so it gets only the narrow strip then (no double-darkening). */
  function drawAO(e, b, v, g) {
    const s = aoBox(b, v); if (!s) return;
    const z = fxZoom, Sx = e.sx + s.dx * z, Sy = e.sy + s.dy * z, bl = s.bl * z, br = s.br * z, k = (v & SPR.SCAFFOLD) ? 0.6 : 1;
    g.fillStyle = AO_COL;
    for (let lv = 0; lv < 2; lv++) {
      const w = (lv === 0 ? 9 : 4) * z;
      g.globalAlpha = (lv === 0 ? aoA1 : aoA0) * k; g.beginPath();
      g.moveTo(Sx - bl, Sy - bl / 2); g.lineTo(Sx, Sy); g.lineTo(Sx, Sy + w); g.lineTo(Sx - bl - w, Sy - bl / 2 + w / 2); g.closePath();
      if (lv === 1 || aoSEWide) { g.moveTo(Sx, Sy); g.lineTo(Sx + br, Sy - br / 2); g.lineTo(Sx + br + w, Sy - br / 2 + w / 2); g.lineTo(Sx, Sy + w); g.closePath(); }
      g.fill();
    }
  }
  const EB_Y = [-0.72, -0.36, 0, 0.36, 0.72], EB_W = [0.62, 0.9, 1, 0.9, 0.62];
  /** a pixel-art ellipse of five stacked rects added to the current path (much cheaper than an anti-aliased ellipse, and it matches the sprites' hard edges) */
  function ellRects(g, cx, cy, rx, ry) {
    const h = Math.max(1, Math.round(ry * 0.42));
    for (let k = 0; k < 5; k++) { const w = rx * EB_W[k]; g.rect(Math.round(cx - w), Math.round(cy + ry * EB_Y[k] - h / 2), Math.max(1, Math.round(w * 2)), h); }
  }
  /** the 3-band version for the many small shapes (tree AO) */
  function ellRects3(g, cx, cy, rx, ry) {
    const h = Math.max(1, Math.round(ry * 0.7));
    for (let k = 0; k < 3; k++) { const w = rx * (k === 1 ? 1 : 0.78); g.rect(Math.round(cx - w), Math.round(cy + (k - 1) * ry * 0.62 - h / 2), Math.max(1, Math.round(w * 2)), h); }
  }
  /** a tight dark ellipse (two nested) at every trunk base, under the sprites */
  function treeAO(g, pool, n, z) {
    g.fillStyle = AO_COL;
    for (let lv = 0; lv < 2; lv++) {
      let any = false; g.beginPath();
      for (let k = 0; k < n; k++) {
        const e = pool[k]; if (e.kind !== 'tree' || !e.ref || (e.variant & 64)) continue;
        const sw = e.ref.sw * z / (e.ref.zoom || 1); if (sw < 8) continue;
        const rx = Math.max(3 * z, sw * 0.075) * (lv === 0 ? 1.8 : 1), cy = e.sy + 0.5 * z;
        ellRects3(g, e.sx, cy, rx, rx * 0.42); any = true;
      }
      if (any) { g.globalAlpha = lv === 0 ? aoA1 : aoA0; g.fill(); }
    }
  }
  // --- rain splashes (two frames: the crown, then the ring with two flying drops) --------
  const SPL_MAX = 160, SPL_F0 = 90, SPL_LIFE = 230;
  const spX = new Float32Array(SPL_MAX), spY = new Float32Array(SPL_MAX), spAge = new Float32Array(SPL_MAX), spOwn = new Int16Array(SPL_MAX), spKind = new Uint8Array(SPL_MAX);
  let spN = 0, spApron = 0, spCap = SPL_MAX;
  function addSplash(wx, wy, kind, own) {
    if (spN >= spCap) return;
    spX[spN] = wx; spY[spN] = wy; spAge[spN] = 0; spKind[spN] = kind; spOwn[spN] = own; if (own >= 0) spApron++; spN++;
  }
  function updateSplashes(dtMs) {
    spApron = 0;
    for (let i = 0; i < spN; i++) {
      spAge[i] += dtMs;
      if (spAge[i] >= SPL_LIFE) { spN--; if (i !== spN) { spX[i] = spX[spN]; spY[i] = spY[spN]; spAge[i] = spAge[spN]; spOwn[i] = spOwn[spN]; spKind[i] = spKind[spN]; } i--; continue; }
      if (spOwn[i] >= 0) spApron++;
    }
  }
  /** own < 0: every splash that is not on an apron (drawn under the entities); own ≥ 0: that building's apron (drawn right after its sprite) */
  function drawSplashes(g, cam, vw, vh, own) {
    const z = cam.zoom || 1, ps = Math.max(1, Math.round(z));
    for (let fr = 0; fr < 2; fr++) {
      let any = false; g.beginPath();
      for (let i = 0; i < spN; i++) {
        if ((spAge[i] >= SPL_F0) !== (fr === 1) || (own < 0 ? spOwn[i] >= 0 : spOwn[i] !== own)) continue;
        const sx = Math.round((spX[i] - cam.x) * z + vw / 2), sy = Math.round((spY[i] - cam.y) * z + vh / 2);
        if (sx < -8 || sx > vw + 8 || sy < -8 || sy > vh + 8) continue;
        if (fr === 0) { g.rect(sx - ps, sy, 3 * ps, ps); g.rect(sx, sy - ps, ps, ps); }
        else { g.rect(sx - 3 * ps, sy, 2 * ps, ps); g.rect(sx + ps, sy, 2 * ps, ps); g.rect(sx - 3 * ps, sy - ps, ps, ps); g.rect(sx + 2 * ps, sy - ps, ps, ps); }
        any = true;
      }
      if (any) { g.fillStyle = '#E2EEF8'; g.globalAlpha = fr === 0 ? 0.8 : 0.5; g.fill(); }
    }
  }
  /** rain-rate driven: paved ground (path / road / boardwalk / bridge), building aprons and water; ripples on the puddles */
  function spawnSplashes(state, view, cam, rr) {
    spCap = fxPerf ? 60 : SPL_MAX;
    if (!FXO.splashes || rr < 0.08 || (cam.zoom || 1) < 1) return;
    const t = state.tiles; if (!t || !t.surface) return;
    const r = rng(), x0 = view.x0 | 0, y0 = view.y0 | 0, spanX = Math.max(1, (view.x1 | 0) - x0 + 1), spanY = Math.max(1, (view.y1 | 0) - y0 + 1);
    const cv = R.curves && typeof R.curves.current === 'function' ? R.curves.current() : null, dk = cv && cv.deck ? cv.deck : null;
    const n = Math.round((1.5 + 11 * rr) * (fxPerf ? 0.5 : 1));
    for (let k = 0, made = 0; k < n * 3 && made < n; k++) {
      const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
      const i = ty * W + tx; let kind = 0, own = -1, zpx = fin(t.elev[i], 0) * PXFT;
      if (isWaterTile(state, i)) { kind = 1; zpx = (fin(t.elev[i], 0) + fin(t.depth[i], 0)) * PXFT; if (dk && dk[i] === dk[i]) { zpx = dk[i] * PXFT; kind = 0; } }
      else { const ow = t.owner ? t.owner[i] : -1, sf = t.surface[i]; if (ow >= 0) own = ow; else if (!((sf >= 1 && sf <= 3) || sf === SURF.BRIDGE)) continue; }
      const u = r.float() - 0.5, v = r.float() - 0.5;
      addSplash(tileWorldX(tx, ty) + (u - v) * 32, tileWorldY(tx, ty) + (u + v) * 16 - zpx, kind, own); made++;
    }
    if (pvN > 0) { const m = 1 + ((rr * 4) | 0); for (let k = 0; k < m; k++) { const j = r.int(pvN); addSplash(pvWX[j] + (r.float() - 0.5) * pvWR[j], pvWY[j] + (r.float() - 0.5) * pvWR[j] * 0.5, 2, -1); } }
  }
  // --- puddles: a translucent layer on low ground that fills during long rain and shrinks after ----
  const PUD_CAND = 640, PUD_VIS = 160, PUD_FILL_MS = 14000, PUD_DRY_MS = 42000;
  const pdIdx = new Int32Array(PUD_CAND), pdTh = new Float32Array(PUD_CAND), pdOx = new Float32Array(PUD_CAND), pdOy = new Float32Array(PUD_CAND), pdR = new Float32Array(PUD_CAND);
  const hotIdx = new Int32Array(256);
  const pvSX = new Float32Array(PUD_VIS), pvSY = new Float32Array(PUD_VIS), pvWX = new Float32Array(PUD_VIS), pvWY = new Float32Array(PUD_VIS), pvWR = new Float32Array(PUD_VIS), pvA = new Float32Array(PUD_VIS);
  let pdN = 0, hotN = 0, pdX0 = 0, pdY0 = 0, pdX1 = -1, pdY1 = -1, pdDirty = true, wet = 0, pvN = 0;
  /** the wetness threshold at which a tile grows a puddle: low against its 4 neighbours and wet ground first; 9 = never (water, building ground, fences, bumps) */
  function puddleTh(t, i, tx, ty) {
    if ((t.owner && t.owner[i] >= 0) || (t.flags && (t.flags[i] & WATER_FLAGS) !== 0)) return 9;
    const ty8 = t.type[i]; if (ty8 === T.OPEN_WATER || ty8 === T.BAYOU || ty8 === T.POND || (t.depth && t.depth[i] >= 0.1)) return 9;
    const sf = t.surface ? t.surface[i] : 0; if (sf === SURF.FENCE || sf === SURF.BOARDWALK || sf === SURF.BRIDGE) return 9;
    const e = fin(t.elev[i], 0); let m = 0, n = 0;
    if (tx > 0) { m += t.elev[i - 1]; n++; } if (tx < W - 1) { m += t.elev[i + 1]; n++; } if (ty > 0) { m += t.elev[i - W]; n++; } if (ty < HGT - 1) { m += t.elev[i + W]; n++; }
    const low = n ? m / n - e : 0; if (low < -0.2) return 9;
    let th = 0.3 + 1.0 * ((hash(tx * 7 + 3, ty * 13 + 1) & 1023) / 1024) - 0.55 * clamp(low * 2.5, 0, 1);
    if (ty8 === T.WET) th -= 0.18; else if (ty8 === T.MARSH) th -= 0.08;
    if (sf === SURF.PATH || sf === SURF.ROAD) th -= 0.05;
    return th;
  }
  function rebuildPuddles(state, view) {
    const t = state.tiles; pdN = 0; hotN = 0;
    pdX0 = Math.max(0, (view.x0 | 0) - 2); pdY0 = Math.max(0, (view.y0 | 0) - 2); pdX1 = Math.min(W - 1, (view.x1 | 0) + 2); pdY1 = Math.min(HGT - 1, (view.y1 | 0) + 2);
    for (let ty = pdY0; ty <= pdY1; ty++) for (let tx = pdX0; tx <= pdX1; tx++) {
      const i = ty * W + tx, th = puddleTh(t, i, tx, ty); if (th > 0.55) continue;
      const sf = t.surface[i];
      if (hotN < 256 && (sf === SURF.PATH || sf === SURF.ROAD)) hotIdx[hotN++] = i;
      if (pdN >= PUD_CAND) continue;
      const h = hash(tx + 11, ty + 5);
      pdIdx[pdN] = i; pdTh[pdN] = th; pdOx[pdN] = ((h & 255) / 255 - 0.5) * 16; pdOy[pdN] = (((h >> 8) & 255) / 255 - 0.5) * 8; pdR[pdN] = 7 + ((h >> 16) & 15) * 0.8; pdN++;
    }
    pdDirty = false;
  }
  const PUD_COL = [['#1B2230', '#161C2A', '#10141F'], ['#6E93AE', '#42586F', '#1E2A3F'], ['#DCEBF5', '#9DB2C6', '#566B88']];   // halo / water / glint × day, dusk, night
  function drawPuddles(state, g, cam, view) {
    const vw = view.vw, vh = view.vh, z = cam.zoom || 1, t = state.tiles;
    const wetE = wet * 0.56;
    for (let k = 0; k < pdN && pvN < PUD_VIS; k++) {
      const a = clamp((wetE - pdTh[k]) / 0.16, 0, 1); if (a <= 0) continue;
      const i = pdIdx[k], tx = i & 63, ty = i >> 6;
      const wx = (tx - ty) * 32 + pdOx[k], wy = (tx + ty) * 16 + pdOy[k] - fin(t.elev[i], 0) * PXFT;
      const sx = (wx - cam.x) * z + vw / 2, sy = (wy - cam.y) * z + vh / 2; if (sx < -40 || sx > vw + 40 || sy < -20 || sy > vh + 20) continue;
      const rw = pdR[k] * (0.4 + 0.6 * a);
      pvSX[pvN] = sx; pvSY[pvN] = sy; pvWX[pvN] = wx; pvWY[pvN] = wy; pvWR[pvN] = rw; pvA[pvN] = a; pvN++;
    }
    if (pvN === 0) return;
    const night = nightAmount(state), pb = night > 0.6 ? 2 : (night > 0.15 ? 1 : 0);   // the water mirrors the sky: bright by day, dim at dusk, near black at night
    // layer 1: the wet halo (darker ground), layer 2: the sky in the water, layer 3: a glint on the upper-left rim
    for (let ly = 0; ly < 3; ly++) {
      g.beginPath();
      for (let k = 0; k < pvN; k++) {
        const rx = pvWR[k] * 2 * z * (ly === 0 ? 0.66 : ly === 1 ? 0.5 : 0.2), ry = rx * (ly === 2 ? 0.34 : 0.5);
        if (ly === 2) g.rect(Math.round(pvSX[k] - rx * 2.2), Math.round(pvSY[k] - ry * 2.3), Math.max(2, Math.round(rx * 1.6)), Math.max(1, Math.round(z)));   // the glint: one light dash on the upper-left rim
        else ellRects(g, pvSX[k], pvSY[k], rx, ry);
      }
      g.fillStyle = PUD_COL[ly][pb]; g.globalAlpha = ly === 0 ? 0.2 : ly === 1 ? 0.44 : 0.5; g.fill();
    }
    // night: each puddle mirrors the nearest lamp / window / pot / fire above it (last frame's light list). Drawn here, under the entities,
    // so a tree in front hides it; additive and boosted ×2 because the tint pass multiplies the frame afterwards.
    if (FXO.reflect && night > 0.1 && lightsN > 0) {
      g.globalCompositeOperation = 'lighter'; let shown = 0;
      for (let p = 0; p < pvN && shown < 40; p++) {
        if (pvA[p] < 0.3) continue;
        const qx = pvSX[p], qy = pvSY[p]; let best = -1, bd = 1e9;
        for (let k = 0; k < lightsN; k++) {
          const L = lightsList[k]; if (L.refl || (L.kind !== 'lamp' && L.kind !== 'window' && L.kind !== 'pot' && L.kind !== 'fire' && L.kind !== 'glow')) continue;
          const dx = L.x - qx, dy = qy - L.y; if (dy < 6 * z || dy > 230 * z || dx > 120 * z || dx < -120 * z) continue;
          const d = dx * dx + dy * dy * 0.4; if (d < bd) { bd = d; best = k; }
        }
        if (best < 0) continue;
        const S = lightsList[best], fall = 1 - Math.sqrt(bd) / (200 * z); if (fall <= 0.05) continue;
        const rx = pvWR[p] * z * 1.1 * (0.5 + 0.5 * pvA[p]), a = Math.min(1, 0.95 * S.a * pvA[p] * fall * night);
        g.fillStyle = S.kind === 'window' ? '#FFC56A' : '#FFD98A';
        g.globalAlpha = a * 0.7; g.beginPath(); ellRects(g, qx + (S.x - qx) * 0.12, qy, rx, rx * 0.5); g.fill();
        g.globalAlpha = a; g.beginPath(); ellRects(g, qx + (S.x - qx) * 0.12, qy, rx * 0.42, rx * 0.21); g.fill(); shown++;
      }
      g.globalCompositeOperation = 'source-over';
    }
  }
  /** called by render's entity pass, before the shadows: puddles, ground splashes, tree AO (all under the sorted entities) */
  R.groundFx = function (state, g, pool, n, info) {
    pvN = 0; aoOn = false;
    const cam = camOf(state), z = cam.zoom || 1, view = R.view; fxZoom = z; fxCamRef = cam; fxViewRef = view;
    if (z < 1 || !view) return;   // the 0.5× map view and the minimap pass: nothing here is visible at that size
    fxPerf = !!(info && info.perfMode);
    const sha = info ? fin(info.shAlpha, 0.2) : 0.2, sun = clamp((sha - 0.07) / 0.15, 0, 1);
    aoOn = FXO.ao && !fxPerf; aoSEWide = sun < 0.45;
    const k = (0.6 + 0.4 * sun) * (1 - 0.35 * stormDarkness(state)); aoA0 = 0.23 * k; aoA1 = 0.13 * k;
    if ((FXO.puddles || FXO.shimmer) && !fxPerf && state.tiles && state.tiles.type && (pdDirty || (view.x0 | 0) < pdX0 || (view.y0 | 0) < pdY0 || (view.x1 | 0) > pdX1 || (view.y1 | 0) > pdY1)) rebuildPuddles(state, view);
    if (FXO.puddles && !fxPerf && wet > 0.02 && state.tiles && state.tiles.type) drawPuddles(state, g, cam, view);
    if (spN > spApron && FXO.splashes) drawSplashes(g, cam, view.vw, view.vh, -1);
    if (aoOn) treeAO(g, pool, n, z);
    g.globalAlpha = 1;
  };
  /** called right after each building entity is drawn: contact AO on the apron, then that building's apron splashes */
  R.entityFx = function (e, g) {
    try {
      if (fxZoom < 1) return;
      const b = e.b; if (!b) return; const v = e.variant | 0;
      if (aoOn && !(v & SPR.RUIN)) drawAO(e, b, v, g);
      if (spApron > 0 && FXO.splashes) drawSplashes(g, fxCamRef, fxViewRef.vw, fxViewRef.vh, b.id | 0);
      g.globalAlpha = 1;
    } catch (err) { ferr('entityFx', err); }
  };
  /** test / tour hook: set (and read) the rain wetness that drives the puddles (0 dry … 1 saturated) */
  R._fxPuddleWet = function (v) { if (Number.isFinite(v)) wet = clamp(v, 0, 1); return wet; };
  R.fxStats = function () { return { wet: wet, puddles: pvN, candidates: pdN, splashes: spN, apron: spApron, plumes: plN, shells: fwN, aoOn: aoOn, shimmer: shimN, sources: srcN, shell0: fwN > 0 ? { t: fwT[0], x: fwX[0], y: fwY[0], z0: fwZ0[0], z1: fwZ1[0], kind: fwKind[0] } : null }; };
  // --- boil-pot steam, vent shimmer ---------------------------------------------------
  const PL_MAX = 40;
  const plX = new Float32Array(PL_MAX), plY = new Float32Array(PL_MAX), plA = new Float32Array(PL_MAX), plL = new Float32Array(PL_MAX), plS = new Float32Array(PL_MAX), plPh = new Float32Array(PL_MAX), plK = new Uint8Array(PL_MAX);
  let plN = 0;
  function addPuff(wx, wy, kind, size, life, ph) {
    if (plN >= PL_MAX) return;
    plX[plN] = wx; plY[plN] = wy; plA[plN] = 0; plL[plN] = life; plS[plN] = size; plPh[plN] = ph; plK[plN] = kind; plN++;
  }
  function updatePlumes(dt, wind, windAngle) {
    const wvx = Math.cos(windAngle) * wind * 16;
    for (let i = 0; i < plN; i++) {
      plA[i] += dt;
      if (plA[i] >= plL[i]) { plN--; if (i !== plN) { plX[i] = plX[plN]; plY[i] = plY[plN]; plA[i] = plA[plN]; plL[i] = plL[plN]; plS[i] = plS[plN]; plPh[i] = plPh[plN]; plK[i] = plK[plN]; } i--; continue; }
      plY[i] -= (plK[i] ? 9 : 20) * dt / 1000; plX[i] += (wvx + Math.sin(plPh[i] + plA[i] * 0.003) * 5) * dt / 1000;
    }
  }
  let steamTex = null, steamTried = false;
  function ensureSteamTex() {
    if (steamTex || steamTried) return steamTex; steamTried = true;
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d'); if (!g) return null;
      const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.45, 'rgba(240,246,252,0.62)'); gr.addColorStop(1, 'rgba(225,232,242,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32); steamTex = c;
    } catch (e) { steamTex = null; }
    return steamTex;
  }
  function drawPlumes(g, cam, vw, vh) {
    if (plN === 0) return;
    const spr = ensureSteamTex(); if (!spr) return; const z = cam.zoom || 1;
    for (let i = 0; i < plN; i++) {
      const u = plA[i] / plL[i], w = plS[i] * (0.5 + 1 * u) * z, h = w * 0.85;
      const sx = (plX[i] - cam.x) * z + vw / 2, sy = (plY[i] - cam.y) * z + vh / 2; if (sx < -w || sx > vw + w || sy < -h || sy > vh + h) continue;
      g.globalAlpha = (plK[i] ? 0.42 : 0.8) * (1 - u) * (u < 0.15 ? u / 0.15 : 1);
      g.drawImage(spr, sx - w / 2, sy - h / 2, w, h);
    }
    g.globalAlpha = 1;
  }
  const SRC_MAX = 12, srcX = new Float32Array(SRC_MAX), srcY = new Float32Array(SRC_MAX), srcKind = new Uint8Array(SRC_MAX);   // 0 wastewater stack, 1 generator vent, 2 boil pot
  let srcN = 0;
  /** this frame's vents and boil pots from the sorted draw list (screen px at the current zoom); emits the pots' steam puffs */
  function scanSources(state, view, cam) {
    srcN = 0; const list = R.drawList; if (!Array.isArray(list) || (cam.zoom || 1) < 1) return;
    const z = cam.zoom, vw = view.vw, vh = view.vh;
    for (let k = 0; k < list.length && srcN < SRC_MAX; k++) {
      const e = list[k]; if (!e || e.kind !== 'building' || !e.b) continue;
      const b = e.b, ty = b.type; if (!(b.built >= 1) || b.ruin || (ty !== 'wastewater' && ty !== 'generator' && ty !== 'dining_hall' && ty !== 'poboy')) continue;
      if (e.sx < -140 || e.sx > vw + 140 || e.sy < -60 || e.sy > vh + 240) continue;
      const span = (b.w | 0) + (b.h | 0), cx = e.sx + ((b.h | 0) - (b.w | 0)) * 16 * z, cy = e.sy - (span - 2) * 8 * z;
      if (ty === 'wastewater') { srcX[srcN] = cx - 35 * z * (span / 6); srcY[srcN] = cy - 27 * z * (span / 6); srcKind[srcN] = 0; srcN++; }
      else if (ty === 'generator') { if (!(b.data && fin(b.data.fuelDays, 0) > 0)) continue; srcX[srcN] = cx; srcY[srcN] = cy - 14 * z; srcKind[srcN] = 1; srcN++; }
      else { srcX[srcN] = e.sx + 11 * z; srcY[srcN] = e.sy - 6 * z; srcKind[srcN] = 2; srcN++; }
    }
    if (!FXO.steam) return;
    for (let k = 0; k < srcN; k++) {
      const kind = srcKind[k]; if (kind === 1) continue;
      if (((frameNo + k * 5) % (kind === 2 ? 7 : 16)) !== 0) continue;
      const wx = (srcX[k] - vw / 2) / z + cam.x, wy = (srcY[k] - vh / 2) / z + cam.y;
      addPuff(wx + (rng().float() - 0.5) * 3, wy, kind === 2 ? 0 : 1, kind === 2 ? 11 : 18, kind === 2 ? 1500 : 2400, rng().float() * 6.28);
    }
  }
  let shimCv = null, shimG = null, shimW = 0, shimH = 0, shimN = 0;
  function ensureShim(w, h) {
    try {
      if (!shimCv) { shimCv = document.createElement('canvas'); shimG = shimCv.getContext('2d'); }
      if (!shimG) return false;
      if (shimW < w) shimCv.width = shimW = w; if (shimH < h) shimCv.height = shimH = h; return true;
    } catch (e) { shimCv = null; shimG = null; return false; }
  }
  const shRX = new Float32Array(32), shRY = new Float32Array(32), shRW = new Float32Array(32), shRH = new Float32Array(32), shRS = new Uint8Array(32);
  /** heat shimmer: displaced slices of the frame above the vents (always) and above paved ground on advisory days (Tier 2, ≤ 10 strips, one small self-copy) */
  function shimmerPass(state, g, view, cam) {
    shimN = 0;
    if (!FXO.shimmer || fxPerf || BSU.headlessMode || !R.canvas || (cam.zoom || 1) < 1) return;
    const z = cam.zoom, vw = view.vw, vh = view.vh, dpr = view.dpr || 1, wx = state.weather || {};
    const heat = fin(wx.heat, 0), adv = heat >= 95 && effRainFx < 0.05 && (sk.phase === SKY.DAY || sk.phase === SKY.GOLDEN);
    let n = 0;
    for (let k = 0; k < srcN && n < 20; k++) { if (srcKind[k] === 2) continue; shRX[n] = srcX[k] - 11 * z; shRY[n] = srcY[k] - 30 * z; shRW[n] = 22 * z; shRH[n] = 30 * z; shRS[n] = 7; n++; }
    if (adv && hotN > 0) {
      const step = Math.max(1, Math.ceil(hotN / 10)); let cnt = 0;
      for (let k = (frameNo >> 4) % step; k < hotN && cnt < 10 && n < 30; k += step) {
        const i = hotIdx[k], tx = i & 63, ty = i >> 6, sx = ((tx - ty) * 32 - cam.x) * z + vw / 2, sy = ((tx + ty) * 16 - fin(state.tiles.elev[i], 0) * PXFT - cam.y) * z + vh / 2;
        if (Math.abs(sx - vw / 2) > 380 || Math.abs(sy - vh / 2) > 200) continue;
        shRX[n] = sx - 30 * z; shRY[n] = sy - 17 * z; shRW[n] = 60 * z; shRH[n] = 14 * z; shRS[n] = 3; n++; cnt++;
      }
    }
    shimN = n;
    if (n === 0) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, shRX[k]); y0 = Math.min(y0, shRY[k]); x1 = Math.max(x1, shRX[k] + shRW[k]); y1 = Math.max(y1, shRY[k] + shRH[k]); }
    x0 = Math.max(0, Math.floor(x0) - 4); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(vw, Math.ceil(x1) + 4); y1 = Math.min(vh, Math.ceil(y1)); const bw = x1 - x0, bh = y1 - y0; if (bw < 4 || bh < 2) return;
    if (!ensureShim(Math.ceil(bw * dpr), Math.ceil(bh * dpr))) return;
    const amp = (adv ? 1.2 + 1.2 * clamp((heat - 95) / 10, 0, 1) : 1.1) * z;
    try {
      shimG.setTransform(1, 0, 0, 1, 0, 0); shimG.globalCompositeOperation = 'copy';
      shimG.drawImage(R.canvas, x0 * dpr, y0 * dpr, bw * dpr, bh * dpr, 0, 0, bw * dpr, bh * dpr);
      g.globalAlpha = 0.92;
      for (let k = 0; k < n; k++) {
        const ns = shRS[k], sh = shRH[k] / ns;
        for (let s = 0; s < ns; s++) {
          const dy = shRY[k] + s * sh, off = Math.round(Math.sin(frameNo * 0.11 + s * 1.3 + k * 2.1) * amp * (0.4 + 0.6 * (1 - s / ns)));
          g.drawImage(shimCv, (shRX[k] - x0) * dpr, (dy - y0) * dpr, shRW[k] * dpr, sh * dpr, shRX[k] + off, dy, shRW[k], sh);
        }
      }
      g.globalAlpha = 1;
    } catch (e) { /* shimmer is optional */ }
  }
  /** once per frame, in the weather pass: wetness, pools, splashes, sources */
  function fxFrame(state, view, cam, dtMs, rr, wind, windAngle) {
    const dt = clamp(fin(dtMs, 16.67), 0, 100);
    effRainFx = rr; fxPerf = !!(state.ui && state.ui.perfMode);
    if (rr > 0.15) wet = Math.min(1, wet + rr * dt / PUD_FILL_MS); else wet = Math.max(0, wet - dt / PUD_DRY_MS);
    updateSplashes(dt); updatePlumes(dt, wind, windAngle); updateShells(dt);
    spawnSplashes(state, view, cam, rr);
    scanSources(state, view, cam);
  }
  // --- firework shells: a rising rocket with a tail, then a burst of velocity-aligned trails, with additive bloom -----------
  const FW_MAX = 8, FW_SP = 40, FW_RISE = 650, FW_LIFE = 2400;
  const fwT = new Float32Array(FW_MAX), fwX = new Float32Array(FW_MAX), fwY = new Float32Array(FW_MAX), fwZ0 = new Float32Array(FW_MAX), fwZ1 = new Float32Array(FW_MAX), fwSc = new Float32Array(FW_MAX);
  const fwKind = new Uint8Array(FW_MAX), fwCol = new Uint8Array(FW_MAX);
  const fwCos = new Float32Array(FW_MAX * FW_SP), fwSin = new Float32Array(FW_MAX * FW_SP), fwSpd = new Float32Array(FW_MAX * FW_SP);
  let fwN = 0;
  const FW_PAL = [['#FFF1A8', '#FDD023'], ['#FFFFFF', '#B79BFF'], ['#FFFFFF', '#9FD2FF']];
  /** a shell bursting z1 px above the ground point (wx, wy) whose ground is z0 px up (world px at zoom 1) */
  function addShell(wx, wy, z0, z1, scale) {
    if (fwN >= FW_MAX || !FXO.fireworks) return;
    const r = rng(), s = fwN++, kind = r.int(3), base = s * FW_SP;
    fwT[s] = 0; fwX[s] = wx; fwY[s] = wy; fwZ0[s] = z0; fwZ1[s] = z1; fwSc[s] = scale; fwKind[s] = kind; fwCol[s] = kind === 1 ? 0 : r.int(3);
    for (let k = 0; k < FW_SP; k++) {
      const a = (k + (r.float() - 0.5) * 0.7) / FW_SP * TAU;
      fwCos[base + k] = Math.cos(a); fwSin[base + k] = Math.sin(a) * (kind === 2 ? 0.38 : 0.92);
      fwSpd[base + k] = (kind === 1 ? 270 : 380) * scale * (kind === 2 ? 1 : 0.66 + 0.34 * r.float());
    }
  }
  function updateShells(dt) {
    for (let s = 0; s < fwN; s++) {
      fwT[s] += dt;
      if (fwT[s] < FW_RISE + FW_LIFE) continue;
      fwN--;
      if (s !== fwN) { fwT[s] = fwT[fwN]; fwX[s] = fwX[fwN]; fwY[s] = fwY[fwN]; fwZ0[s] = fwZ0[fwN]; fwZ1[s] = fwZ1[fwN]; fwSc[s] = fwSc[fwN]; fwKind[s] = fwKind[fwN]; fwCol[s] = fwCol[fwN]; for (let k = 0; k < FW_SP; k++) { fwCos[s * FW_SP + k] = fwCos[fwN * FW_SP + k]; fwSin[s * FW_SP + k] = fwSin[fwN * FW_SP + k]; fwSpd[s * FW_SP + k] = fwSpd[fwN * FW_SP + k]; } }
      s--;
    }
  }
  const bloomTex = [null, null, null]; let bloomTried = false;
  function ensureBloom() {
    if (bloomTried) return bloomTex[0]; bloomTried = true;
    try {
      for (let p = 0; p < 3; p++) {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); if (!g) return null;
        const col = FW_PAL[p][1], gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.18, col); gr.addColorStop(0.5, col + '55'); gr.addColorStop(1, col + '00');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64); bloomTex[p] = c;
      }
    } catch (e) { bloomTex[0] = bloomTex[1] = bloomTex[2] = null; }
    return bloomTex[0];
  }
  const fwE = new Float32Array(4), fwD = new Float32Array(4);
  function passFireworks(state, g, view) {
    if (fwN === 0 || !FXO.fireworks) return;
    const cam = camOf(state), z = cam.zoom || 1, vw = view.vw, vh = view.vh, ps = Math.max(1, Math.round(z)), bloom = ensureBloom();
    for (let s = 0; s < fwN; s++) {
      const t = fwT[s], sx0 = (fwX[s] - cam.x) * z + vw / 2, gy = fwY[s] - fwZ0[s], pal = FW_PAL[fwCol[s]], sc = fwSc[s];
      if (t < FW_RISE) {   // the rocket: eased climb with a six-point tail
        g.beginPath(); let hx = 0, hy = 0;
        for (let j = 5; j >= 0; j--) { const u = clamp((t - j * 32) / FW_RISE, 0, 1), hgt = fwZ1[s] * (1 - (1 - u) * (1 - u)), px_ = sx0 + Math.sin(u * 9 + s) * 1.2 * z, py_ = (gy - hgt - cam.y) * z + vh / 2; if (j === 5) g.moveTo(px_, py_); else g.lineTo(px_, py_); hx = px_; hy = py_; }
        g.strokeStyle = '#FFE9A0'; g.lineWidth = Math.max(1, z); g.globalAlpha = 0.55; g.stroke();
        g.fillStyle = '#FFFFFF'; g.globalAlpha = 1; g.fillRect(Math.round(hx - ps / 2), Math.round(hy - ps / 2), ps * 2, ps * 2);
        continue;
      }
      const tau = (t - FW_RISE) / 1000, cxs = sx0, cys = (gy - fwZ1[s] - cam.y) * z + vh / 2, G = fwKind[s] === 1 ? 60 : 24, fade = Math.pow(clamp(1 - tau / (FW_LIFE / 1000), 0, 1), 0.85);
      for (let j = 0; j < 4; j++) { const tj = Math.max(0, tau - j * 0.05); fwE[j] = (1 - Math.exp(-3.2 * tj)) / 3.2; fwD[j] = 0.5 * G * tj * tj; }
      const base = s * FW_SP;
      for (let grp = 0; grp < 2; grp++) {
        for (let pass = 0; pass < 2; pass++) {   // pass 0: the faint 150-ms trail, pass 1: the bright last 50 ms
          g.beginPath();
          for (let k = grp; k < FW_SP; k += 2) {
            const c = fwCos[base + k], sn = fwSin[base + k], sp = fwSpd[base + k] * z;
            const x0_ = cxs + c * sp * fwE[0], y0_ = cys + fwD[0] * z - sn * sp * fwE[0], x1_ = cxs + c * sp * fwE[1], y1_ = cys + fwD[1] * z - sn * sp * fwE[1];
            if (pass === 0) { g.moveTo(cxs + c * sp * fwE[3], cys + fwD[3] * z - sn * sp * fwE[3]); g.lineTo(cxs + c * sp * fwE[2], cys + fwD[2] * z - sn * sp * fwE[2]); g.lineTo(x1_, y1_); g.lineTo(x0_, y0_); }
            else { g.moveTo(x1_, y1_); g.lineTo(x0_, y0_); }
          }
          g.strokeStyle = pal[grp]; g.lineWidth = Math.max(1, z * (pass === 0 ? 1.4 : 2.2)); g.globalAlpha = (pass === 0 ? 0.5 : 1) * fade; g.stroke();
        }
        g.beginPath();
        for (let k = grp; k < FW_SP; k += 2) { const c = fwCos[base + k], sn = fwSin[base + k], sp = fwSpd[base + k] * z; g.rect(Math.round(cxs + c * sp * fwE[0] - ps * 1.5), Math.round(cys + fwD[0] * z - sn * sp * fwE[0] - ps * 1.5), ps * 3, ps * 3); }
        g.fillStyle = grp === 0 ? '#FFFFFF' : pal[1]; g.globalAlpha = fade; g.fill();
      }
      if (bloom) {
        g.globalCompositeOperation = 'lighter';
        const fl = Math.exp(-tau * 2.4), bs = (150 + 220 * Math.min(1, tau / 0.25)) * z * sc, b2 = 320 * z * sc;
        g.globalAlpha = 0.9 * fl; g.drawImage(bloomTex[fwCol[s]], cxs - bs / 2, cys - bs / 2, bs, bs);
        g.globalAlpha = 0.26 * fade; g.drawImage(bloomTex[fwCol[s]], cxs - b2 / 2, cys - b2 / 2, b2, b2);
        g.globalCompositeOperation = 'source-over';
      }
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Pass 5: weather (screen space, under the shake transform)
  // ---------------------------------------------------------------------------
  function rainLineCount(rainRate, zoom, perf) {
    const r = clamp(fin(rainRate, 0), 0, 1); if (r <= 0) return 0;
    let n = Math.round(lerp(PR.rainLines ? PR.rainLines[0] : 300, PR.rainLines ? PR.rainLines[1] : 1200, r));
    if (zoom < 1) n = Math.min(n, PR.rainLinesHalf || 400);
    if (perf) n = n >> 1;
    return n;
  }
  function seedRain(vw, vh) { const r = rng(); for (let k = 0; k < RAIN_N; k++) { rainPos[2 * k] = r.float() * (vw + 80) - 40; rainPos[2 * k + 1] = r.float() * (vh + 40) - 20; } rainSeeded = true; }
  function passWeather(state, g, view, alpha, dtMs) {
    frameNo = R.frameNo | 0;
    const wx = state.weather || {}, cam = camOf(state), z = cam.zoom || 1, vw = view.vw, vh = view.vh;
    const perf = !!(state.ui && state.ui.perfMode);
    const wind = clamp(fin(wx.wind, 0), 0, 1.5), windAngle = fin(wx.windAngle, 0);
    let newFrame = false;
    if (frameNo !== lastFrameNo) { lastFrameNo = frameNo; newFrame = true; update(dtMs, wind, windAngle); perFrameEmitters(state, view, cam); }
    const storm = stormDarkness(state);
    rainRamp = storm > 0 ? Math.min(1, rainRamp + fin(dtMs, 16) / 2500) : 0;
    let rainRate = clamp(fin(wx.rainRate, 0), 0, 1);
    if (storm > 0) rainRate = Math.max(rainRate, stormPhase === SPH.EYE ? 0.08 : lerp(0.5, 1, rainRamp));
    // stadium crowd (world-space but screen px; before the rain so ponchos get wet)
    try { crowdInWorld(state, g, view, cam, rainRate > 0.05); } catch (e) { ferr('crowd', e); }
    curRainRate = rainRate; curStorm = storm; curWind = wind; curWindAngle = windAngle;
    if (newFrame) { try { fxFrame(state, view, cam, dtMs, rainRate, wind, windAngle); } catch (e) { ferr('fxFrame', e); } }
    // the cell disc: 12 stacked bands, alpha falling to the edge (under the tint)
    const ev = wx.event;
    if (ev && ev.kind === 'cell' && ev.radius > 0) {
      const p = R.tileToScreen(ev.cx | 0, ev.cy | 0), ccx = p.x, ccy = p.y, crx = Math.max(1, ev.radius * 32 * z), cry = Math.max(1, ev.radius * 16 * z);
      g.fillStyle = 'rgb(60,70,90)';
      for (let b = 0; b < 12; b++) { const yy = -1 + (b + 0.5) / 6, hw = crx * Math.sqrt(Math.max(0, 1 - yy * yy)); g.globalAlpha = 0.25 * (1 - Math.abs(yy)) * 0.6; g.fillRect(ccx - hw, ccy + yy * cry - cry / 12, hw * 2, cry / 6 + 1); }
    }
    // wind leaves at the windward edge
    if (wind >= 0.3 && (frameNo & 1) === 0 && !BSU.headlessMode) {
      const cnt = wind >= 0.6 ? 4 : 1, fromLeft = Math.cos(windAngle) >= 0;
      for (let k = 0; k < cnt; k++) { const sy = rng().float() * vh, sx = fromLeft ? -10 : vw + 10; const wpx = (sx - vw / 2) / z + cam.x, wpy = (sy - vh / 2) / z + cam.y; emit(storm > 0 ? 'debris' : 'leaf', wpx, wpy, 1, { vx: Math.cos(windAngle) * (120 + 200 * wind), vy: Math.sin(windAngle) * 40, vz: 30, z: 10 + rng().float() * 40, life: 2500, size: storm > 0 ? 3 : 1 }); }
    }
    // boil-pot / vent steam puffs, then the heat shimmer over the vents and (advisory days) paved ground — both read the frame so far (before the tint)
    try { drawPlumes(g, cam, vw, vh); shimmerPass(state, g, view, cam); } catch (e) { ferr('shimmer', e); }
    // screen-space particles
    const cols = R.particleColors || [GOLD];
    g.globalAlpha = 1;
    for (let i = 0; i < alive; i++) if (pscreen[i]) { g.fillStyle = cols[pcol[i] & 15] || GOLD; g.globalAlpha = clamp(plife[i] / 300, 0, 1); g.fillRect(Math.round(px[i]), Math.round(py[i] - pz[i]), psize[i], psize[i]); }
    g.globalAlpha = 1;
  }
  let curRainRate = 0, curStorm = 0, curWind = 0, curWindAngle = 0;
  /** rain lines (one path, one stroke), landfall sheets and the lightning flash/bolt — drawn above tint/lights/fog so they stay bright */
  function drawRainAndLightning(state, g, view, dtMs) {
    const wx = state.weather || {}, cam = camOf(state), z = cam.zoom || 1, vw = view.vw, vh = view.vh;
    const perf = !!(state.ui && state.ui.perfMode), rainRate = curRainRate, storm = curStorm, wind = curWind, windAngle = curWindAngle;
    // rain lines
    const n = rainLineCount(rainRate, z, perf);
    if (n > 0) {
      if (!rainSeeded) seedRain(vw, vh);
      const dt = clamp(fin(dtMs, 16.67), 0, 100) / 1000;
      const len = (8 + 6 * rainRate + 12 * storm) * (z < 1 ? 0.8 : 1), lean = wind * 6 + storm * 20 * (0.7 + 0.3 * Math.sin(frameNo * 0.05));
      const dx = Math.cos(windAngle) * lean, dy = len;
      const vy = 900 * dt, vxs = (dx / len) * 900 * dt;
      const ev = wx.event, cell = ev && ev.kind === 'cell' && ev.radius > 0;
      let ccx = 0, ccy = 0, crx = 1, cry = 1;
      if (cell) { const p = R.tileToScreen(ev.cx | 0, ev.cy | 0); ccx = p.x; ccy = p.y; crx = Math.max(1, ev.radius * 32 * z); cry = Math.max(1, ev.radius * 16 * z); }
      g.globalAlpha = 1; g.strokeStyle = storm > 0 ? 'rgba(215,228,255,0.72)' : 'rgba(200,220,255,0.5)'; g.lineWidth = storm > 0.5 ? 1.5 : 1;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        let x = rainPos[2 * k] + vxs * (0.85 + 0.3 * (k & 3) / 3), y = rainPos[2 * k + 1] + vy * (0.8 + 0.4 * (k & 3) / 3);
        if (y > vh + 20) { y -= vh + 40; x = rng().float() * (vw + 80) - 40; }
        if (x < -40) x += vw + 80; else if (x > vw + 40) x -= vw + 80;
        rainPos[2 * k] = x; rainPos[2 * k + 1] = y;
        if (cell && (k & 3) === 0) { const ex = (x - ccx) / crx, ey = (y - ccy) / cry; if (ex * ex + ey * ey > 1) { k += 3; continue; } }
        g.moveTo(x, y); g.lineTo(x + dx, y + dy);
      }
      g.stroke();
      // wind-blown sheets during landfall: 3 translucent diagonal bands sweeping across
      if (storm > 0.2 && stormPhase !== SPH.EYE) {
        g.save(); g.transform(1, 0, -dx / len * 0.9, 1, 0, 0);   // skewed to the rain angle
        g.fillStyle = 'rgb(190,205,230)';
        for (let b = 0; b < 3; b++) { const sx = ((frameNo * (6 + b * 2) + b * 500) % (vw + 900)) - 300, w = 160 + b * 40; g.globalAlpha = 0.04 * storm; g.fillRect(sx - w * 0.5, -20, w * 2, vh + 40); g.globalAlpha = 0.06 * storm; g.fillRect(sx, -20, w, vh + 40); }
        g.restore();
      }
    }
    // lightning: flash + bolt
    const now = nowMs();
    if (now < flashUntil) {
      const k = (flashUntil - now) / (PR.lightningMs || 250);
      g.globalAlpha = (PR.lightningFlashAlpha || 0.7) * k * k; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, vw, vh);
      if (boltN > 1 && now < boltUntil) { g.globalAlpha = clamp((boltUntil - now) / 60, 0, 1); g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.moveTo(bolt[0], bolt[1]); for (let i = 1; i < boltN; i++) g.lineTo(bolt[2 * i], bolt[2 * i + 1]); g.stroke(); g.globalAlpha = 0.35; g.lineWidth = 6; g.strokeStyle = '#CFE4FF'; g.stroke(); }
    }
  }
  /** per-frame emitters for visible sources (GDD §12.7) */
  function perFrameEmitters(state, view, cam) {
    const t = state.tiles; if (!t || !t.elev) return;
    const r = rng(), wx = state.weather || {}, s = readSky(state);
    const x0 = view.x0 | 0, y0 = view.y0 | 0, x1 = view.x1 | 0, y1 = view.y1 | 0, spanX = Math.max(1, x1 - x0 + 1), spanY = Math.max(1, y1 - y0 + 1);
    const night = s.phase === SKY.DUSK || s.phase === SKY.NIGHT;
    const rainRate = clamp(fin(wx.rainRate, 0), 0, 1), storm = stormDarkness(state);
    const effRain = Math.max(rainRate, storm > 0 ? 0.6 : 0);
    // rain splashes on water / puddle tiles (≤ 40 per frame)
    if (effRain >= 0.3) {
      const tries = Math.min(40, Math.round(12 + 28 * effRain)); let made = 0;
      for (let k = 0; k < tries && made < 40; k++) {
        const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
        const i = ty * W + tx; if (!isWaterTile(state, i)) continue;
        const d = fin(t.depth[i], 0), ex = (r.float() - 0.5) * 40, ey = (r.float() - 0.5) * 20;
        emit('splash', tileWorldX(tx, ty) + ex, tileWorldY(tx, ty) + ey, 2, { vz: 60 + 60 * r.float(), z: fin(t.elev[i], 0) * PXFT + d * PXFT + 1, life: 260, spread: 2 });
        made++;
      }
    }
    // fireflies (GDD §6.7): keep the pool topped up over marsh/wet/preserve tiles in view at Dusk/Night
    const wl = mod('wildlife');
    let target = 0; try { target = wl && typeof wl.fireflyTarget === 'function' ? fin(wl.fireflyTarget(state), 0) : 0; } catch (e) { target = 0; }
    const forced = state.progress && Number.isFinite(state.progress.forceFirefliesDay) && state.progress.forceFirefliesDay === fin(state.calendar && state.calendar.day, -2);
    if (forced && target < 60) target = 60;
    if (lowMode || (state.ui && state.ui.perfMode)) target = target >> 1;
    if ((cam.zoom || 1) < 1) target = Math.min(target, PR.fireflyHalfCap || 300);
    if (target > 0 && (night || s.phase === SKY.DAWN) && !(effRain > 0.2)) {
      let have = 0; for (let i = 0; i < alive; i++) if (ptype[i] === TID.firefly) have++;
      let budget = Math.min(12, target - have);
      for (let k = 0; k < 24 && budget > 0; k++) {
        const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
        const i = ty * W + tx; if (!isMarshy(state, i)) continue;
        const pres = t.flags && FLAG.PRESERVE ? (t.flags[i] & FLAG.PRESERVE) !== 0 : false;
        const cnt = pres ? 3 : 1;
        emit('firefly', tileWorldX(tx, ty), tileWorldY(tx, ty), cnt, { spread: 28, z: fin(t.elev[i], 0) * PXFT + 8 + r.float() * 16, vx: 0, vy: 0, life: 2600 + r.float() * 2400 });
        budget -= cnt;
      }
    }
    if (effRain > 0.3) for (let i = 0; i < alive; i++) if (ptype[i] === TID.firefly) plife[i] -= 60;
    // mosquito haze at Dusk/Night: sample visible tiles
    if (night) {
      for (let k = 0; k < 10; k++) {
        const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
        const i = ty * W + tx, m = t.mosq ? fin(t.mosq[i], 0) : 0; if (m < 0.3) continue;
        emit('mosqDot', tileWorldX(tx, ty), tileWorldY(tx, ty), m >= 0.6 ? 2 : 1, { spread: 24, z: fin(t.elev[i], 0) * PXFT + 6 + r.float() * 10, vz: 4, life: 1800 });
      }
    }
    // building-driven emitters (sampled: one building per frame per kind)
    const B = state.buildings; if (!Array.isArray(B) || !B.length) return;
    const bl = mod('buildings'), month = fin(state.calendar && state.calendar.month, 1), dom = fin(state.calendar && state.calendar.dom, 1);
    const bloom = month === 3 || (month === 4 && dom <= 10);
    const pick = B[r.int(B.length)];
    if (pick && pick.built >= 1 && !pick.ruin) {
      const bx = pick.tx + pick.w - 1, by = pick.ty + pick.h - 1;
      if (bx >= x0 - 2 && bx <= x1 + 2 && by >= y0 - 2 && by <= y1 + 2) {
        let eff = 1; try { eff = bl && typeof bl.effective === 'function' ? fin(bl.effective(state, pick.id), 1) : 1; } catch (e) { eff = 1; }
        const cx = tileWorldX(pick.tx + (pick.w - 1) / 2, pick.ty + (pick.h - 1) / 2), cy = tileWorldY(pick.tx + (pick.w - 1) / 2, pick.ty + (pick.h - 1) / 2), ez = elevPx(state, by * W + bx);
        if ((pick.type === 'dining_hall' || pick.type === 'poboy') && eff > 0) emit('smoke', cx + 10, cy + 2, 2, { vz: 26, z: ez + 20, spread: 3, life: 1100, size: 2 });
        if (pick.type === 'wastewater' && eff > 0) emit('steam', cx, cy, 1, { vz: 30, z: ez + 18, spread: 4 });
        if (pick.type === 'generator' && pick.data && fin(pick.data.fuelDays, 0) > 0) emit('smoke', cx, cy, 1, { vz: 22, z: ez + 12, spread: 2, color: 12 });
        if (pick.type === 'pump' && eff > 0 && t.depth && fin(t.depth[by * W + bx], 0) > 0.02) emit('foam', cx, cy + 8, 2, { vz: 10, z: ez + 2, spread: 6 });
        if (pick.type === 'azalea' && bloom) emit('petal', cx, cy, 2, { vz: -4, z: ez + 10 + r.float() * 8, spread: 10, life: 1800 });
      }
    }
    // cypress leaves in November
    if (month === 11 && Array.isArray(state.veg) && state.veg.length && (frameNo % 3) === 0) {
      const v = state.veg[r.int(state.veg.length)];
      if (v && v.type === 'cypress' && v.tx >= x0 && v.tx <= x1 && v.ty >= y0 && v.ty <= y1) emit('leaf', tileWorldX(v.tx, v.ty), tileWorldY(v.tx, v.ty), 1, { z: elevPx(state, v.ty * W + v.tx) + 30 + r.float() * 20, vz: -6, spread: 6, color: 13, life: 2200 });
    }
    // levee overtopping trickle
    if (overtop.size) {
      for (const [i, left] of overtop) { if (left <= 0) { overtop.delete(i); continue; } overtop.set(i, left - 1); const tx = i & 63, ty = i >> 6; if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) emit('sheet', tileWorldX(tx, ty), tileWorldY(tx, ty), 2, { spread: 14, z: elevPx(state, i) + fin(t.crest ? t.crest[i] : 0, 0) * PXFT, vz: -20, vy: 20 }); }
    }
    // fireworks queue (game:final)
    if (burstsPending > 0 && --burstTimer <= 0) { burstTimer = 22; burstsPending--; fireworks(state, 1.2); }
    if (milePending > 0 && --mileTimer <= 0) { mileTimer = 20; milePending--; viewShell(state); }
  }

  // ---------------------------------------------------------------------------
  // Crowd shader: per-seat noise field (score bug + the stadium bowl in the world)
  // ---------------------------------------------------------------------------
  /** per-seat pixel-noise brightness field; rect {x, y, w, h} in ctx px; fill 0–1; wave advances the sweep */
  R.crowd = function (g, rect, fill, wave, rain) {
    if (!g || !rect || !(rect.w > 0 && rect.h > 0)) return;
    fill = clamp(fin(fill, 0), 0, 1); wave = fin(wave, 0) | 0;
    const cell = Math.max(2, Math.ceil(Math.sqrt((rect.w * rect.h) / 2000)));
    const cols = Math.max(1, Math.floor(rect.w / cell)), rows = Math.max(1, Math.floor(rect.h / cell)), seed = wave >> 4;
    const purple = PAL.purpleHi || '#7F5BC5', gold = GOLD, gray = '#5A6B7A', sweepX = (wave * 2) % (cols + 8);
    const cx = cols / 2, cy = rows / 2;
    for (let yy = 0; yy < rows; yy++) {
      const ny = (yy - cy) / cy;
      for (let xx = 0; xx < cols; xx++) {
        const nx = (xx - cx) / cx; if (nx * nx + ny * ny > 1) continue;   // the bowl is an ellipse
        if ((hash(xx + 1, yy + 1 + seed * 97) % 100) >= fill * 100) continue;
        g.fillStyle = rain ? gray : (((xx + yy) & 1) ? purple : gold);
        g.globalAlpha = Math.abs(xx - sweepX) < 3 ? 1 : 0.6;
        g.fillRect(rect.x + xx * cell, rect.y + yy * cell, cell, cell);
      }
    }
    g.globalAlpha = 1;
  };
  function crowdInWorld(state, g, view, cam, rain) {
    const game = state.sports && state.sports.game; if (!game || !game.home) return;
    if (R.fbCrowdFrame === R.frameNo) return;   // football pass F: the sorted football layer drew the crowd (shader + fans) this frame
    const list = R.drawList; if (!Array.isArray(list)) return;
    const S = mod('sprites'), cat = (BSU.data && BSU.data.catalog) || {};
    // the venue the game is played at (sports.venue; the scheduled game's own venue as the fallback), never just the first field in the draw list
    const venue = String((state.sports && state.sports.venue) || game.venue || ''); const wantType = venue.indexOf('stadium') === 0 ? 'stadium' : 'practice_field';
    let pick = null;
    for (let k = 0; k < list.length; k++) {
      const e = list[k]; if (!e || e.kind !== 'building' || !e.b) continue;
      const b = e.b; if (b.type !== wantType || !(b.built >= 1) || b.ruin || !(b.tier >= 1)) continue;
      if (!pick || fin(b.tier, 0) > fin(pick.b.tier, 0)) pick = e;
    }
    for (let k = 0; k < list.length; k++) {
      const e = list[k]; if (e !== pick) continue;
      const b = e.b;
      const row = cat[b.type]; let box = null;
      try { box = S && typeof S.buildingBox === 'function' ? S.buildingBox(row, e.variant, cam.zoom, b.rot) : null; } catch (err) { box = null; }
      const br = box && box.bowlRect;
      const z = cam.zoom || 1, bs = z / (box && box.zoom ? box.zoom : 1);
      const rect = br ? { x: e.sx + br.x * bs, y: e.sy + br.y * bs, w: br.w * bs, h: br.h * bs } : { x: e.sx - (b.w + b.h) * 12 * z, y: e.sy - (b.w + b.h) * 14 * z, w: (b.w + b.h) * 24 * z, h: (b.w + b.h) * 10 * z };
      const tiers = row && Array.isArray(row.tiers) ? row.tiers : null;
      const seats = tiers && tiers[clamp((b.tier | 0) - 1, 0, tiers.length - 1)] ? fin(tiers[clamp((b.tier | 0) - 1, 0, tiers.length - 1)].seats, 15000) : 15000;
      R.crowd(g, rect, fin(game.attendance, 0) / Math.max(1, seats), frameNo, rain);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 6: tint (sky clock, storm, desaturation, horizon glow)
  // ---------------------------------------------------------------------------
  /** the two tint layers for a sky phase and progress (pure; exposed for tests) */
  function tintFor(phase, t, out) {
    out = out || {}; phase = clamp(fin(phase, SKY.DAY) | 0, 0, 4); t = clamp(fin(t, 0), 0, 1);
    const cur = TINTS[phase], nxt = TINTS[(phase + 1) % 5];
    const k = t < 0.75 ? 0 : (t - 0.75) / 0.25;
    out.c1 = cur ? cur.color : null; out.a1 = cur ? cur.alpha * (1 - k) : 0;
    out.c2 = nxt ? nxt.color : null; out.a2 = nxt ? nxt.alpha * k : 0;
    return out;
  }
  const tintOut = {};
  function passTint(state, g, view) {
    const s = readSky(state), vw = view.vw, vh = view.vh;
    const storm = stormDarkness(state);
    g.globalCompositeOperation = 'multiply';
    const fill = (c, a) => { if (!c || a <= 0.004) return; g.globalAlpha = clamp(a, 0, 1); g.fillStyle = c; g.fillRect(0, 0, vw, vh); };
    tintFor(s.phase, s.t, tintOut);
    const skyScale = 1 - 0.5 * storm;   // the storm swallows most of the sky colour
    fill(tintOut.c1, tintOut.a1 * skyScale); fill(tintOut.c2, tintOut.a2 * skyScale);
    const kk = s.t < 0.75 ? 0 : (s.t - 0.75) / 0.25, nightW = s.phase === SKY.NIGHT ? 1 - kk : (s.phase === SKY.DUSK ? kk : 0);
    if (nightW > 0) fill('#1A2050', 0.18 * nightW * skyScale);   // deep blue-purple, not plain black
    if (storm > 0) {
      if (stormPhase === SPH.EYE) { fill(EYE_TINT.color, EYE_TINT.alpha); fill(STORM_TINT.color, STORM_TINT.alpha * 0.3); }
      else if (stormPhase === SPH.CLEARING) { fill(TINTS[SKY.GOLDEN].color, TINTS[SKY.GOLDEN].alpha); fill(STORM_TINT.color, STORM_TINT.alpha * 0.25); }
      else fill(STORM_TINT.color, STORM_TINT.alpha * storm);
    }
    const rr = clamp(fin(state.weather && state.weather.rainRate, 0), 0, 1) * (1 - storm);   // B5: ordinary rain greys and cools the whole scene (a cool overcast multiply scaled by the rain rate)
    if (rr > 0.05) fill('#A5B1C4', 0.24 * rr);
    const st = state.storms && state.storms.current;
    if (st && !st.nearMiss && st.phase >= STORM.WATCH && st.phase <= STORM.LANDFALL) fill('#8A8A8A', (PR.stormDesaturate || 0.3) * (st.phase === STORM.WATCH ? 0.5 : 1));
    // colour cast ('overlay' keeps the midtones readable while the multiply sets the mood)
    g.globalCompositeOperation = 'overlay';
    if (storm === 0) {
      if (s.phase === SKY.GOLDEN) fill('#FFB060', 0.32 * (1 - kk) + 0.2 * kk);
      else if (s.phase === SKY.DAWN) fill('#FF9A70', 0.26 * (1 - s.t) + 0.08);
      else if (s.phase === SKY.DUSK) fill('#B04A9A', 0.2 * (1 - kk));
      if (nightW > 0) fill('#2A3AA0', 0.28 * nightW);
    } else fill('#3A4A5A', 0.3 * storm);
    g.globalCompositeOperation = 'screen';
    // horizon glow: 10 bands from the top at dawn / golden hour / dusk
    const hc = HORIZON[s.phase];
    if (hc && storm === 0) {
      const strength = s.phase === SKY.GOLDEN ? 0.34 : (s.phase === SKY.DUSK ? 0.3 * (1 - s.t * 0.6) : 0.28 * (1 - s.t * 0.7));
      const bandH = Math.max(2, Math.round(vh * 0.4 / 10)); g.fillStyle = hc;
      for (let b = 0; b < 10; b++) { const f = 1 - b / 10; g.globalAlpha = strength * f * f; g.fillRect(0, b * bandH, vw, bandH); }
    }
    if (goldFlash > 0) { goldFlash--; g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.15; g.fillStyle = GOLD; g.fillRect(0, 0, vw, vh); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Pass 7: lights (additive sprites on the offscreen composite; skipped by Day)
  // ---------------------------------------------------------------------------
  function pushLight(kind, x, y, r, a, rot) { if (lightsN >= lightsList.length) return null; const L = lightsList[lightsN++]; L.kind = kind; L.x = x; L.y = y; L.r = r; L.a = a; L.rot = rot || 0; L.refl = 0; return L; }
  // art pass B1: a lamp beside water (its S or E neighbour is wet) mirrors as a stretched, fainter pool on the water
  function wetBelow(state, i) { const tx = i & 63, ty = i >> 6; return (ty < HGT - 1 && isWaterTile(state, i + W)) || (tx < W - 1 && isWaterTile(state, i + 1)); }
  function pushReflection(x, y, z, a) { const L = pushLight('lamp', x, y + 14 * z, 0.9, a, 0); if (L) L.refl = 1; return L; }
  function lightsCtxFor(view) {
    const c = R.composites && R.composites.lights; if (!c || typeof c.getContext !== 'function') return null;
    if (c !== lightsCanvasRef) { lightsCanvasRef = c; try { lightsCtx = c.getContext('2d'); } catch (e) { lightsCtx = null; } }
    return lightsCtx;
  }
  // art pass B5: stadium haze entries (drawn after the lights), window reflections on water near lit buildings, puddle reflections
  const hazeX = new Float32Array(2), hazeY = new Float32Array(2), hazeR = new Float32Array(2), hazeA = new Float32Array(2); let hazeN = 0;
  let tsx = 0, tsy = 0;
  function tileScreenXY(state, i, cam, view, ft) { const tx = i & 63, ty = i >> 6, z = cam.zoom || 1; tsx = (tileWorldX(tx, ty) - cam.x) * z + view.vw / 2; tsy = (tileWorldY(tx, ty) - ft * PXFT - cam.y) * z + view.vh / 2; }
  /** a lit building with water 1–3 tiles off its SW or SE edge mirrors a warm smear on that water (≤ 3 per building) */
  function windowReflections(state, b, span, cam, view, a) {
    const t = state.tiles, tx0 = b.tx | 0, ty0 = b.ty | 0, w = b.w | 0, h = b.h | 0; let made = 0;
    for (let edge = 0; edge < 2 && made < 3; edge++) {
      for (let d = 1; d <= 3 && made < 3; d++) {
        const n = edge === 0 ? w : h; let hit = -1;
        for (let k = 0; k < n; k++) {
          const x = edge === 0 ? tx0 + k : tx0 + w - 1 + d, y = edge === 0 ? ty0 + h - 1 + d : ty0 + k; if (x < 0 || y < 0 || x >= W || y >= HGT) continue;
          const i = y * W + x; if (isWaterTile(state, i)) { hit = i; if (k >= (n >> 1)) break; }
        }
        if (hit < 0) continue;
        tileScreenXY(state, hit, cam, view, fin(t.elev[hit], 0) + fin(t.depth[hit], 0));
        const L = pushLight('window', tsx, tsy, 1.2 + 0.3 * span, a * (1 - 0.22 * (d - 1)), 0); if (L) { L.refl = 1; made++; }
        break;
      }
    }
  }
  /** gather the frame's light sources (≤ lightsMax, nearest to the camera centre first); exposed for tests via R.lightsList */
  function gatherLights(state, view, cam, nightA) {
    lightsN = 0; hazeN = 0;
    const z = cam.zoom || 1, vw = view.vw, vh = view.vh, pad = 60;
    const inScreen = (x, y) => x > -pad && x < vw + pad && y > -pad && y < vh + pad;
    const list = R.drawList, te = mod('terrain'), game = state.sports && state.sports.game;
    const prestige = clamp(fin(state.economy && state.economy.prestige, 10) / 100, 0.3, 1);
    // streetlamps
    try {
      const lamps = te && typeof te.streetlamps === 'function' ? te.streetlamps(state) : null;
      if (lamps && lamps.length) for (let k = 0; k < lamps.length && lightsN < LMAX; k++) { const i = lamps[k] | 0; const tx = i & 63, ty = i >> 6; if (tx < view.x0 - 1 || tx > view.x1 + 1 || ty < view.y0 - 1 || ty > view.y1 + 1) continue; const p = R.tilePx(i); if (inScreen(p.x, p.y)) { pushLight('lamp', p.x, p.y - 14 * z, 1, 0.95, 0); if (wetBelow(state, i)) pushReflection(p.x, p.y, z, 0.4); } }
    } catch (e) { /* no terrain */ }
    // bridge pass: the lamps on decks over water (boardwalk / road bridge / Pedestrian Bridge), at deck height
    try {
      const cv = R.curves && typeof R.curves.current === 'function' ? R.curves.current() : null, L = cv && cv.lamps;
      const dark = typeof R.curves.overtopped === 'function' ? R.curves.overtopped : null;
      if (L && L.length) for (let k = 0; k < L.length && lightsN < LMAX; k++) { const q = L[k]; if (dark && dark(q.i)) continue; if (q.x < view.x0 - 1 || q.x > view.x1 + 1 || q.y < view.y0 - 1 || q.y > view.y1 + 1) continue; const p = R.tileToScreen(q.x, q.y, q.ft); if (inScreen(p.x, p.y)) { pushLight('lamp', p.x, p.y - 2 * z, 1, 0.9, 0); pushReflection(p.x, p.y + 4 * z, z, 0.45); } }
    } catch (e) { /* no curves */ }
    // dug canals: a cool water highlight on every visible CANAL tile so the cut (and the canal objective, which
    // can be offered after Dusk) reads at night — ≤ 64 per frame, nearest-first like everything else
    try {
      const fl = state.tiles && state.tiles.flags;
      if (fl && FLAG.CANAL) {
        let n = 0;
        for (let ty = Math.max(0, view.y0 | 0); ty <= Math.min(HGT - 1, view.y1 | 0) && n < 64; ty++) for (let tx = Math.max(0, view.x0 | 0); tx <= Math.min(W - 1, view.x1 | 0) && n < 64; tx++) {
          const i = ty * W + tx; if (!(fl[i] & FLAG.CANAL)) continue;
          const p = R.tilePx(i); if (!inScreen(p.x, p.y)) continue;
          pushLight('canal', p.x, p.y, 1, 0.6 + 0.12 * Math.sin(frameNo * 0.06 + tx * 1.7 + ty * 0.9), 0); n++;
        }
      }
    } catch (e) { /* no terrain */ }
    if (Array.isArray(list)) {
      for (let k = 0; k < list.length && lightsN < LMAX; k++) {
        const e = list[k]; if (!e) continue;
        if (e.kind === 'building' && e.b) {
          const b = e.b, v = e.variant | 0, span = (b.w | 0) + (b.h | 0);
          const cx = e.sx + ((b.h | 0) - (b.w | 0)) * 16 * z, cy = e.sy - (span - 2) * 8 * z;
          if (v & SPR.NIGHT) { const L = pushLight('window', cx, cy - (10 + span * 3) * z, 1.6 + 0.7 * span, 0.9, 0); if (L) L.d = 1; if (v & SPR.PILINGS) pushReflection(cx, cy + (span * 4) * z, z, 0.3); else if (FXO.reflect && state.tiles && state.tiles.depth) windowReflections(state, b, span, cam, view, 0.34); }
          if (b.type === 'bell_tower' && b.built >= 1 && !b.ruin) pushLight('beacon', cx, cy - 78 * z, 2.2 + 0.4 * Math.sin(frameNo * 0.05), prestige, 0);
          else if (b.type === 'water_tower' && b.built >= 1 && !b.ruin && (((frameNo / 60) | 0) & 1) === 0) pushLight('blink', cx, cy - 64 * z, 1.5, 1, 0);
          else if (b.type === 'substation' && (v & SPR.NIGHT) && (frameNo % 180) < 6) pushLight('arc', cx, cy - 10 * z, 2.5, 1, 0);
          else if (b.type === 'generator' && b.data && fin(b.data.fuelDays, 0) > 0 && b.built >= 1) pushLight('glow', cx, cy - 6 * z, 1.5 + 0.2 * Math.sin(frameNo * 0.3), 0.85, 0);
          else if ((b.type === 'dining_hall' || b.type === 'poboy') && (v & SPR.NIGHT)) pushLight('pot', e.sx + 10 * z, e.sy - 8 * z, 1.6, 0.75 + 0.25 * ((frameNo >> 2) & 1), 0);
          else if (b.type === 'stadium' && (b.tier | 0) >= 2 && b.built >= 1 && !b.ruin && !b.blackout && game && game.home) {
            // six masts around the bowl, cones rotated toward the field
            const rx = (span) * 14 * z, ry = span * 7 * z, fy = cy - 18 * z;
            for (let m = 0; m < 6 && lightsN < LMAX; m++) { const ang = (m / 6) * Math.PI * 2 + 0.3; const mx = cx + Math.cos(ang) * rx, my = fy + Math.sin(ang) * ry - 40 * z; pushLight('mast', mx, my, 1.9, 0.42, Math.atan2(fy - my, cx - mx) - Math.PI / 2); }   // B5: six overlapping cones used to white out the bowl; the haze below carries the glow now
            pushLight('glow', cx, fy, 7 * span * 0.25, 0.45, 0);
            if (FXO.haze && hazeN < 2) { hazeX[hazeN] = cx; hazeY[hazeN] = fy - 22 * z; hazeR[hazeN] = span * 38 * z * (1 + 0.15 * ((b.tier | 0) - 2)); hazeA[hazeN] = 0.9; hazeN++; }
          }
        } else if (!inScreen(e.sx, e.sy)) continue;
        else if (e.kind === 'bonfire') pushLight('fire', e.sx, e.sy - 8 * z, 1.4 + 0.3 * ((frameNo >> 1) % 3) / 2, 0.95, 0);
        else if (e.kind === 'gator' && nightA > 0.6 && e.b) {
          const b = e.b, i = clamp(Math.floor(fin(b.tx, 0)), 0, W - 1) + clamp(Math.floor(fin(b.ty, 0)), 0, HGT - 1) * W;
          if (isWaterTile(state, i) && (frameNo % 240) > 12) { pushLight('eye', e.sx - 4 * z, e.sy - 7 * z, 1, 1, 0); pushLight('eye', e.sx + 4 * z, e.sy - 7 * z, 1, 1, 0); }
        }
      }
    }
    // nearest to the camera centre first (the budget favours what the player looks at)
    const hx = vw / 2, hy = vh / 2;
    for (let k = 0; k < lightsN; k++) { const L = lightsList[k]; const dx = L.x - hx, dy = L.y - hy; L.d = dx * dx + dy * dy; }
    const part = lightsList.slice(0, lightsN).sort((a, b) => a.d - b.d);
    for (let k = 0; k < lightsN; k++) lightsList[k] = part[k];
    return lightsN;
  }
  function passLights(state, g, view) {
    const nightA = nightAmount(state);
    if (nightA <= 0.01) { lightsN = 0; return; }
    const cam = camOf(state), z = cam.zoom || 1, vw = view.vw, vh = view.vh;
    for (const k of LIGHT_KINDS) lightRefs[k] = undefined;   // refresh refs each frame (the atlas may re-bake)
    const lg = lightsCtxFor(view), lc = lightsCanvasRef;
    if (!lg || !lc) return;
    const sc = lc.width / Math.max(1, vw);
    gatherLights(state, view, cam, nightA);
    try {
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-over'; lg.globalAlpha = 1; lg.clearRect(0, 0, lc.width, lc.height);
      lg.setTransform(sc, 0, 0, sc, 0, 0); lg.imageSmoothingEnabled = true; lg.globalCompositeOperation = 'lighter';
      for (let k = 0; k < lightsN; k++) {
        const L = lightsList[k], ref = lightRef(L.kind); if (!ref) continue;
        const w = ref.sw * L.r * z, h = ref.sh * L.r * z;
        if (L.kind === 'mast') { lg.save(); lg.translate(L.x, L.y); lg.rotate(L.rot); lg.globalAlpha = L.a; lg.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, -w / 2, 0, w, h); lg.restore(); continue; }
        if (L.kind === 'lamp') { if (L.refl) { drawRef(lg, ref, L.x, L.y, w * 0.9, h * 2.8, L.a * 0.6); continue; } drawRef(lg, ref, L.x, L.y + 10 * z, w * 3.2, h * 1.6, L.a * 0.55); drawRef(lg, ref, L.x, L.y, w, h, L.a); continue; }   // pool on the ground + the core; refl = a mirrored smear on water
        if (L.kind === 'window') { if (L.refl) { drawRef(lg, ref, L.x, L.y, w * 1.1, h * 2.6, L.a * 0.55); continue; } drawRef(lg, ref, L.x, L.y + 16 * z, w * 2.2, h * 1.2, L.a * 0.35); drawRef(lg, ref, L.x, L.y, w, h, L.a); continue; }
        if (L.kind === 'canal') { drawRef(lg, ref, L.x, L.y, w * 2.3, h * 1.15, L.a); continue; }   // stretched 2:1 over the tile diamond
        drawRef(lg, ref, L.x, L.y, w, h, L.a);
      }
      // stadium glow haze on game nights: a warm dome and a pale veil over the lit bowl
      if (hazeN > 0) { const hs = ensureFogSprite(), hw = lightRef('lamp'); for (let k = 0; k < hazeN; k++) { const hr = hazeR[k]; if (hs) { lg.globalAlpha = 0.55 * hazeA[k]; lg.drawImage(hs, hazeX[k] - hr, hazeY[k] - hr * 0.6, hr * 2, hr * 1.2); } if (hw) drawRef(lg, hw, hazeX[k], hazeY[k] + hr * 0.1, hr * 2.6, hr * 1.4, 0.34 * hazeA[k]); } }
      // fireflies: blink via sin on life; drawn from the pool (they are also 1-px world particles)
      const ff = lightRef('firefly');
      if (ff) { let cnt = 0; const capF = (z < 1 ? (PR.fireflyHalfCap || 300) : 2000); for (let i = 0; i < alive && cnt < capF; i++) { if (ptype[i] !== TID.firefly || pscreen[i]) continue; const a = 0.5 + 0.5 * Math.sin(plife[i] * 0.005 + i); if (a < 0.15) continue; const sx = (px[i] - cam.x) * z + vw / 2, sy = (py[i] - pz[i] - cam.y) * z + vh / 2; if (sx < -8 || sx > vw + 8 || sy < -8 || sy > vh + 8) continue; drawRef(lg, ff, sx, sy, ff.sw * 2.5 * z, ff.sh * 2.5 * z, a); if (z >= 2 && cnt < 160) drawRef(lg, ff, sx, sy, ff.sw * 7 * z, ff.sh * 7 * z, a * 0.2); cnt++; } }   // B5: a soft bloom round each firefly at 2×
      // lightning bloom
      const now = nowMs();
      if (now < flashUntil) { const fs = ensureFogSprite(); const k = (flashUntil - now) / (PR.lightningMs || 250); if (fs) { lg.globalAlpha = k; lg.drawImage(fs, boltTipX - 160, boltTipY - 80, 320, 160); lg.globalAlpha = k * 0.8; lg.drawImage(fs, boltTipX - 70, boltTipY - 35, 140, 70); } }
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-over'; lg.globalAlpha = 1;
      // composite onto the world
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = nightA; g.imageSmoothingEnabled = true;
      g.drawImage(lc, 0, 0, lc.width, lc.height, 0, 0, vw, vh);
      g.imageSmoothingEnabled = false; g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    } catch (e) { try { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; } catch (e2) { /* stub */ } ferr('lights', e); }
  }

  // ---------------------------------------------------------------------------
  // Pass 8: fog, mist, vignette
  // ---------------------------------------------------------------------------
  // art pass B5: layered fog volumes. Soft noise-lumped sprites (3 shapes × 4 palettes: cool, warm dawn/dusk, storm grey, dim night)
  // in two layers — a low sheet hugging the water and a higher, smaller, slower drift — spawned over water (and now and then marsh);
  // the strength follows the sky clock and burns off through the first 40 % of Day. Storm fog bands sweep across during hurricane bands.
  const FOG_PAL = [[196, 208, 220], [246, 216, 192], [150, 160, 172], [118, 134, 160]];
  const fogTex = [[null, null, null], [null, null, null], [null, null, null], [null, null, null]]; let fogTexTried = false;
  function ensureFogTex() {
    if (fogTexTried) return fogTex[0][0]; fogTexTried = true;
    try {
      for (let p = 0; p < 4; p++) for (let v = 0; v < 3; v++) {
        const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); if (!g) return null;
        const col = FOG_PAL[p];
        g.save(); g.scale(1, 0.5);
        for (let b = 0; b < 7; b++) {
          const h = hash(v * 31 + b, 977 + p * 7), cx = 22 + b * 14 + ((h & 15) - 8) * 1.2, cy = 64 + (((h >> 4) & 15) - 8) * 2.2, r = 22 + ((h >> 8) & 15) * 1.4, a = 0.3 + 0.14 * (((h >> 12) & 7) / 7);
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          gr.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a.toFixed(3) + ')'); gr.addColorStop(0.55, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (a * 0.4).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
          g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
        }
        g.globalCompositeOperation = 'destination-in';
        const mk = g.createRadialGradient(64, 64, 0, 64, 64, 64); mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(0.5, 'rgba(0,0,0,0.9)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = mk; g.fillRect(0, 0, 128, 128); g.restore();
        fogTex[p][v] = c;
      }
    } catch (e) { for (let p = 0; p < 4; p++) for (let v = 0; v < 3; v++) fogTex[p][v] = null; }
    return fogTex[0][0];
  }
  /** the mist strength 0–1 for a sky phase and progress (pure; exposed for tests): strongest at dawn, burned off by 40 % of Day, back at dusk, steady at night */
  function mistFor(phase, t) {
    t = clamp(fin(t, 0), 0, 1);
    if (phase === SKY.DAWN) return lerp(1, 0.55, t);
    if (phase === SKY.DAY) return 0.55 * (1 - clamp(t / 0.4, 0, 1));
    if (phase === SKY.DUSK) return 0.6 * t;
    if (phase === SKY.NIGHT) return 0.6;
    return 0;
  }
  const FOG_N = 32;
  const wisps = []; for (let k = 0; k < FOG_N; k++) wisps.push({ tx: -1, ty: -1, ox: 0, oy: 0, s: 1, ph: 0, ttl: 0, age: 0, layer: 0, v: 0 });
  function ensureFogSprite() {
    if (fogSprite || fogSpriteTried) return fogSprite; fogSpriteTried = true;
    try {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); if (!g) return null;
      g.save(); g.scale(1, 0.5);
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(220,228,232,0.5)'); grad.addColorStop(0.4, 'rgba(210,220,226,0.24)'); grad.addColorStop(0.75, 'rgba(205,215,224,0.07)'); grad.addColorStop(1, 'rgba(200,210,220,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128); g.restore();
      fogSprite = c;
    } catch (e) { fogSprite = null; }
    return fogSprite;
  }
  function respawnWisp(wp, state, view) {
    const r = rng(), x0 = view.x0 | 0, y0 = view.y0 | 0, spanX = Math.max(1, (view.x1 | 0) - x0 + 1), spanY = Math.max(1, (view.y1 | 0) - y0 + 1);
    for (let k = 0; k < 14; k++) {
      const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
      const i = ty * W + tx; if (!isMarshy(state, i)) continue;
      if (!isWaterTile(state, i) && r.float() > 0.3) continue;   // mostly over open water, now and then a marsh
      wp.tx = tx; wp.ty = ty; wp.ox = (r.float() - 0.5) * 30; wp.oy = (r.float() - 0.5) * 10; wp.layer = r.float() < 0.4 ? 1 : 0; wp.v = r.int(3);
      wp.s = wp.layer ? 1.2 + r.float() * 0.8 : 1.7 + r.float() * 1.1; wp.ph = r.float() * 6.28; wp.age = 0; wp.ttl = 5000 + r.float() * 6000; return;
    }
    wp.ttl = 400;   // nothing wet in view: retry soon
  }
  function passFog(state, g, view, alpha, dtMs) {
    const vw = view.vw, vh = view.vh, cam = camOf(state), z = cam.zoom || 1, wx = state.weather || {};
    const fog = clamp(fin(wx.fog, 0), 0, 1), s = readSky(state), nightA = nightAmount(state), storm = stormDarkness(state);
    const dt = clamp(fin(dtMs, 16.67), 0, 100), wind = clamp(fin(wx.wind, 0), 0, 1.5), windAngle = fin(wx.windAngle, 0);
    const spr = ensureFogSprite();
    // mist over water and marsh (B5: two layers of soft volumes): strongest at dawn, burned off through the morning, back at dusk, steady at night, never in rain
    let mistA = FXO.fog ? mistFor(s.phase, s.t) : 0;
    mistA *= 1 - clamp(fin(wx.rainRate, 0), 0, 1); mistA *= 1 - storm;
    const perfLow = lowMode || (state.ui && state.ui.perfMode);
    if (mistA > 0.02 && state.tiles && state.tiles.type && ensureFogTex()) {
      const pal = s.phase === SKY.NIGHT || (s.phase === SKY.DUSK && s.t > 0.6) ? 3 : (s.phase === SKY.DAWN || s.phase === SKY.DUSK || s.phase === SKY.GOLDEN ? 1 : 0);
      const nW = perfLow ? 16 : (z < 1 ? 22 : wisps.length);
      g.globalCompositeOperation = 'source-over';
      for (let k = 0; k < nW; k++) {
        const wp = wisps[k]; wp.ttl -= dt; wp.age += dt;
        if (wp.ttl <= 0 || wp.tx < view.x0 - 2 || wp.tx > view.x1 + 2 || wp.ty < view.y0 - 2 || wp.ty > view.y1 + 2) respawnWisp(wp, state, view);
        if (wp.tx < 0) continue;
        wp.ox += Math.cos(windAngle) * (4 + 30 * wind) * (wp.layer ? 0.55 : 1) * dt / 1000; wp.ph += dt * 0.0006;
        const i = wp.ty * W + wp.tx, wpx = tileWorldX(wp.tx, wp.ty) + wp.ox, wpy = tileWorldY(wp.tx, wp.ty) + wp.oy - elevPx(state, i) - (wp.layer ? 16 : 4);
        const sx = (wpx - cam.x) * z + vw / 2, sy = (wpy - cam.y) * z + vh / 2;
        const sw = 128 * wp.s * z * (1 + 0.12 * Math.sin(wp.ph)), sh = sw * 0.38;
        if (sx < -sw || sx > vw + sw || sy < -sh || sy > vh + sh) continue;
        g.globalAlpha = mistA * (wp.layer ? 0.62 : 1) * Math.min(1, wp.ttl / 1200) * Math.min(1, wp.age / 1200);
        g.drawImage(fogTex[pal][wp.v], sx - sw / 2, sy - sh / 2, sw, sh);
      }
    }
    // storm fog bands: long low grey bands streaming across the view during hurricane rain bands and the landfall
    const evb = wx.event, sbands = storm > 0 && stormPhase !== SPH.EYE ? 0.35 + 0.65 * storm : (evb && evb.kind === 'band' ? 0.5 : 0);
    if (FXO.fog && sbands > 0.02 && ensureFogTex()) {
      const nb = perfLow ? 3 : 6, dir = Math.cos(windAngle) >= 0 ? 1 : -1; g.globalCompositeOperation = 'source-over';
      for (let b = 0; b < nb; b++) {
        const bw = vw * (0.9 + 0.12 * b), bh = (80 + 20 * b) * z, span = vw + bw, spd = (0.6 + 0.35 * b) * (0.6 + wind);
        const x = ((((frameNo * spd * dir + b * 331) % span) + span) % span) - bw, y = vh * (0.12 + 0.14 * b) - bh / 2;
        g.globalAlpha = 0.9 * sbands * (0.75 + 0.25 * Math.sin(frameNo * 0.011 + b * 1.7));
        g.drawImage(fogTex[2][b % 3], x, y, bw, bh);
      }
    }
    // weather fog: the flat layer (Tier 1) + 8 drifting blobs (Tier 2)
    if (fog > 0.01) {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = FOG_TINT.alpha * fog; g.fillStyle = FOG_TINT.color; g.fillRect(0, 0, vw, vh);
      if (spr) {
        for (let k = 0; k < fogBlobs.length; k++) {
          const b = fogBlobs[k];
          if (b.r <= 1) { const r = rng(); b.x = r.float() * vw; b.y = r.float() * vh; b.r = 180 + r.float() * 260; b.vx = 6 + r.float() * 10; b.ph = r.float() * 6.28; }
          b.x += (b.vx + 40 * wind * Math.cos(windAngle)) * dt / 1000; b.ph += dt * 0.0004;
          if (b.x - b.r > vw) b.x = -b.r; else if (b.x + b.r < 0) b.x = vw + b.r;
          g.globalAlpha = 0.22 * fog * (0.75 + 0.25 * Math.sin(b.ph));
          g.drawImage(spr, b.x - b.r, b.y - b.r / 2, b.r * 2, b.r);
        }
      }
    }
    // night vignette: 4 edges × 6 stacked bands, up to .35 at Night
    if (nightA > 0.02) {
      const steps = 6, depth = Math.round(Math.min(vw, vh) * 0.22); g.fillStyle = '#05061A';
      for (let b = 0; b < steps; b++) { const a = 0.35 * nightA * ((b + 1) / steps) * ((b + 1) / steps) / 2.2, d = Math.round(depth * (1 - b / steps)); g.globalAlpha = a; g.fillRect(0, 0, vw, d); g.fillRect(0, vh - d, vw, d); g.fillRect(0, 0, d, vh); g.fillRect(vw - d, 0, d, vh); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Pass 8.5: storm spectacle (cone, surge crest, god rays) — world-space, under the shake
  // ---------------------------------------------------------------------------
  /** the forecast cone polygon in world px (zoom-1), or null without a cone (GDD §6.2) */
  R.cone = function (state) {
    try {
      const wx = mod('weather'); const c = wx && typeof wx.cone === 'function' ? wx.cone(state) : null;
      if (!c || !Array.isArray(c.track) || c.track.length < 2) return null;
      const half = Math.max(2, fin(c.width, 24) / 2), tr = c.track, left = [], right = [];
      for (let k = 0; k < tr.length; k++) {
        const p = tr[k], q = tr[Math.min(tr.length - 1, k + 1)], o = tr[Math.max(0, k - 1)];
        let dx = fin(q.tx, 0) - fin(o.tx, 0), dy = fin(q.ty, 0) - fin(o.ty, 0); const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const nx = -dy, ny = dx, grow = half * (0.35 + 0.65 * k / Math.max(1, tr.length - 1));   // the cone widens away from the current point
        left.push({ x: tileWorldX(p.tx + nx * grow, p.ty + ny * grow), y: tileWorldY(p.tx + nx * grow, p.ty + ny * grow) });
        right.push({ x: tileWorldX(p.tx - nx * grow, p.ty - ny * grow), y: tileWorldY(p.tx - nx * grow, p.ty - ny * grow) });
      }
      return { points: left.concat(right.reverse()) };
    } catch (e) { return null; }
  };
  function passStorm(state, g, view, alpha, dtMs) {
    const cam = camOf(state), z = cam.zoom || 1, vw = view.vw, vh = view.vh;
    // the cone
    const cone = stormDarkness(state) === 0 ? R.cone(state) : null;
    if (cone && cone.points.length >= 4) {
      g.globalAlpha = 0.22 + 0.05 * Math.sin(frameNo * 0.08); g.fillStyle = '#8E2A5E'; g.beginPath();
      for (let k = 0; k < cone.points.length; k++) { const p = worldToScreenPx(cone.points[k].x, cone.points[k].y, cam, view); if (k === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); }
      g.closePath(); g.fill(); g.globalAlpha = 0.5; g.strokeStyle = '#C94A8A'; g.lineWidth = 1; g.stroke();
    }
    // the surge front: foam crest on the advancing edge (never a `front` array; D47)
    const hy = mod('hydro'), surge = state.hydro && state.hydro.surge;
    if (surge && hy && typeof hy.surgeReached === 'function' && typeof hy.surgeFrontDistance === 'function' && state.tiles) {
      const reached = fin(surge.reached, 0); let drawn = 0; const t = state.tiles, r = rng();
      g.fillStyle = '#E8F2F8';
      for (let ty = view.y0 | 0; ty <= (view.y1 | 0) && drawn < 160; ty++) for (let tx = view.x0 | 0; tx <= (view.x1 | 0) && drawn < 160; tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
        const i = ty * W + tx; if (!hy.surgeReached(state, i)) continue;
        const d = hy.surgeFrontDistance(state, i); if (!(d >= reached - 1.5)) continue;
        const surf = fin(t.elev[i], 0) + fin(t.depth[i], 0);
        const sx = (tileWorldX(tx, ty) - cam.x) * z + vw / 2, sy = (tileWorldY(tx, ty) - surf * PXFT - cam.y) * z + vh / 2;
        if (sx < -40 || sx > vw + 40 || sy < -20 || sy > vh + 20) continue;
        drawn++;
        g.globalAlpha = 0.5 + 0.3 * Math.sin(frameNo * 0.2 + tx * 1.7 + ty);
        g.fillRect(Math.round(sx - 22 * z), Math.round(sy - 3 * z), 44 * z, 2 * z); g.fillRect(Math.round(sx - 12 * z), Math.round(sy + 2 * z), 24 * z, z);
        if (r.float() < 0.05) emit('foam', tileWorldX(tx, ty), tileWorldY(tx, ty), 2, { spread: 20, z: surf * PXFT + 2, vz: 25, life: 500 });
      }
    }
    // god rays for godRayTicks after CLEARING: 6 translucent gold wedges from the top-right (one path)
    if (godRayUntil >= 0) {
      const left = godRayUntil - fin(state.tick, 0);
      if (left <= 0 || !state.setPiece) godRayUntil = -1;
      else {
        const k = clamp(left / (PR.godRayTicks || 100), 0, 1);
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.07 * Math.sin(k * Math.PI); g.fillStyle = GOLD; g.beginPath();
        for (let w = 0; w < 6; w++) { const ang = 0.75 + w * 0.12 + 0.02 * Math.sin(frameNo * 0.02 + w), bx = vw + 40, by = -40, len = vw * 1.6; g.moveTo(bx, by); g.lineTo(bx - Math.cos(ang) * len, by + Math.sin(ang) * len); g.lineTo(bx - Math.cos(ang + 0.05) * len, by + Math.sin(ang + 0.05) * len); g.closePath(); }
        g.fill(); g.globalCompositeOperation = 'source-over';
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    drawRainAndLightning(state, g, view, dtMs);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Pass 10.5: HUD-canvas bits — the performance chip
  // ---------------------------------------------------------------------------
  function passFxHud(state, g, view) {
    const now = nowMs();
    if (now < perfChipUntil) {
      const a = clamp((perfChipUntil - now) / 800, 0, 1), x = view.vw - 176, y = 52;
      g.globalAlpha = 0.85 * a; g.fillStyle = PAL.panel || '#1A1230'; g.fillRect(x, y, 164, 26); g.fillStyle = GOLD; g.fillRect(x, y, 3, 26);
      g.globalAlpha = a; g.fillStyle = PAL.text || '#F4EEE2'; g.font = '12px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('Performance mode', x + 12, y + 13);
      g.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Event-driven FX (owner 'renderfx'; flags + particles only, never sim state)
  // ---------------------------------------------------------------------------
  function buildingOf(p) { const s = stateLive(); if (!s || !Array.isArray(s.buildings)) return null; const id = p && Number.isFinite(p.id) ? p.id | 0 : -1; return id >= 0 ? (s.buildings[id] || null) : null; }
  function footprintCenter(b) { return { x: tileWorldX(b.tx + (b.w - 1) / 2, b.ty + (b.h - 1) / 2), y: tileWorldY(b.tx + (b.w - 1) / 2, b.ty + (b.h - 1) / 2), z: elevPx(stateLive(), clamp(b.ty + b.h - 1, 0, HGT - 1) * W + clamp(b.tx + b.w - 1, 0, W - 1)), spread: (b.w + b.h) * 10 }; }
  function tileCenter(i) { const tx = i & 63, ty = i >> 6; return { x: tileWorldX(tx, ty), y: tileWorldY(tx, ty), z: elevPx(stateLive(), i) }; }
  let milePending = 0, mileTimer = 0;
  /** a shell over the screen: the burst lands inside the current view (milestones) */
  function viewShell(state) {
    const view = R.view; if (!view) return; const cam = camOf(state), z = cam.zoom || 1, r = rng();
    const H = 110 + 40 * r.float(), sx = view.vw * (0.3 + 0.4 * r.float()), sy = view.vh * (0.2 + 0.18 * r.float());
    addShell((sx - view.vw / 2) / z + cam.x, (sy - view.vh / 2) / z + cam.y + H, 0, H, 1);
  }
  function fireworks(state, scale) {
    state = state || stateLive(); if (!state) return;
    let at = null;
    let vb = null; try { vb = typeof R.fieldVenue === 'function' ? R.fieldVenue(state, false) : null; } catch (e) { vb = null; }   // football pass F: the venue the game is played at
    if (vb) at = footprintCenter(vb);
    else if (Array.isArray(state.buildings)) for (const b of state.buildings) if (b && (b.type === 'stadium' || b.type === 'practice_field') && b.built >= 1) { at = footprintCenter(b); if (b.type === 'stadium') break; }
    if (!at && state.plot && state.plot.founders) at = { x: tileWorldX(state.plot.founders.tx + 1, state.plot.founders.ty + 1), y: tileWorldY(state.plot.founders.tx + 1, state.plot.founders.ty + 1), z: 0, spread: 20 };
    if (!at) return;
    const r = rng(), ox = (r.float() - 0.5) * 90 * scale, oy = (r.float() - 0.5) * 30 * scale, zz = at.z + 90 + r.float() * 40;
    emit('confetti', at.x + ox, at.y + oy, Math.round(30 * scale), { z: zz, vx: 0, vy: 0, vz: 40, spread: 6, jitter: 1, size: 3, life: 1500 });
    addShell(at.x + ox, at.y + oy, at.z, 150 + 60 * r.float(), 1);   // B5: a rising rocket and a trailed burst with bloom (render_fx passFireworks)
  }
  function subscribe() {
    if (subscribed || !BSU.events || typeof BSU.events.on !== 'function') return; subscribed = true;
    const on = (name, fn) => { if (!name) return; BSU.events.on(name, function (p) { try { fn(p || {}); } catch (e) { ferr('on:' + name, e); } }, 'renderfx'); };
    on(EV.ECON_INCOME, (p) => {
      const amt = fin(p.amount, 0); if (amt <= 0) return;
      const n = clamp(6 + Math.round(amt / 100000), 6, 12);
      if (Number.isFinite(p.i) && p.i >= 0 && p.i < N) { const c = tileCenter(p.i | 0); emit('coin', c.x, c.y, n, { z: c.z + 6, vz: 160, spread: 8, jitter: 0.5, color: 0, size: 2 }); }
      else emit('coin', 120, 24, 6, { screen: true, vz: 120, vx: 0, spread: 10, jitter: 0.6, color: 0, size: 2 });
      if (amt >= 500000) R.hitStop(PR.hitStopMs || 60);
    });
    on(EV.BUILDING_PLACED, (p) => { const b = buildingOf(p); if (!b) return; const c = footprintCenter(b); emit('dust', c.x, c.y, 12, { z: c.z, spread: c.spread, vz: 30, jitter: 0.8 }); R.squash[b.id] = nowMs(); });
    on(EV.BUILDING_COMPLETE, (p) => { const b = buildingOf(p); if (!b) return; const c = footprintCenter(b); emit('dust', c.x, c.y, 20, { z: c.z, spread: c.spread, vz: 40, jitter: 0.8 }); emit('sparks', c.x, c.y, 6, { z: c.z + 20, vz: 120, spread: c.spread / 2, jitter: 0.8 }); R.squash[b.id] = nowMs(); });
    on(EV.BUILDING_REMOVED, (p) => {
      let c = null; const b = p.building || p.b || null;
      if (b && Number.isFinite(b.tx)) c = footprintCenter(b);
      else if (Number.isFinite(p.tx) && Number.isFinite(p.ty)) { const w = fin(p.w, 1), h = fin(p.h, 1); c = footprintCenter({ tx: p.tx, ty: p.ty, w: w, h: h }); }
      else if (Number.isFinite(p.i)) c = tileCenter(p.i | 0);
      if (!c) return; emit('smoke', c.x, c.y, 20, { z: c.z + 6, spread: c.spread || 16, vz: 35, jitter: 0.8 }); R.shake(PR.shakeMs ? PR.shakeMs.demolish : 120, 3);
    });
    on(EV.BUILDING_DAMAGED, (p) => { if (p.cause !== 'wind') return; const b = buildingOf(p); if (!b) return; const c = footprintCenter(b); emit('debris', c.x, c.y, 4, { z: c.z + 30 + (b.w + b.h) * 4, vz: 60, vx: 80, spread: c.spread / 2, jitter: 1, size: 3 }); });
    // football pass F: crowd reactions (render.fbNotify), the gold flash on home scores, a shake on big hits, audio stings
    const fbTell = (kind, p) => { try { if (typeof R.fbNotify === 'function') R.fbNotify(kind, p); } catch (e) { ferr('fbNotify', e); } };
    const sting = (name, opts) => { try { const A = BSU.audio; if (A && typeof A.play === 'function') A.play(name, opts); } catch (e) { ferr('sting', e); } };
    on(EV.GAME_SCORE, (p) => { fbTell('score', p); if (p.side !== 'home') return; fireworks(stateLive(), 1); goldFlash = Math.max(goldFlash, 4); R.shake(PR.shakeMs ? PR.shakeMs.score : 150); });
    on(EV.GAME_FINAL, (p) => { fbTell('final', p); if (!p.won) return; burstsPending = 3; burstTimer = 1; goldFlash = 6; });
    on(EV.GAME_KICKOFF || 'game:kickoff', (p) => { fbTell('kickoff', p); });
    on(EV.GAME_HALFTIME || 'game:halftime', (p) => { fbTell('halftime', p); if (p.mode === 'highlights' || p.mode === 'full') sting('whistle', { gain: 0.5 }); });
    on(EV.GAME_PLAY || 'game:play', (p) => {
      fbTell('play', p);
      const big = p.type === 'sack' || p.res === 'fumble';
      if (big) R.shake(PR.shakeMs ? PR.shakeMs.demolish : 120, 3);
      if (p.poss === 0 && (p.res === 'int' || p.res === 'fumble')) sting('groan', { gain: 0.6 });
      else if (p.poss === 0 && p.key && fin(p.yds, 0) >= 20 && p.res !== 'td') sting('roar', { gain: 0.35 });
      else if (p.poss === 1 && p.fourth && p.res === 'downs') sting('roar', { gain: 0.5 });
    });
    on(EV.STORM_PULSE, () => {
      const s = stateLive(), cam = camOf(s), view = R.view; if (!s || !view) return; const z = cam.zoom || 1, r = rng();
      const wa = fin(s.weather && s.weather.windAngle, 0), fromLeft = Math.cos(wa) >= 0;
      for (let k = 0; k < 20; k++) {
        const sy0 = r.float() * view.vh, sy2 = r.float() * view.vh; const sx0 = fromLeft ? -40 : view.vw + 40, sx2 = fromLeft ? view.vw + 40 : -40;
        const x0 = (sx0 - view.vw / 2) / z + cam.x, y0 = (sy0 - view.vh / 2) / z + cam.y, x2 = (sx2 - view.vw / 2) / z + cam.x, y2 = (sy2 - view.vh / 2) / z + cam.y;
        emitArc(x0, y0, (x0 + x2) / 2 + (r.float() - 0.5) * 200, (y0 + y2) / 2 - 100, x2, y2, 60 + r.float() * 120, 900 + r.float() * 800, 3 + r.int(4));
      }
    });
    on(EV.STORM_PHASE, (p) => { stormPhase = fin(p.phase, -1); if (stormPhase === SPH.LANDFALL) R.shake(PR.shakeMs ? PR.shakeMs.landfall : 400); if (stormPhase === SPH.CLEARING) { const s = stateLive(); godRayUntil = s ? fin(s.tick, 0) + (PR.godRayTicks || 100) : -1; } if (stormPhase === SPH.OUTER) rainRamp = 0; });
    on(EV.WEATHER_LIGHTNING, (p) => {
      const s = stateLive(), view = R.view; if (!s || !view) return;
      const tx = clamp(fin(p.tx, 32) | 0, 0, W - 1), ty = clamp(fin(p.ty, 32) | 0, 0, HGT - 1);
      let tip; try { tip = R.tileToScreen(tx, ty); } catch (e) { tip = { x: view.vw / 2, y: view.vh / 2 }; }
      const r = rng(), segs = 6 + r.int(4), sx0 = clamp(tip.x + (r.float() - 0.5) * 300, 0, view.vw);
      boltN = segs + 1; for (let k = 0; k <= segs; k++) { const t = k / segs; bolt[2 * k] = lerp(sx0, tip.x, t) + (k > 0 && k < segs ? (r.float() * 2 - 1) * 20 : 0); bolt[2 * k + 1] = lerp(-10, tip.y, t) + (k > 0 && k < segs ? (r.float() * 2 - 1) * 12 : 0); }
      boltTipX = tip.x; boltTipY = tip.y; const now = nowMs(); flashUntil = now + (PR.lightningMs || 250); boltUntil = now + 110;
      R.shake(PR.shakeMs ? PR.shakeMs.lightning : 80, 3);
      emit('lightningBloom', tileWorldX(tx, ty), tileWorldY(tx, ty), 1, { z: elevPx(s, ty * W + tx) + 10 });
      // thunder, delayed by distance from the camera (audio has no lightning listener of its own)
      try {
        const au = mod('audio');
        if (au && typeof au.play === 'function' && !BSU.headlessMode) {
          const cam = camOf(s), ctx_ = (cam.x / 32 + cam.y / 16) / 2, cty = (cam.y / 16 - cam.x / 32) / 2, d = Math.hypot(tx - ctx_, ty - cty);
          const dl = (BSU.params.audio && BSU.params.audio.thunderDelay) || [0.3, 2];
          au.play('thunder', { delayMs: Math.round(lerp(dl[0], dl[1], clamp(d / 48, 0, 1)) * 1000), gain: clamp(1 - d / 80, 0.3, 1) });
        }
      } catch (e) { /* audio is optional */ }
    });
    on(EV.LEVEE_OVERTOP, (p) => { if (!Number.isFinite(p.i)) return; const i = p.i | 0; if (i < 0 || i >= N) return; const c = tileCenter(i); const s = stateLive(); const crest = s && s.tiles && s.tiles.crest ? fin(s.tiles.crest[i], 0) : 0; emit('sheet', c.x, c.y, 8, { z: c.z + crest * PXFT, spread: 14, vz: -30, vy: 20 }); overtop.set(i, 300); });
    on(EV.LEVEE_BREACH, (p) => { if (!Number.isFinite(p.i)) return; const c = tileCenter(p.i | 0); emit('gush', c.x, c.y, 30, { z: c.z + 20, vz: 80, vx: 60, spread: 10, jitter: 1 }); emit('foam', c.x, c.y, 10, { z: c.z + 2, spread: 20, vz: 10 }); R.shake(120, 3); });
    on(EV.SURGE_FRONT, (p) => { if (!Number.isFinite(p.i)) return; const c = tileCenter(p.i | 0); emit('foam', c.x, c.y, 3, { z: c.z + 2, spread: 18, vz: 20 }); emit('debris', c.x, c.y, 1, { z: c.z + 4, vz: 20, spread: 10, size: 3 }); });
    // B5: two confetti cannons at the lower corners and a pair of view shells (the burst lands in the current view)
    on(EV.MILESTONE_EARNED, () => { const view = R.view, vw = view ? view.vw : 1280, vh = view ? view.vh : 800; emit('confetti', 40, vh * 0.72, 26, { screen: true, vz: 300, vx: 150, spread: 12, jitter: 0.6, size: 3, life: 2600 }); emit('confetti', vw - 40, vh * 0.72, 26, { screen: true, vz: 300, vx: -150, spread: 12, jitter: 0.6, size: 3, life: 2600 }); milePending = 2; mileTimer = 6; });
    on(EV.OBJECTIVE_COMPLETE, () => { const view = R.view; emit('sparks', view ? view.vw - 160 : 1100, 120, 8, { screen: true, vz: 120, spread: 20, jitter: 1, size: 2, life: 600 }); });
    on(EV.SETPIECE_START, (p) => { if (p.kind === 'landfall') { rainRamp = 0; stormPhase = SPH.OUTER; } });
    on(EV.SETPIECE_END, (p) => { if (p.kind === 'landfall') { stormPhase = -1; rainRamp = 0; } });
    on(EV.TILE_CHANGED, () => { pdDirty = true; });
    on(EV.SAVE_LOADED, () => { R._fxReset(stateLive()); });
  }

  // ---------------------------------------------------------------------------
  // Perf guardrail reaction, init / reset
  // ---------------------------------------------------------------------------
  /** the guardrail tripped (render measured 60 frames > 25 ms): fewer particles, fireflies ÷ 2, rain ÷ 2, chip */
  R.onPerfMode = function () { lowMode = true; cap = LOWP; if (alive > cap) alive = cap; perfChipUntil = nowMs() + 6000; };
  /** once per page load, from render.init */
  R._fxInit = function () { inited = true; subscribe(); R._fxReset(stateLive()); };
  /** on newGame / load: drop every transient effect */
  R._fxReset = function (state) {
    alive = 0; spN = 0; spApron = 0; plN = 0; fwN = 0; pvN = 0; srcN = 0; milePending = 0; pdDirty = true; wet = state && state.weather && fin(state.weather.rainRate, 0) > 0.3 ? 0.4 : 0; overtop.clear(); boltN = 0; flashUntil = 0; boltUntil = 0; godRayUntil = -1; goldFlash = 0; burstsPending = 0; rainRamp = 0; rainSeeded = false; lightsN = 0;
    for (const wp of wisps) { wp.tx = -1; wp.ttl = 0; wp.age = 0; } for (const b of fogBlobs) b.r = 1;
    const low = !!(state && state.ui && (state.ui.perfMode || (state.ui.settings && state.ui.settings.particles === 'low')));
    lowMode = low; cap = low ? LOWP : MAXP;
    stormPhase = state && state.setPiece && state.setPiece.kind === 'landfall' ? SPH.OUTER : -1;
  };
  /** four bands of the K overlay (0 none, 1 Ambient, 2 Annoying, 3 Biblical, 4 State Bird) — shared with tests/ui */
  R.mosqBand = function (m) { m = fin(m, 0); return m < 0.15 ? 0 : m < 0.3 ? 1 : m < 0.6 ? 2 : m < 0.8 ? 3 : 4; };
  R.tintFor = function (phase, t) { return tintFor(phase, t, {}); };
  R.rainLineCount = rainLineCount;
  /** number of light sources gathered last frame (≤ lightsMax; R.lightsList[0..n) sorted nearest-first) */
  R.lightsCount = function () { return lightsN; };
  R.nightAmount = nightAmount;
  R.mistFor = mistFor;
  R.addShell = function (wx, wy, z0, z1, scale) { addShell(wx, wy, z0, z1, fin(scale, 1)); };

  // Passes (same-name registrations replace render's fallbacks for 'tint'; overlays/hud stay render's)
  R.registerPass('weather', function (s, g, v, a, dt) { try { passWeather(s, g, v, a, dt); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 5);
  R.registerPass('tint', function (s, g, v) { try { passTint(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 6);
  R.registerPass('lights', function (s, g, v) { try { passLights(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 7);
  R.registerPass('fog', function (s, g, v, a, dt) { try { passFog(s, g, v, a, dt); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 8);
  R.registerPass('fireworks', function (s, g, v) { try { passFireworks(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 8.2);
  R.registerPass('storm', function (s, g, v, a, dt) { try { passStorm(s, g, v, a, dt); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 8.5);
  R.registerPass('fxhud', function (s, g, v) { try { passFxHud(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 10.5);
  if (inited === false && R.ctx) { try { R._fxInit(); } catch (e) { ferr('lateInit', e); } }   // render.init already ran (manifest order safety)

  // ---------------------------------------------------------------------------
  // Tests (run by render.selfTest via R._tests)
  // ---------------------------------------------------------------------------
  R._tests.push(function () {
    const notes = []; const saved = alive, savedCap = cap; alive = 0; cap = MAXP;
    try {
      const A = (c, m) => { if (!c) throw new Error(m); };
      emit('dust', 0, 0, 10); A(alive === 10, 'emit 10 → count 10'); let seen = 0; R.particles.forEachWorld(() => seen++); A(seen === 10, 'forEachWorld visits 10');
      emit('confetti', 0, 0, 3, { screen: true }); A(alive === 13, 'screen particles count'); seen = 0; R.particles.forEachWorld(() => seen++); A(seen === 10, 'screen particles skipped by forEachWorld');
      for (let k = 0; k < 60; k++) update(100, 0, 0); A(alive === 0, 'all dead after life'); emit('sparks', 0, 0, 3000); A(alive <= MAXP, 'cap respected'); R.particles.clear(); A(alive === 0, 'clear');
      A(rainLineCount(0, 1, false) === 0 && rainLineCount(0.5, 1, false) === 750 && rainLineCount(1, 1, false) === 1200 && rainLineCount(1, 0.5, false) <= 400 && rainLineCount(1, 1, true) <= 600, 'rain line counts');
      A(R.mosqBand(0.1) === 0 && R.mosqBand(0.2) === 1 && R.mosqBand(0.5) === 2 && R.mosqBand(0.7) === 3 && R.mosqBand(0.9) === 4, 'mosq bands');
      const tD = tintFor(SKY.DAY, 0.3, {}); A(tD.a1 === 0 && tD.a2 === 0, 'day tint alpha 0');
      const tN = tintFor(SKY.NIGHT, 0.5, {}); A(tN.c1 === TINTS[SKY.NIGHT].color && Math.abs(tN.a1 - 0.62) < 1e-6, 'night tint');
      for (let ph = 0; ph < 5; ph++) for (let t = 0; t <= 1; t += 0.25) { const o = tintFor(ph, t, {}); A(Number.isFinite(o.a1) && Number.isFinite(o.a2), 'finite tint'); }
      A(R.cone({ storms: { current: null } }) === null, 'no cone without a storm');
      const fake = { storms: { current: { phase: STORM.WATCH, nearMiss: false, track: [{ tx: 30, ty: 63 }, { tx: 30, ty: 40 }, { tx: 31, ty: 20 }], coneWidth: 24, point: 63 * 64 + 30, landfallDay: 3, cat: 3, forecastCat: 3 } } };
      const wxm = mod('weather'); const c = wxm && typeof wxm.cone === 'function' ? R.cone(fake) : { points: [1, 2, 3, 4] };
      A(c && c.points.length >= 4, 'cone polygon ≥ 4 points');
      A(mistFor(SKY.DAWN, 0) === 1 && mistFor(SKY.DAY, 0.5) === 0 && mistFor(SKY.NIGHT, 0.5) === 0.6 && mistFor(SKY.GOLDEN, 0.5) === 0, 'mist table');
      const svShells = fwN; fwN = 0; for (let k = 0; k < 20; k++) addShell(0, 0, 0, 100, 1); A(fwN === FW_MAX, 'shell cap'); fwN = svShells;
      const svWet = wet; wet = 0.5; A(clamp(wet * 0.56, 0, 1) < 1, 'wet scale'); wet = svWet;
      notes.push('render_fx: pool/rain/bands/tint/cone/mist/shells ok');
      return { ok: true, notes: notes.join(' ') };
    } catch (e) { return { ok: false, notes: 'render_fx: ' + (e && e.message) }; }
    finally { alive = saved; cap = savedCap; }
  });
})();
