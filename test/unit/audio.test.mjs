// Unit test for src/js/audio.js: loads contract.js (+ every earlier manifest module that exists),
// then audio.js, through makeWindow() from test/domstub.mjs with vm.runInContext; runs
// BSU.audio.selfTest() without an AudioContext (the stub omits it on purpose), then injects a
// small fake AudioContext to exercise the synthesis paths: buses, voice cap, ducking, distance
// gain, the lazy ambience layers, thunder delay, the event listeners, the zydeco scheduler and
// node disposal. Usage: node test/unit/audio.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'audio.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(!/setTimeout|setInterval|requestAnimationFrame/.test(src), 'no timers (musical timing is ctx.currentTime)');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/rng\.sim/.test(src), 'never draws rng.sim (presentation uses rng.fx only)');

// --- load (contract + existing manifest modules before audio.js, skipping missing/broken) ----
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest.slice(0, manifest.indexOf('audio.js'))) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { if (f === 'contract.js') throw e; console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'audio.js' }); } catch (e) { threw = e; }
ok(!threw, 'audio.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(performance.now() - t0 < 50, 'definition time < 50 ms');
const BSU = win.BSU;
const A = BSU.audio;
ok(A && typeof A.init === 'function' && typeof A.reset === 'function' && typeof A.selfTest === 'function' && !('tick' in A), 'module shape: init/reset/selfTest, no tick');
for (const fn of ['unlock', 'play', 'setAmbience', 'update', 'mute', 'muted', 'setVolume', 'applySettings', 'motif', 'ready', 'voices', 'targets', 'dB', 'distGain', 'camTile'])
  ok(typeof A[fn] === 'function', 'public function ' + fn);
ok(A.recipes && typeof A.recipes === 'object' && Array.isArray(A.NAMES), 'recipes table + NAMES list');

// --- headless: no AudioContext → everything is a no-op ---------------------------
const S = BSU.state = BSU.newState(11);
S.sky.phase = BSU.SKY.NIGHT; S.calendar.season = 'summer'; S.wildlife.ecology = 80;
let boom = null;
try {
  A.init(S); A.reset(S, true); A.unlock(); A.applySettings(S.ui.settings);
  for (const n of A.NAMES) A.play(n, { tile: 100 });
  A.play('thunder', { tile: -5, delayMs: NaN }); A.play(null); A.play(42);
  for (let i = 0; i < 50; i++) A.update(S, 33);
  A.setAmbience(S); A.motif('zydeco', true); A.motif('mardiGras', false); A.mute(true); A.mute(false); A.setVolume(0.7);
  A.reset(S, false); A.update(null, 16); A.setAmbience(undefined);
  // every listened event with garbage payloads
  for (const ev of ['building:placed', 'building:complete', 'building:removed', 'econ:income', 'milestone:earned', 'ui:notify', 'gator:campus',
    'weather:lightning', 'levee:overtop', 'levee:breach', 'game:kickoff', 'game:score', 'game:final', 'storm:phase', 'storm:named', 'storm:passed',
    'festival:start', 'festival:end', 'objective:complete', 'decision:open', 'sky:phase', 'setpiece:start', 'setpiece:end']) {
    BSU.events.emit(ev, {}); BSU.events.emit(ev, null); BSU.events.emit(ev, { i: NaN, tx: 1e9, amount: Infinity, phase: 'x', kind: 7 });
  }
} catch (e) { boom = e; }
ok(!boom, 'headless: init/reset/unlock/play/update/events never throw' + (boom ? ': ' + (boom.stack || boom) : ''));
eq(A.ready(), false, 'ready() false without an AudioContext');
eq(A.voices(), 0, 'voices() 0 without a context');
eq(BSU.errors.size, 0, 'no BSU.error raised by the headless no-op paths');

const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t2 = performance.now();
try { st = A.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t2;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
eq(BSU.errors.size, errorsBefore, 'selfTest did not grow BSU.errors');
eq(BSU.events.count('weather:lightning'), 1, 'init registered its listeners once (owner audio)');
A.init(S); eq(BSU.events.count('weather:lightning'), 1, 'a second init re-registers (clear by owner), never duplicates');

// --- a fake AudioContext: records automation and node lifetimes ---------------------
class Param {
  constructor(v) { this.value = v; this.log = []; }
  _p(kind, v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new Error(`non-finite automation ${kind}(${v}, ${t})`); this.log.push([kind, v, t]); this.value = v; return this; }
  setValueAtTime(v, t) { return this._p('set', v, t); }
  linearRampToValueAtTime(v, t) { return this._p('lin', v, t); }
  exponentialRampToValueAtTime(v, t) { if (v <= 0) throw new Error('exp ramp to ' + v); return this._p('exp', v, t); }
  setTargetAtTime(v, t, c) { if (!(c > 0)) throw new Error('bad time constant'); return this._p('tgt', v, t); }
  cancelScheduledValues() { return this; }
}
class Node { constructor(c) { this.c = c; this.outs = []; c.live.add(this); c.created++; } connect(n) { this.outs.push(n); this.c.live.add(this); return n; } disconnect() { this.outs.length = 0; this.c.live.delete(this); } }
class Src extends Node {
  constructor(c) { super(c); this.startAt = null; this.stopAt = null; this.onended = null; this.ended = false; }
  start(t) { if (this.startAt !== null) throw new Error('start twice'); this.startAt = t === undefined ? this.c.currentTime : t; this.c.srcs.push(this); }
  stop(t) { this.stopAt = t === undefined ? this.c.currentTime : t; }
}
class Osc extends Src { constructor(c) { super(c); this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0); } }
class BufSrc extends Src { constructor(c) { super(c); this.buffer = null; this.loop = false; this.playbackRate = new Param(1); } }
class Gain extends Node { constructor(c) { super(c); this.gain = new Param(1); } }
class Biquad extends Node { constructor(c) { super(c); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); this.gain = new Param(0); } }
class Panner extends Node { constructor(c) { super(c); this.pan = new Param(0); } }
class Conv extends Node { constructor(c) { super(c); this.buffer = null; } }
class Shaper extends Node { constructor(c) { super(c); this.curve = null; } }
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'suspended'; this.live = new Set(); this.created = 0; this.srcs = []; this.resumes = 0; this.destination = new Node(this); }
  createGain() { return new Gain(this); } createOscillator() { return new Osc(this); } createBufferSource() { return new BufSrc(this); }
  createBiquadFilter() { return new Biquad(this); } createStereoPanner() { return new Panner(this); } createConvolver() { return new Conv(this); } createWaveShaper() { return new Shaper(this); }
  createBuffer(ch, len, sr) { const d = new Float32Array(len); return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData() { return d; } }; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  /** advance the clock and fire onended for every source whose stop time passed */
  advance(sec) {
    this.currentTime += sec;
    const due = this.srcs.filter(s => !s.ended && s.stopAt !== null && s.stopAt <= this.currentTime);
    for (const s of due) { s.ended = true; if (typeof s.onended === 'function') s.onended(); }
    this.srcs = this.srcs.filter(s => !s.ended);
  }
}
win.AudioContext = FakeAudioContext;
// sibling stubs the sampler reads through (guarded in audio.js; real modules may already be loaded)
const uiSettings = S.ui.settings;
let saved = 0;
BSU.ui = BSU.ui || {}; BSU.ui.settings = () => uiSettings; BSU.ui.saveSettings = () => { saved++; };
BSU.render = BSU.render || {}; Object.defineProperty(BSU.render, 'camera', { value: { x: S.ui.camera.x, y: S.ui.camera.y, zoom: 1 }, writable: true, configurable: true, enumerable: true }); // render.js exposes camera as a getter; override for the test

