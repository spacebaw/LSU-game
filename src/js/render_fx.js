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
  const wisps = []; for (let k = 0; k < 22; k++) wisps.push({ tx: -1, ty: -1, ox: 0, oy: 0, s: 1, ph: 0, ttl: 0 });
  let fogSprite = null, fogSpriteTried = false, lightsCtx = null, lightsCanvasRef = null;
  let stormPhase = -1, godRayUntil = -1, goldFlash = 0, burstsPending = 0, burstTimer = 0, perfChipUntil = 0, subscribed = false, inited = false;
  let frameNo = 0, lastFrameNo = -1;
  const overtop = new Map();   // tile → frames left of trickle
  const lightRefs = {};        // kind → SpriteRef (refreshed per frame)
  const LIGHT_KINDS = ['lamp', 'window', 'mast', 'beacon', 'blink', 'arc', 'glow', 'pot', 'fire', 'firefly', 'eye'];
  const LMAX = PR.lightsMax || 250;
  const lightsList = []; for (let k = 0; k < LMAX + 8; k++) lightsList.push({ kind: 'lamp', x: 0, y: 0, r: 1, a: 1, rot: 0, d: 0 });
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
    if (frameNo !== lastFrameNo) { lastFrameNo = frameNo; update(dtMs, wind, windAngle); perFrameEmitters(state, view, cam); }
    const storm = stormDarkness(state);
    rainRamp = storm > 0 ? Math.min(1, rainRamp + fin(dtMs, 16) / 2500) : 0;
    let rainRate = clamp(fin(wx.rainRate, 0), 0, 1);
    if (storm > 0) rainRate = Math.max(rainRate, stormPhase === SPH.EYE ? 0.08 : lerp(0.5, 1, rainRamp));
    // stadium crowd (world-space but screen px; before the rain so ponchos get wet)
    try { crowdInWorld(state, g, view, cam, rainRate > 0.05); } catch (e) { ferr('crowd', e); }
    curRainRate = rainRate; curStorm = storm; curWind = wind; curWindAngle = windAngle;
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
    // heat shimmer (Tier 2): re-draw the middle rows of the world offset by a sine
    try {
      const heat = fin(wx.heat, 0);
      if (heat > 95 && rainRate < 0.05 && (sk.phase === SKY.DAY || sk.phase === SKY.GOLDEN) && !BSU.headlessMode && R.canvas && !perf) {
        const c = R.canvas, dpr = view.dpr || 1, strips = 24, h = Math.max(2, Math.round(vh * 0.3 / strips)), y0 = Math.round(vh * 0.35);
        g.globalAlpha = 0.35;
        for (let s = 0; s < strips; s++) { const y = y0 + s * h, off = Math.round(Math.sin(frameNo * 0.15 + s * 0.9) * 1.5); g.drawImage(c, 0, y * dpr, c.width, h * dpr, off, y, vw, h); }
      }
    } catch (e) { /* shimmer is optional */ }
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
    const list = R.drawList; if (!Array.isArray(list)) return;
    const S = mod('sprites'), cat = (BSU.data && BSU.data.catalog) || {};
    for (let k = 0; k < list.length; k++) {
      const e = list[k]; if (!e || e.kind !== 'building' || !e.b) continue;
      const b = e.b; if (b.type !== 'stadium' && !(b.type === 'practice_field' && b.tier >= 1)) continue;
      if (!(b.built >= 1) || b.ruin) continue;
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
  function pushLight(kind, x, y, r, a, rot) { if (lightsN >= lightsList.length) return null; const L = lightsList[lightsN++]; L.kind = kind; L.x = x; L.y = y; L.r = r; L.a = a; L.rot = rot || 0; return L; }
  function lightsCtxFor(view) {
    const c = R.composites && R.composites.lights; if (!c || typeof c.getContext !== 'function') return null;
    if (c !== lightsCanvasRef) { lightsCanvasRef = c; try { lightsCtx = c.getContext('2d'); } catch (e) { lightsCtx = null; } }
    return lightsCtx;
  }
  /** gather the frame's light sources (≤ lightsMax, nearest to the camera centre first); exposed for tests via R.lightsList */
  function gatherLights(state, view, cam, nightA) {
    lightsN = 0;
    const z = cam.zoom || 1, vw = view.vw, vh = view.vh, pad = 60;
    const inScreen = (x, y) => x > -pad && x < vw + pad && y > -pad && y < vh + pad;
    const list = R.drawList, te = mod('terrain'), game = state.sports && state.sports.game;
    const prestige = clamp(fin(state.economy && state.economy.prestige, 10) / 100, 0.3, 1);
    // streetlamps
    try {
      const lamps = te && typeof te.streetlamps === 'function' ? te.streetlamps(state) : null;
      if (lamps && lamps.length) for (let k = 0; k < lamps.length && lightsN < LMAX; k++) { const i = lamps[k] | 0; const tx = i & 63, ty = i >> 6; if (tx < view.x0 - 1 || tx > view.x1 + 1 || ty < view.y0 - 1 || ty > view.y1 + 1) continue; const p = R.tilePx(i); if (inScreen(p.x, p.y)) pushLight('lamp', p.x, p.y - 14 * z, 1, 0.95, 0); }
    } catch (e) { /* no terrain */ }
    if (Array.isArray(list)) {
      for (let k = 0; k < list.length && lightsN < LMAX; k++) {
        const e = list[k]; if (!e) continue;
        if (e.kind === 'building' && e.b) {
          const b = e.b, v = e.variant | 0, span = (b.w | 0) + (b.h | 0);
          const cx = e.sx + ((b.h | 0) - (b.w | 0)) * 16 * z, cy = e.sy - (span - 2) * 8 * z;
          if (v & SPR.NIGHT) { const L = pushLight('window', cx, cy - (10 + span * 3) * z, 1.6 + 0.7 * span, 0.9, 0); if (L) L.d = 1; }
          if (b.type === 'bell_tower' && b.built >= 1 && !b.ruin) pushLight('beacon', cx, cy - 78 * z, 2.2 + 0.4 * Math.sin(frameNo * 0.05), prestige, 0);
          else if (b.type === 'water_tower' && b.built >= 1 && !b.ruin && (((frameNo / 60) | 0) & 1) === 0) pushLight('blink', cx, cy - 64 * z, 1.5, 1, 0);
          else if (b.type === 'substation' && (v & SPR.NIGHT) && (frameNo % 180) < 6) pushLight('arc', cx, cy - 10 * z, 2.5, 1, 0);
          else if (b.type === 'generator' && b.data && fin(b.data.fuelDays, 0) > 0 && b.built >= 1) pushLight('glow', cx, cy - 6 * z, 1.5 + 0.2 * Math.sin(frameNo * 0.3), 0.85, 0);
          else if ((b.type === 'dining_hall' || b.type === 'poboy') && (v & SPR.NIGHT)) pushLight('pot', e.sx + 10 * z, e.sy - 8 * z, 1.6, 0.75 + 0.25 * ((frameNo >> 2) & 1), 0);
          else if (b.type === 'stadium' && (b.tier | 0) >= 2 && b.built >= 1 && !b.ruin && !b.blackout && game && game.home) {
            // six masts around the bowl, cones rotated toward the field
            const rx = (span) * 14 * z, ry = span * 7 * z, fy = cy - 18 * z;
            for (let m = 0; m < 6 && lightsN < LMAX; m++) { const ang = (m / 6) * Math.PI * 2 + 0.3; const mx = cx + Math.cos(ang) * rx, my = fy + Math.sin(ang) * ry - 40 * z; pushLight('mast', mx, my, 2.2, 0.9, Math.atan2(fy - my, cx - mx) - Math.PI / 2); }
            pushLight('glow', cx, fy, 7 * span * 0.25, 0.7, 0);
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
        if (L.kind === 'lamp') { drawRef(lg, ref, L.x, L.y + 10 * z, w * 3.2, h * 1.6, L.a * 0.55); drawRef(lg, ref, L.x, L.y, w, h, L.a); continue; }   // pool on the ground + the core
        if (L.kind === 'window') { drawRef(lg, ref, L.x, L.y + 16 * z, w * 2.2, h * 1.2, L.a * 0.35); drawRef(lg, ref, L.x, L.y, w, h, L.a); continue; }
        drawRef(lg, ref, L.x, L.y, w, h, L.a);
      }
      // fireflies: blink via sin on life; drawn from the pool (they are also 1-px world particles)
      const ff = lightRef('firefly');
      if (ff) { let cnt = 0; const capF = (z < 1 ? (PR.fireflyHalfCap || 300) : 2000); for (let i = 0; i < alive && cnt < capF; i++) { if (ptype[i] !== TID.firefly || pscreen[i]) continue; const a = 0.5 + 0.5 * Math.sin(plife[i] * 0.005 + i); if (a < 0.15) continue; const sx = (px[i] - cam.x) * z + vw / 2, sy = (py[i] - pz[i] - cam.y) * z + vh / 2; if (sx < -8 || sx > vw + 8 || sy < -8 || sy > vh + 8) continue; drawRef(lg, ff, sx, sy, ff.sw * 2.5 * z, ff.sh * 2.5 * z, a); cnt++; } }
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
    for (let k = 0; k < 10; k++) {
      const tx = x0 + r.int(spanX), ty = y0 + r.int(spanY); if (tx < 0 || ty < 0 || tx >= W || ty >= HGT) continue;
      const i = ty * W + tx; if (!isMarshy(state, i)) continue;
      wp.tx = tx; wp.ty = ty; wp.ox = (r.float() - 0.5) * 30; wp.oy = (r.float() - 0.5) * 10; wp.s = 2 + r.float() * 2.4; wp.ph = r.float() * 6.28; wp.ttl = 4000 + r.float() * 5000; return;
    }
    wp.ttl = 400;   // nothing marshy in view: retry soon
  }
  function passFog(state, g, view, alpha, dtMs) {
    const vw = view.vw, vh = view.vh, cam = camOf(state), z = cam.zoom || 1, wx = state.weather || {};
    const fog = clamp(fin(wx.fog, 0), 0, 1), s = readSky(state), nightA = nightAmount(state), storm = stormDarkness(state);
    const dt = clamp(fin(dtMs, 16.67), 0, 100), wind = clamp(fin(wx.wind, 0), 0, 1.5), windAngle = fin(wx.windAngle, 0);
    const spr = ensureFogSprite();
    // mist over water and marsh: strongest at dawn, present at night, never in heavy rain
    let mistA = 0;
    if (s.phase === SKY.DAWN) mistA = 1 - s.t * 0.65; else if (s.phase === SKY.NIGHT) mistA = 0.6; else if (s.phase === SKY.DUSK) mistA = 0.3 * s.t;
    mistA *= 1 - clamp(fin(wx.rainRate, 0), 0, 1); mistA *= 1 - storm;
    if (spr && mistA > 0.02 && state.tiles && state.tiles.type) {
      g.globalCompositeOperation = 'source-over';
      for (let k = 0; k < wisps.length; k++) {
        const wp = wisps[k]; wp.ttl -= dt;
        if (wp.ttl <= 0 || wp.tx < view.x0 - 2 || wp.tx > view.x1 + 2 || wp.ty < view.y0 - 2 || wp.ty > view.y1 + 2) respawnWisp(wp, state, view);
        if (wp.tx < 0) continue;
        wp.ox += Math.cos(windAngle) * (4 + 30 * wind) * dt / 1000; wp.ph += dt * 0.0006;
        const i = wp.ty * W + wp.tx, wpx = tileWorldX(wp.tx, wp.ty) + wp.ox, wpy = tileWorldY(wp.tx, wp.ty) + wp.oy - elevPx(state, i) - 4;
        const sx = (wpx - cam.x) * z + vw / 2, sy = (wpy - cam.y) * z + vh / 2;
        const sw = 128 * wp.s * z * (1 + 0.15 * Math.sin(wp.ph)), sh = 64 * wp.s * z * 0.5;
        if (sx < -sw || sx > vw + sw || sy < -sh || sy > vh + sh) continue;
        g.globalAlpha = mistA * 0.5 * Math.min(1, wp.ttl / 1200);
        g.drawImage(spr, sx - sw / 2, sy - sh / 2, sw, sh);
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
  function fireworks(state, scale) {
    state = state || stateLive(); if (!state) return;
    let at = null;
    if (Array.isArray(state.buildings)) for (const b of state.buildings) if (b && (b.type === 'stadium' || b.type === 'practice_field') && b.built >= 1) { at = footprintCenter(b); if (b.type === 'stadium') break; }
    if (!at && state.plot && state.plot.founders) at = { x: tileWorldX(state.plot.founders.tx + 1, state.plot.founders.ty + 1), y: tileWorldY(state.plot.founders.tx + 1, state.plot.founders.ty + 1), z: 0, spread: 20 };
    if (!at) return;
    const r = rng(), ox = (r.float() - 0.5) * 80 * scale, oy = (r.float() - 0.5) * 30 * scale, zz = at.z + 90 + r.float() * 40;
    emit('confetti', at.x + ox, at.y + oy, Math.round(30 * scale), { z: zz, vx: 0, vy: 0, vz: 40, spread: 6, jitter: 1, size: 3, life: 1500 });
    emit('sparks', at.x + ox, at.y + oy, Math.round(20 * scale), { z: zz, vz: 90, spread: 3, jitter: 1, size: r.float() < 0.5 ? 3 : 5, color: r.float() < 0.5 ? 0 : 8, life: 700 });
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; emit('sparks', at.x + ox, at.y + oy, 1, { z: zz, vx: Math.cos(a) * 110, vy: Math.sin(a) * 55, vz: 30, jitter: 0.2, size: 2, color: 14, life: 600 }); }
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
    on(EV.GAME_SCORE, (p) => { if (p.side !== 'home') return; fireworks(stateLive(), 1); R.shake(PR.shakeMs ? PR.shakeMs.score : 150); });
    on(EV.GAME_FINAL, (p) => { if (!p.won) return; burstsPending = 3; burstTimer = 1; goldFlash = 6; });
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
    on(EV.MILESTONE_EARNED, () => { const view = R.view; emit('confetti', view ? view.vw / 2 : 640, 30, 20, { screen: true, vz: 140, vx: 0, spread: 60, jitter: 1, size: 3, life: 1400 }); });
    on(EV.OBJECTIVE_COMPLETE, () => { const view = R.view; emit('sparks', view ? view.vw - 160 : 1100, 120, 8, { screen: true, vz: 120, spread: 20, jitter: 1, size: 2, life: 600 }); });
    on(EV.SETPIECE_START, (p) => { if (p.kind === 'landfall') { rainRamp = 0; stormPhase = SPH.OUTER; } });
    on(EV.SETPIECE_END, (p) => { if (p.kind === 'landfall') { stormPhase = -1; rainRamp = 0; } });
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
    alive = 0; overtop.clear(); boltN = 0; flashUntil = 0; boltUntil = 0; godRayUntil = -1; goldFlash = 0; burstsPending = 0; rainRamp = 0; rainSeeded = false; lightsN = 0;
    for (const wp of wisps) { wp.tx = -1; wp.ttl = 0; } for (const b of fogBlobs) b.r = 1;
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

  // Passes (same-name registrations replace render's fallbacks for 'tint'; overlays/hud stay render's)
  R.registerPass('weather', function (s, g, v, a, dt) { try { passWeather(s, g, v, a, dt); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 5);
  R.registerPass('tint', function (s, g, v) { try { passTint(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 6);
  R.registerPass('lights', function (s, g, v) { try { passLights(s, g, v); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 7);
  R.registerPass('fog', function (s, g, v, a, dt) { try { passFog(s, g, v, a, dt); } finally { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } }, 8);
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
      notes.push('render_fx: pool/rain/bands/tint/cone ok');
      return { ok: true, notes: notes.join(' ') };
    } catch (e) { return { ok: false, notes: 'render_fx: ' + (e && e.message) }; }
    finally { alive = saved; cap = savedCap; }
  });
})();
