'use strict';
// ============================================================================
// BAYOU STATE — session.js (module 19, the LAST file in the manifest) → BSU.session,
// BSU.state, BSU.headless, BSU.headlessMode (finalized here), the boot and the main loop.
// Owner of: state.seed, state.tick, state.playSeconds, state.setPiece, state.saveMeta,
// state.rng.sim (mirror of BSU.rng.sim.state after every tick), state.calendar.frozen
// (step 0), state.economy.ecology (the mirror, step 10), state.ui.speed/speedBefore
// (through setSpeed/restoreSpeed). Replaces BSU.state wholesale on newGame/load.
// Implements: ARCHITECTURE.md §1 (init/reset/tick order), §5.1 (the tick table — tick1),
// §8 (save schema v1, load, migrate, autosave, slots), §9 (boot, charter, the fixed-step
// loop, skipTutorial, BSU.headless), §10.1 (error policy), §10.2 (determinism), §10.6
// (the session.selfTest exemption); GDD §0.1 (timing), §9.4 (speed rules), §15.1–15.2.
// Zero DOM / timer / RAF / audio access at definition time: boot() runs at the end of this
// file but only touches the DOM inside try/catch and calls requestAnimationFrame only in a
// real browser (never when BSU.headlessMode). tick1 never reads the wall clock.
// Guarded siblings: render, render_fx, ui, ui_panels and progress may be absent (they are
// called when present, else no-op) so the game boots and runs headless without them.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.session = BSU.session || {});

  // Finalize headless detection (§9.1 step 0; D3). contract.js computed the first guess.
  BSU.headlessMode = BSU.headlessMode || (typeof window !== 'undefined' && !!window.BSU_FORCE_HEADLESS);

  const P = BSU.params;
  const PT = P.time;
  const EV = BSU.EV;
  const APP = 'bayou-state';
  const KEY_PREFIX = 'bsu.save.';
  const KEY_LAST = 'bsu.last';
  const KEY_SETTINGS = 'bsu.settings';
  const NAMED_SLOTS = ['auto.0', 'auto.1', 'auto.2', 'manual.0', 'manual.1', 'manual.2'];
  /** manifest order of module objects (split files share their object, so they are listed once) */
  const MODULES = ['data', 'terrain', 'hydro', 'weather', 'wildlife', 'buildings', 'economy', 'agents', 'sports', 'sprites', 'render', 'ui', 'audio', 'progress'];
  /** §5.1 steps 1–9 (weather first; progress last) */
  const SIM_ORDER = ['weather', 'terrain', 'hydro', 'buildings', 'wildlife', 'agents', 'economy', 'sports', 'progress'];
  /** header fields written next to the branches (never cloned as a branch) */
  const HEADER_KEYS = { v: 1, app: 1, savedAt: 1, label: 1, seed: 1, tick: 1, playSeconds: 1, setPiece: 1, saveMeta: 1, rng: 1, tiles: 1 };
  const REMEMBER_REASONS = { cone: 1, warning: 1, setpiece: 1, receiver: 1 };

  // --- private state (closure; none of it is game state) ----------------------------
  const slots = new Map();          // slot → json (always written alongside localStorage)
  let acc = 0, last = 0;
  let deferredAutosave = false;
  let suppressAutosave = false;
  let booted = false;
  let loopRunning = false;
  let titleWorld = false;
  let autoIndex = -1;               // last auto.N written (−1 = none yet)
  let pendingRestore = {};          // reason → true while a speedBefore is remembered for it
  let saveHintShown = false;

  // --- tiny helpers -------------------------------------------------------------------
  /** the live module object or null */
  function mod(name) { const m = BSU[name]; return (m && typeof m === 'object') ? m : null; }
  /** call BSU.<name>.<fn>(...args) when it exists; a throw is routed to BSU.error (rethrows under SELFTEST) */
  function call(name, fn) {
    const m = mod(name);
    if (!m || typeof m[fn] !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try { return m[fn].apply(m, args); }
    catch (e) { BSU.error('session', name + '.' + fn, e); return undefined; }
  }
  function has(name, fn) { const m = mod(name); return !!(m && typeof m[fn] === 'function'); }
  function emit(name, payload) { try { BSU.events.emit(name, payload); } catch (e) { if (BSU.SELFTEST) throw e; } }
  function lsGet(k) { try { return window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsRemove(k) { try { if (window.localStorage) window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  /** the one allowed Math.random: the title/new-game seed when none is given (§9.1) */
  function randomUint32() { return ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0) || 1; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v); }
  function fin(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }
  function r2(v) { return Math.round(fin(v, 0) * 100) / 100; }
  function state() { return BSU.state; }

  /** persisted settings (bsu.settings) merged over the contract defaults (and over `extra`, when given) */
  function readSettings(extra) {
    const defaults = BSU.newState(0).ui.settings;
    let persisted = null;
    try { const raw = lsGet(KEY_SETTINGS); persisted = raw ? JSON.parse(raw) : null; } catch (e) { persisted = null; }
    return Object.assign({}, defaults, isPlainObject(extra) ? extra : {}, isPlainObject(persisted) ? persisted : {});
  }

  /** recursive scan for a non-finite number; returns the first bad path or null (typed arrays included) */
  function scanNumbers(obj, path, seen, depth) {
    path = path || 'state'; seen = seen || new Set(); depth = depth || 0;
    if (obj == null || depth > 14) return null;
    if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
    if (typeof obj !== 'object') return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (ArrayBuffer.isView(obj)) { for (let i = 0; i < obj.length; i++) if (!Number.isFinite(obj[i])) return path + '[' + i + ']'; return null; }
    if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const r = scanNumbers(obj[i], path + '[' + i + ']', seen, depth + 1); if (r) return r; } return null; }
    const keys = Object.keys(obj);
    for (let k = 0; k < keys.length; k++) { const r = scanNumbers(obj[keys[k]], path + '.' + keys[k], seen, depth + 1); if (r) return r; }
    return null;
  }
  M._scanNumbers = scanNumbers;

  // ============================================================================
  // Speed (D7; GDD §9.4)
  // ============================================================================
  /** Write ui.speed (any finite ≥ 0), remember speedBefore for cone|warning|setpiece|receiver, emit speed:changed. */
  M.setSpeed = function (s, speed, reason) {
    s = s || BSU.state; if (!s || !s.ui) return;
    speed = Number(speed);
    if (!Number.isFinite(speed) || speed < 0) { BSU.error('session', 'setSpeed', new Error('speed must be a finite number ≥ 0, got ' + speed)); return; }
    const prev = fin(s.ui.speed, 1);
    if (REMEMBER_REASONS[reason] && !pendingRestore[reason]) { s.ui.speedBefore = prev; pendingRestore[reason] = true; }
    s.ui.speed = speed;
    emit(EV.SPEED_CHANGED || 'speed:changed', { speed: speed, prev: prev, reason: reason || 'user' });
  };
  /** Put speedBefore back (reason names the pending remember it releases). */
  M.restoreSpeed = function (s, reason) {
    s = s || BSU.state; if (!s || !s.ui) return;
    pendingRestore[reason] = false;
    M.setSpeed(s, fin(s.ui.speedBefore, 1), 'restore');
  };

  // ============================================================================
  // Set pieces (D13; §2.1, §9.3) — the calendar freeze is owned here (step 0 of tick1)
  // ============================================================================
  /** Start a set piece; false when one already runs. The owner scripts the sky and its own timeline. */
  M.startSetPiece = function (s, kind, opts) {
    s = s || BSU.state; opts = opts || {};
    if (!s || s.setPiece) return false;
    const len = (Number.isFinite(opts.len) && opts.len > 0) ? Math.floor(opts.len) : (BSU.SET_PIECES[kind] || PT.nearMissTicks);
    s.setPiece = { kind: String(kind), tick: 0, len: len, skippable: !!opts.skippable, choices: {}, speedBefore: fin(s.ui.speed, 1), cameraTouched: false };
    s.ui.speedBefore = fin(s.ui.speed, 1);
    s.calendar.frozen = true;
    emit(EV.SETPIECE_START || 'setpiece:start', { kind: s.setPiece.kind, len: len });
    return true;
  };
  /** End the running set piece: release the sky, restore the speed, emit setpiece:end, run a deferred autosave. */
  M.endSetPiece = function (s) {
    s = s || BSU.state;
    if (!s || !s.setPiece) return;
    const kind = s.setPiece.kind, len = s.setPiece.len;
    s.setPiece = null;
    s.calendar.frozen = !s.calendar.running;
    call('weather', 'releaseSky', s);
    M.restoreSpeed(s, 'setpiece');
    emit(EV.SETPIECE_END || 'setpiece:end', { kind: kind, len: len });
    if (deferredAutosave) { deferredAutosave = false; autosave(); }
  };
  /** Skip the running set piece when skippable and past params.time.skipAfterTick; dispatches to the owner. */
  M.skipSetPiece = function (s) {
    s = s || BSU.state;
    const sp = s && s.setPiece;
    if (!sp || !sp.skippable || sp.tick < PT.skipAfterTick) return;
    const kind = sp.kind, len = sp.len;
    if (kind === 'landfall') call('weather', 'skipSetPiece', s);
    else if (kind === 'game' || kind === 'montage') call('sports', 'skipToFinal', s);
    else if ((kind === 'parade' || kind === 'graduation') && has('progress', 'skipSetPiece')) call('progress', 'skipSetPiece', s);
    else sp.tick = len - 1;
    if (s.setPiece === sp && sp.tick < len - 1 && kind !== 'game' && kind !== 'montage') sp.tick = len - 1;
    emit(EV.SETPIECE_SKIP || 'setpiece:skip', { kind: kind, len: len });
  };

  // ============================================================================
  // One sim tick (§5.1 — the order is law)
  // ============================================================================
  /** Execute one 100 ms sim tick in the §5.1 order with per-module try/catch. Never throws. */
  M.tick1 = function () {
    const s = BSU.state;
    if (!s || !s.calendar) return;
    // 0. bookkeeping
    s.calendar.frozen = !s.calendar.running || !!s.setPiece;
    // 1. weather (owns the date, sky, dtDay; returns the day flags)
    let flags = null;
    const W = mod('weather');
    if (W && typeof W.tick === 'function') { try { flags = W.tick(s); } catch (e) { BSU.error('weather', 'tick', e); flags = null; } }
    if (!flags || typeof flags !== 'object') flags = { newDay: false, newMonth: false, newYear: false, newSemester: false, day: fin(s.calendar.day, 0) };
    // 2–9. the sim modules
    for (let k = 1; k < SIM_ORDER.length; k++) {
      const name = SIM_ORDER[k];
      const m = BSU[name];
      if (!m || typeof m.tick !== 'function') continue;
      try { m.tick(s, flags); } catch (e) { BSU.error(name, 'tick', e); }
    }
    // 10. session bookkeeping
    if (s.setPiece) {
      if (s.setPiece.tick + 1 >= s.setPiece.len) { try { M.endSetPiece(s); } catch (e) { BSU.error('session', 'endSetPiece', e); } }
      else s.setPiece.tick++;
    }
    s.rng.sim = BSU.rng.sim.state;
    if (s.wildlife && s.economy) s.economy.ecology = fin(s.wildlife.ecology, 0);
    s.tick++;
    if (BSU.headlessMode) s.playSeconds = s.tick / 10;
    if (flags.newMonth && !suppressAutosave && (!BSU.headlessMode || BSU.headless.autosave === true)) {
      if (s.setPiece) deferredAutosave = true;
      else autosave();
    }
  };

  // ============================================================================
  // New game (§9.1, §9.4)
  // ============================================================================
  /** skipTutorial pre-placement (§9.4, D28, D57): Founders' Hall, the G3 land path to the landing, 120 students. */
  function applySkipTutorial(s) {
    const plot = s.plot || {};
    const f = plot.founders;
    if (!f) { BSU.error('session', 'skipTutorial', new Error('no plot.founders (terrain.gen failed?)')); return; }
    const placed = call('buildings', 'place', s, 'founders_hall', f.tx, f.ty, { rot: 0, ignoreCash: true, instant: true });
    if (!placed || !placed.ok) BSU.error('session', 'skipTutorial:founders', new Error('Founders’ Hall refused: ' + (placed && placed.reason)));
    const frontTile = BSU.idx(f.tx + 1, f.ty + 3);
    if (Number.isInteger(plot.landingShoulder) && plot.landingShoulder >= 0) {
      const route = call('terrain', 'landRoute', s, frontTile, plot.landingShoulder);
      if (Array.isArray(route) && route.length) call('buildings', 'placeRun', s, 'path', route, { ignoreCash: true });
      else BSU.error('session', 'skipTutorial:path', new Error('terrain.landRoute found no land route to the landing shoulder'));
    }
    if (has('weather', 'setRunning')) call('weather', 'setRunning', s, true); else { s.calendar.running = true; s.calendar.frozen = false; }
    M.setSpeed(s, 1, 'user');
    if (s.progress) s.progress.tutorialStage = 6;
    // progress marks Objectives 1–5 done without grants and introduces every tab; it queues no cell (D57).
    call('progress', 'applySkipTutorial', s);
    call('economy', 'setSuspendCapPenalties', s, false);
    call('economy', 'setSuppressCoverage', s, false);
    call('economy', 'addStudents', s, 120, 'founding');
    call('agents', 'regenerate', s);
    s.ui.speed = 1;
  }

  /** New game: seed → newState → BSU.state → rng.sim in place → terrain.gen → every reset(state, true) → tutorial | skipTutorial | title. */
  M.newGame = function (opts) {
    opts = opts || {};
    const seed = (opts.seed >>> 0) || randomUint32();
    const s = BSU.newState(seed);
    BSU.state = s;                                   // before generation: rng.derive('reroll', k) mixes THIS seed (D40)
    BSU.rng.sim.state = s.rng.sim;                   // in place; the Stream is never replaced (D39)
    titleWorld = !!opts.title;
    pendingRestore = {};
    deferredAutosave = false;
    try { if (has('terrain', 'gen')) BSU.terrain.gen(s, seed); } catch (e) { BSU.error('session', 'newGame:gen', e); }
    for (let k = 0; k < MODULES.length; k++) {
      const name = MODULES[k];
      const m = BSU[name];
      if (!m || typeof m.reset !== 'function') continue;
      try { m.reset(s, true); } catch (e) { BSU.error('session', 'reset:' + name, e); }
    }
    s.ui.settings = readSettings(s.ui.settings);     // settings survive new games
    if (opts.title) {
      s.calendar.running = false; s.calendar.frozen = true;
      s.ui.speed = 0;
      if (s.progress) s.progress.tutorialStage = 0;
      call('weather', 'scriptSky', s, BSU.SKY.NIGHT, 0.3);
      const R = mod('render'); if (R) { try { R.titleDrift = true; } catch (e) { /* frozen */ } }
    } else {
      const R = mod('render'); if (R) { try { R.titleDrift = false; } catch (e) { /* frozen */ } }
      if (opts.skipTutorial) applySkipTutorial(s);
      else { if (s.progress) s.progress.tutorialStage = 1; s.ui.speed = 1; }   // progress drives the swoop/charter; calendar waits for Objective 2
    }
    if (s.wildlife && s.economy) s.economy.ecology = fin(s.wildlife.ecology, 0);
    s.rng.sim = BSU.rng.sim.state;
    return s;
  };

  // ============================================================================
  // Save (§8.1; D20, D23, D48)
  // ============================================================================
  function deletePath(obj, path) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (!o || typeof o !== 'object') return; o = o[parts[i]]; }
    if (o && typeof o === 'object') delete o[parts[parts.length - 1]];
  }
  /** replace every non-finite number in a cloned doc with 0, reporting each path once */
  function sanitize(obj, path) {
    if (obj == null || typeof obj !== 'object') return;
    if (ArrayBuffer.isView(obj)) return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i];
        if (typeof v === 'number') { if (!Number.isFinite(v)) { BSU.error('session', 'save:nonfinite:' + path + '[' + i + ']', new Error('non-finite ' + v)); obj[i] = 0; } }
        else if (v && typeof v === 'object') sanitize(v, path + '[' + i + ']');
      }
      return;
    }
    const keys = Object.keys(obj);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k], v = obj[key];
      if (typeof v === 'number') { if (!Number.isFinite(v)) { BSU.error('session', 'save:nonfinite:' + path + '.' + key, new Error('non-finite ' + v)); obj[key] = 0; } }
      else if (v && typeof v === 'object') sanitize(v, path + '.' + key);
    }
  }
  /** Build the v1 doc structurally: header + every enumerable branch (deepClone) + tiles as b64, minus BSU.SAVE_SKIP. */
  function buildDoc(s, label) {
    const doc = {
      v: BSU.SAVE_VERSION, app: APP, savedAt: BSU.headlessMode ? 0 : Date.now(), label: String(label || ''),
      seed: fin(s.seed, 0) >>> 0, tick: fin(s.tick, 0), playSeconds: fin(s.playSeconds, 0),
      setPiece: s.setPiece ? BSU.deepClone(s.setPiece) : null,
      saveMeta: BSU.deepClone(s.saveMeta || { slot: '', savedAt: 0, label: '' }),
      rng: { sim: fin(s.rng && s.rng.sim, 0) >>> 0 }
    };
    const keys = Object.keys(s);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (HEADER_KEYS[key] || key === 'agents' || key === 'vehicles') continue;
      doc[key] = BSU.deepClone(s[key]);
    }
    doc.tiles = {};
    const names = Object.keys(BSU.TILE_ARRAYS);
    for (let k = 0; k < names.length; k++) {
      const name = names[k];
      const arr = s.tiles && s.tiles[name];
      if (!arr || !ArrayBuffer.isView(arr)) continue;
      let src = arr;
      if (arr instanceof Float32Array) {
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) {
            BSU.error('session', 'save:nonfinite:tiles.' + name + '[' + i + ']', new Error('non-finite ' + arr[i]));
            if (src === arr) src = arr.slice();
            src[i] = 0;
          }
        }
      }
      doc.tiles[name] = BSU.b64.encode(src);
    }
    for (let k = 0; k < BSU.SAVE_SKIP.length; k++) deletePath(doc, BSU.SAVE_SKIP[k]);
    sanitize(doc, 'state');
    return doc;
  }
  /** Save the live game to `slot`: in-memory map + localStorage (try/catch) + bsu.last; returns the JSON string. */
  M.save = function (slot) {
    const s = BSU.state;
    slot = String(slot == null ? 'manual.0' : slot);
    if (!s) { BSU.error('session', 'save', new Error('no live game')); return ''; }
    const label = BSU.formatDate(fin(s.calendar && s.calendar.day, 0));
    const doc = buildDoc(s, label);
    const json = JSON.stringify(doc);
    slots.set(slot, json);
    const isPrivate = slot.charAt(0) === '_';
    let stored = lsSet(KEY_PREFIX + slot, json);
    if (stored && !isPrivate) lsSet(KEY_LAST, slot);
    if (!stored && !saveHintShown && !BSU.headlessMode) { saveHintShown = true; call('ui', 'hint', s, 'saveUnavailable', { slot: slot }); }
    s.saveMeta = { slot: slot, savedAt: doc.savedAt, label: label };
    const am = /^auto\.(\d)$/.exec(slot); if (am) autoIndex = Number(am[1]);
    emit(EV.SAVE_WRITTEN || 'save:written', { slot: slot, bytes: json.length });
    return json;
  };
  /** Autosave rotation auto.((n+1) % 3) (§8.4); label = the formatted date. */
  function autosave() {
    const s = BSU.state;
    if (!s || !s.plot || !s.plot.founders || titleWorld) return;
    if (autoIndex < 0 && s.saveMeta && typeof s.saveMeta.slot === 'string') { const m = /^auto\.(\d)$/.exec(s.saveMeta.slot); if (m) autoIndex = Number(m[1]); }
    const n = ((autoIndex < 0 ? -1 : autoIndex) + 1) % 3;
    try { M.save('auto.' + n); } catch (e) { BSU.error('session', 'autosave', e); }
  }
  M._autosave = autosave;

  // ============================================================================
  // Load (§8.2–8.3)
  // ============================================================================
  M.migrations = { 1: function (doc) { return doc; } };
  /** Upgrade `doc` in place to BSU.SAVE_VERSION; returns the doc, or null when refused (newer version / wrong app). */
  M.migrate = function (doc) {
    if (!doc || typeof doc !== 'object' || doc.app !== APP || typeof doc.v !== 'number' || !Number.isFinite(doc.v)) return null;
    let guard = 0;
    while (doc.v < BSU.SAVE_VERSION && guard++ < 64) {
      const fn = M.migrations[doc.v];
      if (typeof fn !== 'function') return null;
      const next = fn(doc);
      if (next && typeof next === 'object') doc = next;
      doc.v++;
    }
    if (doc.v !== BSU.SAVE_VERSION) return null;
    return doc;
  };
  /** fill keys missing in target from defaults (recursive over plain objects); null stays null; unknown keys kept */
  function fillDefaults(target, defaults) {
    if (!isPlainObject(target) || !isPlainObject(defaults)) return target;
    const keys = Object.keys(defaults);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const d = defaults[key];
      if (target[key] === undefined) target[key] = BSU.deepClone(d);
      else if (isPlainObject(target[key]) && isPlainObject(d)) fillDefaults(target[key], d);
    }
    return target;
  }
  /** copy a parsed doc over a fresh tree */
  function applyDoc(s, doc) {
    s.seed = fin(doc.seed, s.seed) >>> 0;
    s.tick = Math.max(0, Math.floor(fin(doc.tick, 0)));
    s.playSeconds = fin(doc.playSeconds, 0);
    s.setPiece = isPlainObject(doc.setPiece) ? fillDefaults(BSU.deepClone(doc.setPiece), { kind: 'landfall', tick: 0, len: PT.landfallTicks, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false }) : null;
    s.saveMeta = fillDefaults(isPlainObject(doc.saveMeta) ? BSU.deepClone(doc.saveMeta) : {}, { slot: '', savedAt: 0, label: '' });
    if (doc.rng && Number.isFinite(doc.rng.sim)) s.rng.sim = doc.rng.sim >>> 0;
    // typed arrays decoded into the preallocated arrays
    const names = Object.keys(BSU.TILE_ARRAYS);
    for (let k = 0; k < names.length; k++) {
      const name = names[k];
      const str = doc.tiles && doc.tiles[name];
      if (typeof str !== 'string') continue;
      try {
        const dec = BSU.b64.decode(str, BSU.TILE_ARRAYS[name]);
        const dst = s.tiles[name];
        dst.set(dec.length <= dst.length ? dec : dec.subarray(0, dst.length));
      } catch (e) { BSU.error('session', 'load:tiles.' + name, e); }
    }
    // plain branches: replaced wholesale, then missing keys filled from the fresh tree; unknown keys kept; no value translation
    const keys = Object.keys(doc);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (HEADER_KEYS[key] || key === 'agents' || key === 'vehicles') continue;
      const v = doc[key];
      if (isPlainObject(v)) s[key] = fillDefaults(BSU.deepClone(v), s[key]);
      else if (Array.isArray(v)) s[key] = BSU.deepClone(v);
      else if (v !== undefined) s[key] = v;
    }
    // derived / UI-only fields (SAVE_SKIP) start fresh
    s.agents = []; s.vehicles = [];
    if (s.hydro) { s.hydro.networks = null; s.hydro.risk = null; s.hydro.active = null; }
    if (s.wildlife) s.wildlife.campusMask = null;
    if (s.ui) {
      s.ui.tool = null; s.ui.panel = null; s.ui.perfMode = false;
      if (s.ui.camera) { s.ui.camera.tx = fin(s.ui.camera.x, 0); s.ui.camera.ty = fin(s.ui.camera.y, 0); }
      s.ui.settings = readSettings(s.ui.settings);  // the persisted settings win over the save's
    }
    if (!s.setPiece && s.calendar) s.calendar.frozen = !s.calendar.running;
  }
  /** Load `slot` (localStorage, else the in-memory map): migrate → newState(seed) → copy → resets(false) → save:loaded. Null when missing/refused. */
  M.load = function (slot) {
    slot = String(slot == null ? '' : slot);
    let json = lsGet(KEY_PREFIX + slot);
    if (json == null) json = slots.has(slot) ? slots.get(slot) : null;
    const live = BSU.state;
    if (json == null) { if (!BSU.headlessMode) call('ui', 'notify', live, { kind: 'danger', text: 'No save in slot ' + slot }); return null; }
    let doc = null;
    try { doc = JSON.parse(json); } catch (e) { doc = null; }
    if (!doc || typeof doc !== 'object') { if (!BSU.headlessMode) call('ui', 'notify', live, { kind: 'danger', text: 'That save could not be read' }); return null; }
    const docV = doc.v;
    const migratedDoc = M.migrate(doc);
    if (!migratedDoc) {
      if (!BSU.headlessMode) call('ui', 'card', live, 'versionMismatch', { seed: fin(doc.seed, 0) >>> 0, version: docV });
      return null;
    }
    doc = migratedDoc;
    const s = BSU.newState(fin(doc.seed, 0) >>> 0);
    applyDoc(s, doc);
    BSU.state = s;
    BSU.rng.sim.state = s.rng.sim;                   // in place (D39)
    titleWorld = false;
    pendingRestore = {};
    deferredAutosave = false;
    for (let k = 0; k < MODULES.length; k++) {
      const name = MODULES[k];
      const m = BSU[name];
      if (!m || typeof m.reset !== 'function') continue;
      try { m.reset(s, false); } catch (e) { BSU.error('session', 'reset:' + name, e); }
    }
    s.saveMeta.slot = slot;
    const am = /^auto\.(\d)$/.exec(slot); if (am) autoIndex = Number(am[1]);
    emit(EV.SAVE_LOADED || 'save:loaded', { slot: slot, version: fin(docV, BSU.SAVE_VERSION), migrated: docV !== BSU.SAVE_VERSION });
    if (!BSU.headlessMode) call('ui', 'showTitle', false);
    return s;
  };
  /** Continue = load bsu.last. */
  M.continue_ = function () { const lastSlot = lsGet(KEY_LAST); return lastSlot ? M.load(lastSlot) : null; };
  /** The six named slots plus any in-memory ones that hold a save: {slot, savedAt, label}[]. */
  M.slots = function () {
    const out = [];
    const seen = new Set();
    const names = NAMED_SLOTS.concat(Array.from(slots.keys()));
    for (let k = 0; k < names.length; k++) {
      const slot = names[k];
      if (seen.has(slot)) continue;
      seen.add(slot);
      let json = lsGet(KEY_PREFIX + slot);
      if (json == null) json = slots.has(slot) ? slots.get(slot) : null;
      if (json == null) continue;
      let savedAt = 0, label = '';
      try { const d = JSON.parse(json); savedAt = fin(d.savedAt, 0); label = typeof d.label === 'string' ? d.label : ''; } catch (e) { continue; }
      out.push({ slot: slot, savedAt: savedAt, label: label });
    }
    return out;
  };
  /** Remove a slot from localStorage and the in-memory map (and bsu.last when it pointed there). */
  M.deleteSlot = function (slot) {
    slot = String(slot);
    slots.delete(slot);
    lsRemove(KEY_PREFIX + slot);
    if (lsGet(KEY_LAST) === slot) lsRemove(KEY_LAST);
  };

  // ============================================================================
  // Debug: skip to a calendar date (bounded by 2 years), autosave off
  // ============================================================================
  M.skipToDate = function (s, dateStr, yearOffset) {
    s = s || BSU.state; if (!s) return;
    let target = call('weather', 'dayOf', s, dateStr, yearOffset || 0);
    if (!Number.isFinite(target) || target < 0) { try { target = BSU.dateToDay(dateStr, (s.calendar.year || 1) + (yearOffset || 0)); } catch (e) { target = -1; } }
    if (!Number.isFinite(target) || target < 0) { BSU.error('session', 'skipToDate', new Error('unparsable date ' + dateStr)); return; }
    if (target <= s.calendar.day) target += PT.daysPerYear;
    const wasSuppressed = suppressAutosave;
    suppressAutosave = true;
    try {
      const max = 2 * PT.daysPerYear * PT.ticksPerDay;
      for (let n = 0; n < max && BSU.state === s && s.calendar.day !== target; n++) {
        M.tick1();
        if (s.setPiece && s.setPiece.skippable && s.setPiece.tick >= PT.skipAfterTick) M.skipSetPiece(s);
      }
    } finally { suppressAutosave = wasSuppressed; }
  };

  // ============================================================================
  // BSU.headless (§9.5; docs/HEADLESS_API.md) — always defined, also in browsers
  // ============================================================================
  /** Chebyshev-ring spiral from (cx, cy): ring order, each ring clockwise from its top-left; first (tx, ty) where test() is true. */
  function spiral(cx, cy, maxR, test) {
    const W = BSU.MAP.W, Hh = BSU.MAP.H;
    const probe = function (tx, ty) { return tx >= 0 && ty >= 0 && tx < W && ty < Hh && test(tx, ty); };
    if (probe(cx, cy)) return { x: cx, y: cy };
    for (let r = 1; r <= maxR; r++) {
      for (let x = cx - r; x <= cx + r; x++) if (probe(x, cy - r)) return { x: x, y: cy - r };                 // top: left → right
      for (let y = cy - r + 1; y <= cy + r; y++) if (probe(cx + r, y)) return { x: cx + r, y: y };             // right: top → bottom
      for (let x = cx + r - 1; x >= cx - r; x--) if (probe(x, cy + r)) return { x: x, y: cy + r };             // bottom: right → left
      for (let y = cy + r - 1; y >= cy - r + 1; y--) if (probe(cx - r, y)) return { x: cx - r, y: y };         // left: bottom → top
    }
    return null;
  }
  function agentsCount(s) {
    if (has('agents', 'count')) { const n = call('agents', 'count', s); if (Number.isFinite(n)) return n; }
    const st = fin(s.economy && s.economy.students, 0);
    return st > 0 ? Math.min(P.agents && P.agents.maxAgents || 300, 40 + Math.floor(st / 25)) : 0;
  }
  const H = {
    autosave: false,
    /** run n fixed 100 ms ticks synchronously (set pieces included; no rendering) */
    tick: function (n) { n = Math.max(0, Math.floor(fin(Number(n), 0))); for (let k = 0; k < n; k++) M.tick1(); },
    /** one render frame + HUD update (+ audio.update) on the stub canvas; a safe no-op when render/ui are absent */
    render: function () {
      const s = BSU.state; if (!s) return;
      const R = mod('render');
      if (R && typeof R.frame === 'function') { try { R.frame(s, 0, 16.67); } catch (e) { BSU.error('render', 'frame', e); } }
      const U = mod('ui');
      if (U && typeof U.update === 'function') { try { U.update(s, 16.67); } catch (e) { BSU.error('ui', 'update', e); } }
      const A = mod('audio');
      if (A && typeof A.update === 'function') { try { A.update(s, 16.67); } catch (e) { BSU.error('audio', 'update', e); } }
    },
    /** plain JSON-able summary of saved fields and pure functions of saved fields (never state.agents.length) */
    snapshot: function () {
      const s = BSU.state;
      if (!s) return null;
      const cal = s.calendar || {}, e = s.economy || {}, b = s.buildings || [];
      let nb = 0; for (let i = 0; i < b.length; i++) if (b[i]) nb++;
      let floodedTiles = 0, floodedBuildings = 0;
      if (has('hydro', 'floodedTiles')) floodedTiles = fin(call('hydro', 'floodedTiles', s), 0);
      if (has('hydro', 'floodedBuildings')) { const fb = call('hydro', 'floodedBuildings', s); floodedBuildings = Array.isArray(fb) ? fb.length : fin(fb, 0); }
      const cur = s.storms && s.storms.current;
      return {
        year: fin(cal.year, 1), month: fin(cal.month, 1), day: fin(cal.dom, 1), tick: fin(s.tick, 0),
        cash: fin(e.cash, 0), students: fin(e.students, 0),
        prestige: r2(e.prestige), happiness: r2(e.happiness), ecology: r2(e.ecology),
        buildings: nb, agents: agentsCount(s), gators: Array.isArray(s.gators) ? s.gators.length : 0,
        floodedTiles: floodedTiles, floodedBuildings: floodedBuildings,
        storm: cur ? { name: String(cur.name || ''), cat: fin(cur.cat, 0), phase: fin(cur.phase, 0) } : null,
        speed: fin(s.ui && s.ui.speed, 0)
      };
    },
    /** {x, y} of a legal placement for a catalog id near plot.founders (D21), or null */
    findSpot: function (id) {
      const s = BSU.state;
      const row = BSU.data && BSU.data.catalog ? BSU.data.catalog[id] : null;
      if (!s || !row || !has('buildings', 'canPlace') || !s.plot || !s.plot.founders) return null;
      const B = BSU.buildings;
      const okAt = function (tx, ty, opts) { try { const r = B.canPlace(s, id, tx, ty, opts); return !!(r && r.ok); } catch (e) { if (BSU.SELFTEST) throw e; return false; } };
      if (id === 'pilings') {
        for (let i = 0; i < s.buildings.length; i++) {
          const bld = s.buildings[i];
          if (!bld || bld.pilings) continue;
          if (okAt(bld.tx, bld.ty, { target: bld.id, ignoreCash: true })) return { x: bld.tx, y: bld.ty };
        }
        return null;
      }
      const f = s.plot.founders;
      let p = spiral(f.tx, f.ty, 40, function (tx, ty) { return okAt(tx, ty, { rot: 0, ignoreCash: true }); });
      if (!p && row.kind === 'footprint' && row.rotatable) p = spiral(f.tx, f.ty, 40, function (tx, ty) { return okAt(tx, ty, { rot: 1, ignoreCash: true }); });
      return p;
    },
    /** = buildings.place(state, id, x, y, {rot: 0}) — the UI's validation/cost path (charges cash; 'pilings' retrofits the building at x, y) */
    place: function (id, x, y) {
      const s = BSU.state;
      if (!s || !has('buildings', 'place')) return { ok: false, reason: 'buildings unavailable' };
      const r = call('buildings', 'place', s, id, x | 0, y | 0, { rot: 0 });
      return (r && typeof r === 'object') ? r : { ok: false, reason: 'Cannot place here' };
    },
    /** a compressed (tick-driven) storm: cone now, watch +300, bands +500, landfall set piece at +600 (D51) */
    forceHurricane: function (cat) {
      const s = BSU.state;
      if (!s || !has('weather', 'spawnStorm')) return null;
      const c = BSU.clamp(Math.round(fin(Number(cat), 3)), 1, 5);
      const st = call('weather', 'spawnStorm', s, { cat: c, coneNowTick: s.tick, landfallTick: s.tick + 600, compressed: true });
      return st || null;
    },
    /** a left click at canvas pixel coords through ui's input state machine (mods always carry all four booleans, D56) */
    click: function (px, py) {
      const mods = { ctrl: false, shift: false, meta: false, alt: false };
      if (!has('ui', 'pointer')) return;
      call('ui', 'pointer', 'down', px, py, 0, mods);
      call('ui', 'pointer', 'up', px, py, 0, mods);
    },
    /** a keydown by KeyboardEvent.key name; multi-char names also travel as `code` so key('Backquote') reaches the debug binding */
    key: function (name) {
      name = String(name);
      if (!has('ui', 'keydown')) return;
      call('ui', 'keydown', name, { ctrl: false, shift: false, meta: false, alt: false, code: name.length === 1 ? undefined : name });
    },
    fastForwardDays: function (n) { H.tick(Math.max(0, Math.floor(fin(Number(n), 0))) * PT.ticksPerDay); },
    state: state
  };
  BSU.headless = H;

  // ============================================================================
  // Main loop (§9.3, D7) — browser only
  // ============================================================================
  function hitStopUntil() {
    const R = mod('render');
    if (!R) return 0;
    const v = typeof R.hitStopUntil === 'function' ? R.hitStopUntil() : R.hitStopUntil;
    return fin(v, 0);
  }
  function loop(now) {
    try {
      const dtMs = Math.min(100, (now - last) || 16.67);
      last = now;
      const s = BSU.state;
      if (s && s.ui) {
        const tps = s.setPiece ? 10 : (titleWorld ? 10 : fin(s.ui.speed, 0) * fin(PT.baseTps, 5));
        if (tps > 0 && now >= hitStopUntil()) { acc += dtMs * tps / 1000; if (!titleWorld) s.playSeconds += dtMs / 1000; }
        let n = 0;
        while (acc >= 1 && n < PT.maxTicksPerFrame) { M.tick1(); acc -= 1; n++; }
        if (n === PT.maxTicksPerFrame) acc = Math.min(acc, 1);     // never a backlog burst after a stall
        const alpha = tps > 0 ? Math.min(1, acc) : 0;
        const R = mod('render'); if (R && typeof R.frame === 'function') { try { R.frame(s, alpha, dtMs); } catch (e) { BSU.error('render', 'frame', e); } }
        const U = mod('ui'); if (U && typeof U.update === 'function') { try { U.update(s, dtMs); } catch (e) { BSU.error('ui', 'update', e); } }
        const A = mod('audio'); if (A && typeof A.update === 'function') { try { A.update(s, dtMs); } catch (e) { BSU.error('audio', 'update', e); } }
      }
    } catch (e) { BSU.error('session', 'loop', e); }
    requestAnimationFrame(loop);
  }
  Object.defineProperty(M, 'loopRunning', { get: function () { return loopRunning; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'titleWorld', { get: function () { return titleWorld; }, set: function (v) { titleWorld = !!v; }, enumerable: true, configurable: true });

  // ============================================================================
  // Boot (§9.1) — every step in its own try/catch so BSU.session/BSU.headless survive a failing module
  // ============================================================================
  M.boot = function () {
    if (booted) return;
    booted = true;
    try { BSU.state = BSU.newState(0); } catch (e) { BSU.error('session', 'boot:newState', e); }
    for (let k = 0; k < MODULES.length; k++) {
      const name = MODULES[k];
      const m = BSU[name];
      if (!m || typeof m.init !== 'function') continue;
      try { m.init(BSU.state); } catch (e) { BSU.error('session', 'init:' + name, e); }
    }
    try {
      if (BSU.state && BSU.state.ui) BSU.state.ui.settings = readSettings(BSU.state.ui.settings);
      call('audio', 'applySettings', BSU.state && BSU.state.ui ? BSU.state.ui.settings : null);
      BSU.rng.fx.state = BSU.headlessMode ? 0xF0F0F0F0 : ((Date.now() ^ 0xF0F0F0F0) >>> 0);   // reseeded in place (D39)
    } catch (e) { BSU.error('session', 'boot:settings', e); }
    if (!BSU.headlessMode) {
      try {
        M.newGame({ seed: randomUint32(), title: true });
        call('ui', 'showTitle', true, { canContinue: !!lsGet(KEY_LAST) });
      } catch (e) { BSU.error('session', 'boot:title', e); }
      try {
        const doc = window.document;
        if (doc && typeof doc.addEventListener === 'function') {
          doc.addEventListener('visibilitychange', function () {
            try { if (doc.hidden && !titleWorld && BSU.state && !BSU.state.setPiece && BSU.state.plot && BSU.state.plot.founders) autosave(); }
            catch (e) { BSU.error('session', 'visibilitychange', e); }
          });
        }
      } catch (e) { BSU.error('session', 'boot:visibility', e); }
      try {
        if (typeof requestAnimationFrame === 'function') { loopRunning = true; requestAnimationFrame(loop); }
      } catch (e) { BSU.error('session', 'boot:loop', e); }
    }
  };

  // ============================================================================
  // selfTest (§10.6 exemption: ≤ 3 s, swaps the live game and restores it in a finally)
  // ============================================================================
  M.selfTest = function () {
    const A = BSU.assert;
    const notes = [];
    const t0 = Date.now();
    const prevAutosave = H.autosave;
    const prevTitle = titleWorld;
    // The backup is taken OUTSIDE the try: if it throws (a non-finite in the live tree) the live game is untouched.
    M.save('__selftest_backup');
    try {
      H.autosave = false;
      // 1. skipTutorial start
      M.newGame({ seed: 1234, skipTutorial: true });
      let s = BSU.state;
      let snap = H.snapshot();
      A(snap.students === 120, 'skipTutorial: 120 students (got ' + snap.students + ')');
      A(snap.cash === 4000000, 'skipTutorial: cash stays 4,000,000 (got ' + snap.cash + ')');
      A(snap.buildings === 1, 'skipTutorial: Founders’ Hall is the only building (got ' + snap.buildings + ')');
      A(snap.speed === 1, 'skipTutorial: speed 1');
      A(s.tiles.surface[s.plot.landingShoulder] === 1, 'the tutorial path reaches plot.landingShoulder');
      A(s.calendar.running === true && s.calendar.frozen === false, 'calendar running after skipTutorial');
      // 2. 300 ticks: finite tree, tick/day counts
      H.tick(300);
      const bad = scanNumbers(s);
      A(!bad, 'no non-finite number after 300 ticks: ' + bad);
      A(s.tick === 300, 'tick === 300');
      A(s.calendar.day === 3, 'calendar.day === 3 after 300 ticks (got ' + s.calendar.day + ')');
      // 3. save → load identity, elev bit-identical, an open-ended timer round-trips as −1
      if (has('progress', 'addTimer')) call('progress', 'addTimer', s, '__t', 1, -1);
      else s.progress.timers.push({ id: '__t', value: 1, untilDay: -1 });
      const before = JSON.stringify(H.snapshot());
      const elevBefore = s.tiles.elev.slice();
      const json = M.save('__selftest_a');
      A(typeof json === 'string' && json.length > 1000, 'save returns a JSON string');
      A(!/\bNaN\b|\bInfinity\b/.test(json), 'the saved JSON has no NaN/Infinity token');
      const loaded = M.load('__selftest_a');
      A(loaded === BSU.state && loaded !== s, 'load replaces BSU.state');
      s = BSU.state;
      A(JSON.stringify(H.snapshot()) === before, 'snapshot identical after save → load');
      let same = s.tiles.elev.length === elevBefore.length;
      for (let i = 0; same && i < elevBefore.length; i++) if (elevBefore[i] !== s.tiles.elev[i]) same = false;
      A(same, 'tiles.elev bit-identical after load');
      const timer = has('progress', 'timer') ? call('progress', 'timer', s, '__t') : (s.progress.timers.find(function (t) { return t && t.id === '__t'; }) || null);
      A(timer && timer.untilDay === -1, 'open-ended timer untilDay −1 round-trips unchanged');
      for (let i = 0; i < s.progress.timers.length; i++) A(Number.isFinite(s.progress.timers[i].untilDay), 'timer untilDay finite: ' + s.progress.timers[i].id);
      if (has('progress', 'removeTimer')) call('progress', 'removeTimer', s, '__t');
      else s.progress.timers = s.progress.timers.filter(function (t) { return !t || t.id !== '__t'; });
      M.deleteSlot('__selftest_a');
      A(!M.slots().some(function (x) { return x.slot === '__selftest_a'; }), 'deleteSlot removes a slot');
      // 4. determinism
      M.newGame({ seed: 77, skipTutorial: true }); H.tick(500);
      const snapA = JSON.stringify(H.snapshot()), rngA = BSU.state.rng.sim;
      M.newGame({ seed: 77, skipTutorial: true }); H.tick(500);
      A(JSON.stringify(H.snapshot()) === snapA, 'two seed-77 runs give identical snapshots');
      A(BSU.state.rng.sim === rngA, 'two seed-77 runs give identical rng.sim state');
      // 5. speed survives a set piece; start/end fire once each
      s = BSU.state;
      let starts = 0, ends = 0;
      const onStart = function () { starts++; }, onEnd = function () { ends++; };
      BSU.events.on('setpiece:start', onStart, 'session-selftest');
      BSU.events.on('setpiece:end', onEnd, 'session-selftest');
      try {
        M.setSpeed(s, 2, 'user');
        A(M.startSetPiece(s, 'nearMiss', { len: 150 }) === true, 'startSetPiece returns true');
        A(M.startSetPiece(s, 'nearMiss', { len: 150 }) === false, 'a second startSetPiece is refused');
        A(s.calendar.frozen === true, 'calendar frozen during a set piece');
        H.tick(150);
        A(s.setPiece === null, 'the set piece ended after len ticks');
        A(s.ui.speed === 2, 'speed restored to 2 after the set piece (got ' + s.ui.speed + ')');
        A(starts === 1 && ends === 1, 'setpiece:start/end fired once each (' + starts + '/' + ends + ')');
      } finally { BSU.events.clear('session-selftest'); }
      // 6. forceHurricane reaches the landfall set piece
      const storm = H.forceHurricane(3);
      A(storm && storm.compressed === true && storm.cat === 3, 'forceHurricane returns a compressed Cat 3 Storm');
      A(storm.landfallDay === s.calendar.day + 6, 'landfallDay = today + 6');
      H.tick(700);
      snap = H.snapshot();
      A(s.setPiece && s.setPiece.kind === 'landfall', 'landfall set piece running at +700');
      A(snap.storm && snap.storm.phase === BSU.STORM.LANDFALL, 'snapshot().storm.phase is LANDFALL during the set piece');
      H.tick(1000);
      A(s.setPiece === null, 'the landfall set piece is over at +1700');
      // 7. findSpot / place
      M.newGame({ seed: 1234, skipTutorial: true });
      const spot = H.findSpot('dorm');
      A(spot && Number.isInteger(spot.x) && Number.isInteger(spot.y), 'findSpot(dorm) finds a spot');
      const pr = H.place('dorm', spot.x, spot.y);
      A(pr && pr.ok === true, 'place(dorm) ok: ' + (pr && pr.reason));
      A(H.findSpot('nope') === null, 'findSpot(nope) → null');
      // 8. migrate
      const d1 = { v: 1, app: APP, seed: 5 };
      A(M.migrate(d1) === d1 && d1.v === 1, 'migrate v1 doc unchanged');
      A(M.migrate({ v: 2, app: APP }) === null, 'a newer version is refused');
      A(M.migrate({ v: 1 }) === null, 'a doc without app is refused');
      slots.set('__selftest_v2', JSON.stringify({ v: 2, app: APP, seed: 1 }));
      A(M.load('__selftest_v2') === null, 'load refuses a v2 doc');
      M.deleteSlot('__selftest_v2');
      // 9. slots
      A(M.slots().some(function (x) { return x.slot === '__selftest_backup'; }), 'slots() lists the backup while it exists');
      notes.push('ok in ' + (Date.now() - t0) + ' ms');
    } finally {
      H.autosave = prevAutosave;
      M.load('__selftest_backup');
      M.deleteSlot('__selftest_backup');
      titleWorld = prevTitle;
    }
    return { ok: true, notes: notes.join('; ') };
  };

  // --- boot now (the last IIFE in the bundle) ---------------------------------------
  try { M.boot(); } catch (e) { try { BSU.error('session', 'boot', e); } catch (e2) { /* nothing left to do */ } }
})();