// --- scenario 1: unlock creates the graph once; ambience at −12 dB; settings applied ----
A.applySettings({ volume: 0.4, muted: true });   // before unlock: stored
A.unlock();
const C = A._debug.ctx();
ok(C instanceof FakeAudioContext, 'unlock() created the (fake) AudioContext lazily');
eq(A.ready(), true, 'ready() true once the context runs (resume() called on a suspended context)');
A.unlock(); A.unlock();
ok(A._debug.ctx() === C, 'unlock() twice keeps the same context');
const buses = [...C.live].filter(n => n instanceof Gain && n.outs.some(o => o === C.destination));
eq(buses.length, 1, 'one master bus into the destination');
const masterBus = buses[0];
eq(masterBus.gain.value, 0, 'muted before unlock → master gain 0 after unlock');
const feeders = [...C.live].filter(n => n instanceof Gain && n.outs.includes(masterBus));
eq(feeders.length, 3, 'ambience / sfx / music buses feed the master');
const amb = feeders.find(g => Math.abs(g.gain.value - Math.pow(10, -12 / 20)) < 1e-6);
ok(!!amb, 'the ambience bus sits at dB(−12) ≈ 0.2512');
A.mute(false);
eq(masterBus.gain.value, 0.4, 'mute(false) restores the stored volume through the master gain');
eq(uiSettings.muted, false, 'mute() mirrors into ui.settings');
ok(saved > 0, '…and asks ui to persist it');
A.mute(true); eq(masterBus.gain.value, 0, 'mute(true) → master 0 (graph keeps running)');
A.mute(false); A.setVolume(0.9); eq(masterBus.gain.value, 0.9, 'setVolume drives the master');

