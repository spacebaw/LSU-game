# Brief: `src/js/audio.js` → `BSU.audio`

Read first: `docs/ARCHITECTURE.md` §1 (row 17), §2.10 (`ui.settings.volume/muted`), §3.2 `params.audio` (`voices 12, ambienceDb −12, duckDb −6, thunderDelay [0.3, 2], zydecoBpm 120`), §3.3 (`rng.fx` only), §3.4 (the events you react to), §5.11 (API — copy it; the listener list), §9.2 (the charter click = the gesture), §9.5 (headless: no context), §10.1, §10.5, §11.1 (Tier 1 audio list), §11.2 #5; `docs/GDD.md` §13 (all of it: every voice's synthesis recipe), §10.1 (the 🔊 hint at 0:35), §11.8 (`M` mute), §6.2 (audio roar, wind bed, storm drone), §8 (whistle, brass sting, crowd, sad trombone, zydeco), §12.5 (thunder delay), §6.3 (growl), §6.4 (whine ≥ .5).

---

## 1. Purpose and public surface

All sound, synthesized with WebAudio (oscillators, noise buffers, biquad filters, gain envelopes). No files, no CDNs. The `AudioContext` is created only on the first user gesture (`unlock()`), never at load, and every function is a no-op without a context (headless: `AudioContext` is undefined in the stub — on purpose).

```js
BSU.audio.init(state)              // registers event listeners only (owner 'audio'); reads nothing else
BSU.audio.reset(state, fresh)      // stops stings, re-evaluates ambience, reapplies settings; keeps the context; identical for both fresh values
BSU.audio.unlock() → void          // creates the AudioContext (webkitAudioContext fallback), the master/ambience/sfx buses; starts the ambience at −12 dB unless muted; resumes a suspended context
BSU.audio.play(name, opts?) → void // one-shots: 'place','tick','invalid','money','milestone','notify','hover','demolish','growl','splash','sting','whistle','roar','trombone','bells','peal','thunder','chime','coin'; opts {tile: i} (distance gain from the camera center), {delayMs}
BSU.audio.setAmbience(state) → void   // crossfades the bed by sky/season/weather/ecology (called from update at phase changes)
BSU.audio.update(state, dtMs) → void  // per frame: rain/wind/drone/pump-hum/mosquito-whine levels, ducking, distance
BSU.audio.mute(on); muted(); setVolume(v 0–1); applySettings(settings)
BSU.audio.motif(name: 'zydeco'|'mardiGras', on) → void   // Tier 2
BSU.audio.ready() → boolean        // context exists and is 'running'
BSU.audio.voices() → number        // live voice count (debug)
```

Module shape: `'use strict'` IIFE, `const M = (BSU.audio = BSU.audio || {})`, `init/reset/selfTest`, no `tick`. **No `AudioContext`, `window`, DOM or timers at definition time.** Use `ctx.currentTime` scheduling, never `setTimeout` for musical timing (a `setTimeout` for the thunder delay is acceptable but prefer `start(ctx.currentTime + delay)`).

## 2. State fields

Owns none. The mute/volume choice lives in `state.ui.settings` (ui persists it in `bsu.settings`); audio reads `settings` through `applySettings` and `ui.settings()`. Reads `state.sky`, `weather` (`rainRate`, `wind`, `storm`, `heat`), `calendar.season`, `wildlife.ecology`, `wildlife.mosqAt` near the camera, `buildings.list('pump')` positions + `hydro.pumpRunning`, `render.camera` (distance), `state.setPiece`, `state.sports.game` (the state field — there is no `sports.game()` function, D46).

Private: `ctx`, buses (`master → ambience/sfx/music` gains), the ambience layers (each `{source, gain, target}`), the noise buffer (2 s of white noise, generated once with `rng.fx`), voice counter, duck envelope, `motif` scheduler state.

## 3. Events

**Emits:** none.

