'use strict';
// ============================================================================
// BAYOU STATE — audio.js (module 17) → BSU.audio
// Owner: nothing in BSU.state (the audio graph lives in this closure; the
// mute/volume choice is state.ui.settings, owned and persisted by ui).
// Implements: GDD §13 (every voice's synthesis recipe), §10.1 (the ambience
// starts on the charter click), §11.8 (`M` mute), §6.2 (wind bed, roar, storm
// drone), §8 (whistle, brass sting, crowd, sad trombone, zydeco), §12.5 (thunder
// delayed by distance), §6.3 (growl), §6.4 (whine ≥ .5); ARCHITECTURE §5.11,
// §9.2, §9.5, §10.1, §10.5, §11.1, §11.2 #5.
//
// All sound is WebAudio synthesis: oscillators, a 2-s noise buffer, biquad
// filters and gain envelopes. No files, no CDNs. The AudioContext is created
// lazily by unlock() on the first user gesture and never at load; every public
// function is a safe no-op without a context (headless: the DOM stub omits
// AudioContext on purpose). Zero DOM / timer / AudioContext access at
// definition time.
//
// Numbers the GDD/brief state but BSU.params does not carry (local const L):
// crossfade 2 s, duck ramps 30 ms / 400 ms, distance gain 1 − d/30 floored at
// .15, stereo pan (tx − camTx)/20, sampling 100 ms, mosquito sampling 500 ms,
// pump hum radius 10 / cap 3, fogger radius 8, lap radius 8, bullfrog zoom 2
// within 6 tiles every 8–20 s, owl every 40–90 s, layer teardown after 4 s of
// silence, every synthesis frequency / duration of GDD §13 (table F below).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.audio = BSU.audio || {});
  const P = BSU.params.audio;                 // voices 12, ambienceDb −12, duckDb −6, thunderDelay [0.3, 2], zydecoBpm 120, defaultVolume .5
  const SKY = BSU.SKY, SP = BSU.STORM_PHASE, FLAG = BSU.FLAG, T = BSU.T;
  const clamp = BSU.clamp, lerp = BSU.lerp;

  // ---------------------------------------------------------------------------
  // Local constants (GDD values not carried by params; see INTEGRATION_NOTES.md)
  // ---------------------------------------------------------------------------
  const L = Object.freeze({
    crossfadeTau: 0.6,        // setTargetAtTime time constant: ~2 s to settle (3τ ≈ 1.8 s)
    fastTau: 0.25,            // rain / wind / pump follow the sim faster
    duckIn: 0.03, duckOut: 0.4,
    distDiv: 30, distFloor: 0.15, panDiv: 20,
    sampleMs: 100, mosqEvery: 5,          // 100 ms sampler; mosquito every 5th sample (500 ms)
    pumpRadius: 10, pumpCap: 3, foggerRadius: 8, lapRadius: 8, bullfrogRadius: 6, bullfrogZoom: 2,
    owlGap: [40, 90], bullfrogGap: [8, 20],
    layerIdleSec: 4,          // a silent layer is torn down after this (keeps the live node count low)
    lookahead: 0.35,          // music scheduler lookahead (s)
    bigIncome: 10000,         // econ:income ≥ $10k → 'money'
    minRamp: 0.005            // every envelope has ≥ 5 ms attack and release
  });

  // Synthesis numbers (GDD §13 / brief §4). Frequencies in Hz, times in seconds.
  const F = Object.freeze({
    bells: [329.63, 392.0, 440.0, 659.26],           // E4 G4 A4 E5
    bellPartials: [1, 2.4, 3.1, 4.7], bellPartialDb: [0, -6, -9, -12], bellGap: 0.5, bellDecay: [3, 2.6, 2.3, 2],
    sting: [392, 494, 587, 784, 587],                // G4 B4 D5 G5 D5
    stingMinor: [392, 466, 587, 784, 587],           // G4 Bb4 D5 G5 D5
    stingNote: 0.12, stingDetune: 7, snareHz: 16, snareLen: 0.4,
    money: [660, 880, 1100], moneyNote: 0.06,
    milestone: [523, 659, 784], milestoneDecay: 1.2, reverbLen: 0.4,
    notify: [880, 660], notifyDanger: [440, 330], notifyNote: 0.08,
    place: [300, 200], placeLen: 0.12, tickHz: 1200, tickLen: 0.015, invalidHz: 110, invalidLen: 0.15,
    hoverLen: 0.002, demolishCut: 800, demolishLen: 0.3, growlHz: 60, growlFm: 20, growlRate: 8, growlLen: 0.8,
    splashHz: 1000, splashLen: 0.2, coin: [1320, 1760], coinLen: [0.08, 0.06], chimeHz: 1047, chimeLen: 0.4,
    whistleHz: 2200, whistleTrill: 30, whistleLen: 0.5,
    roarAttack: 0.8, roarRelease: 2, roarBand: 400, groanSweep: [800, 200], groanLen: 1.2,
    tromboneHz: [220, 110], tromboneLen: 1.2, tromboneCut: 600,
    thunderLen: 2, thunderSweep: [2000, 120], thumpHz: 38, thumpLen: 0.4,
    hissHz: 1500, hissLen: 1.2, breachLen: 2, gustLen: 2,
    frogs: [190, 260, 340, 410], frogQ: 8, frogRate: [1.5, 4],
    cicadaHz: 6000, cicadaQ: 1.2, cicadaTrem: 30,
    cricketHz: 4200, cricketChirp: 12,
    owl: [400, 300], owlLen: 0.6, bullfrogHz: 90, bullfrogLen: 0.3,
    whineHz: 600, whineVib: 6, whineDepth: 15,
    lapHz: 55, lapGain: 0.04, lapCut: 400, lapPuff: 0.4,
    rainCut: [300, 600], rainGain: 0.25,
    windBand: [200, 800], windLfo: 0.2, windGain: [0.05, 0.35],
    droneHz: 55, droneGain: 0.08, droneLfo: 0.2,
    pumpHz: 60, pumpCut: 200, pumpGain: 0.05, foggerHz: 110, foggerGain: 0.03,
    zydecoRoot: 392,          // G4 for the accordion riff; bass an octave × 2 below
    accordionBand: 1200, accordionVib: 5
  });

  // Storm-phase wind floor and drone (GDD §6.2 timeline; OUTER wind bed up, WALL/LANDFALL/BACK drone on)
  const STORM_WIND = Object.freeze({ 0: 0.6, 1: 0.9, 2: 0.9, 3: 0.1, 4: 0.7, 5: 0.3 });
  const STORM_DRONE = Object.freeze({ 0: false, 1: true, 2: true, 3: false, 4: true, 5: false });
  const DUCKERS = new Set(['sting', 'stingMinor', 'milestone', 'thunder', 'peal']);
  const DROPPABLE = new Set(['hover', 'tick']);

  // ---------------------------------------------------------------------------
  // Private state (closure; never on the module object, never in BSU.state)
  // ---------------------------------------------------------------------------
  let ctx = null;                 // AudioContext, created by unlock()
  let master = null, ambBus = null, sfxBus = null, musicBus = null;
  let noiseBuf = null, reverbBuf = null, pulseCurve = null, hasPanner = false;
  const settings = { volume: P.defaultVolume, muted: false };   // pending until unlock; mirrored from ui.settings
  const voices = [];              // live one-shot chains, oldest first
  const layers = {};              // name → layer {def, target, applied, nodes, srcs, gain, silentSince, ...}
  let root = null;                // the state root init/reset bound (fallback for listeners; BSU.state preferred)
  let acc = 0, sampleNo = 0;      // update() accumulator
  let lastPhase = -1, lastSeason = '', middayDone = false;
  let windFloor = 0, droneOn = false;
  let owlNext = 0, bullfrogNext = 0, mosqLevel = 0;
  let quiet = false;              // selfTest: suppress the ui settings mirror write
  const music = { name: null, on: false, bars: 0, bar: 0, nextBar: 0, level: 0 };

  // ---------------------------------------------------------------------------
  // Pure helpers (also used by selfTest)
  // ---------------------------------------------------------------------------
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
  /** decibels → linear gain */
  M.dB = function (x) { return Math.pow(10, num(x, 0) / 20); };
  /** distance gain from the camera centre: clamp(1 − d/30, .15, 1) */
  M.distGain = function (d) { return clamp(1 - num(d, 0) / L.distDiv, L.distFloor, 1); };
  /** the bells motif (E4 G4 A4 E5) */
  M.BELLS = F.bells.slice();
  /** The one-shot names play() understands (the brief's list + hiss, groan, stingMinor, gust). */
  M.NAMES = Object.freeze(['place', 'tick', 'invalid', 'money', 'milestone', 'notify', 'hover', 'demolish', 'growl', 'splash',
    'sting', 'whistle', 'roar', 'trombone', 'bells', 'peal', 'thunder', 'chime', 'coin', 'hiss', 'groan', 'stingMinor', 'gust']);

  /**
   * Ambience target table (pure). info = {phase, season, ecology, heat, rainRate, wind, windFloor, drone,
   * nearWater, mosq, pumps, fogger}; missing fields default to silence. Returns gain targets per layer.
   */
  M.targets = function (info) {
    const o = info || {};
    const phase = num(o.phase, -1), season = o.season || '', eco = clamp(num(o.ecology, 0), 0, 100), heat = num(o.heat, 55);
    const frogBase = eco < 30 ? 0 : 0.15 + 0.35 * eco / 100;
    const frogs = phase === SKY.NIGHT ? frogBase : (phase === SKY.DUSK ? frogBase / 2 : 0);
    const cicadas = (season === 'summer' && phase === SKY.DAY) ? 0.3 + 0.5 * clamp((heat - 85) / 20, 0, 1) : 0;
    const crickets = (phase === SKY.NIGHT && (season === 'spring' || season === 'fall')) ? 0.15 : 0;
    const rainRate = clamp(num(o.rainRate, 0), 0, 1);
    const wind = clamp(Math.max(num(o.wind, 0), num(o.windFloor, 0)), 0, 1);
    return {
      frogs: frogs, cicadas: cicadas, crickets: crickets,
      frogRate: F.frogRate[0] + (F.frogRate[1] - F.frogRate[0]) * eco / 100,
      rain: F.rainGain * rainRate, rainCut: F.rainCut[0] + F.rainCut[1] * rainRate,
      wind: F.windGain[0] + F.windGain[1] * wind,
      drone: o.drone ? 1 : 0,
      lap: o.nearWater ? 1 : 0,
      whine: 0.06 * clamp((num(o.mosq, 0) - 0.5) / 0.5, 0, 1),
      pump: F.pumpGain * Math.min(L.pumpCap, Math.max(0, num(o.pumps, 0) | 0)),
      fogger: o.fogger ? F.foggerGain : 0
    };
  };

  /** the camera centre as a tile {tx, ty, zoom} (render.camera when live, else state.ui.camera; `camera` overrides both) */
  M.camTile = function (state, camera) {
    let cam = camera || (BSU.render && BSU.render.camera) || (state && state.ui && state.ui.camera) || null;
    if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y)) cam = { x: 0, y: 0, zoom: 1 };
    const tx = clamp(Math.round((cam.x / 32 + cam.y / 16) / 2), 0, 63);
    const ty = clamp(Math.round((cam.y / 16 - cam.x / 32) / 2), 0, 63);
    return { tx: tx, ty: ty, zoom: num(cam.zoom, 1) };
  };

  function cur() { return BSU.state || root; }
  function safe(where, fn, dflt) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { BSU.error('audio', where, e); return dflt; }
    };
  }

  // ---------------------------------------------------------------------------
  // Graph primitives (only ever called with a context)
  // ---------------------------------------------------------------------------
  function now() { return ctx.currentTime; }
  function setNow(param, v) { try { param.setValueAtTime(v, now()); } catch (e) { param.value = v; } }
  function target(param, v, tau) { try { param.setTargetAtTime(v, now(), tau); } catch (e) { param.value = v; } }

  /** a node chain: every node is disconnected when its last source ends (no growth over time) */
  function chain(dest) {
    const c = { nodes: [], srcs: [], out: ctx.createGain(), pan: null, done: false, end: 0, pending: 0, name: '' };
    c.out.connect(dest);
    return c;
  }
  function node(c, n) { c.nodes.push(n); return n; }
  function osc(c, type, freq, t0, t1) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(Math.max(1, freq), t0);
    return src(c, o, t0, t1);
  }
  function noise(c, t0, t1) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    return src(c, s, t0, t1);
  }
  function src(c, s, t0, t1) {
    s.start(t0); s.stop(t1 + 0.02);
    c.srcs.push(s); c.end = Math.max(c.end, t1);
    return s;
  }
  function filter(c, type, freq, q) {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q !== undefined) f.Q.value = q;
    return node(c, f);
  }
  function gain(c, v) { const g = ctx.createGain(); g.gain.value = v; return node(c, g); }
  /** linear envelope: 0 → peak over attack, hold, → 0 over release; returns the gain node */
  function env(c, t0, attack, peak, hold, release) {
    const g = gain(c, 0);
    const a = Math.max(L.minRamp, attack), r = Math.max(L.minRamp, release);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setValueAtTime(peak, t0 + a + Math.max(0, hold));
    g.gain.linearRampToValueAtTime(0, t0 + a + Math.max(0, hold) + r);
    return g;
  }
  /** exponential decay envelope (5 ms attack), peak → ~0 over dur */
  function decay(c, t0, peak, dur) {
    const g = gain(c, 0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + L.minRamp);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + Math.max(L.minRamp * 2, dur));
    g.gain.linearRampToValueAtTime(0, t0 + Math.max(L.minRamp * 2, dur) + L.minRamp);
    return g;
  }
  function dispose(c) {
    if (c.done) return; c.done = true;
    for (const s of c.srcs) { try { s.onended = null; s.disconnect(); } catch (e) { /* already gone */ } }
    for (const n of c.nodes) { try { n.disconnect(); } catch (e) { /* */ } }
    try { c.out.disconnect(); } catch (e) { /* */ }
    if (c.pan) { try { c.pan.disconnect(); } catch (e) { /* */ } }
    const k = voices.indexOf(c); if (k >= 0) voices.splice(k, 1);
  }
  function commit(c) {
    c.pending = c.srcs.length;
    if (!c.pending) { dispose(c); return; }
    for (const s of c.srcs) s.onended = function () { if (--c.pending <= 0) dispose(c); };
  }
  /** fast fade-out and stop (voice stealing, reset) */
  function kill(c) {
    if (c.done) return;
    const t = now();
    try { c.out.gain.cancelScheduledValues(t); c.out.gain.setValueAtTime(c.out.gain.value, t); c.out.gain.linearRampToValueAtTime(0, t + 0.01); } catch (e) { /* */ }
    for (const s of c.srcs) { try { s.stop(t + 0.015); } catch (e) { /* not started / already stopped */ } }
  }
  /** pulse curve for the chirp gates: y = max(0, x)^6 (short, click-free pulses on the LFO peaks) */
  function makePulseCurve() {
    const n = 256, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = x > 0 ? Math.pow(x, 6) : 0; }
    return cv;
  }
  /** an LFO through the pulse curve driving `param` (0..1 pulses); rate in Hz */
  function chirpGate(c, param, rate, t0, t1) {
    const lfo = osc(c, 'sine', rate, t0, t1);
    const sh = ctx.createWaveShaper(); sh.curve = pulseCurve; node(c, sh);
    lfo.connect(sh); sh.connect(param);
    return lfo;
  }
  /** an LFO (sine) scaled by depth into `param` */
  function lfoInto(c, param, rate, depth, t0, t1) {
    const lfo = osc(c, 'sine', rate, t0, t1);
    const g = gain(c, depth);
    lfo.connect(g); g.connect(param);
    return lfo;
  }

  // ---------------------------------------------------------------------------
  // One-shot recipes: M.recipes[name](c, t, o) builds the voice into chain c at time t (opts o)
  // ---------------------------------------------------------------------------
  const R = (M.recipes = {});

  R.place = function (c, t) {
    const o = osc(c, 'square', F.place[0], t, t + F.placeLen);
    o.frequency.exponentialRampToValueAtTime(F.place[1], t + F.placeLen);
    const lp = filter(c, 'lowpass', 1200);
    o.connect(lp); lp.connect(env(c, t, 0.005, 0.35, F.placeLen - 0.04, 0.03)).connect(c.out);
  };
  R.tick = function (c, t) {
    const o = osc(c, 'sine', F.tickHz, t, t + F.tickLen + 0.01);
    o.connect(env(c, t, 0.005, 0.25, F.tickLen - 0.005, 0.005)).connect(c.out);
  };
  R.invalid = function (c, t) {
    const o = osc(c, 'square', F.invalidHz, t, t + F.invalidLen);
    const lp = filter(c, 'lowpass', 600);
    o.connect(lp); lp.connect(env(c, t, 0.005, 0.3, F.invalidLen - 0.03, 0.02)).connect(c.out);
  };
  R.money = function (c, t) {
    for (let k = 0; k < F.money.length; k++) {
      const t0 = t + k * F.moneyNote;
      const o = osc(c, 'sine', F.money[k], t0, t0 + F.moneyNote + 0.02);
      o.connect(env(c, t0, 0.005, 0.3, F.moneyNote - 0.02, 0.03)).connect(c.out);
    }
  };
  R.milestone = function (c, t) {
    const dry = gain(c, 0.5), wet = gain(c, 0.5);
    let conv = null;
    try { conv = ctx.createConvolver(); conv.buffer = reverbBuf; node(c, conv); } catch (e) { conv = null; }
    for (let k = 0; k < F.milestone.length; k++) {
      const o = osc(c, 'triangle', F.milestone[k], t + k * 0.03, t + F.milestoneDecay + 0.1);
      const g = decay(c, t + k * 0.03, 0.28, F.milestoneDecay);
      o.connect(g); g.connect(dry); if (conv) g.connect(conv);
    }
    dry.connect(c.out);
    if (conv) { conv.connect(wet); wet.connect(c.out); }
  };
  R.notify = function (c, t, o) {
    const tones = o && o.danger ? F.notifyDanger : F.notify;
    for (let k = 0; k < 2; k++) {
      const t0 = t + k * F.notifyNote;
      const s = osc(c, 'sine', tones[k], t0, t0 + F.notifyNote + 0.03);
      s.connect(env(c, t0, 0.008, 0.25, F.notifyNote - 0.03, 0.04)).connect(c.out);
    }
  };
  R.hover = function (c, t) {
    const n = noise(c, t, t + F.hoverLen + 0.01);
    const hp = filter(c, 'highpass', 3000);
    n.connect(hp); hp.connect(env(c, t, L.minRamp, 0.12, 0, L.minRamp)).connect(c.out);
  };
  R.demolish = function (c, t) {
    const n = noise(c, t, t + F.demolishLen);
    const lp = filter(c, 'lowpass', F.demolishCut);
    lp.frequency.setValueAtTime(F.demolishCut, t); lp.frequency.exponentialRampToValueAtTime(200, t + F.demolishLen);
    n.connect(lp); lp.connect(decay(c, t, 0.5, F.demolishLen)).connect(c.out);
  };
  R.growl = function (c, t) {
    const o = osc(c, 'sawtooth', F.growlHz, t, t + F.growlLen);
    const R2 = BSU.rng.fx;
    lfoInto(c, o.frequency, F.growlRate * (0.75 + 0.5 * R2.float()), F.growlFm * (0.7 + 0.6 * R2.float()), t, t + F.growlLen);
    const lp = filter(c, 'lowpass', 400, 2);
    o.connect(lp); lp.connect(env(c, t, 0.05, 0.4, F.growlLen - 0.35, 0.3)).connect(c.out);
  };
  R.splash = function (c, t) {
    const n = noise(c, t, t + F.splashLen);
    const bp = filter(c, 'bandpass', F.splashHz, 1.5);
    n.connect(bp); bp.connect(decay(c, t, 0.4, F.splashLen)).connect(c.out);
  };
  R.hiss = function (c, t, o) {
    const breach = !!(o && o.breach);
    const len = breach ? F.breachLen : F.hissLen;
    const n = noise(c, t, t + len);
    const hp = filter(c, 'highpass', F.hissHz);
    n.connect(hp); hp.connect(env(c, t, 0.04, breach ? 0.7 : 0.35, 0.15, len - 0.19)).connect(c.out);
  };
  R.coin = function (c, t) {
    const a = osc(c, 'sine', F.coin[0], t, t + F.coinLen[0] + 0.02);
    a.connect(env(c, t, 0.005, 0.25, F.coinLen[0] - 0.03, 0.03)).connect(c.out);
    const t1 = t + 0.04;
    const b = osc(c, 'sine', F.coin[1], t1, t1 + F.coinLen[1] + 0.02);
    b.connect(env(c, t1, 0.005, 0.2, F.coinLen[1] - 0.03, 0.03)).connect(c.out);
  };
  R.chime = function (c, t) {
    const o = osc(c, 'triangle', F.chimeHz, t, t + F.chimeLen + 0.02);
    o.connect(decay(c, t, 0.3, F.chimeLen)).connect(c.out);
  };
  /** 4-note bell motif; speed 1 (bells) or 3 (peal); partials at ×1/2.4/3.1/4.7 at 0/−6/−9/−12 dB */
  function bellMotif(c, t, speed, reps) {
    const gap = F.bellGap / speed;
    let idx = 0;
    for (let r = 0; r < reps; r++) {
      for (let k = 0; k < F.bells.length; k++, idx++) {
        const t0 = t + idx * gap;
        for (let p = 0; p < F.bellPartials.length; p++) {
          const dur = F.bellDecay[p] / Math.sqrt(speed);
          const o = osc(c, 'sine', F.bells[k] * F.bellPartials[p], t0, t0 + dur + 0.02);
          o.connect(decay(c, t0, 0.22 * M.dB(F.bellPartialDb[p]), dur)).connect(c.out);
        }
      }
    }
  }
  R.bells = function (c, t) { bellMotif(c, t, 1, 1); };
  R.peal = function (c, t) { bellMotif(c, t, 3, 3); };
  R.whistle = function (c, t) {
    const o = osc(c, 'square', F.whistleHz, t, t + F.whistleLen);
    const trem = gain(c, 0.5);
    lfoInto(c, trem.gain, F.whistleTrill, 0.5, t, t + F.whistleLen);
    const bp = filter(c, 'bandpass', F.whistleHz, 4);
    o.connect(bp); bp.connect(trem); trem.connect(env(c, t, 0.02, 0.25, F.whistleLen - 0.1, 0.08)).connect(c.out);
  };
  /** pink-ish noise chain: white → lowpass 1 kHz → highpass 150 (−3 dB/oct approximation) */
  function pink(c, t0, t1) {
    const n = noise(c, t0, t1);
    const lp = filter(c, 'lowpass', 1000, 0.5), hp = filter(c, 'highpass', 150, 0.5);
    n.connect(lp); lp.connect(hp);
    return hp;
  }
  R.roar = function (c, t) {
    const len = F.roarAttack + 0.4 + F.roarRelease;
    const p = pink(c, t, t + len);
    const bp = filter(c, 'bandpass', F.roarBand, 0.8);
    p.connect(bp); bp.connect(env(c, t, F.roarAttack, 0.9, 0.4, F.roarRelease)).connect(c.out);
  };
  R.groan = function (c, t) {
    const len = F.groanLen + 0.8;
    const p = pink(c, t, t + len);
    const bp = filter(c, 'bandpass', F.groanSweep[0], 1.2);
    bp.frequency.setValueAtTime(F.groanSweep[0], t); bp.frequency.exponentialRampToValueAtTime(F.groanSweep[1], t + F.groanLen);
    p.connect(bp); bp.connect(env(c, t, 0.3, 0.7, F.groanLen - 0.3, 0.8)).connect(c.out);
  };
  R.gust = function (c, t) {
    const n = noise(c, t, t + F.gustLen);
    const bp = filter(c, 'bandpass', 300, 0.7);
    bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(700, t + F.gustLen * 0.5); bp.frequency.linearRampToValueAtTime(250, t + F.gustLen);
    n.connect(bp); bp.connect(env(c, t, 0.6, 0.6, 0.4, F.gustLen - 1)).connect(c.out);
  };
  /** brass sting: 3 detuned sawtooth horns on a 5-note fanfare over a 16-Hz snare roll */
  function fanfare(c, t, notes) {
    const total = notes.length * F.stingNote + 0.35;
    const lp = filter(c, 'lowpass', 2500, 0.7);
    for (let h = 0; h < 3; h++) {
      const o = osc(c, 'sawtooth', notes[0], t, t + total);
      o.detune.value = (h - 1) * F.stingDetune;
      for (let k = 1; k < notes.length; k++) o.frequency.setValueAtTime(notes[k], t + k * F.stingNote);
      o.connect(lp);
    }
    const hornEnv = gain(c, 0);
    hornEnv.gain.setValueAtTime(0, t);
    hornEnv.gain.linearRampToValueAtTime(0.22, t + 0.02);
    for (let k = 1; k < notes.length; k++) {   // a tongued re-attack on every note
      hornEnv.gain.setValueAtTime(0.22, t + k * F.stingNote - 0.012);
      hornEnv.gain.linearRampToValueAtTime(0.08, t + k * F.stingNote);
      hornEnv.gain.linearRampToValueAtTime(0.22, t + k * F.stingNote + 0.02);
    }
    hornEnv.gain.setValueAtTime(0.22, t + notes.length * F.stingNote);
    hornEnv.gain.linearRampToValueAtTime(0, t + total);
    lp.connect(hornEnv); hornEnv.connect(c.out);
    // snare roll
    const n = noise(c, t, t + F.snareLen + 0.05);
    const bp = filter(c, 'bandpass', 1800, 1);
    const sn = gain(c, 0);
    const step = 1 / F.snareHz, hits = Math.floor(F.snareLen * F.snareHz);
    sn.gain.setValueAtTime(0, t);
    for (let k = 0; k < hits; k++) {
      const t0 = t + k * step;
      sn.gain.linearRampToValueAtTime(0.4, t0 + 0.005);
      sn.gain.linearRampToValueAtTime(0.03, t0 + step - 0.005);
    }
    sn.gain.linearRampToValueAtTime(0, t + F.snareLen + 0.02);
    n.connect(bp); bp.connect(sn); sn.connect(c.out);
  }
  R.sting = function (c, t) { fanfare(c, t, F.sting); };
  R.stingMinor = function (c, t) { fanfare(c, t, F.stingMinor); };
  R.trombone = function (c, t) {
    const o = osc(c, 'sawtooth', F.tromboneHz[0], t, t + F.tromboneLen + 0.1);
    o.frequency.exponentialRampToValueAtTime(F.tromboneHz[1], t + F.tromboneLen);
    const lp = filter(c, 'lowpass', F.tromboneCut, 1);
    o.connect(lp); lp.connect(env(c, t, 0.06, 0.3, F.tromboneLen - 0.3, 0.3)).connect(c.out);
  };
  R.thunder = function (c, t) {
    const n = noise(c, t, t + F.thunderLen + 0.1);
    const lp = filter(c, 'lowpass', F.thunderSweep[0], 0.8);
    lp.frequency.setValueAtTime(F.thunderSweep[0], t); lp.frequency.exponentialRampToValueAtTime(F.thunderSweep[1], t + F.thunderLen);
    n.connect(lp); lp.connect(decay(c, t, 0.9, F.thunderLen)).connect(c.out);
    const thump = osc(c, 'sine', F.thumpHz, t, t + F.thumpLen + 0.05);
    thump.connect(env(c, t, 0.01, 0.6, 0.1, F.thumpLen - 0.11)).connect(c.out);
  };

  // ---------------------------------------------------------------------------
  // Voice management: cap, distance gain, stereo pan, ducking
  // ---------------------------------------------------------------------------
  function allocVoice(name) {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].done) voices.splice(i, 1);
    if (voices.length < P.voices) return true;
    if (DROPPABLE.has(name)) return false;
    kill(voices[0]); dispose(voices[0]);   // steal the oldest one-shot (ambience layers and music are not voices)
    return true;
  }
  function newVoice(name, opts) {
    const c = chain(sfxBus); c.name = name;
    let g = 1;
    if (opts && Number.isFinite(opts.tile) && opts.tile >= 0 && opts.tile < 4096) {
      const cam = M.camTile(cur());
      const tx = opts.tile & 63, ty = opts.tile >> 6;
      g = M.distGain(BSU.chebyshev(tx, ty, cam.tx, cam.ty));
      if (hasPanner) {
        try {
          const pan = ctx.createStereoPanner();
          pan.pan.value = clamp((tx - cam.tx) / L.panDiv, -1, 1);
          c.out.disconnect(); c.out.connect(pan); pan.connect(sfxBus); c.pan = pan;
        } catch (e) { hasPanner = false; }
      }
    }
    if (opts && Number.isFinite(opts.gain)) g *= clamp(opts.gain, 0, 2);
    c.out.gain.value = g;
    return c;
  }
  function duck(t0, dur) {
    const lo = M.dB(P.ambienceDb + P.duckDb), hi = M.dB(P.ambienceDb);
    const g = ambBus.gain;
    try {
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(lo, t0 + L.duckIn);
      g.setValueAtTime(lo, t0 + dur);
      g.linearRampToValueAtTime(hi, t0 + dur + L.duckOut);
    } catch (e) { /* param not automatable */ }
  }

  // ---------------------------------------------------------------------------
  // Ambience layers: looping synths built lazily when their target rises above 0
  // and torn down after L.layerIdleSec of silence; gains lerp with setTargetAtTime
  // ---------------------------------------------------------------------------
  const LAYERS = {
    frogs: { tau: L.crossfadeTau, build: function (ly, t) {   // 3 filtered sawtooth chirp voices, gated at 1.5–4 Hz
      ly.rates = [];
      for (let k = 0; k < 3; k++) {
        const f = F.frogs[k];
        const o = osc(ly, 'sawtooth', f, t, 1e9);
        const g = gain(ly, 0);
        const vbp = filter(ly, 'bandpass', f, F.frogQ);
        ly.rates.push(chirpGate(ly, g.gain, F.frogRate[0] + k * 0.37, t, 1e9));
        o.connect(vbp); vbp.connect(g); g.connect(ly.gain);
      }
    } },
    cicadas: { tau: L.crossfadeTau, build: function (ly, t) {   // band-passed noise 5–7 kHz with a 30 Hz tremolo
      const n = noise(ly, t, 1e9);
      const bp = filter(ly, 'bandpass', F.cicadaHz, F.cicadaQ);
      const trem = gain(ly, 0.5);
      lfoInto(ly, trem.gain, F.cicadaTrem, 0.5, t, 1e9);
      n.connect(bp); bp.connect(trem); trem.connect(ly.gain);
    } },
    crickets: { tau: L.crossfadeTau, build: function (ly, t) {   // 4.2 kHz sine with a 12 Hz chirp gate
      const o = osc(ly, 'sine', F.cricketHz, t, 1e9);
      const g = gain(ly, 0);
      chirpGate(ly, g.gain, F.cricketChirp, t, 1e9);
      o.connect(g); g.connect(ly.gain);
    } },
    whine: { tau: L.crossfadeTau, build: function (ly, t) {   // 600 Hz sine, 6 Hz vibrato ±15 Hz
      const o = osc(ly, 'sine', F.whineHz, t, 1e9);
      lfoInto(ly, o.frequency, F.whineVib, F.whineDepth, t, 1e9);
      o.connect(ly.gain);
    } },
    lap: { tau: L.crossfadeTau, build: function (ly, t) {   // 55 Hz sine .04 + lowpassed noise puffs gated at 0.4 Hz
      const o = osc(ly, 'sine', F.lapHz, t, 1e9);
      const og = gain(ly, F.lapGain); o.connect(og); og.connect(ly.gain);
      const n = noise(ly, t, 1e9);
      const lp = filter(ly, 'lowpass', F.lapCut, 0.7);
      const puff = gain(ly, 0);
      chirpGate(ly, puff.gain, F.lapPuff, t, 1e9);
      const pg = gain(ly, 0.12);
      n.connect(lp); lp.connect(puff); puff.connect(pg); pg.connect(ly.gain);
    } },
    rain: { tau: L.fastTau, build: function (ly, t) {   // brown-ish noise: white → 1-pole-ish lowpass 300–900 Hz
      const n = noise(ly, t, 1e9);
      ly.cut = filter(ly, 'lowpass', F.rainCut[0], 0.3);
      n.connect(ly.cut); ly.cut.connect(ly.gain);
    } },
    wind: { tau: L.fastTau, build: function (ly, t) {   // bandpass 200–800 Hz with a 0.2 Hz LFO on the cutoff
      const n = noise(ly, t, 1e9);
      const bp = filter(ly, 'bandpass', (F.windBand[0] + F.windBand[1]) / 2, 0.6);
      lfoInto(ly, bp.frequency, F.windLfo, (F.windBand[1] - F.windBand[0]) / 2 - 50, t, 1e9);
      n.connect(bp); bp.connect(ly.gain);
    } },
    drone: { tau: L.crossfadeTau, build: function (ly, t) {   // 55 Hz sine, 0.2 Hz LFO on gain .08
      const o = osc(ly, 'sine', F.droneHz, t, 1e9);
      const g = gain(ly, F.droneGain);
      lfoInto(ly, g.gain, F.droneLfo, F.droneGain * 0.4, t, 1e9);
      o.connect(g); g.connect(ly.gain);
    } },
    pump: { tau: L.fastTau, build: function (ly, t) {   // 60 Hz sawtooth → lowpass 200
      const o = osc(ly, 'sawtooth', F.pumpHz, t, 1e9);
      const lp = filter(ly, 'lowpass', F.pumpCut, 1);
      o.connect(lp); lp.connect(ly.gain);
    } },
    fogger: { tau: L.fastTau, build: function (ly, t) {   // 110 Hz square motor buzz
      const o = osc(ly, 'square', F.foggerHz, t, 1e9);
      const lp = filter(ly, 'lowpass', 900, 0.8);
      o.connect(lp); lp.connect(ly.gain);
    } }
  };
  function layerOf(name) {
    let ly = layers[name];
    if (!ly) ly = layers[name] = { name: name, def: LAYERS[name], target: 0, applied: 0, nodes: [], srcs: [], gain: null, built: false, silentSince: 0, rates: null, cut: null };
    return ly;
  }
  function buildLayer(ly) {
    if (ly.built) return;
    ly.gain = ctx.createGain(); ly.gain.gain.value = 0; ly.gain.connect(ambBus);
    ly.nodes = []; ly.srcs = [];
    ly.def.build(ly, now());
    ly.built = true; ly.applied = 0;
  }
  function dropLayer(ly) {
    if (!ly.built) return;
    for (const s of ly.srcs) { try { s.stop(now() + 0.05); s.disconnect(); } catch (e) { /* */ } }
    for (const n of ly.nodes) { try { n.disconnect(); } catch (e) { /* */ } }
    try { ly.gain.disconnect(); } catch (e) { /* */ }
    ly.built = false; ly.nodes = []; ly.srcs = []; ly.gain = null; ly.rates = null; ly.cut = null; ly.applied = 0;
  }
  /** push every changed target into the graph (2-s crossfades), build/tear down layers */
  function applyTargets(t) {
    for (const name in LAYERS) {
      const ly = layerOf(name);
      const want = clamp(num(ly.target, 0), 0, 1);
      if (want > 0) {
        if (!ly.built) buildLayer(ly);
        ly.silentSince = 0;
        if (Math.abs(want - ly.applied) > 1e-4) { target(ly.gain.gain, want, ly.def.tau); ly.applied = want; }
      } else if (ly.built) {
        if (ly.applied !== 0) { target(ly.gain.gain, 0, ly.def.tau); ly.applied = 0; }
        if (!ly.silentSince) ly.silentSince = t;
        else if (t - ly.silentSince > L.layerIdleSec) dropLayer(ly);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Music: zydeco riff in G at 120 BPM (Tier 2 #5) and the Mardi Gras variant
  // ---------------------------------------------------------------------------
  const RIFF = [   // two bars of eighths, semitones above G4 (−1 = rest)
    [0, 4, 7, 4, 0, 2, 4, 7],
    [9, 7, 4, 2, 0, 2, 4, -1]
  ];
  const CHORDS = [0, 5, 7, 0];                    // I IV V I (semitones above G)
  const RUB_ACCENT = [0, 0, 1, 0, 0, 1, 1, 0];    // second-line accents on the eighths
  const SNARE_HITS = [0, 1, 0, 1, 0, 1, 1, 0];    // second-line snare (Mardi Gras)
  const st = (semi) => Math.pow(2, semi / 12);
  function barLen() { return 4 * 60 / num(P.zydecoBpm, 120); }
  function accordionNote(t0, freq, len) {
    const c = chain(musicBus);
    const bp = filter(c, 'bandpass', F.accordionBand, 0.9);
    for (let k = 0; k < 2; k++) {
      const o = osc(c, 'square', freq, t0, t0 + len + 0.05);
      o.detune.value = k ? 6 : -6;
      lfoInto(c, o.frequency, F.accordionVib, freq * 0.01, t0, t0 + len + 0.05);
      o.connect(bp);
    }
    bp.connect(env(c, t0, 0.01, 0.16, len - 0.05, 0.04)).connect(c.out);
    commit(c);
  }
  function bassNote(t0, freq, len) {
    const c = chain(musicBus);
    const o = osc(c, 'triangle', freq, t0, t0 + len + 0.05);
    o.connect(env(c, t0, 0.01, 0.35, len - 0.09, 0.08)).connect(c.out);
    commit(c);
  }
  function tickNoise(t0, hpType, hz, q, len, peak) {
    const c = chain(musicBus);
    const n = noise(c, t0, t0 + len + 0.02);
    const f = filter(c, hpType, hz, q);
    n.connect(f); f.connect(env(c, t0, 0.003, peak, 0.005, len - 0.008)).connect(c.out);
    commit(c);
  }
  function scheduleBar(name, bar, t) {
    const bl = barLen(), eighth = bl / 8;
    const chord = CHORDS[bar % 4];
    const riff = RIFF[bar % 2];
    for (let e = 0; e < 8; e++) {
      const t0 = t + e * eighth;
      const semi = riff[e];
      if (semi >= 0) accordionNote(t0, F.zydecoRoot * st(semi + chord), eighth * 0.95);
      tickNoise(t0, 'highpass', 5000, 0.7, 0.03, RUB_ACCENT[e] ? 0.22 : 0.1);      // rubboard
      if (name === 'mardiGras') {
        tickNoise(t0 + eighth * 0.5, 'bandpass', 8000, 2, 0.05, 0.1);              // tambourine on the off-eighths
        if (SNARE_HITS[e]) tickNoise(t0, 'bandpass', 2000, 1, 0.08, 0.3);          // second-line snare
      }
    }
    const rootHz = F.zydecoRoot / 4 * st(chord);   // G2-ish
    bassNote(t, rootHz, eighth * 1.8);
    bassNote(t + 2 * eighth * 2, rootHz, eighth * 1.8);
    if (bar % 4 === 3) bassNote(t + 7 * eighth, rootHz * st(7), eighth * 0.9);   // pickup on the V
  }
  function scheduleMusic(t) {
    if (!music.on) return;
    const bl = barLen();
    if (music.nextBar < t - bl) music.nextBar = t + 0.05;   // tab was hidden: do not catch up
    while (music.nextBar < t + L.lookahead) {
      if (music.bars > 0 && music.bar >= music.bars) { stopMusic(0.5); return; }
      scheduleBar(music.name, music.bar, music.nextBar);
      music.bar++; music.nextBar += bl;
    }
  }
  function stopMusic(fade) {
    music.on = false;
    if (musicBus) target(musicBus.gain, 0, Math.max(0.05, fade / 3));
  }

  // ---------------------------------------------------------------------------
  // Sampler (every 100 ms from update): world levels, bells, owl, bullfrog
  // ---------------------------------------------------------------------------
  function hasComplete(state, type) {
    try { if (BSU.buildings && typeof BSU.buildings.has === 'function') return !!BSU.buildings.has(state, type); } catch (e) { /* fall through */ }
    const list = state && state.buildings;
    if (!Array.isArray(list)) return false;
    for (const b of list) if (b && b.type === type && num(b.built, 0) >= 1 && !b.ruin) return true;
    return false;
  }
  function waterWithin(state, cam, r) {
    const tiles = state && state.tiles; if (!tiles || !tiles.flags || !tiles.type) return false;
    const mask = FLAG.BAYOU | FLAG.OPEN_WATER;
    const x0 = Math.max(0, cam.tx - r), x1 = Math.min(63, cam.tx + r), y0 = Math.max(0, cam.ty - r), y1 = Math.min(63, cam.ty + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * 64 + x;
      if ((tiles.flags[i] & mask) || tiles.type[i] === T.OPEN_WATER || tiles.type[i] === T.BAYOU) return true;
    }
    return false;
  }
  function pumpsNear(state, cam) {
    let list = null;
    try { if (BSU.buildings && typeof BSU.buildings.list === 'function') list = BSU.buildings.list(state, 'pump'); } catch (e) { list = null; }
    if (!Array.isArray(list)) { list = []; if (state && Array.isArray(state.buildings)) for (const b of state.buildings) if (b && b.type === 'pump') list.push(b); }
    let n = 0;
    for (const b of list) {
      if (!b || num(b.built, 0) < 1 || b.ruin) continue;
      if (BSU.chebyshev(num(b.tx, -99), num(b.ty, -99), cam.tx, cam.ty) > L.pumpRadius) continue;
      let running = false;
      try { running = (BSU.hydro && typeof BSU.hydro.pumpRunning === 'function') ? !!BSU.hydro.pumpRunning(state, b.id) : (b.powered !== false && !b.blackout); }
      catch (e) { running = false; }
      if (running && ++n >= L.pumpCap) break;
    }
    return n;
  }
  function foggerNear(state, cam) {
    const vs = state && state.vehicles; if (!Array.isArray(vs)) return false;
    for (const v of vs) if (v && v.kind === 'fogger' && BSU.chebyshev(num(v.tx, -99), num(v.ty, -99), cam.tx, cam.ty) <= L.foggerRadius) return true;
    return false;
  }
  function seasonOf(state) {
    const s = state && state.calendar && state.calendar.season;
    return typeof s === 'string' ? s : '';
  }
  function heatOf(state) {
    try { if (BSU.weather && typeof BSU.weather.heat === 'function') return num(BSU.weather.heat(state).index, 55); } catch (e) { /* */ }
    return num(state && state.weather && state.weather.heat, 55);
  }
  function ecologyOf(state) {
    try { if (BSU.wildlife && typeof BSU.wildlife.ecology === 'function') return num(BSU.wildlife.ecology(state), 0); } catch (e) { /* */ }
    return num(state && state.wildlife && state.wildlife.ecology, 0);
  }
  function mosqAt(state, cam) {
    try { if (BSU.wildlife && typeof BSU.wildlife.mosqAt === 'function') return clamp(num(BSU.wildlife.mosqAt(state, cam.tx, cam.ty), 0), 0, 1); } catch (e) { /* */ }
    const m = state && state.tiles && state.tiles.mosq;
    return m ? clamp(num(m[cam.ty * 64 + cam.tx], 0), 0, 1) : 0;
  }
  /** the slow (sky/season/ecology/heat) targets: cheap, called at phase changes and by setAmbience */
  function slowTargets(state) {
    const info = { phase: num(state && state.sky && state.sky.phase, -1), season: seasonOf(state), ecology: ecologyOf(state), heat: heatOf(state) };
    const tg = M.targets(info);
    layerOf('frogs').target = tg.frogs; layerOf('cicadas').target = tg.cicadas; layerOf('crickets').target = tg.crickets;
    const fr = layerOf('frogs');
    if (fr.built && fr.rates) for (let k = 0; k < fr.rates.length; k++) target(fr.rates[k].frequency, tg.frogRate * (0.85 + 0.15 * k), 0.5);
    lastPhase = info.phase; lastSeason = info.season;
  }
  function sample(state, t) {
    if (!state) { applyTargets(t); scheduleMusic(t); return; }
    const sky = state.sky || {}, w = state.weather || {};
    const cam = M.camTile(state);
    // phase change → slow targets, bells at Dusk start, Zydeco Friday
    const phase = num(sky.phase, -1);
    if (phase !== lastPhase || seasonOf(state) !== lastSeason) {
      const prev = lastPhase;
      slowTargets(state);
      if (phase !== SKY.DAY) middayDone = false;
      if (phase === SKY.DUSK && prev !== -1) {
        if (hasComplete(state, 'bell_tower')) M.play('bells');
        const cal = state.calendar || {};
        const every = num(BSU.params.agents && BSU.params.agents.zydecoEvery, 5);
        if (cal.running && num(cal.day, -1) >= 0 && (cal.day % every) === 0 && hasComplete(state, 'union') && !music.on) M.motif('zydeco', true, { bars: 8 });
      }
    }
    if (phase === SKY.DAY && !middayDone && num(sky.t, 0) >= 0.5) {
      middayDone = true;
      if (hasComplete(state, 'bell_tower')) M.play('bells');
    }
    // fast targets
    const fast = M.targets({
      phase: phase, season: seasonOf(state), ecology: 0, heat: 0,
      rainRate: num(w.rainRate, 0), wind: num(w.wind, 0), windFloor: windFloor, drone: droneOn,
      nearWater: waterWithin(state, cam, L.lapRadius), mosq: mosqLevel, pumps: pumpsNear(state, cam), fogger: foggerNear(state, cam)
    });
    layerOf('rain').target = fast.rain; layerOf('wind').target = fast.wind; layerOf('drone').target = fast.drone;
    layerOf('lap').target = fast.lap; layerOf('pump').target = fast.pump; layerOf('fogger').target = fast.fogger;
    if (sampleNo % L.mosqEvery === 0) { mosqLevel = mosqAt(state, cam); }
    layerOf('whine').target = M.targets({ mosq: mosqLevel }).whine;
    const rain = layerOf('rain');
    if (rain.built && rain.cut) target(rain.cut.frequency, fast.rainCut, L.fastTau);
    applyTargets(t);
    // rare ambience one-shots through the ambience bus (not voices)
    const R2 = BSU.rng.fx;
    if (phase === SKY.NIGHT) {
      if (t >= owlNext) { owlNext = t + R2.range(L.owlGap[0], L.owlGap[1]); owl(t); }
    } else owlNext = Math.max(owlNext, t + R2.range(L.owlGap[0], L.owlGap[1]) * 0.5);
    if (cam.zoom >= L.bullfrogZoom && waterWithin(state, cam, L.bullfrogRadius)) {
      if (t >= bullfrogNext) { bullfrogNext = t + R2.range(L.bullfrogGap[0], L.bullfrogGap[1]); bullfrog(t); }
    } else bullfrogNext = Math.max(bullfrogNext, t + L.bullfrogGap[0]);
    scheduleMusic(t);
  }
  function owl(t) {
    const c = chain(ambBus);
    const o = osc(c, 'sine', F.owl[0], t, t + F.owlLen + 0.1);
    o.frequency.exponentialRampToValueAtTime(F.owl[1], t + F.owlLen);
    o.connect(env(c, t, 0.08, 0.3, F.owlLen - 0.3, 0.22)).connect(c.out);
    commit(c);
  }
  function bullfrog(t) {
    const c = chain(ambBus);
    for (let k = 0; k < 2; k++) {
      const t0 = t + k * (F.bullfrogLen + 0.12);
      const o = osc(c, 'sine', F.bullfrogHz, t0, t0 + F.bullfrogLen + 0.05);
      o.connect(env(c, t0, 0.03, 0.5, F.bullfrogLen - 0.13, 0.1)).connect(c.out);
    }
    commit(c);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  /** registers event listeners only (owner 'audio'); reads nothing else, touches no AudioContext */
  M.init = function (state) {
    root = state || null;
    try { BSU.events.clear('audio'); subscribe(); } catch (e) { BSU.error('audio', 'init', e); }
  };

  /** every newGame/load: stops stings and the motif, re-evaluates ambience, reapplies settings; keeps the context */
  M.reset = safe('reset', function (state, fresh) {
    root = state || root;
    void fresh;   // identical for both values (nothing here is per-game state)
    lastPhase = -1; lastSeason = ''; middayDone = false; windFloor = 0; droneOn = false; mosqLevel = 0;
    if (state && state.ui && state.ui.settings) M.applySettings(state.ui.settings);
    if (!ctx) return;
    for (let i = voices.length - 1; i >= 0; i--) { kill(voices[i]); dispose(voices[i]); }
    stopMusic(0.2);
    music.name = null; music.bars = 0; music.bar = 0;
    M.setAmbience(state);
  });

  /** creates the AudioContext on the first user gesture; resumes a suspended one on every later call */
  M.unlock = safe('unlock', function () {
    if (ctx) {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') { try { const p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* */ } }
      return;
    }
    const W = (typeof window !== 'undefined') ? window : globalThis;
    const AC = W.AudioContext || W.webkitAudioContext;
    if (typeof AC !== 'function') return;
    let c = null;
    try { c = new AC(); } catch (e) { BSU.error('audio', 'unlock:new', e); return; }
    try {
      ctx = c;
      master = ctx.createGain(); master.connect(ctx.destination);
      ambBus = ctx.createGain(); ambBus.gain.value = M.dB(P.ambienceDb); ambBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      hasPanner = typeof ctx.createStereoPanner === 'function';
      const sr = num(ctx.sampleRate, 48000);
      const R2 = BSU.rng.fx;
      noiseBuf = ctx.createBuffer(1, Math.max(1, Math.floor(sr * 2)), sr);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = R2.float() * 2 - 1;
      reverbBuf = ctx.createBuffer(1, Math.max(1, Math.floor(sr * F.reverbLen)), sr);
      const rd = reverbBuf.getChannelData(0);
      for (let i = 0; i < rd.length; i++) rd[i] = (R2.float() * 2 - 1) * Math.pow(1 - i / rd.length, 2.5);
      pulseCurve = makePulseCurve();
      master.gain.value = settings.muted ? 0 : settings.volume;
      owlNext = now() + R2.range(L.owlGap[0], L.owlGap[1]) * 0.5;
      bullfrogNext = now() + L.bullfrogGap[0];
      acc = 0; sampleNo = 0;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') { try { const p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* */ } }
      M.setAmbience(cur());
    } catch (e) {
      ctx = null; master = ambBus = sfxBus = musicBus = null;
      BSU.error('audio', 'unlock', e);
    }
  });

  /** one-shots (see M.NAMES); opts {tile: i} distance gain + pan, {delayMs}, {gain}, {danger}, {breach} */
  M.play = safe('play', function (name, opts) {
    if (!ctx) return;
    const recipe = R[name];
    if (typeof recipe !== 'function') { BSU.error('audio', 'play', new Error('unknown one-shot "' + name + '"')); return; }
    if (ctx.state === 'suspended') M.unlock();
    const o = opts || {};
    const delay = clamp(num(o.delayMs, 0), 0, 10000) / 1000;
    if (!allocVoice(name)) return;
    const c = newVoice(name, o);
    const t0 = now() + delay;
    try { recipe(c, t0, o); }
    catch (e) { dispose(c); BSU.error('audio', 'play:' + name, e); return; }
    voices.push(c);
    commit(c);
    if (DUCKERS.has(name)) duck(t0, Math.max(0.1, c.end - t0));
  });

  /** crossfades the bed by sky phase / season / ecology / heat (cheap: sets targets; update lerps) */
  M.setAmbience = safe('setAmbience', function (state) {
    if (!ctx) return;
    slowTargets(state || cur());
    applyTargets(now());
  });

  /** per frame: samples the world every 100 ms (rain/wind/drone/pump/whine, bells, owl, music); lerps are in the graph */
  M.update = safe('update', function (state, dtMs) {
    if (!ctx) return;
    acc += clamp(num(dtMs, 16.67), 0, 1000);
    if (acc < L.sampleMs) return;
    acc = Math.min(acc - L.sampleMs, L.sampleMs);
    sampleNo++;
    sample(state || cur(), now());
  });

  /** mute (master gain 0; the graph keeps running so unmuting is instant); mirrors ui.settings when it exists */
  M.mute = safe('mute', function (on) {
    settings.muted = !!on;
    mirrorSettings();
    if (ctx) target(master.gain, settings.muted ? 0 : settings.volume, 0.02);
  });
  M.muted = function () { return settings.muted; };
  /** volume 0–1 (clamped; non-finite → the default) */
  M.setVolume = safe('setVolume', function (v) {
    settings.volume = clamp(num(v, P.defaultVolume), 0, 1);
    mirrorSettings();
    if (ctx) target(master.gain, settings.muted ? 0 : settings.volume, 0.02);
  });
  /** {volume, muted} from ui.settings; before unlock the values are stored for when the context exists */
  M.applySettings = safe('applySettings', function (s) {
    const o = s || {};
    settings.volume = clamp(num(o.volume, P.defaultVolume), 0, 1);
    settings.muted = !!o.muted;
    if (ctx) target(master.gain, settings.muted ? 0 : settings.volume, 0.02);
  });
  function mirrorSettings() {
    if (quiet) return;
    try {
      const s = (BSU.ui && typeof BSU.ui.settings === 'function') ? BSU.ui.settings() : null;
      if (s && typeof s === 'object' && (s.muted !== settings.muted || s.volume !== settings.volume)) {
        s.muted = settings.muted; s.volume = settings.volume;
        if (typeof BSU.ui.saveSettings === 'function') BSU.ui.saveSettings();
      }
    } catch (e) { /* ui absent or refused: the audio choice still applies */ }
  }
  /** Tier 2: 'zydeco' (16 bars, or opts.bars) / 'mardiGras' (loops at low volume) on/off */
  M.motif = safe('motif', function (name, on, opts) {
    if (!ctx) return;
    if (name !== 'zydeco' && name !== 'mardiGras') return;
    if (on) {
      music.name = name; music.on = true;
      music.bars = Math.max(0, num(opts && opts.bars, name === 'zydeco' ? 16 : 0) | 0);
      music.bar = 0; music.nextBar = now() + 0.05;
      music.level = name === 'mardiGras' ? 0.35 : 0.6;
      target(musicBus.gain, music.level, 0.1);
      scheduleMusic(now());
    } else if (music.on && (music.name === name || name == null)) {
      stopMusic(0.6);
    }
  });
  /** context exists and is running */
  M.ready = function () { return !!ctx && ctx.state === 'running'; };
  /** live one-shot voice count (debug) */
  M.voices = function () { return ctx ? voices.length : 0; };
  /** debug/test hooks (functions only, D46): live layer names and the music scheduler state */
  M._debug = {
    layers: function () { const o = {}; for (const k in layers) o[k] = { built: layers[k].built, target: layers[k].target, applied: layers[k].applied }; return o; },
    music: function () { return { name: music.name, on: music.on, bars: music.bars, bar: music.bar }; },
    settings: function () { return { volume: settings.volume, muted: settings.muted }; },
    windFloor: function () { return windFloor; },
    drone: function () { return droneOn; },
    ctx: function () { return ctx; }
  };

  // ---------------------------------------------------------------------------
  // Event listeners (owner 'audio'); each wrapped so nothing escapes (§10.1)
  // ---------------------------------------------------------------------------
  function on(name, fn) { BSU.events.on(name, safe('on:' + name, fn), 'audio'); }
  function tileOf(p) {
    if (!p) return undefined;
    if (Number.isFinite(p.i)) return p.i;
    if (Number.isFinite(p.tx) && Number.isFinite(p.ty) && BSU.inBounds(p.tx, p.ty)) return BSU.idx(p.tx, p.ty);
    return undefined;
  }
  function isRival(opp) {
    try { const o = BSU.data && BSU.data.opponents && BSU.data.opponents[opp]; return !!(o && o.rival); } catch (e) { return false; }
  }
  function subscribe() {
    on('building:placed', function (p) { M.play('place', { tile: tileOf(p) }); });
    on('building:complete', function () { M.play('coin'); });
    on('building:removed', function (p) { M.play('demolish', { tile: tileOf(p) }); });
    on('econ:income', function (p) { if (num(p && p.amount, 0) >= L.bigIncome) M.play('money', { tile: tileOf(p) }); });
    on('milestone:earned', function (p) { M.play('milestone'); if (p && p.id === 'flagship') M.play('peal', { delayMs: 600 }); });
    on('ui:notify', function (p) { M.play('notify', { danger: !!(p && p.kind === 'danger') }); });
    on('gator:campus', function (p) { if (p && p.enter) M.play('growl', { tile: tileOf(p) }); });
    on('weather:lightning', function (p) {
      const tile = tileOf(p);
      let d = 0;
      if (tile !== undefined) { const cam = M.camTile(cur()); d = BSU.chebyshev(tile & 63, tile >> 6, cam.tx, cam.ty); }
      const delayMs = lerp(P.thunderDelay[0] * 1000, P.thunderDelay[1] * 1000, clamp(d / 40, 0, 1));
      M.play('thunder', { tile: tile, delayMs: delayMs });
    });
    on('levee:overtop', function (p) { M.play('hiss', { tile: tileOf(p) }); });
    on('levee:breach', function (p) { M.play('hiss', { tile: tileOf(p), breach: true }); });
    on('game:kickoff', function () { M.play('whistle'); M.play('roar', { gain: 0.6, delayMs: 300 }); });
    on('game:score', function (p) {
      if (p && p.side === 'away') M.play('groan');
      else { M.play('sting'); M.play('roar', { delayMs: 200 }); }
    });
    on('game:final', function (p) {
      if (p && p.won) {
        M.play('sting'); M.play('roar', { delayMs: 200 });
        if (isRival(p.opp)) M.play('peal', { delayMs: 900 });
        M.motif('zydeco', true, { bars: 16 });
      } else M.play('trombone');
    });
    on('storm:phase', function (p) {
      const ph = num(p && p.phase, -1);
      windFloor = num(STORM_WIND[ph], 0);
      droneOn = !!STORM_DRONE[ph];
      if (ph === SP.WALL) M.play('gust');
      if (ph === SP.LANDFALL) M.play('roar', { gain: 0.8 });
      if (ctx) { const st2 = cur(); if (st2) sample(st2, now()); }
    });
    on('storm:passed', function () { windFloor = 0; droneOn = false; });
    on('setpiece:end', function (p) { if (p && p.kind === 'landfall') { windFloor = 0; droneOn = false; } });
    on('setpiece:start', function (p) { if (p && p.kind === 'game') M.motif('zydeco', true, { bars: 16 }); });
    on('storm:named', function () { M.play('stingMinor'); });
    on('festival:start', function (p) { M.play('chime'); if (p && p.id === 'mardiGras') M.motif('mardiGras', true); });
    on('festival:end', function (p) { if (p && p.id === 'mardiGras') M.motif('mardiGras', false); });
    on('objective:complete', function () { M.play('chime'); });
    on('decision:open', function () { M.play('notify'); });
    on('sky:phase', function () { M.setAmbience(cur()); });
    on('save:loaded', function () { M.reset(cur(), false); });
  }

  // ---------------------------------------------------------------------------
  // selfTest: pure, no context needed (brief §6)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const A = BSU.assert;
    const notes = [];
    const saved = { volume: settings.volume, muted: settings.muted };
    quiet = true;
    try {
      // 1. every one-shot has a recipe and play() never throws without a context
      for (const n of M.NAMES) A(typeof R[n] === 'function', 'recipe ' + n);
      if (!ctx) {
        for (const n of M.NAMES) M.play(n);
        M.play('bogus'); M.play(undefined); M.play('sting', { tile: NaN, delayMs: Infinity });
        M.update(null, NaN); M.setAmbience(null); M.motif('zydeco', true); M.motif('nope', true);
      } else notes.push('context live: play() calls skipped');
      // 2. dB
      A(Math.abs(M.dB(-12) - 0.2512) < 0.001, 'dB(−12) ≈ 0.2512');
      A(Math.abs(M.dB(-6) - 0.5012) < 0.001, 'dB(−6) ≈ 0.5012');
      // 3. distance gain
      A(M.distGain(0) === 1, 'd 0 → 1');
      A(Math.abs(M.distGain(15) - 0.5) < 1e-9, 'd 15 → .5');
      A(Math.abs(M.distGain(40) - 0.15) < 1e-9, 'd 40 → .15');
      A(M.distGain(NaN) === 1, 'NaN distance → 1');
      // 4. ambience target table
      let t = M.targets({ phase: SKY.NIGHT, season: 'summer', ecology: 80 });
      A(t.frogs > 0 && t.cicadas === 0 && t.crickets === 0, 'summer night: frogs only');
      t = M.targets({ phase: SKY.DAY, season: 'summer', ecology: 80, heat: 100 });
      A(t.cicadas > t.frogs && t.frogs === 0, 'summer day, heat 100: cicadas > frogs');
      A(Math.abs(t.cicadas - 0.675) < 1e-9, 'cicadas .3 + .5 × .75');
      t = M.targets({ phase: SKY.NIGHT, season: 'spring', ecology: 20 });
      A(t.frogs === 0 && t.crickets > 0, 'spring night, ecology 20: no frogs, crickets');
      t = M.targets({ phase: SKY.DUSK, season: 'fall', ecology: 100 });
      A(Math.abs(t.frogs - 0.25) < 1e-9, 'dusk frogs at half');
      t = M.targets({ rainRate: 1, wind: 0.9, mosq: 1, pumps: 5 });
      A(Math.abs(t.rain - 0.25) < 1e-9 && t.rainCut === 900 && Math.abs(t.wind - 0.365) < 1e-9 && Math.abs(t.whine - 0.06) < 1e-9 && Math.abs(t.pump - 0.15) < 1e-9, 'rain/wind/whine/pump formulas');
      t = M.targets({ wind: 0, windFloor: 0.6, drone: true });
      A(Math.abs(t.wind - 0.26) < 1e-9 && t.drone === 1, 'storm wind floor and drone');
      t = M.targets(null);
      for (const k in t) A(Number.isFinite(t[k]), 'targets(null) finite ' + k);
      // 5. bells motif
      A(F.bells.map(Math.round).join(',') === '330,392,440,659', 'bells E4 G4 A4 E5');
      // 6. settings before unlock
      M.applySettings({ volume: 0.3, muted: true });
      A(M.muted() === true, 'muted() reflects applySettings');
      M.setVolume(2); A(M._debug.settings().volume === 1, 'setVolume(2) clamps to 1');
      M.setVolume(-1); A(M._debug.settings().volume === 0, 'setVolume(−1) clamps to 0');
      M.setVolume(NaN); A(M._debug.settings().volume === P.defaultVolume, 'setVolume(NaN) → default');
      M.mute(false); A(M.muted() === false, 'mute(false)');
      M.applySettings(null); A(M.muted() === false && M._debug.settings().volume === P.defaultVolume, 'applySettings(null) → defaults');
      // 7. voices without a context
      if (!ctx) A(M.voices() === 0 && M.ready() === false, 'voices() 0 / ready() false without a context');
      else A(M.voices() >= 0 && M.voices() <= P.voices, 'voices() within the cap');
      // camera tile math
      const s = BSU.newState(1234);
      const ct = M.camTile(s, s.ui.camera);
      A(ct.tx === s.plot.founders.tx && ct.ty === s.plot.founders.ty, 'camTile inverts the Founders\' camera');
      A(M.camTile(s, { x: 0, y: 1e9, zoom: 2 }).ty === 63 && M.camTile(s, { x: NaN, y: 1 }).tx === 0, 'camTile clamps / tolerates NaN');
      A(M.camTile(null).tx >= 0, 'camTile(null) safe');
      // music constants
      A(Math.abs(barLen() - 2) < 1e-9, 'a bar at 120 BPM is 2 s');
      A(RIFF[0].length === 8 && RIFF[1].length === 8 && CHORDS.join(',') === '0,5,7,0', 'riff/chords shape');
      notes.push(M.NAMES.length + ' one-shots, ' + Object.keys(LAYERS).length + ' ambience layers');
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: 'audio selfTest: ' + (e && e.message || e) };
    } finally {
      settings.volume = saved.volume; settings.muted = saved.muted;
      quiet = false;
      if (ctx) target(master.gain, settings.muted ? 0 : settings.volume, 0.02);
    }
  };
})();