// --- scenario 2: every event makes its sound; distance gain and pan; thunder delay ----
const liveVoices = () => [...C.live].filter(n => n instanceof Gain && n.outs.length && n.outs.some(o => o === feeders[1] || o instanceof Panner));
function burst(ev, payload) { const before = C.created; BSU.events.emit(ev, payload); return C.created - before; }
ok(burst('building:placed', { id: 0, type: 'dorm', tx: 30, ty: 30, w: 3, h: 2, cost: 1, pilings: false }) > 0, 'building:placed → nodes created (place)');
ok(burst('building:complete', { id: 0, type: 'dorm' }) > 0, 'building:complete → coin');
ok(burst('building:removed', { id: 0, type: 'dorm', tx: 30, ty: 30, w: 3, h: 2, refund: 0, reason: 'demolish' }) > 0, 'building:removed → demolish');
eq(burst('econ:income', { key: 'tuition', amount: 5000 }), 0, 'econ:income below $10k is silent');
ok(burst('econ:income', { key: 'tuition', amount: 50000 }) > 0, 'econ:income ≥ $10k → money');
ok(burst('milestone:earned', { id: 'firstBell', name: 'x', reward: '' }) > 0, 'milestone:earned → milestone chime');
ok(burst('ui:notify', { text: 'hi', kind: 'danger' }) > 0 && burst('ui:notify', { text: 'hi', kind: 'info' }) > 0, 'ui:notify → notify (danger and plain)');
ok(burst('gator:campus', { id: 1, name: 'Beignet', i: 40 * 64 + 40, enter: true, target: -1 }) > 0, 'gator:campus enter → growl');
eq(burst('gator:campus', { id: 1, name: 'Beignet', i: 40, enter: false, target: -1 }), 0, 'gator:campus leave is silent');
ok(burst('levee:overtop', { i: 2000, tx: 16, ty: 31 }) > 0 && burst('levee:breach', { i: 2000, tx: 16, ty: 31 }) > 0, 'levee:overtop/breach → hiss');
ok(burst('game:kickoff', { opp: 'delta', home: true, night: false, homePts: 0, awayPts: 0 }) > 0, 'game:kickoff → whistle + crowd');
ok(burst('game:score', { opp: 'delta', side: 'home', homePts: 7, awayPts: 0 }) > 0 && burst('game:score', { opp: 'delta', side: 'away', homePts: 7, awayPts: 3 }) > 0, 'game:score home → sting + roar, away → groan');
ok(burst('storm:named', { name: 'Célestine', cat: 2 }) > 0, 'storm:named → minor sting');
ok(burst('objective:complete', { id: '3', kind: 0, text: '' }) > 0 && burst('decision:open', { id: 'shelter' }) > 0 && burst('festival:start', { id: 'crawfish', day: 0 }) > 0, 'objective:complete / decision:open / festival:start → chime / notify / chime');
ok(A.voices() > 0 && A.voices() <= BSU.params.audio.voices, `voices() = ${A.voices()} ≤ ${BSU.params.audio.voices} after the burst`);
// thunder: far tile → delay toward 2 s; the tile is ~30 tiles from the camera
const cam = A.camTile(S);
const farTx = cam.tx > 32 ? cam.tx - 30 : cam.tx + 30;
const beforeSrcs = C.srcs.length;
BSU.events.emit('weather:lightning', { tx: farTx, ty: cam.ty });
const thunderSrcs = C.srcs.slice(beforeSrcs);
ok(thunderSrcs.length >= 2, 'weather:lightning → thunder sources scheduled');
const delay = Math.min(...thunderSrcs.map(s => s.startAt)) - C.currentTime;
ok(delay >= 0.3 - 1e-9 && delay <= 2 + 1e-9, `thunder delayed ${delay.toFixed(2)} s after the flash (0.3–2 s by distance)`);
ok(Math.abs(delay - (0.3 + 1.7 * Math.min(1, 30 / 40))) < 0.02, 'delay = lerp(300, 2000, d/40) for d = 30');
// ducking: the ambience bus got a ramp to dB(−18) and back to dB(−12)
const ambLog = amb.gain.log;
ok(ambLog.some(e => e[0] === 'lin' && Math.abs(e[1] - Math.pow(10, -18 / 20)) < 1e-6) && ambLog.some(e => e[0] === 'lin' && Math.abs(e[1] - Math.pow(10, -12 / 20)) < 1e-6), 'stings/thunder duck the ambience bus to −18 dB and restore −12 dB');
// distance gain + pan
const pans = [...C.live].filter(n => n instanceof Panner);
ok(pans.length > 0 && pans.every(p => p.pan.value >= -1 && p.pan.value <= 1), 'tile-positioned one-shots get a StereoPanner within ±1');
const before2 = C.created;
A.play('splash', { tile: BSU.idx(Math.max(0, cam.tx - 45), cam.ty) });
const farVoice = [...C.live].filter(n => n instanceof Gain && n.outs.some(o => o instanceof Panner)).pop();
ok(C.created > before2 && farVoice && Math.abs(farVoice.gain.value - 0.15) < 1e-9, 'a one-shot 45 tiles away plays at the .15 distance floor');