**Listens (owner `'audio'`):** `building:placed` → `play('place')` (+ `tick` per drag tile is ui's call with `delayMs`); `building:complete` → `play('coin')`; `building:removed` → `play('demolish')`; `econ:income` (≥ $10k) → `play('money')`; `milestone:earned` → `play('milestone')`; `ui:notify` → `play('notify')` (kind `danger` → a lower two-tone); `gator:campus{enter:true}` → `play('growl', {tile: i})`; `agent:flee` → nothing (too many); `weather:lightning{tx,ty}` → `play('thunder', {tile, delayMs: lerp(300, 2000, distance/40 tiles)})`; `levee:overtop` → `play('splash')`-like white-water hiss (`'hiss'` alias of `splash` with a longer decay; add `'hiss'` to the one-shot list); `levee:breach` → `'hiss'` louder; `game:kickoff` → `play('whistle')` + crowd swell; `game:score{side:'home'}` → `play('sting')` + `roar`; `side:'away'` → a crowd groan (`'groan'`: pink noise swell with a descending filter; add it); `game:final{won}` → won: `sting` + `roar` (+ `peal` on a rivalry win), lost: `play('trombone')` once; `storm:phase` → OUTER: wind bed up; WALL: `roar`-like wind gust + the storm drone on; EYE: drone down, wind off; BACK: drone on; CLEARING: drone off; `storm:named` → `play('sting')` (a minor variant: `'stingMinor'`); `festival:start{id:'mardiGras'}` → `motif('mardiGras', true)` (Tier 2; Tier 1: `play('chime')`); `festival:end` → `motif(…, false)`; `objective:complete` → `play('chime')`; `decision:open` → `play('notify')`; `bells` are scheduled by `update` from the sky (midday = `DAY` phase `t ≈ .5` once per cycle; and `DUSK` start) when a complete Bell Tower exists → `play('bells')`; `sky:phase` → `setAmbience`; `save:loaded` → `reset`.

## 4. Rules checklist

### Tier 1

**Context and buses (GDD §13; ARCHITECTURE §5.11)**
- [ ] `unlock()`: `const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;` create once; `master.gain = settings.volume (default .5)`; `ambienceBus.gain = dB(−12)` (`dB(x) = 10^(x/20)`); `sfxBus`, `musicBus`; if `settings.muted` → `master.gain = 0` (keep the graph running so unmuting is instant). Call `ctx.resume()` on every subsequent gesture if `ctx.state === 'suspended'` (ui calls `unlock()` on the first pointerdown too).
- [ ] Voice cap: `params.audio.voices (12)` simultaneous one-shots; a 13th request steals the oldest non-ambience voice (stop it) or is dropped if it is a `hover`/`tick`.
- [ ] Ducking: while a sting/milestone/thunder plays, `ambienceBus.gain` ramps to `dB(−12 − 6)` over 30 ms and back over 400 ms after.
- [ ] Distance gain: `opts.tile` → `d = chebyshev(tile, cameraTile)`; gain `clamp(1 − d/30, .15, 1)`; stereo pan by `(tx − cameraTx)/20` clamped ±1 through a `StereoPannerNode` when available (guard: Safari < 14.1 lacks it → skip).

**Ambience bed (crossfaded by sky phase, season, weather, ecology)** — each layer is a looping synth with its own gain, target gains set by `setAmbience` and lerped in `update`:
- [ ] Frog chorus: 3–6 voices of short filtered sawtooth chirps at 180–420 Hz (each voice: an oscillator gated by a periodic gain envelope at a rate `1.5–4 Hz`, bandpass Q 8), rate ∝ `ecology/100`, **Night only** (and Dusk at half); silent at ecology < 30.
- [ ] Cicadas: band-passed noise 5–7 kHz with a 20–40 Hz tremolo (a gain LFO), summer Day only, louder with `heat.index` (gain `.3 + .5 × clamp((index − 85)/20, 0, 1)`).
- [ ] Crickets at Night in spring and fall: a 4.2 kHz sine with a 12 Hz chirp gate.
- [ ] Distant owl: a sine glide 400 → 300 Hz over 0.6 s, rarely (every 40–90 s at Night, `rng.fx`).
- [ ] Bullfrog "jug-o-rum": a 90 Hz sine burst 0.3 s near water when the camera is zoomed in (zoom 2 and a water tile within 6 of the camera center), every 8–20 s.
- [ ] Mosquito whine: a 600 Hz sine with 6 Hz vibrato (±15 Hz) at gain `.06 × clamp((mosqAtCamera − .5)/.5, 0, 1)` (mercifully quiet; `wildlife.mosqAt` at the camera tile, sampled every 500 ms).
- [ ] Bayou lap: a slow low sine (55 Hz, gain .04) + noise puffs (lowpass 400 Hz, gated at 0.4 Hz) when the camera is within 8 tiles of a bayou/water tile.
- [ ] Crossfade times 2 s; `setAmbience` is cheap (sets targets); `update` lerps `gain.value` (or uses `setTargetAtTime`).

**Weather and world**
- [ ] Rain: brown noise (white noise through a 1-pole lowpass at 300–900 Hz, cutoff and gain following `weather.rainRate`: gain `.25 × rainRate`, cutoff `300 + 600 × rainRate`).
- [ ] Wind: filtered noise (bandpass 200–800 Hz) with a slow LFO (0.1–0.3 Hz) on the cutoff; gain `.05 + .35 × wind`; rises with category (the set piece's wind 0.9 → gain .4).
- [ ] Thunder: a noise burst with a 2-s exponential decay through a lowpass sweeping 2 kHz → 120 Hz plus a sub-40 Hz sine thump (0.4 s), scheduled `delayMs` after the flash.
- [ ] Overtopping/breach: white-water hiss (`hiss`: highpassed noise 1.5 kHz, 1.2 s decay; breach 2 s at double gain).
- [ ] Storm drone: a 55 Hz sine with a slow 0.2 Hz LFO on gain (`.08`) under everything from the wall to the back half.
- [ ] Pump hum: a 60 Hz sawtooth through a lowpass 200 Hz, gain `.05` per running pump within 10 tiles of the camera (cap 3 pumps); fogger motor buzz (Tier 2 vehicle): 110 Hz square, gain .03 while the fogger is within 8.

**UI sounds**: `place` = square-wave plunk 300 → 200 Hz over 120 ms; `tick` = 1.2 kHz sine 15 ms; `invalid` = 110 Hz square buzz 150 ms; `money` = three ascending sine blips (660, 880, 1100 Hz, 60 ms each); `milestone` = a gold chime: a major triad on triangle waves (523, 659, 784 Hz, 1.2 s decay) through a short noise-convolver reverb (a 0.4-s decaying noise impulse built once); `notify` = a soft two-tone (880 → 660 Hz sine, 2 × 80 ms); `hover` = a tiny click (2 ms noise burst); `demolish` = noise crunch (lowpass 800 Hz, 300 ms); `growl` = 60 Hz sawtooth with random FM (±20 Hz at 8 Hz) 0.8 s; `splash` = filtered noise burst (bandpass 1 kHz, 200 ms); `coin` = 1,320 Hz sine 80 ms + 1,760 Hz 60 ms; `chime` = 1,047 Hz triangle 400 ms.

**Bells (Bell Tower)**: 4 decaying sines per note (fundamental + inharmonic partials at ×2.4, ×3.1, ×4.7, each 2–3 s decay, partials at −6/−9/−12 dB) in a 4-note motif (E4 G4 A4 E5 → 330, 392, 440, 659 Hz, 0.5 s apart) at midday (`DAY` phase `t` crossing .5) and Dusk start when a complete Bell Tower exists; `peal`: the motif ×3 faster on Flagship and after a rivalry win.

**Game day**: `whistle` (a 2.2 kHz square with a 30 Hz trill, 0.5 s) at kickoff; `roar` = pink noise (white through a −3 dB/oct approximation: lowpass 1 kHz + highpass 150) swell through a 400 Hz bandpass with a 0.8 s attack and 2 s release; `sting` = three detuned sawtooth "horns" (a 5-note fanfare: G4 B4 D5 G5 D5 → 392, 494, 587, 784, 587 Hz, 120 ms each, detune ±7 cents) over a snare roll (noise bursts at 16 Hz for 0.4 s); `stingMinor`: the same on G Bb D; `trombone` = a descending sawtooth glide 220 → 110 Hz over 1.2 s with a lowpass 600 Hz, once per loss; `groan` = pink noise swell with a filter sweep 800 → 200 Hz.

### Tier 2 (cut #5)

- [ ] Zydeco motif in G at 120 BPM: accordion (two detuned square waves through a bandpass 800–1,600 Hz with 5 Hz vibrato) on a 2-bar riff, rubboard (short high-passed noise ticks on eighths with second-line accents), bass (triangle on roots I–IV–V–I: G, C, D, G), 16 bars at the tailgate and after a win; Mardi Gras variant with a second-line snare pattern and tambourine (noise + 8 kHz bandpass), continuously at low volume during the parade; Zydeco Friday (every 5th Dusk with a Union) plays 8 bars.

## 5. Edge cases and invariants

- Every public function begins `if (!ctx) return;` (or the value default). `init` must not touch `window.AudioContext` (a `typeof` check is fine but do it inside `unlock`).
- Never throw: wrap node creation in try/catch (`BSU.error('audio', …)`); Safari's `webkitAudioContext` lacks some node types (`StereoPannerNode`, `createConstantSource`) — feature-detect each.
- `unlock` may be called many times (every gesture); create once, `resume()` otherwise.
- `applySettings({volume, muted})` before `unlock` stores the values for when the context exists.
- Muted = master gain 0 (graph keeps running; no CPU concern: ≤ 20 nodes for the bed).
- `update` is called every frame; do work at most every 100 ms (a private accumulator) except the lerps.
- Headless: `AudioContext` undefined → `ready() === false`; all calls no-ops; `selfTest` must pass without a context.
- Wall-clock is fine here (presentation).

## 6. selfTest() requirements

Pure; no context needed:

1. Every one-shot name in the list (`place … coin`, plus `hiss`, `groan`, `stingMinor`) has a recipe entry (a table `M.recipes[name]` of functions); calling `play(name)` without a context returns without throwing for every name.
2. `dB(−12)` ≈ 0.2512, `dB(−6)` ≈ 0.5012.
3. Distance gain: `d 0 → 1`, `d 15 → .5`, `d 40 → .15` (clamped).
4. The ambience target table: `{phase NIGHT, season 'summer', ecology 80}` → frogs > 0, cicadas 0, crickets 0; `{DAY, 'summer', 80, heat 100}` → cicadas > frogs; `{NIGHT, 'spring', 20}` → frogs 0 (ecology < 30), crickets > 0.
5. The bells motif frequencies equal `[330, 392, 440, 659]` (rounded).
6. `applySettings` before `unlock` then `muted()` reflects the setting; `setVolume(2)` clamps to 1.
7. `voices()` is 0 without a context.

## 7. Testing in isolation

```js
// scratch/test_audio.mjs — Node: no AudioContext, everything must be a no-op
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`BSU.ui = { settings(){ return BSU.state.ui.settings; } }; BSU.render = { camera: {x:0,y:0,zoom:1} }; BSU.weather = { storm(){ return null; }, heat(){ return {index:80}; } }; BSU.wildlife = { mosqAt(){ return 0; }, ecology(){ return 80; } }; BSU.buildings = { list(){ return []; }, has(){ return false; } }; BSU.hydro = { pumpRunning(){ return false; } };`, ctx);
load('audio.js');
const BSU = win.BSU; const s = BSU.state = BSU.newState(1);
BSU.audio.init(s); BSU.audio.unlock(); BSU.audio.play('sting'); BSU.audio.update(s, 16); BSU.audio.setAmbience(s);
console.log('ready', BSU.audio.ready(), BSU.audio.selfTest());
```
Then in Chrome (real sound): `node test/browser.mjs` cannot hear; use the built game, click charter (ambience must start at −12 dB with 🔊 lit), press `M` (silence, persisted after reload), place a building (plunk), drag a path (ticks), spawn a Cat 3 from the debug panel (wind bed rising, thunder delayed after flashes, the drone, hiss on overtopping), trigger a home game (whistle, sting + roar on scores, trombone on a loss). Check `chrome://media-internals` or the DevTools performance panel: ≤ 40 audio nodes live, no growth over 10 minutes (one-shots must disconnect on `ended`).

## 8. Performance budget

≤ 0.2 ms per `update` (lerps only, sampling every 100 ms); ≤ 40 live nodes; one-shot nodes disconnected on `ended` (attach `onended`); no allocation per frame; the noise buffer and the reverb impulse built once at `unlock`.

## 9. Done means

- `selfTest().ok` in Node without a context; `node test/modules.mjs` passes; `node test/smoke.mjs` never touches audio.
- In Chrome and Safari: ambience starts on the charter click, every event in §3 makes its sound, `M` mutes and the choice survives a reload, the voice cap holds during a fireworks-heavy final, no clicks/pops (every envelope has ≥ 5 ms attack and release ramps), no `console.error` (e.g. from a suspended context — `resume()` on gesture).