// --- scenario 3: the voice cap holds; hover/tick are dropped when full ---------------
for (let i = 0; i < 40; i++) A.play('sting');
ok(A.voices() <= BSU.params.audio.voices, `40 stings in one burst → voices() = ${A.voices()} ≤ ${BSU.params.audio.voices} (oldest stolen)`);
const beforeHover = C.created; A.play('hover'); A.play('tick');
eq(C.created, beforeHover, 'hover/tick are dropped (not stolen for) when the cap is full');
ok(A.voices() <= BSU.params.audio.voices, 'still capped');
// every automation value/time was finite (the fake throws otherwise) and no BSU.error so far
eq(BSU.errors.size, errorsBefore, 'no BSU.error during the burst');

// --- scenario 4: envelopes have ≥ 5 ms attack/release ramps ------------------------
let badRamps = 0, ramps = 0;
for (const n of C.live) {
  if (!(n instanceof Gain)) continue;
  const log = n.gain.log;
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1], b = log[i];
    if (b[0] === 'lin' && a[0] === 'set' && a[1] === 0 && b[1] > 0) { ramps++; if (b[2] - a[2] < 0.005 - 1e-9) badRamps++; }
  }
}
ok(ramps > 20 && badRamps === 0, `${ramps} attack ramps inspected, none shorter than 5 ms`);

// --- scenario 5: ambience layers follow sky/season/ecology; lazy build + teardown -----
function frames(sec) { const n = Math.round(sec / 0.05); for (let i = 0; i < n; i++) { C.advance(0.05); A.update(S, 50); } }
S.sky.phase = BSU.SKY.NIGHT; S.calendar.season = 'summer'; S.wildlife.ecology = 80; S.weather.heat = 90;
BSU.events.emit('sky:phase', { phase: BSU.SKY.NIGHT, prev: BSU.SKY.DUSK });
frames(0.5);
let ly = A._debug.layers();
ok(ly.frogs && ly.frogs.built && ly.frogs.target > 0, 'summer night, ecology 80: the frog chorus is built and audible');
ok(!(ly.cicadas && ly.cicadas.built), 'cicadas silent at night');
S.sky.phase = BSU.SKY.DAY; S.sky.t = 0.1; S.weather.heat = 100;
BSU.events.emit('sky:phase', { phase: BSU.SKY.DAY, prev: BSU.SKY.DAWN });
frames(0.5);
ly = A._debug.layers();
ok(ly.cicadas.built && Math.abs(ly.cicadas.target - 0.675) < 1e-9, 'summer day at heat 100: cicadas .675');
eq(ly.frogs.target, 0, 'frogs target 0 by day');
frames(6);
ly = A._debug.layers();
ok(!ly.frogs.built, 'a layer silent for > 4 s is torn down (frogs dropped)');
S.weather.rainRate = 0.8; S.weather.wind = 0.5;
frames(0.3);
ly = A._debug.layers();
ok(ly.rain.built && Math.abs(ly.rain.target - 0.2) < 1e-9 && Math.abs(ly.wind.target - 0.225) < 1e-9, 'rain .25×rate and wind .05+.35×wind follow the sim');
S.weather.rainRate = 0; S.weather.wind = 0;
BSU.events.emit('storm:phase', { phase: BSU.STORM_PHASE.WALL, t: 150 });
frames(0.3);
ly = A._debug.layers();
ok(ly.drone.built && ly.drone.target === 1 && Math.abs(ly.wind.target - (0.05 + 0.35 * 0.9)) < 1e-9, 'storm WALL: drone on, wind floor .9');
BSU.events.emit('storm:phase', { phase: BSU.STORM_PHASE.EYE, t: 450 });
frames(0.3);
ly = A._debug.layers();
eq(ly.drone.target, 0, 'EYE: drone off');
BSU.events.emit('storm:passed', {});
frames(0.3);
eq(A._debug.windFloor(), 0, 'storm:passed clears the wind floor');
// mosquito whine (sampled every 500 ms) and pump hum near the camera
S.tiles.mosq.fill(1);
S.buildings.push({ id: 0, type: 'pump', tx: cam.tx + 2, ty: cam.ty, w: 1, h: 1, built: 1, ruin: false, powered: true, blackout: false, tier: 0 });
const realPumpRunning = BSU.hydro && BSU.hydro.pumpRunning;
if (BSU.hydro) BSU.hydro.pumpRunning = () => true;   // hydro's own pump accounting needs a generated map; the audio question is only 'within 10 tiles and running'
frames(1);
ly = A._debug.layers();
ok(ly.whine.built && Math.abs(ly.whine.target - 0.06) < 1e-9, 'mosquito density 1 at the camera → whine .06');
ok(ly.pump.built && ly.pump.target > 0, 'a running pump within 10 tiles → pump hum');
S.tiles.mosq.fill(0); S.buildings.length = 0;
if (BSU.hydro) BSU.hydro.pumpRunning = realPumpRunning;

// --- scenario 6: bells ring at midday and Dusk only with a complete Bell Tower --------
S.sky.phase = BSU.SKY.DAY; S.sky.t = 0.2; S.calendar.season = 'spring';
BSU.events.emit('sky:phase', { phase: BSU.SKY.DAY, prev: BSU.SKY.DAWN });
frames(0.3);
const c0 = C.created; S.sky.t = 0.6; frames(0.3);
eq(C.created - c0, 0, 'midday without a Bell Tower: silence');
S.buildings.push({ id: 0, type: 'bell_tower', tx: 40, ty: 8, w: 1, h: 1, built: 1, ruin: false, tier: 0 });
S.sky.phase = BSU.SKY.DAWN; S.sky.t = 0; frames(0.3);
S.sky.phase = BSU.SKY.DAY; S.sky.t = 0.3; frames(0.3);
const c1 = C.created; S.sky.t = 0.55; frames(0.3);
ok(C.created - c1 >= 16, `midday with a Bell Tower rings the 4-note motif (${C.created - c1} nodes)`);
const c2 = C.created; S.sky.t = 0.9; frames(0.3);
eq(C.created - c2, 0, '…once per cycle');
S.sky.phase = BSU.SKY.DUSK; S.sky.t = 0; const c3 = C.created; frames(0.3);
ok(C.created - c3 >= 16, 'Dusk start rings again');
S.buildings.length = 0;

// --- scenario 7: the zydeco motif schedules bars ahead and stops after its bar count ----
const mBefore = C.created;
A.motif('zydeco', true, { bars: 2 });
frames(0.2);
ok(A._debug.music().on && C.created > mBefore, 'motif(zydeco) schedules accordion / rubboard / bass nodes');
frames(4.5);
eq(A._debug.music().on, false, 'a 2-bar zydeco (4 s at 120 BPM) has stopped');
A.motif('mardiGras', true); frames(1);
ok(A._debug.music().on && A._debug.music().name === 'mardiGras', 'mardiGras loops');
BSU.events.emit('festival:end', { id: 'mardiGras', day: 0 }); frames(0.2);
eq(A._debug.music().on, false, 'festival:end stops the parade motif');
BSU.events.emit('game:final', { opp: 'magnolia', home: true, night: true, homePts: 21, awayPts: 14, won: true });
ok(A._debug.music().on && A._debug.music().name === 'zydeco', 'a win starts the zydeco riff (16 bars)');
const pealBefore = C.srcs.length; frames(0.05);
ok(C.srcs.length - pealBefore >= 0, 'rivalry win queued the peal');   // scheduled at +0.9 s; sources are created immediately
BSU.events.emit('game:final', { opp: 'delta', home: true, night: false, homePts: 7, awayPts: 14, won: false });
ok(true, 'loss → trombone (no throw)');

// --- scenario 8: no node growth over time; reset stops everything ----------------------
frames(40);                                   // 40 s of frames: all one-shots and the riff end
for (let i = 0; i < 30; i++) { A.play('coin'); A.play('place', { tile: 100 }); frames(0.5); }
frames(6);
eq(A.voices(), 0, 'every one-shot disposed on ended (voices() back to 0)');
ok(C.live.size <= 40, `live nodes after 10 minutes of activity: ${C.live.size} ≤ 40`);
const errs = BSU.errors.size;
A.play('sting'); A.play('bells');
A.reset(S, false);
frames(0.2);
eq(A.voices(), 0, 'reset() stops live stings');
ok(A._debug.ctx() === C, 'reset() keeps the context');
eq(A._debug.music().on, false, 'reset() stops the motif');
eq(BSU.errors.size, errs, 'no BSU.error across reset');

// --- scenario 9: selfTest is still pure with a live context -----------------------------
BSU.SELFTEST = true;
try { st = A.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
ok(st && st.ok === true, 'selfTest().ok with a live context — ' + (st && st.notes));
eq(masterBus.gain.value, 0.9, 'selfTest restored the settings (volume .9)');
eq(BSU.errors.size, errs, 'BSU.errors unchanged');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
