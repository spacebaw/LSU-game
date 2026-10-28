'use strict';
// ============================================================================
// BAYOU STATE — ui.js (module 15) → BSU.ui
// Owner of: state.ui.overlay / tool / panel / paletteTab / tabsSeen / newPips /
// tabsIntroduced / settings (speed through session.setSpeed; camera is render's).
// The only DOM owner: builds the whole HUD inside #app once in init, refreshes
// it in update(state, dtMs) with diffing, translates every pointer/wheel/key
// event through ONE input state machine, and exposes the notification / card /
// toast / inspect / palette APIs. Sim state is written only through action
// functions (buildings.place/placeRun/remove/undo/…, session.setSpeed,
// progress.*, economy.set*). ui_panels.js extends this object through
// registerPanel / registerCard.
// Implements: ARCHITECTURE §7 (all), §9.2, §9.5; GDD §11 (all), §10.1–10.2,
// §6.3 Tell, §12.7, §13 (mute hint), §9.4 (speed buttons), §14.3 (parade card).
// Zero DOM access at definition time (registerPanel/registerCard are plain map
// writes). Loads and no-ops in Node through test/domstub.mjs.
//
// DOM skeleton (ARCHITECTURE §7.1; every node is kept in BSU.ui.el, never re-queried):
//   #app
//   ├─ canvas#world.world                        (render.js; pointer/wheel/key target)
//   ├─ #hud (pointer-events:none; interactive children auto)
//   │  ├─ #topbar  #brand · .stat#stat-cash(.odometer .delta) · #stat-students(#chip-capacity) ·
//   │  │   #stat-prestige · #stat-happiness · #stat-ecology · #stat-date(#sky-glyph) · #chip-weather ·
//   │  │   #speed(.speed-btn[data-speed]) · #btn-budget #btn-season #btn-storm(.dot) #btn-almanac #btn-menu #btn-mute · #chip-endowed
//   │  ├─ #alert-strip.hidden  #alert-icon #alert-text #alert-action #alert-gator
//   │  ├─ #minimap-wrap  canvas#minimap(200×200 × UI scale) #minimap-viewport
//   │  ├─ #overlay-buttons  .ov-btn[data-ov=1..6] · #legend.chip
//   │  ├─ #objective-card (the GOALS TRACKER, top-left)  canvas#obj-portrait #obj-kicker #obj-title #obj-text #obj-why #obj-progress(.fill) #obj-count
//   │  │     #btn-obj-build #btn-showme #btn-obj-dismiss #obj-next #obj-background #needs-strip(.need×5 #needs-text) #speech-bubble
//   │  ├─ #voice-card.hidden  #voice-text #voice-payoff #btn-voice-accept #btn-voice-decline
//   │  ├─ #milestones-card.hidden  .ms-row×3
//   │  ├─ #notifications  .notif[data-kind]
//   │  ├─ #decision-toast.hidden  #dt-text #dt-countdown.bar #btn-dt-yes #btn-dt-no
//   │  ├─ #inspect.panel.side.hidden  #insp-title #insp-sub #btn-insp-close canvas#insp-sprite #insp-body #insp-actions  (a kitchen's #insp-menu = summary + #btn-edit-menu)
//   │  ├─ #ghost-label.hidden · #tooltip.hidden · #popover.hidden(#pop-title .pop-line×7 #pop-next)
//   │  ├─ #ticker  #ticker-track · #btn-ticker-log · #ticker-log.hidden
//   │  ├─ #palette  #btn-build-menu · #palette-tabs(.tab[data-tab] .pip) · #palette-items(.item[data-id]) · #btn-bulldoze · #btn-palette-info
//   │  ├─ #build-menu.hidden  #bm-cats(.bm-cat[data-tab]) · #bm-cards(.bm-card[data-id] .bm-badge .bm-reqs .bm-lock) · #bm-detail · #bm-foot   (UX pass; key G)
//   │  ├─ #coach.hidden  .coach-pane×4 · .coach-ring · .coach-box(#coach-step #coach-title #coach-text #btn-coach-back #btn-coach-skip #btn-coach-next)
//   │  ├─ #cards (modal stack: .card#card-<id> .card-title .card-body .card-actions)
//   │  └─ #perf-chip.hidden · #perfmode-chip.hidden · #hint.hidden · #btn-skip.hidden
//   ├─ #panels  (#panel-<name>.panel built through registerPanel; settings + debug built in here)
//   └─ #title  #title-name #title-tag #btn-charter #btn-continue input#title-seed #btn-title-settings #btn-title-mute
//
// Input state machine (ARCHITECTURE §7.3):
//   IDLE/INSPECTING + down(left)            → armed (down recorded)
//   armed + move > 4 px                     → PANNING (render.panBy per move)
//   armed + up ≤ 4 px                       → hit? inspect (gator/agent → building → levee → tile) → INSPECTING, else IDLE
//   PANNING + up                            → previous state
//   any + down(middle/right)                → pan-drag → PANNING; release ≤ 4 px + right → cancel tool / close inspect
//   IDLE/INSPECTING + selectTool            → PLACING
//   PLACING + move                          → buildings.canPlace → render.ghost + #ghost-label
//   PLACING(footprint) + up ≤ 4 px          → buildings.place (ok → IDLE unless Shift; !ok → invalid + shake)
//   PLACING(drag row) + down(left)          → DRAGGING (run starts; Shift = straight line)
//   DRAGGING + move                         → the run is an ORDERED trail: it grows 4-connected (x then y staircase); moving back
//                                             onto a tile already in the trail truncates it to that tile (the start tile too)
//   DRAGGING + up                           → buildings.placeRun → PLACING (tool kept)
//   DRAGGING + Esc/right-click              → the whole pending run is dropped (nothing placed) → PLACING, tool kept
//   PLACING + Esc/right-click               → IDLE;  R → rotate in place
//   any + wheel                             → render.panBy;  ctrl+wheel / pinch → render.setZoom at the cursor
//   any + cancel (pointercancel/blur)       → drop drag/pan without placing
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.ui = BSU.ui || {});
  const P = BSU.params, PR = P.render || {}, PU = P.ui || {}, PT = P.time || {};
  const OV = BSU.OV, SPR = BSU.SPR, STORM = BSU.STORM, SKY = BSU.SKY, T = BSU.T, EV = BSU.EV;
  const W = BSU.MAP.W, HGT = BSU.MAP.H, N = BSU.MAP.N;
  const fin = function (v, d) { return Number.isFinite(v) ? v : d; };
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  // numbers the brief states but params does not carry (or carries under render)
  const L = {
    dragThreshold: fin(PR.dragThreshold, 4), tooltipMs: fin(PR.tooltipMs, 300), tickerPxPerSec: fin(PR.tickerPxPerSec, 60),
    notifMs: fin(PR.notifMs, 12000), notifMax: fin(PR.notifMax, 3), notifTicks: 120, bubbleIdleMs: fin(PR.bubbleIdleMs, 8000),
    bubbleMs: fin(PR.bubbleMs, 6000), hintMs: 6000, hintTicks: 60, panPx: fin(PR.panPxPerFrame, 12), refreshMs: fin(PU.panelRefreshMs, 500),
    deltaMs: 600, odoMs: 150, holdTicks: 600, logMax: fin(PU.tickerMax, 30), popLines: 7, minimapPx: fin(PR.minimapPx, 160),
    compactWidth: fin(PU.compactWidth, 1180), hudStaggerMs: fin(PT.hudStaggerMs, 100), ringThrottleMs: 50, skipAfterTick: fin(PT.skipAfterTick, 150),
    autoCardTicksPerSec: 10, toastTicks: fin(PT.toastTicks, 80), cardWords: fin(PU.cardWordsMax, 12)
  };
  const M0 = { ctrl: false, shift: false, meta: false, alt: false };
  const TILE_NAMES = ['Open water', 'Bayou', 'Marsh', 'Wet ground', 'Dry ground', 'High ground', 'Drained marsh', 'Pond'];
  const SKY_GLYPH = ['🌅', '☀', '🌅', '🌆', '🌙'];
  const SKY_NAME = ['Dawn', 'Day', 'Golden', 'Dusk', 'Night'];
  const MOOD_FACES = ['😞', '🙁', '😐', '🙂', '😄'];
  const HINT_TEXT = { saveUnavailable: 'Saves unavailable in this browser mode', perfMode: 'Performance mode', mute: '🔊 on · M to mute', pauseToPlan: 'Pause to plan', desireLine: 'Students want a path here' };
  const PANEL_KEYS = { budget: 'Budget', season: 'Season', storm: 'Storm', almanac: 'Almanac', milestones: 'Milestones', settings: 'Settings', debug: 'Debug' };

  // ---------------------------------------------------------------------------
  // Small helpers (stub-safe: textContent/classList/style/dataset only)
  // ---------------------------------------------------------------------------
  function mod(name) { return BSU[name]; }
  function has(name, fn) { const m = BSU[name]; return !!(m && typeof m[fn] === 'function'); }
  function call(name, fn) {
    const m = BSU[name]; if (!m || typeof m[fn] !== 'function') return undefined;
    try { return m[fn].apply(m, Array.prototype.slice.call(arguments, 2)); } catch (e) { uerr(name + '.' + fn, e); return undefined; }
  }
  function uerr(where, e) { BSU.error('ui', where, e); }
  function emit(name, payload) { const f = M._deps && M._deps.emit; if (typeof f === 'function') return f(name, payload); return BSU.events.emit(name, payload); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function setText(e, s) { if (!e) return; s = s == null ? '' : String(s); if (e.textContent !== s) e.textContent = s; }
  function show(e, on) { if (!e) return; const hid = e.classList.contains('hidden'); if (on && hid) e.classList.remove('hidden'); else if (!on && !hid) e.classList.add('hidden'); }
  function cls(e, c, on) { if (!e) return; const h = e.classList.contains(c); if (on && !h) e.classList.add(c); else if (!on && h) e.classList.remove(c); }
  function clear(e) { if (!e) return; while (e.firstChild) e.removeChild(e.firstChild); }
  function isEl(v) { return !!(v && typeof v === 'object' && typeof v.tagName === 'string'); }
  function btn(id, label, cls_, onClick) { const b = el('button', 'btn' + (cls_ ? ' ' + cls_ : ''), label); if (id) b.id = id; b.type = 'button'; if (onClick) b.addEventListener('click', function (ev) { try { onClick(ev); } catch (e) { uerr('click:' + (id || label), e); } }); return b; }
  function money(n) { return BSU.formatMoney(fin(n, 0)); }
  function tileOf(i) { return { tx: i % W, ty: (i / W) | 0 }; }
  function catalog() { return (BSU.data && BSU.data.catalog) || {}; }
  function rowOf(id) { return id ? catalog()[id] || null : null; }
  function stateOf() { return root || BSU.state || null; }
  function tickOf(s) { return fin(s && s.tick, 0); }
  function dayOf(s) { return fin(s && s.calendar && s.calendar.day, 0); }
  function dom() { return inited && !dry; }
  function nameOfBuilding(s, id) { const b = call('buildings', 'get', s, id); return b ? (b.name || (rowOf(b.type) || {}).name || b.type) : ''; }
  function nearestBuildingName(s, tx, ty) {
    const list = call('buildings', 'list', s) || []; let best = null, bd = 1e9;
    for (const b of list) { if (!b) continue; const d = Math.max(Math.abs(b.tx + b.w / 2 - tx), Math.abs(b.ty + b.h / 2 - ty)); if (d < bd) { bd = d; best = b; } }
    return best ? (best.name || (rowOf(best.type) || {}).name || best.type) : 'campus';
  }

  // ---------------------------------------------------------------------------
  // Module-private bookkeeping (ui-private DOM/machine state; never mirrors of state.*)
  // ---------------------------------------------------------------------------
  const E = (M.el = M.el || {});
  M.debug = M.debug || { hydroNumbers: false, perfHud: false, open: false };
  M.state = 'IDLE';
  M.hoverTile = -1;
  M.cards = M.cards || {};
  M._tests = M._tests || [];
  M._deps = M._deps || { emit: null };
  M.fmt = { money: function (n) { return BSU.formatMoney(n); }, date: function (d) { return BSU.formatDate(d); } };
  const panels = {};                       // name → {build, refresh, events, el, built, lastRefresh}
  let root = null, inited = false, dry = false, clock = 0, titleOn = false, focusedInput = null;
  let toolLocked = false, undoAtMs = -1e9, lastRunLen = 0, lastGhost = null, ghostPin = null, lastArm = null, lastRingMs = -1e9, shakeUntil = 0, ghostCache = null;
  let heldShift = false;   // design pass: Shift held → the footprint ghost places flush (no setback snap)
  let hoverKey = '', hoverSince = 0, hoverPx = 0, hoverPy = 0, tipShown = '', lastPx = 0, lastPy = 0;
  const notifs = [];                       // {spec, el, born, bornTick, closed}
  let toast = null; const toastQueue = [];
  const gameDecs = {};   // football pass D: game:decision payloads (options with win probabilities) by decision id, consumed by the toast
  let card = null; const cardQueue = [];
  let insp = null, inspAt = -1e9, inspDirty = false, renaming = null;
  let menuEdit = null, menuReason = { text: '', until: 0 }, menuSig = '';   // menu layout pass: the Edit menu overlay ({id} while open, never saved), its inline refusal line, the dish-grid signature (cells are rebuilt only when the set changes)
  let tk = { x: 0, line: null, seen: 0, w: 0, lastLen: 0, logOpen: false };
  const odo = { cash: NaN, students: NaN, shownStudents: NaN, holdUntil: -1, lastStudents: NaN, deltaUntil: 0 };
  const held = { up: false, down: false, left: false, right: false };
  let hint = null;                         // {until, untilTick}
  let bubble = { since: 0, until: 0, key: '' };
  let manualAlert = null, alertAt = -1e9, alertKey = '';
  let alertClosedKey = '';                 // the alert key the player closed with ✕ (hidden until the alert changes)
  let paletteDirty = true, paletteKey = '', paletteTab = '', pipKey = '', hudFade = false, hudFadeAt = 0, capacityShown = false;
  let objKey = '', msAt = -1e9, panelAt = -1e9, perfAt = -1e9, speedKey = '', skipShown = false, paletteHidden = false, errCount = 0;
  let pendingPlaceSound = 0;
  // UX pass: build menu, needs strip cache, coach-mark tour
  const bm = { open: false, hover: null, selected: null, pulseId: null, pulseUntil: 0, focusUntil: 0, keepOpen: false, key: '', detailKey: '', dirty: true };
  let needsCache = null, needsAt = -1e9, needsKey = '';
  const coach = { step: -1, armedAt: 0, paused: false, overlayBefore: 0, layoutAt: -1e9, expanded: [] };   // hud + zoom pass: `expanded` = the HUD parts un-pilled for the current step
  // hud + zoom pass: HUD modes (full / compact / hidden; H cycles, Shift+H → full) and the per-element pills of full mode
  const HUD_MODES = (BSU.params.ui && Array.isArray(BSU.params.ui.hudModes) && BSU.params.ui.hudModes.length === 3) ? BSU.params.ui.hudModes.slice() : ['full', 'compact', 'hidden'];
  const HUD_PARTS = { goals: 'objective-card', needs: 'needs-strip', minimap: 'minimap-wrap', issues: 'issues-tray', palette: 'palette' };
  const hudSt = { eff: '', chipOn: null, pillAt: -1e9, wheelAcc: 0, wheelAt: -1e9, wheelStepAt: -1e9 };

  // ---------------------------------------------------------------------------
  // Panel / card registries (plain map writes; ui_panels registers at definition time)
  // ---------------------------------------------------------------------------
  /** ui_panels: registerPanel(name, {build(el, state), refresh(state), events: string[]}) — build runs once on first open into #panel-<name> */
  M.registerPanel = function (name, def) {
    if (!name || !def) return;
    const prev = panels[name];
    panels[name] = { build: def.build || def.open || null, refresh: def.refresh || def.render || null, close: def.close || null, events: Array.isArray(def.events) ? def.events.slice() : [], el: prev ? prev.el : null, built: false, lastRefresh: -1e9 };
    if (prev && prev.el) clear(prev.el);
  };
  /** ui_panels: registerCard(id, builder(state, payload) → CardSpec) */
  M.registerCard = function (id, builder) { if (id && typeof builder === 'function') M.cards[id] = builder; };

  // ---------------------------------------------------------------------------
  // DOM build (init)
  // ---------------------------------------------------------------------------
  function statEl(id, label, key) {
    const s = el('div', 'stat'); s.id = id; s.dataset.stat = key; s.setAttribute('tabindex', '0'); s.setAttribute('role', 'button');
    const lab = el('span', 'stat-label', label); const val = el('span', 'odometer', '—'); const d = el('span', 'delta', '');
    s.appendChild(lab); s.appendChild(val); s.appendChild(d);
    s.addEventListener('click', function () { try { M.breakdown(stateOf(), key); } catch (e) { uerr('stat:' + key, e); } });
    E[id] = s; E[id + '-value'] = val; E[id + '-delta'] = d; E[id + '-label'] = lab;
    return s;
  }
  function topbarButton(id, glyph, label, title, onClick) {
    const b = btn(id, null, 'tb', onClick); b.title = title; if (!label) b.classList.add('glyph-only');
    const g = el('span', 'glyph', glyph), l = el('span', 'label', label); b.appendChild(g); b.appendChild(l); E[id] = b; E[id + '-glyph'] = g; return b;
  }
  function buildTopbar() {
    const tb = el('div'); tb.id = 'topbar'; E.topbar = tb;
    const brand = el('div', null, ''); brand.id = 'brand'; brand.appendChild(el('span', 'brand-mark', '▣')); brand.appendChild(el('span', 'brand-name', 'BAYOU STATE')); E.brand = brand; tb.appendChild(brand);
    const stats = el('div', 'stats'); E.stats = stats; tb.appendChild(stats);
    stats.appendChild(statEl('stat-cash', 'Cash', 'cash'));
    const st = statEl('stat-students', 'Students', 'students'); const cap = el('span', 'chip hidden', ''); cap.id = 'chip-capacity'; E['chip-capacity'] = cap; st.appendChild(cap); stats.appendChild(st);
    stats.appendChild(statEl('stat-prestige', 'Prestige', 'prestige'));
    stats.appendChild(statEl('stat-happiness', 'Happiness', 'happiness'));
    stats.appendChild(statEl('stat-ecology', 'Ecology', 'ecology'));
    const date = el('div'); date.id = 'stat-date'; const dateText = el('span', 'date-text', ''); const glyph = el('span', null, '☀'); glyph.id = 'sky-glyph'; date.appendChild(dateText); date.appendChild(glyph); E['stat-date'] = date; E['stat-date-text'] = dateText; E['sky-glyph'] = glyph;
    const wx = el('div', 'chip', ''); wx.id = 'chip-weather'; E['chip-weather'] = wx;
    const dc = el('div'); dc.id = 'date-chip'; dc.appendChild(date); dc.appendChild(wx); E['date-chip'] = dc; tb.appendChild(dc);   // UI scale pass: date over weather, one roomy two-line chip
    const sp = el('div'); sp.id = 'speed'; E.speed = sp; E.speedBtns = {};
    [[0, '⏸', 'Pause (Space)'], [1, '1×', 'Normal speed (1)'], [2, '2×', 'Double speed (2)'], [4, '4×', 'Fast (3)'], [8, '8×', 'Fastest (4)']].forEach(function (d) {
      const b = btn(null, d[1], 'speed-btn', function () { M.setSpeed(stateOf(), d[0]); }); b.dataset.speed = String(d[0]); b.title = d[2]; b.setAttribute('aria-pressed', 'false'); sp.appendChild(b); E.speedBtns[d[0]] = b;
    });
    tb.appendChild(sp);
    const pb = el('div', 'panel-btns'); E.panelBtns = pb; tb.appendChild(pb);
    pb.appendChild(topbarButton('btn-budget', '◆', 'Budget', 'Budget (B)', function () { M.openPanel('budget'); }));
    pb.appendChild(topbarButton('btn-season', '🏈', 'Season', 'Season (N)', function () { M.openPanel('season'); }));
    const storm = topbarButton('btn-storm', '🌀', 'Storm', 'Storm (T)', function () { M.openPanel('storm'); }); const dot = el('span', 'dot'); storm.appendChild(dot); E['btn-storm-dot'] = dot; storm.disabled = true; pb.appendChild(storm);
    pb.appendChild(topbarButton('btn-almanac', '📖', 'Almanac', 'Almanac', function () { M.openPanel('almanac'); }));
    pb.appendChild(topbarButton('btn-menu', '☰', '', 'Settings', function () { M.openPanel('settings'); }));
    pb.appendChild(topbarButton('btn-mute', '🔊', '', 'Mute (M)', function () { toggleMute(); }));
    const endowed = el('span', 'chip gold hidden', 'Endowed'); endowed.id = 'chip-endowed'; E['chip-endowed'] = endowed; tb.appendChild(endowed);
    return tb;
  }
  function buildAlert() {
    const a = el('div', 'hidden'); a.id = 'alert-strip';
    const ic = el('span', null, ''); ic.id = 'alert-icon'; const tx = el('span', null, ''); tx.id = 'alert-text';
    const act = btn('alert-action', '', 'small', function () { const s = stateOf(); const sp = currentAlert; if (sp && sp.action && typeof sp.action.fn === 'function') sp.action.fn(s); });
    const g = el('span', 'chip gator hidden', ''); g.id = 'alert-gator'; g.addEventListener('click', function () { const sp = currentAlert; if (sp && sp.gator && Number.isFinite(sp.gator.i)) { const t = tileOf(sp.gator.i); call('render', 'panToTile', t.tx, t.ty); } });
    const x = btn('alert-close', '✕', 'icon', function () { closeAlert(); });   // every chip can be closed (the #alert-gator chip is Le Grand's, the lake legend: ambient)
    x.title = 'Dismiss (the ticker keeps the log)';
    a.appendChild(ic); a.appendChild(tx); a.appendChild(act); a.appendChild(g); a.appendChild(x);
    E['alert-strip'] = a; E['alert-icon'] = ic; E['alert-text'] = tx; E['alert-action'] = act; E['alert-gator'] = g; E['alert-close'] = x; return a;
  }
  function buildMinimap() {
    const wrap = el('div'); wrap.id = 'minimap-wrap';
    const c = el('canvas'); c.id = 'minimap'; c.width = Math.round(MM_BASE * effScale); c.height = c.width; const vp = el('div'); vp.id = 'minimap-viewport';
    wrap.appendChild(c); wrap.appendChild(vp);
    let mdown = false;
    const go = function (ev) { const cw = fin(c.clientWidth, 0) || c.width || MM_BASE, ch = fin(c.clientHeight, 0) || c.height || MM_BASE; const mx = fin(ev.offsetX, cw / 2), my = fin(ev.offsetY, ch / 2); call('render', 'panToTile', clamp(mx / (cw / W), 0, W - 1), clamp(my / (ch / HGT), 0, HGT - 1), false);   // CSS px of the (scaled) element, not canvas px
      const s = stateOf(); if (s && s.setPiece) call('render', 'captureCameraTouch', s); };
    c.addEventListener('pointerdown', function (ev) { mdown = true; go(ev); if (ev.preventDefault) ev.preventDefault(); });
    c.addEventListener('pointermove', function (ev) { if (mdown) go(ev); });
    c.addEventListener('pointerup', function () { mdown = false; }); c.addEventListener('pointerleave', function () { mdown = false; });
    wrap.appendChild(hudChevron('minimap')); wrap.appendChild(hudPillEl('minimap', '🗺', 'Map')); hudHover('minimap', wrap);   // hud + zoom pass
    E['minimap-wrap'] = wrap; E.minimap = c; E['minimap-viewport'] = vp; return wrap;
  }
  function buildOverlays() {
    const wrap = el('div'); wrap.id = 'overlay-buttons'; E['overlay-buttons'] = wrap; E.ovBtns = {};
    const list = (BSU.data && BSU.data.overlays) || [];
    for (const o of list) { const b = btn(null, o.key, 'ov-btn', function () { const s = stateOf(); M.setOverlay(s, s && s.ui.overlay === o.ov ? OV.NONE : o.ov); }); b.dataset.ov = String(o.ov); b.title = o.name + ' (' + o.key + ')'; wrap.appendChild(b); E.ovBtns[o.ov] = b; }
    const legend = el('div', 'chip hidden', ''); legend.id = 'legend'; E.legend = legend; wrap.appendChild(legend);
    return wrap;
  }
  function buildObjective() {
    // the GOALS TRACKER (UX pass): top-left under the topbar; the old ids are kept so progress/tests keep working
    const c = el('div', 'hidden'); c.id = 'objective-card';
    const head = el('div', 'obj-head'); const portrait = el('canvas'); portrait.id = 'obj-portrait'; portrait.width = 64; portrait.height = 64;
    const col = el('div', 'obj-col'); const kick = el('div', 'obj-kicker', 'Goal'); kick.id = 'obj-kicker'; const title = el('div', null, ''); title.id = 'obj-title'; const text = el('div', null, ''); text.id = 'obj-text'; const why = el('div', 'hidden', ''); why.id = 'obj-why';
    col.appendChild(kick); col.appendChild(title); col.appendChild(text); col.appendChild(why);
    const openMs = function () { const s = stateOf(); if (!s || coach.step >= 0) return; M.openPanel(s.ui.panel === 'milestones' ? null : 'milestones'); };
    col.addEventListener('click', openMs); col.title = 'All milestones'; portrait.addEventListener('click', openMs);
    const dis = btn('btn-obj-dismiss', '✕', 'icon', function () { const s = stateOf(); const o = s ? call('progress', 'objective', s) : null; if (o) call('progress', 'dismiss', s, o.id); }); dis.title = 'Dismiss this goal';
    head.appendChild(portrait); head.appendChild(col); head.appendChild(dis); head.appendChild(hudChevron('goals'));
    const progRow = el('div', 'obj-prog-row'); const prog = el('div', 'bar'); prog.id = 'obj-progress'; const fill = el('div', 'fill'); prog.appendChild(fill); const count = el('span', null, ''); count.id = 'obj-count'; progRow.appendChild(prog); progRow.appendChild(count);
    const acts = el('div', 'obj-actions');
    const build = btn('btn-obj-build', 'Build it', 'primary small', function () { objBuildIt(); }); build.title = 'Select the right tool and open the build menu on it';
    const showme = btn('btn-showme', 'Show me', 'small', function () { objShowMe(); });
    const post = btn('btn-postcard-obj', 'Postcard', 'small hidden', function () { postcard(stateOf()); });
    acts.appendChild(build); acts.appendChild(showme); acts.appendChild(post);
    const next = el('div', 'obj-next hidden', ''); next.id = 'obj-next';
    const bg = el('div', 'row hidden', ''); bg.id = 'obj-background'; const bub = el('div', 'hidden', ''); bub.id = 'speech-bubble';
    // needs strip: five gauges + the binding line
    const strip = el('div', 'hidden'); strip.id = 'needs-strip'; E.needEls = {};
    const gauges = el('div', 'needs-gauges');
    for (const k of ['beds', 'seats', 'dining', 'power', 'water']) {
      const g = el('div', 'need'); g.dataset.key = k; const lab = el('div', 'need-label', (BSU.data && BSU.data.needs && BSU.data.needs[k] ? BSU.data.needs[k].label : k)); const bar = el('div', 'bar'); const f = el('div', 'fill'); bar.appendChild(f); const val = el('div', 'need-val', '—');
      g.appendChild(lab); g.appendChild(bar); g.appendChild(val); gauges.appendChild(g); E.needEls[k] = { el: g, fill: f, val: val };
      g.addEventListener('click', function () { const s = stateOf(); const b = (BSU.data.needs[k] || {}).build; if (s && b) M.openBuildMenu(s, { focus: b, pulse: true }); });
      if (k === 'power' || k === 'water') { g.addEventListener('mouseenter', function () { const I = issuesApi(); if (I) I.pulse(k); }); g.addEventListener('mouseleave', function () { const I = issuesApi(); if (I) I.pulse(null); }); }   // issue spotlight pass: hovering the gauge pulses every unpowered / unwatered beacon
    }
    const ntext = el('button', 'needs-text'); ntext.id = 'needs-text'; ntext.type = 'button'; ntext.addEventListener('click', function () { const s = stateOf(); const b = ntext.dataset.build; if (s && b) { M.openBuildMenu(s, { focus: b, pulse: true }); } });
    const nloc = btn('needs-locate', 'Locate', 'small hidden', function () { const s = stateOf(); const fam = nloc.dataset.family; if (!s || !fam) return; const it = issueFirstOf(s, (issuesApi() && issuesApi().families()[fam]) || []); if (it) locateIssue(s, it); }); nloc.title = 'Ease the camera to the first building with this problem';
    const nrow = el('div', 'needs-row'); nrow.appendChild(ntext); nrow.appendChild(nloc);
    strip.appendChild(gauges); strip.appendChild(nrow); E['needs-locate'] = nloc;
    nrow.appendChild(hudChevron('needs')); strip.appendChild(hudPillEl('needs', '⚖', 'Needs')); hudHover('needs', strip);   // hud + zoom pass: the chevron rides the binding line (inside the strip, so the pill rule hides it with the rest)
    c.appendChild(bub); c.appendChild(head); c.appendChild(progRow); c.appendChild(acts); c.appendChild(next); c.appendChild(bg); c.appendChild(strip);
    c.appendChild(hudPillEl('goals', '🎯', 'Goal')); hudHover('goals', c);
    E['objective-card'] = c; E['obj-portrait'] = portrait; E['obj-kicker'] = kick; E['obj-title'] = title; E['obj-text'] = text; E['obj-why'] = why; E['obj-progress'] = prog; E['obj-prog-row'] = progRow; E['obj-fill'] = fill; E['obj-count'] = count; E['obj-actions'] = acts;
    E['btn-obj-build'] = build; E['btn-showme'] = showme; E['btn-postcard-obj'] = post; E['btn-obj-dismiss'] = dis; E['obj-next'] = next; E['obj-background'] = bg; E['speech-bubble'] = bub; E['needs-strip'] = strip; E['needs-text'] = ntext;
    const v = el('div', 'hidden'); v.id = 'voice-card'; const vh = el('div', 'card-kicker', 'Student voice'); const vs = el('div', 'voice-student', ''); const vt = el('div', null, ''); vt.id = 'voice-text'; const vp = el('div', null, ''); vp.id = 'voice-payoff';
    const va = el('div', 'card-actions'); const acc = btn('btn-voice-accept', 'Accept', 'primary small', function () { answerVoice(true); }); const dec = btn('btn-voice-decline', 'Decline', 'small', function () { answerVoice(false); }); va.appendChild(acc); va.appendChild(dec);
    v.appendChild(vh); v.appendChild(vs); v.appendChild(vt); v.appendChild(vp); v.appendChild(va);
    E['voice-card'] = v; E['voice-student'] = vs; E['voice-text'] = vt; E['voice-payoff'] = vp; E['btn-voice-accept'] = acc; E['btn-voice-decline'] = dec;
    const ms = el('div', 'hidden'); ms.id = 'milestones-card'; const mh = el('div', 'card-kicker', 'Next milestones'); ms.appendChild(mh); E.msRows = [];
    for (let k = 0; k < 3; k++) { const r = el('div', 'ms-row'); const n = el('span', 'ms-name', ''); const b = el('div', 'bar'); const f = el('div', 'fill'); b.appendChild(f); const cnt = el('span', 'ms-count', ''); r.appendChild(n); r.appendChild(b); r.appendChild(cnt); ms.appendChild(r); E.msRows.push({ row: r, name: n, fill: f, count: cnt }); }
    E['milestones-card'] = ms;
    return [c, v, ms];
  }
  function buildToast() {
    const t = el('div', 'hidden'); t.id = 'decision-toast';
    const tx = el('div', null, ''); tx.id = 'dt-text'; const bar = el('div', 'bar'); bar.id = 'dt-countdown'; const fill = el('div', 'fill'); bar.appendChild(fill);
    const opts = el('div', 'hidden'); opts.id = 'dt-options';   // football pass D: one button per engine option (label, win probability, delta); the yes/no row hides while it shows
    const acts = el('div', 'card-actions'); const y = btn('btn-dt-yes', 'Yes', 'primary', function () { if (toast) answerToast(toast.id, 'yes'); }); const n = btn('btn-dt-no', 'No', '', function () { if (toast) answerToast(toast.id, 'no'); });
    const ky = el('span', 'key', 'Y'), kn = el('span', 'key', 'N'); y.appendChild(ky); n.appendChild(kn); acts.appendChild(y); acts.appendChild(n);
    const foot = el('div', 'hidden'); foot.id = 'dt-foot';
    t.appendChild(tx); t.appendChild(opts); t.appendChild(bar); t.appendChild(acts); t.appendChild(foot);
    E['decision-toast'] = t; E['dt-text'] = tx; E['dt-options'] = opts; E['dt-foot'] = foot; E['dt-countdown'] = bar; E['dt-fill'] = fill; E['btn-dt-yes'] = y; E['btn-dt-no'] = n; E['dt-actions'] = acts; return t;
  }
  function buildInspect() {
    const p = el('div', 'panel side hidden'); p.id = 'inspect';
    const head = el('div', 'insp-head'); const sprite = el('canvas'); sprite.id = 'insp-sprite'; sprite.width = 64; sprite.height = 64;
    const col = el('div', 'insp-col'); const title = el('div', null, ''); title.id = 'insp-title'; const sub = el('div', null, ''); sub.id = 'insp-sub'; col.appendChild(title); col.appendChild(sub);
    const close = btn('btn-insp-close', '✕', 'icon', function () { M.closeInspect(); });
    head.appendChild(sprite); head.appendChild(col); head.appendChild(close);
    const body = el('div', 'rows'); body.id = 'insp-body'; const acts = el('div', 'insp-actions'); acts.id = 'insp-actions';
    p.appendChild(head); p.appendChild(body); p.appendChild(acts);
    E.inspect = p; E['insp-title'] = title; E['insp-sub'] = sub; E['btn-insp-close'] = close; E['insp-sprite'] = sprite; E['insp-body'] = body; E['insp-actions'] = acts; return p;
  }
  function buildPopover() {
    const p = el('div', 'hidden'); p.id = 'popover'; const t = el('div', null, ''); t.id = 'pop-title'; p.appendChild(t); E.popLines = [];
    for (let k = 0; k < L.popLines; k++) { const l = el('div', 'pop-line'); const a = el('span', 'k', ''), b = el('span', 'v', ''); l.appendChild(a); l.appendChild(b); p.appendChild(l); E.popLines.push({ row: l, k: a, v: b }); }
    const n = el('div', null, ''); n.id = 'pop-next'; p.appendChild(n); const x = btn('btn-pop-close', '✕', 'icon', function () { show(E.popover, false); }); p.appendChild(x);
    E.popover = p; E['pop-title'] = t; E['pop-next'] = n; return p;
  }
  function buildTicker() {
    const t = el('div'); t.id = 'ticker'; const track = el('div', null, ''); track.id = 'ticker-track';
    track.addEventListener('click', function () { if (tk.line && Number.isFinite(tk.line.subject) && tk.line.subject >= 0) { const p = tileOf(tk.line.subject); call('render', 'panToTile', p.tx, p.ty); } });
    const log = btn('btn-ticker-log', '≡', 'icon', function () { tk.logOpen = !tk.logOpen; show(E['ticker-log'], tk.logOpen); if (tk.logOpen) rebuildLog(stateOf()); });
    const lg = el('div', 'panel hidden'); lg.id = 'ticker-log';
    t.appendChild(track); t.appendChild(log); t.appendChild(lg);
    E.ticker = t; E['ticker-track'] = track; E['btn-ticker-log'] = log; E['ticker-log'] = lg; return t;
  }
  function buildPalette() {
    const p = el('div'); p.id = 'palette'; const tabs = el('div'); tabs.id = 'palette-tabs'; const items = el('div'); items.id = 'palette-items';
    const side = el('div', 'palette-side');
    const bull = btn('btn-bulldoze', '🔨', '', function () { const s = stateOf(); const t = s && s.ui.tool; M.selectTool(s, t && t.id === 'bulldoze' ? null : 'bulldoze'); }); bull.title = 'Bulldoze (X)';
    const info = btn('btn-palette-info', '⋯', '', function () { cls(E.palette, 'compact', !E.palette.classList.contains('compact')); paletteFade(); }); info.title = 'Compact palette';
    // palette pass: the quick-bar scrolls sideways (no scrollbar; a mouse wheel scrolls it, the edges fade while there is more to see)
    try { items.addEventListener('scroll', function () { paletteFade(); }); items.addEventListener('wheel', function (ev) { if (items.scrollWidth <= items.clientWidth + 1 || Math.abs(fin(ev.deltaX, 0)) >= Math.abs(fin(ev.deltaY, 0))) return; items.scrollLeft += ev.deltaY; ev.preventDefault(); }, { passive: false }); } catch (e) { /* stub */ }
    side.appendChild(bull); side.appendChild(info);
    const bmBtn = btn('btn-build-menu', '', 'primary', function () { const s = stateOf(); if (!s) return; if (bm.open) M.closeBuildMenu(); else M.openBuildMenu(s, {}); }); bmBtn.title = 'Build menu (G)';
    bmBtn.appendChild(el('span', 'glyph', '🏗')); bmBtn.appendChild(el('span', 'label', 'Build')); bmBtn.appendChild(el('span', 'key', 'G'));
    p.appendChild(bmBtn); p.appendChild(tabs); p.appendChild(items); p.appendChild(side);
    p.appendChild(hudChevron('palette')); p.appendChild(hudPillEl('palette', '🏗', 'Build · G')); hudHover('palette', p);   // hud + zoom pass: the quick-bar folds to a pill (G still opens the build menu); the chevron sits in the strip's top-right corner
    E.palette = p; E['palette-tabs'] = tabs; E['palette-items'] = items; E['btn-bulldoze'] = bull; E['btn-palette-info'] = info; E['btn-build-menu'] = bmBtn; E.tabEls = {}; E.itemEls = {}; return p;
  }
  function buildTitle() {
    const t = el('div', 'hidden'); t.id = 'title';
    const box = el('div', 'title-box');
    const kicker = el('div', 'title-kicker', 'A SimCity in the swamp');
    const name = el('h1', null, 'BAYOU STATE'); name.id = 'title-name';
    const tag = el('div', null, '$4,000,000, one ridge, and a swamp. Build a university.'); tag.id = 'title-tag';
    const charter = btn('btn-charter', 'Click to charter the university.', 'primary big', function () { charterClick(); });
    const cont = btn('btn-continue', 'Continue', 'big', function () { call('audio', 'unlock'); call('session', 'continue_'); }); cont.disabled = true;
    const row = el('div', 'title-row');
    const seedLab = el('label', 'seed-label', 'Seed'); const seed = el('input'); seed.id = 'title-seed'; seed.type = 'text'; seed.placeholder = 'random'; seed.setAttribute('inputmode', 'numeric'); seed.setAttribute('autocomplete', 'off');
    seed.addEventListener('focus', function () { focusedInput = seed; }); seed.addEventListener('blur', function () { if (focusedInput === seed) focusedInput = null; });
    seedLab.appendChild(seed);
    const ts = btn('btn-title-settings', 'Settings', 'small', function () { M.openPanel('settings'); });
    const tm = btn('btn-title-mute', '🔊', 'small icon', function () { toggleMute(); });
    row.appendChild(seedLab); row.appendChild(ts); row.appendChild(tm);
    const sz = el('div', 'title-size'); sz.appendChild(el('span', 'title-size-label', 'Display size')); const szs = el('div', 'seg'); const szn = el('div', 'seg-note hidden', '');   // P5: Compact 100 / Comfortable 115 / Large 130 / Auto
    SIZE_CHOICES.forEach(function (c) { const b = btn('btn-size-' + c[0], c[1], 'seg-btn', function () { M.setUiScale(c[2]); refreshTitleSize(); }); b.dataset.scale = String(c[2]); if (c[3]) b.appendChild(el('span', 'pct', c[3])); b.title = c[2] === 'auto' ? 'Pick the size from this window (1366 px and up: 115 %, 1680 px and up: 130 %)' : c[1] + ' (' + c[3] + ')'; szs.appendChild(b); });
    sz.appendChild(szs); sz.appendChild(szn);
    const campus = el('canvas', 'hidden'); campus.id = 'title-campus'; campus.width = 320; campus.height = 200;
    const foot = el('div', 'title-foot', 'Louisiana. One ridge. Mind the water.');
    box.appendChild(kicker); box.appendChild(name); box.appendChild(tag); box.appendChild(charter); box.appendChild(cont); box.appendChild(row); box.appendChild(sz); box.appendChild(campus); box.appendChild(foot);
    t.appendChild(box);
    E.title = t; E['title-name'] = name; E['title-tag'] = tag; E['btn-charter'] = charter; E['btn-continue'] = cont; E['title-seed'] = seed; E['btn-title-settings'] = ts; E['btn-title-mute'] = tm; E['title-campus'] = campus; E['title-size'] = sz; E['title-size-note'] = szn; return t;
  }
  function buildPanelsHost() { const p = el('div'); p.id = 'panels'; E.panels = p; p.appendChild(buildMenuOverlay()); return p; }
  /** menu layout pass: the Edit menu overlay (a 64-rem panel centred over the map, the existing panel chrome + close button): title, live summary, presets, "x / cap" count, the inline reason line, the dish grid, the note. Built once; syncMenuOverlay updates it in place */
  function buildMenuOverlay() {
    const p = el('div', 'panel menu-overlay hidden'); p.id = 'menu-overlay';
    const head = el('div', 'panel-head'); const x = btn('btn-menu-close', '✕', 'icon', function () { M.closeMenuEditor(); }); x.title = 'Close (Esc)'; head.appendChild(x);
    const title = el('div', 'panel-title', 'Menu'); title.id = 'menu-title';
    const sum = el('div', 'menu-sum', ''); sum.id = 'menu-sum';
    const bar = el('div', 'mo-bar'); const pre = el('div', 'menu-presets'); pre.id = 'menu-presets';
    const count = el('div', 'mo-count', ''); count.id = 'menu-count';
    bar.appendChild(pre); bar.appendChild(count);
    const reason = el('div', 'mo-reason', ''); reason.id = 'menu-reason';
    const grid = el('div', 'menu-grid'); grid.id = 'menu-grid';
    const note = el('div', 'menu-note', ''); note.id = 'menu-note';
    p.appendChild(head); p.appendChild(title); p.appendChild(sum); p.appendChild(bar); p.appendChild(reason); p.appendChild(grid); p.appendChild(note);
    E['menu-overlay'] = p; E['btn-menu-close'] = x; E['menu-title'] = title; E['menu-sum'] = sum; E['menu-presets'] = pre; E['menu-count'] = count; E['menu-reason'] = reason; E['menu-grid'] = grid; E['menu-note'] = note; return p;
  }
  function buildChips() {
    const perf = el('div', 'chip hidden', ''); perf.id = 'perf-chip'; const pm = el('div', 'chip hidden', 'Performance mode'); pm.id = 'perfmode-chip';
    const h = el('div', 'hidden'); h.id = 'hint'; const ht = el('span', null, ''); const ha = btn('btn-hint-action', '', 'small hidden', function () { if (hint && hint.action && typeof hint.action.fn === 'function') { hint.action.fn(stateOf()); } hideHint(); }); h.appendChild(ht); h.appendChild(ha);
    const skip = btn('btn-skip', 'Skip ▸', 'hidden', function () { const s = stateOf(); if (s && s.setPiece) call('session', 'skipSetPiece', s); });
    // undo pass: the Undo chip (above the palette, bottom-left) — shown for the undo window after any placement or drag run; click = Ctrl+Z
    const uc = btn('undo-chip', '', 'hidden', function () { doUndo(stateOf()); }); const ucMain = el('span', 'uc-main', ''); const ucBar = el('span', 'uc-bar'); const ucFill = el('span', 'uc-fill'); ucBar.appendChild(ucFill);
    uc.appendChild(el('span', 'uc-glyph', '↶')); uc.appendChild(ucMain); uc.appendChild(el('span', 'key', 'Ctrl+Z')); uc.appendChild(ucBar);
    E['undo-chip'] = uc; E['undo-main'] = ucMain; E['undo-fill'] = ucFill;
    const hc = btn('hud-chip', 'HUD hidden · H', 'chip hidden', function () { M.setHudMode('full'); }); hc.title = 'Show the HUD again (H cycles full → compact → hidden; Shift+H restores)'; E['hud-chip'] = hc;   // hud + zoom pass
    E['perf-chip'] = perf; E['perfmode-chip'] = pm; E.hint = h; E['hint-text'] = ht; E['btn-hint-action'] = ha; E['btn-skip'] = skip; return [perf, pm, h, skip, uc, hc];
  }
  function buildCards() { const c = el('div', 'hidden'); c.id = 'cards'; E.cards = c; return c; }
  function buildLabels() {
    const g = el('div', 'hidden'); g.id = 'ghost-label'; const g1 = el('div', 'l1', ''), g2 = el('div', 'l2', ''); g.appendChild(g1); g.appendChild(g2);
    const tt = el('div', 'hidden'); tt.id = 'tooltip';
    E['ghost-label'] = g; E['ghost-l1'] = g1; E['ghost-l2'] = g2; E.tooltip = tt; return [g, tt];
  }

  /** once per page load: the whole HUD inside #app (guarded by #hud), listeners, subscriptions */
  M.init = function (state) {
    if (E.hud) return;
    inited = true; root = state || null;
    let app = null; try { app = document.getElementById('app'); } catch (e) { app = null; }
    if (!app) { uerr('init', new Error('#app missing')); return; }
    E.app = app;
    let world = null; try { for (let k = 0; k < app.children.length; k++) if (app.children[k] && app.children[k].id === 'world') { world = app.children[k]; break; } } catch (e) { world = null; }
    if (!world) { world = el('canvas', 'world'); world.id = 'world'; world.setAttribute('tabindex', '0'); app.appendChild(world); }
    E.world = world;
    const hud = el('div'); hud.id = 'hud'; E.hud = hud;
    hud.appendChild(buildTopbar()); hud.appendChild(buildAlert()); hud.appendChild(buildMinimap()); hud.appendChild(buildOverlays()); hud.appendChild(buildIssuesTray());
    buildObjective().forEach(function (x) { hud.appendChild(x); });
    const notes = el('div'); notes.id = 'notifications'; E.notifications = notes; hud.appendChild(notes);
    const nd = btn('notif-dismiss', 'Dismiss all (Esc)', 'small hidden', function () { M.dismissNotifs(); }); nd.title = 'Clear every notification; the ticker keeps the log'; hud.appendChild(nd); E['notif-dismiss'] = nd;   // gator pass: a hud child above the stack (#notifications clips its overflow and is cleared on reset)
    hud.appendChild(buildToast()); hud.appendChild(buildInspect());
    buildLabels().forEach(function (x) { hud.appendChild(x); });
    hud.appendChild(buildPopover()); hud.appendChild(buildTicker()); hud.appendChild(buildPalette()); hud.appendChild(buildBuildMenu()); hud.appendChild(buildCards());
    buildChips().forEach(function (x) { hud.appendChild(x); });
    hud.appendChild(buildCoach());
    app.appendChild(hud); app.appendChild(buildPanelsHost()); app.appendChild(buildTitle());
    try { call('render', 'attachMinimap', E.minimap); } catch (e) { uerr('init:minimap', e); }
    attachInput(world);
    subscribe();
    registerBuiltins();
    try { const w = fin(window.innerWidth, 1280); cls(E.palette, 'compact', w < L.compactWidth); } catch (e) { /* stub */ }
    try { const raw = window.localStorage.getItem('bsu.settings'); const o = raw ? JSON.parse(raw) : null; applyScale(o && o.uiScale != null ? o.uiScale : 'auto'); } catch (e) { try { applyScale('auto'); } catch (e2) { /* stub */ } }   // the title screen is scaled too; nothing stored (first run) = the smart default for this window
    fitTopbar();
  };
  /** the topbar must never push its buttons off-screen. UI scale pass: it now sheds content in six steps, re-measured from scratch on
   *  every resize / scale change (so there is no flapping and no hysteresis to get stuck): 1 `tight` collapses the brand to its mark,
   *  2 `cap` stacks each panel button's caption under its icon, 3 `compact` keeps the icons only (tooltips carry the names), 4 `tighter`
   *  hides the weather chip and trims the stat tiles, 5 `tightest` hides the capacity chip, 6 `bare` hides the date chip.
   *  A once-a-second check only ever escalates (cash growing a digit) */
  let fitLevel = 0, fitAt = 0;
  function fitTopbar() {
    try {
      const tb = E.topbar; if (!tb || typeof tb.scrollWidth !== 'number' || typeof tb.clientWidth !== 'number' || !tb.clientWidth) return;
      const set = function (n) { cls(tb, 'tight', n >= 1); cls(tb, 'cap', n === 2); cls(tb, 'compact', n >= 3); cls(tb, 'tighter', n >= 4); cls(tb, 'tightest', n >= 5); cls(tb, 'bare', n >= 6); fitLevel = n; };
      set(0); let n = 0;
      while (n < 6 && tb.scrollWidth > tb.clientWidth + 1) set(++n);
    } catch (e) { /* stub */ }
  }
  // ---- UI scale (UI scale pass): html{font-size:calc(10px * var(--ui-scale))} and every CSS length is rem, so the layout math and every
  // getBoundingClientRect() (coach spotlights, ghost label, tooltips) stay in real viewport pixels at 90 / 100 / 115 / 130 %
  const UI_SCALES = [0.9, 1, 1.15, 1.3], MM_BASE = 200;
  /** P5 Display size choices (title screen): the three presets the plan names + Auto (= the viewport default below) */
  const SIZE_CHOICES = [['compact', 'Compact', 1, '100%'], ['comfortable', 'Comfortable', 1.15, '115%'], ['large', 'Large', 1.3, '130%'], ['auto', 'Auto', 'auto', '']];
  let appliedScale = 1, effScale = 1, uiMode = 'auto';   // the chosen factor / what the window can actually hold / 'auto' or the explicit factor
  function scaleOf(v) { v = Number(v); if (!Number.isFinite(v) || v <= 0) return 1; if (v > 3) v /= 100; let b = 1; for (const c of UI_SCALES) if (Math.abs(c - v) < Math.abs(b - v)) b = c; return b; }
  /** P5 smart default by window width: < 1366 → 100 %, 1366–1679 → 115 %, ≥ 1680 → 130 % (effectiveScale still caps it to what the window holds) */
  function autoScaleFor(w) { w = fin(w, 1280); return w >= 1680 ? 1.3 : w >= 1366 ? 1.15 : 1; }
  function isAuto(v) { return v == null || v === 'auto'; }
  function wantScale(v) { return isAuto(v) ? autoScaleFor(window.innerWidth) : scaleOf(v); }
  /** a bigger-than-100 % UI is limited to what the window can hold (a 1280×800 laptop tops out near 114 %): the HUD columns must never collide, and never shrink below 100 % */
  function effectiveScale(sc) {
    if (sc <= 1) return sc;
    const cap = Math.min(fin(window.innerWidth, 1280) / 1100, fin(window.innerHeight, 800) / 700);
    return Math.round(Math.max(1, Math.min(sc, cap)) * 1000) / 1000;
  }
  function applyScale(v) {
    const auto = isAuto(v), sc = wantScale(v), eff = effectiveScale(sc), mode = auto ? 'auto' : sc;
    const changed = eff !== effScale || sc !== appliedScale || mode !== uiMode; appliedScale = sc; effScale = eff; uiMode = mode;
    if (!dom()) return;
    try { const de = document.documentElement; if (de && de.style && typeof de.style.setProperty === 'function') de.style.setProperty('--ui-scale', String(eff)); } catch (e) { /* stub */ }
    try { const c = E.minimap; if (c) { const px = Math.round(MM_BASE * eff); if (c.width !== px) { c.width = px; c.height = px; } } } catch (e) { /* stub */ }
    try { cls(E.hud, 'short', fin(window.innerHeight, 800) < eff * 760); } catch (e) { /* stub */ }   // P5: the tracker + palette need ~72 rem of height; a shorter window drops the tracker's flavour text and "next up" line so it never runs under the ticker
    if (changed) { fitTopbar(); refreshTitleSize(); try { coach.layoutAt = -1e9; const st = stateOf(); if (st && coach.step >= 0) layoutCoach(st); } catch (e) { /* stub */ } }
  }
  /** title screen "Display size" row: the active button follows the stored mode, the note says what Auto picked / what the window limited */
  function refreshTitleSize() {
    try {
      const box = E['title-size']; if (!box) return;
      for (const b of box.children[1].children) { const d = b.dataset.scale; cls(b, 'active', d === 'auto' ? uiMode === 'auto' : uiMode !== 'auto' && Number(d) === appliedScale); b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'); }
      const note = E['title-size-note']; const lim = effScale < appliedScale - 0.005;
      const txt = uiMode === 'auto' ? 'Auto picks ' + Math.round(effScale * 100) + '% for this window.' : lim ? 'Limited to ' + Math.round(effScale * 100) + '% by this window size.' : '';
      if (note) { setText(note, txt); show(note, !!txt); }
    } catch (e) { /* stub */ }
  }
  /** the chosen factor (1 = 100 %), snapped to the four offered sizes; M.uiScaleEffective() is what the window allows */
  M.uiScale = function () { return appliedScale; };
  M.uiScaleEffective = function () { return effScale; };
  /** P5: 'auto' (the viewport default) or the explicit factor; M.autoScaleFor(width) is the default's table */
  M.uiScaleMode = function () { return uiMode; };
  M.autoScaleFor = autoScaleFor;
  /** Settings → UI size: remember it (state.ui.settings + localStorage) and apply it now */
  M.setUiScale = function (v) { try { const sc = isAuto(v) ? 'auto' : scaleOf(v); M.settings().uiScale = sc; M.saveSettings(); applyScale(sc); return appliedScale; } catch (e) { uerr('setUiScale', e); return appliedScale; } };

  // ---- HUD modes (hud + zoom pass) -----------------------------------------------------------------------------------------
  // settings.hudMode: 'full' (every panel) | 'compact' (every part is a pill that opens on hover / click) | 'hidden' (the decision layer + a chip).
  // settings.hudCollapsed[part]: in full mode that one part stays a pill (its ▾ chevron). Both persist like the display size.
  // #hud[data-hud=mode] + .pill / .peek classes on the five parts drive the CSS (`/* hud modes */` block); nothing else moves.
  function hudModeOf() { const m = M.settings().hudMode; return HUD_MODES.indexOf(m) >= 0 ? m : 'full'; }
  function hudCollapsedOf() { const set = M.settings(); if (!set.hudCollapsed || typeof set.hudCollapsed !== 'object') set.hudCollapsed = {}; return set.hudCollapsed; }
  /** the mode the HUD is drawn in right now: the coach-mark tour always runs in full (its spotlights point at HUD elements) */
  function hudEffective() { return coach.step >= 0 ? 'full' : hudModeOf(); }
  M.hudMode = function () { return hudModeOf(); };
  M.hudModes = function () { return HUD_MODES.slice(); };
  M.setHudMode = function (mode) { try { if (HUD_MODES.indexOf(mode) < 0) return hudModeOf(); const set = M.settings(); if (set.hudMode !== mode) { set.hudMode = mode; M.saveSettings(); } const s = stateOf(); if (s && dom()) updateHud(s); return mode; } catch (e) { uerr('setHudMode', e); return hudModeOf(); } };
  /** H: full → compact → hidden → full (dir −1 walks back) */
  M.cycleHud = function (dir) { const k = HUD_MODES.indexOf(hudModeOf()); const n = HUD_MODES[(k + (dir < 0 ? HUD_MODES.length - 1 : 1)) % HUD_MODES.length]; M.setHudMode(n); const s = stateOf(); if (s && dom() && !BSU.headlessMode) hudHint(s, n === 'compact' ? 'HUD: compact · H again hides it · Shift+H restores' : n === 'hidden' ? 'HUD hidden · H or Shift+H brings it back' : ''); return n; };
  /** a short, replaceable hint for the mode just chosen (M.hint is once-per-save; this one must follow every press) */
  function hudHint(s, t) { if (!t) { if (hint && hint.hud) hideHint(); return; } hint = { until: clock + 3500, untilTick: tickOf(s) + L.hintTicks, action: null, text: t, hud: true }; setText(E['hint-text'], t); show(E['btn-hint-action'], false); show(E.hint, true); }
  M.hudCollapsed = function (key) { return !!hudCollapsedOf()[key]; };
  /** collapse (on) / expand (off) one part in full mode; no `on` = toggle. Remembered in settings. */
  M.hudCollapse = function (key, on) { try { if (!HUD_PARTS[key]) return false; const col = hudCollapsedOf(); const v = on === undefined ? !col[key] : !!on; if (col[key] !== v) { col[key] = v; M.saveSettings(); } const e = E[HUD_PARTS[key]]; if (e) cls(e, 'peek', false); if (key === 'issues') tray.key = ''; const s = stateOf(); if (s && dom()) updateHud(s); return v; } catch (e) { uerr('hudCollapse', e); return false; } };
  /** true while that part is drawn as its pill (compact mode, or collapsed in full mode, and not peeked open) */
  M.hudPill = function (key) { const e = E[HUD_PARTS[key]]; return !!(e && e.classList.contains('pill') && !e.classList.contains('peek')); };
  M.hudState = function () { const o = { mode: hudModeOf(), effective: hudEffective(), collapsed: {}, pill: {} }; const col = hudCollapsedOf(); for (const k in HUD_PARTS) { o.collapsed[k] = !!col[k]; o.pill[k] = M.hudPill(k); } return o; };
  /** a pill opened by hover / click (`peek`); closes when the pointer leaves the part */
  function hudPeek(key, on) { const e = E[HUD_PARTS[key]]; if (!e) return; if (on && !e.classList.contains('pill')) return; if (e.classList.contains('peek') === !!on) return; cls(e, 'peek', !!on); if (key === 'issues') tray.key = ''; if (key === 'palette') cls(E.hud, 'pal-pill', M.hudPill('palette')); }
  M.hudPeek = hudPeek;
  /** the collapse chevron of one part (full mode: fold to the pill; compact: close a peek) */
  function hudChevron(key) { const b = btn('hud-chev-' + key, '▾', 'icon hud-chev', function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (hudEffective() === 'compact') hudPeek(key, false); else M.hudCollapse(key); }); b.title = 'Fold this panel to a pill (H folds the whole HUD)'; E['hud-chev-' + key] = b; return b; }
  /** the pill a part folds to: icon + one short reading; click or hover opens it */
  function hudPillEl(key, glyph, label) { const p = el('div', 'hud-pill'); p.id = 'hud-pill-' + key; p.appendChild(el('span', 'pg', glyph)); const t = el('span', 'pt', label); p.appendChild(t); p.appendChild(el('span', 'pc', '▸')); p.title = 'Open'; p.addEventListener('click', function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (hudEffective() === 'compact') hudPeek(key, true); else M.hudCollapse(key, false); }); E['hud-pill-' + key] = p; E['hud-pill-' + key + '-text'] = t; return p; }
  function hudHover(key, e) { e.addEventListener('mouseenter', function () { if (e.classList.contains('pill')) hudPeek(key, true); }); e.addEventListener('mouseleave', function () { hudPeek(key, false); }); }
  /** per frame: the mode on #hud, each part's pill class, the chip, and (every 250 ms) the pill readings */
  function updateHud(s) {
    if (!dom() || !E.hud) return;
    const eff = hudEffective();
    if (E.hud.dataset.hud !== eff) { E.hud.dataset.hud = eff; hudSt.eff = eff; fitTopbar(); coach.layoutAt = -1e9; tray.key = ''; for (const k in HUD_PARTS) cls(E[HUD_PARTS[k]], 'peek', false); if (eff === 'hidden') { hideTooltip(); show(E['ghost-label'], false); } }
    const col = hudCollapsedOf();
    for (const k in HUD_PARTS) {
      const e = E[HUD_PARTS[k]]; if (!e) continue;
      const want = eff === 'compact' || (eff === 'full' && !!col[k] && coach.expanded.indexOf(k) < 0) || (k === 'issues' && alertModeOf() === 'off' && coach.step < 0);   // calm alerts pass: Alerts Off folds the tray to its count pill
      if (e.classList.contains('pill') !== want) { cls(e, 'pill', want); if (k === 'issues') tray.key = ''; }
      if (!want && e.classList.contains('peek')) cls(e, 'peek', false);
    }
    cls(E.hud, 'pal-pill', M.hudPill('palette'));
    const chip = eff === 'hidden' && !titleOn; if (chip !== hudSt.chipOn) { hudSt.chipOn = chip; show(E['hud-chip'], chip); }
    if (clock - hudSt.pillAt < 250) return; hudSt.pillAt = clock;
    try {
      const o = call('progress', 'objective', s); const cnt = E['obj-count'] ? E['obj-count'].textContent : '';
      setText(E['hud-pill-goals-text'], o ? 'Goal' + (cnt ? ' · ' + cnt : '') : 'Goals');
      let tight = 0; for (const k in E.needEls) { const lv = E.needEls[k].el.dataset.level; if (lv === 'warn' || lv === 'bad') tight++; }
      setText(E['hud-pill-needs-text'], tight ? 'Needs · ' + tight + ' tight' : 'Needs · OK');
    } catch (e) { /* stub */ }
  }

  // ---------------------------------------------------------------------------
  // DOM listeners → the machine (pointer / wheel / keys / gestures)
  // ---------------------------------------------------------------------------
  function modsOf(e) { return { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, meta: !!e.metaKey, alt: !!e.altKey, code: e.code, repeat: !!e.repeat }; }
  function attachInput(world) {
    const pt = function (type) { return function (e) { try { if (type === 'down' && typeof world.focus === 'function') world.focus(); M.pointer(type, fin(e.offsetX, 0), fin(e.offsetY, 0), fin(e.button, 0), modsOf(e)); if (type === 'down' && e.preventDefault) e.preventDefault(); } catch (err) { uerr('pointer:' + type, err); } }; };
    world.addEventListener('pointerdown', pt('down'));
    world.addEventListener('pointermove', pt('move'));
    world.addEventListener('pointerup', pt('up'));
    world.addEventListener('pointercancel', function () { M.pointer('cancel', lastPx, lastPy, 0, M0); });
    world.addEventListener('pointerleave', function () { hideTooltip(); show(E['ghost-label'], false); if (live.down) M.pointer('cancel', lastPx, lastPy, 0, M0); });   // the ghost label must not linger over HUD panels
    world.addEventListener('contextmenu', function (e) { if (e.preventDefault) e.preventDefault(); });
    world.addEventListener('dblclick', function (e) { if (e.preventDefault) e.preventDefault(); });
    world.addEventListener('wheel', function (e) { try { M.wheel(fin(e.offsetX, 0), fin(e.offsetY, 0), fin(e.deltaX, 0), fin(e.deltaY, 0), !!(e.ctrlKey || e.metaKey)); if (e.preventDefault) e.preventDefault(); } catch (err) { uerr('wheel', err); } }, { passive: false });
    let gestureZoom = 1;
    world.addEventListener('gesturestart', function (e) { gestureZoom = 1; if (e.preventDefault) e.preventDefault(); });
    world.addEventListener('gesturechange', function (e) { try { const sc = fin(e.scale, 1); if (sc / gestureZoom > 1.25) { gestureZoom = sc; call('render', 'zoomStep', 1, { x: lastPx, y: lastPy }); } else if (sc / gestureZoom < 0.8) { gestureZoom = sc; call('render', 'zoomStep', -1, { x: lastPx, y: lastPy }); } if (e.preventDefault) e.preventDefault(); } catch (err) { uerr('gesture', err); } });
    world.addEventListener('gestureend', function (e) { if (e.preventDefault) e.preventDefault(); });
    try {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('keydown', function (e) {
          try {
            if (isTextTarget(e.target)) return;
            const handled = M.keydown(e.key, modsOf(e));
            if (handled && shouldPrevent(e)) e.preventDefault();
          } catch (err) { uerr('keydown', err); }
        });
        window.addEventListener('keyup', function (e) { try { keyup(e.key); } catch (err) { uerr('keyup', err); } });
        window.addEventListener('blur', function () { try { for (const k in held) held[k] = false; if (live.down || live.state === 'DRAGGING') M.pointer('cancel', lastPx, lastPy, 0, M0); } catch (err) { uerr('blur', err); } });
        window.addEventListener('pointerup', function (e) { try { if (live.down && e.target !== world) M.pointer('up', lastPx, lastPy, fin(e.button, 0), modsOf(e)); } catch (err) { uerr('pointerup:window', err); } });
        window.addEventListener('resize', function () { try { const w = fin(window.innerWidth, 1280); cls(E.palette, 'compact', w < L.compactWidth); } catch (err) { /* stub */ } try { applyScale(uiMode); } catch (err) { /* stub */ } fitTopbar(); paletteFade(); });
      }
    } catch (e) { /* stub window */ }
  }
  function isTextTarget(t) { try { if (!t || typeof t.tagName !== 'string') return false; const tag = t.tagName.toUpperCase(); return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true; } catch (e) { return false; } }
  function shouldPrevent(e) {
    const k = e.key; if (k === 'Tab' || k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') return true;
    if ((e.ctrlKey || e.metaKey) && typeof k === 'string' && /^[spz]$/i.test(k)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Event subscriptions (owner 'ui'): listeners mark dirty flags; DOM writes happen in update
  // ---------------------------------------------------------------------------
  function subscribe() {
    const on = function (name, fn) { try { BSU.events.on(name, function (p) { try { fn(p || {}); } catch (e) { uerr('on:' + name, e); } }, 'ui'); } catch (e) { uerr('subscribe:' + name, e); } };
    on('econ:stat', function (p) { if (p.stat === 'cash' && fin(p.delta, 0) !== 0) { flashDelta(p.delta); } if (p.stat === 'students') needsAt = -1e9; });   // the needs strip follows enrollment at once
    on('agent:arrive', function () { odo.holdUntil = -1; });
    on('unlock:changed', function (p) { paletteDirty = true; bm.dirty = true; needsAt = -1e9; const s = stateOf(); if (!s) return; for (const id of (p.ids || [])) { const r = rowOf(id); if (r && r.tab && s.ui.tabsIntroduced[r.tab] && r.tab !== s.ui.paletteTab) s.ui.newPips[r.tab] = true; } });
    on('objective:offered', function () { objKey = ''; bubble.since = clock; });
    on('objective:complete', function (p) { objKey = ''; if (p.id === '1') { hudFade = true; hudFadeAt = clock; } });
    on('objective:dismissed', function () { objKey = ''; }); on('objective:progress', function () { objKey = ''; });
    on('ring:changed', function () { objKey = ''; });
    on('milestone:earned', function () { msAt = -1e9; paletteDirty = true; });   // progress posts the paw-stamped notify itself
    on('game:decision', function (p) { if (!p || !p.id) return; if (p.closed) { delete gameDecs[p.id]; return; } gameDecs[p.id] = { id: p.id, kind: p.kind, options: Array.isArray(p.options) ? p.options : null, def: p.def, deadlineTicks: fin(p.deadlineTicks, 0) }; });   // football pass D: the engine emits this just before ui.decision, so openToast finds the options
    on('storm:toast', function (p) { const s = stateOf(); if (s) M.decision(s, { id: p.id, text: p.text, yes: p.yes, no: p.no, untilTick: p.untilTick, ticks: L.toastTicks }); });
    on('storm:named', function () { alertAt = -1e9; }); on('storm:watch', function () { alertAt = -1e9; }); on('storm:bands', function () { alertAt = -1e9; }); on('storm:landfall', function () { alertAt = -1e9; }); on('storm:passed', function () { alertAt = -1e9; });
    on('mosquito:warning', function (p) { alertAt = -1e9; const s = stateOf(); if (s && p && p.text) M.notify(s, { kind: 'wildlife', text: p.text, locate: 'mosquito' }); });
    on('weather:heat', function () { alertAt = -1e9; });
    on('power:blackout', function () { alertAt = -1e9; }); on('power:restored', function () { alertAt = -1e9; });
    on('building:flooded', function () { alertAt = -1e9; }); on('building:dried', function () { alertAt = -1e9; });
    on('coverage:changed', function () { inspDirty = true; });
    on('building:placed', function () { paletteDirty = paletteDirty || false; inspDirty = true; needsAt = -1e9; bm.dirty = true; });
    on('building:complete', function () { needsAt = -1e9; bm.dirty = true; });
    on('building:menu', function () { needsAt = -1e9; inspAt = -1e9; });   // P6: a new card moves the Dining gauge and the inspect Menu section at once
    on('coverage:changed', function () { needsAt = -1e9; });
    on('building:removed', function () { if (insp && insp.kind === 'building') { const s = stateOf(); if (s && !call('buildings', 'get', s, insp.id)) M.closeInspect(); } });
    on('ui:ticker', function () { tk.lastLen = -1; if (tk.logOpen) rebuildLog(stateOf()); });
    on('save:written', function (p) { const s = stateOf(); if (s && p && p.slot && String(p.slot).indexOf('auto') !== 0 && String(p.slot)[0] !== '_') M.notify(s, { kind: 'info', text: 'Saved', ttl: 3000 }); });
    on('save:loaded', function () { if (titleOn) M.showTitle(false); });
    on('speed:changed', function () { speedKey = ''; });
    on('setpiece:start', function () {
      const s = stateOf(); if (s && s.ui.tool && !toolLocked) M.selectTool(s, null);
      M.closeBuildMenu();
      // an open modal card goes back to the queue front (no onClose: it is re-offered when the set piece ends)
      if (card && !card.spec.duringSetPiece) { cardQueue.unshift(card.spec); card = null; if (dom()) { clear(E.cards); show(E.cards, false); } }
      hideTooltip();
    });
    on('setpiece:end', function () { skipShown = false; if (!card && cardQueue.length) { const s = stateOf(); if (s) openCard(s, cardQueue.shift()); } });
    on('error', function () { errCount++; });
    on('game:kickoff', function (p) { const s = stateOf(); if (s) M.notify(s, { kind: 'sports', text: 'Kickoff vs ' + (p.opp && p.opp.name ? p.opp.name : ((BSU.data && BSU.data.opponents && BSU.data.opponents[p.opp] && BSU.data.opponents[p.opp].name) || p.opp || 'the visitors')) + (p.night ? ' under the lights' : ''), ttl: 8000 }); });
    on('festival:start', function (p) { const s = stateOf(); if (s && p && p.id === 'mardiGras') M.notify(s, { kind: 'event', text: 'Laissez les bons temps rouler — Mardi Gras!' }); });
    on('econ:card', function () { /* ui_panels opens the failure card */ });
    on('camera:moved', function () { /* render draws the minimap viewport */ });
    on('building:renamed', function () { inspDirty = true; });
  }

  // ---------------------------------------------------------------------------
  // The input state machine — a pure step over a context with injected callbacks (testable without the DOM)
  // ---------------------------------------------------------------------------
  function makeMachine(cb) { return { state: 'IDLE', prev: 'IDLE', down: null, run: [], runStart: -1, runTile: -1, cb: cb }; }
  function mcSet(mc, s) { mc.state = s; if (mc === live) M.state = s; }
  function lineRun(a, b) {
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0, out = [];
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) { const st = bx >= ax ? 1 : -1; for (let x = ax; ; x += st) { out.push(ay * W + x); if (x === bx) break; } }
    else { const st = by >= ay ? 1 : -1; for (let y = ay; ; y += st) { out.push(y * W + ax); if (y === by) break; } }
    return out;
  }
  function stairRun(a, b) {
    let ax = a % W, ay = (a / W) | 0; const bx = b % W, by = (b / W) | 0, out = [];
    while (ax !== bx) { ax += bx > ax ? 1 : -1; out.push(ay * W + ax); }
    while (ay !== by) { ay += by > ay ? 1 : -1; out.push(ay * W + ax); }
    return out;
  }
  /** the pending run is an ordered trail of 4-connected tiles; trail[last] === mc.runTile is where the cursor is.
   *  A tile already in the trail is a BACKTRACK: the trail is cut back to it (everything laid after it disappears).
   *  Anything else extends by the x-then-y staircase from the last tile (a jump of the cursor is filled in). Shift = straight line. */
  function extendRun(mc, ev) {
    const j = mc.cb.tileAt(ev.px, ev.py); if (j < 0 || j === mc.runTile) return false;
    if (ev.mods && ev.mods.shift) mc.run = lineRun(mc.runStart, j);
    else {
      const at = mc.run.indexOf(j);
      if (at >= 0) mc.run.length = at + 1;   // backtrack straight to the tile under the cursor
      else {
        const path = stairRun(mc.run.length ? mc.run[mc.run.length - 1] : mc.runStart, j);
        for (const i of path) { const k = mc.run.indexOf(i); if (k >= 0) mc.run.length = k + 1; else mc.run.push(i); }
      }
    }
    mc.runTile = mc.run.length ? mc.run[mc.run.length - 1] : j;
    return true;
  }
  /** drop the pending run: nothing was placed while dragging, so everything that already exists stays; the tool stays selected */
  function cancelRun(mc, px, py) { mc.run = []; mc.runTile = -1; mc.runStart = -1; mc.down = null; mcSet(mc, 'PLACING'); if (px == null) mc.cb.ghost(null); else mc.cb.ghost(px, py); }
  function mcRightClick(mc) { const cb = mc.cb; if (cb.getTool() && !cb.locked()) { mcStep(mc, { type: 'tool', id: null }); return; } if (cb.inspecting()) { cb.closeInspect(); mcSet(mc, 'IDLE'); } }
  /** one transition; ev = {type:'down'|'move'|'up'|'cancel'|'tool'|'key', px, py, button, mods, id, key} */
  function mcStep(mc, ev) {
    const cb = mc.cb, tool = cb.getTool();
    const isDrag = !!(tool && cb.isDrag(tool.id));
    switch (ev.type) {
      case 'tool': {
        if (ev.id == null) { if (cb.locked()) return false; cb.setTool(null); mc.run = []; mc.down = null; if (mc.state === 'PLACING' || mc.state === 'DRAGGING') mcSet(mc, cb.inspecting() ? 'INSPECTING' : 'IDLE'); cb.ghost(null); return true; }
        cb.setTool({ id: ev.id, rot: 0, shift: false }); mc.run = []; mc.down = null; mcSet(mc, 'PLACING'); cb.ghost(ev.px, ev.py); return true;
      }
      case 'down': {
        if (mc.state === 'DRAGGING' && ev.button !== 0) { if (ev.button === 2) cancelRun(mc, ev.px, ev.py); return true; }   // right-click mid-drag = cancel the whole run (kept tool); the stray release does nothing
        if (ev.button === 1 || ev.button === 2) { mc.down = { px: ev.px, py: ev.py, lx: ev.px, ly: ev.py, button: ev.button, moved: false, pan: true, prev: mc.state }; return true; }
        if (ev.button !== 0) return false;
        if (mc.state === 'PLACING' && isDrag) { const i = cb.tileAt(ev.px, ev.py); if (i < 0) return false; mc.run = [i]; mc.runStart = i; mc.runTile = i; mcSet(mc, 'DRAGGING'); cb.ghost(ev.px, ev.py); return true; }
        mc.down = { px: ev.px, py: ev.py, lx: ev.px, ly: ev.py, button: 0, moved: false, pan: false, prev: mc.state }; return true;
      }
      case 'move': {
        if (mc.down) {
          const d = mc.down;
          if (!d.moved && Math.hypot(ev.px - d.px, ev.py - d.py) > L.dragThreshold) { d.moved = true; mc.prev = d.prev; mcSet(mc, 'PANNING'); }
          if (d.moved) cb.pan(-(ev.px - d.lx), -(ev.py - d.ly));
          d.lx = ev.px; d.ly = ev.py; return true;
        }
        if (mc.state === 'DRAGGING') { extendRun(mc, ev); cb.ghost(ev.px, ev.py); return true; }
        if (mc.state === 'PLACING') { cb.ghost(ev.px, ev.py); return true; }
        cb.hover(ev.px, ev.py); return true;
      }
      case 'up': {
        if (mc.state === 'DRAGGING') { if (ev.button != null && ev.button !== 0) return true; const r = mc.run; mc.run = []; mc.runTile = -1; mcSet(mc, 'PLACING'); cb.placeRun(r); cb.ghost(ev.px, ev.py); return true; }
        const d = mc.down; if (!d) return false; mc.down = null;
        if (mc.state === 'PANNING') mcSet(mc, d.prev === 'PANNING' ? 'IDLE' : d.prev);
        if (d.pan) { if (d.button === 2 && !d.moved) mcRightClick(mc); return true; }
        if (d.moved) return true;
        if (mc.state === 'PLACING') {
          const ok = cb.place(ev.px, ev.py, ev.mods || M0);
          if (ok && !(ev.mods && ev.mods.shift) && !cb.locked()) { cb.setTool(null); mcSet(mc, cb.inspecting() ? 'INSPECTING' : 'IDLE'); cb.ghost(null); }
          else if (ok) { const t = cb.getTool(); if (t && ev.mods && ev.mods.shift) t.shift = true; cb.ghost(ev.px, ev.py); }
          return true;
        }
        if (cb.inspectAt(ev.px, ev.py)) mcSet(mc, 'INSPECTING'); else { cb.closeInspect(); mcSet(mc, 'IDLE'); }
        return true;
      }
      case 'cancel': { mc.down = null; if (mc.state === 'DRAGGING') cancelRun(mc, null); else if (mc.state === 'PANNING') mcSet(mc, mc.prev === 'PANNING' ? 'IDLE' : mc.prev); return true; }
      case 'key': {
        if (ev.key === 'Escape') {
          if (mc.state === 'DRAGGING') { cancelRun(mc, ev.px, ev.py); return true; }   // first Esc drops the pending run, the next one drops the tool
          if (cb.getTool()) { if (cb.locked()) return true; mcStep(mc, { type: 'tool', id: null }); return true; }
          if (cb.inspecting()) { cb.closeInspect(); if (mc.state === 'INSPECTING') mcSet(mc, 'IDLE'); return true; }
          return false;
        }
        if (ev.key === 'r') { const t = cb.getTool(); if (t && cb.rotatable(t.id)) { t.rot ^= 1; cb.ghost(ev.px, ev.py); return true; } return false; }
        return false;
      }
    }
    return false;
  }
  /** tests: a private machine over injected callbacks → step(ev) (ARCHITECTURE §10.6; no DOM) */
  M._machine = function (cb) {
    const defaults = { tool: null, insp: false };
    const c = {
      getTool: function () { return defaults.tool; }, setTool: function (t) { defaults.tool = t; }, isDrag: function (id) { const r = rowOf(id); return !!(r && r.kind === 'drag'); },
      rotatable: function (id) { const r = rowOf(id); return !!(r && r.rotatable); }, locked: function () { return false; }, inspecting: function () { return defaults.insp; },
      tileAt: function (px, py) { const tx = Math.floor(px / 20), ty = Math.floor(py / 11); return BSU.inBounds(tx, ty) ? ty * W + tx : -1; },
      pan: function () {}, hover: function () {}, ghost: function () {}, place: function () { return true; }, placeRun: function () {},
      inspectAt: function () { defaults.insp = true; return true; }, closeInspect: function () { defaults.insp = false; }
    };
    if (cb) for (const k in cb) c[k] = cb[k];
    const mc = makeMachine(c);
    return { mc: mc, step: function (ev) { return mcStep(mc, ev); }, get state() { return mc.state; }, get run() { return mc.run; }, get tool() { return c.getTool(); } };
  };

  // the live machine: callbacks bound to render/buildings/inspect
  const live = makeMachine({
    getTool: function () { const s = stateOf(); return s && s.ui ? s.ui.tool : null; },
    setTool: function (t) { if (!t || !ghostPin || ghostPin.id !== t.id) ghostPin = null; const s = stateOf(); if (s && s.ui) { s.ui.tool = t; } markToolDom(s); if (t && bm.open && !bm.keepOpen) M.closeBuildMenu(); try { emit('ui:tool', { tool: t ? t.id : null }); } catch (e) { uerr('emit:tool', e); } },
    isDrag: function (id) { const r = rowOf(id); return !!(r && r.kind === 'drag'); },
    rotatable: function (id) { const r = rowOf(id); return !!(r && r.rotatable); },
    locked: function () { return toolLocked; },
    inspecting: function () { return !!insp; },
    tileAt: function (px, py) { return tileIndexAt(px, py); },
    pan: function (dx, dy) { call('render', 'panBy', dx, dy, true); },
    hover: function (px, py) { hoverEntity(stateOf(), px, py); },
    ghost: function (px, py) { if (px == null) { call('render', 'ghost', null); show(E['ghost-label'], false); lastGhost = null; } else updateGhost(stateOf(), px, py); },
    place: function (px, py, mods) { return clickPlace(stateOf(), px, py, mods); },
    placeRun: function (run) { finishRun(stateOf(), run); },
    inspectAt: function (px, py) { return clickInspect(stateOf(), px, py); },
    closeInspect: function () { closeInspectDom(); }
  });

  function tileIndexAt(px, py) { const t = call('render', 'screenToTile', px, py); if (!t) return -1; const tx = Math.floor(fin(t.tx, -1)), ty = Math.floor(fin(t.ty, -1)); return BSU.inBounds(tx, ty) ? ty * W + tx : -1; }

  /** the single pointer entry (also headless.click); px/py are canvas CSS px */
  M.pointer = function (type, px, py, button, mods) {
    try {
      const s = stateOf(); if (!s || !s.ui) return;
      px = fin(px, 0); py = fin(py, 0); lastPx = px; lastPy = py; mods = mods || M0;
      if (ghostPin && ghostPin.fresh && type === 'move' && Math.hypot(px - ghostPin.px0, py - ghostPin.py0) > 12) ghostPin.fresh = false;   // issues v2: the armed ghost follows the pointer once it travels onto the map (it still snaps back within ~2 tiles of the spot)
      heldShift = !!mods.shift;
      if (titleOn) return;
      if (type === 'down' && s.ui.panel && !s.ui.tool && !bm.open) { M.openPanel(null); return; }   // a map click dismisses an open panel
      if (type === 'down') { if (call('progress', 'tutorialStage', s) === 1) { call('progress', 'skipSwoop', s); return; } if (s.setPiece) call('render', 'captureCameraTouch', s); show(E.popover, false); if (bm.open) M.closeBuildMenu(); }   // a press on the map while the menu is up (Build it keeps it open) is the player's answer: close it and place   // the swoop-skipping click must not also open the tile inspector behind the charter card
      if (type === 'move' || type === 'down') { const i = tileIndexAt(px, py); M.hoverTile = i; if (BSU.render) BSU.render.hoverTile = i; }
      mcStep(live, { type: type, px: px, py: py, button: fin(button, 0) | 0, mods: mods });
    } catch (e) { uerr('pointer:' + type, e); }
  };
  /** wheel (hud + zoom pass): the wheel zooms AT THE CURSOR, one step per notch — a mouse notch (|dy| ≥ 40) steps at once, a trackpad's
   *  pixel stream accumulates to the same notch, and steps are rate-limited to one per 90 ms of HUD clock (rapid events coalesce);
   *  ctrl+wheel (a pinch) takes the same path with a finer notch. A sideways two-finger scroll (|dx| > 1.5·|dy|) still pans. */
  M.wheel = function (px, py, dx, dy, ctrl) {
    try {
      const s = stateOf(); if (titleOn || !s) return;
      dx = fin(dx, 0); dy = fin(dy, 0);
      if (!ctrl && Math.abs(dx) > Math.abs(dy) * 1.5) { call('render', 'panBy', clamp(dx, -120, 120), clamp(dy, -120, 120), true); if (live.state === 'PLACING' || live.state === 'DRAGGING') updateGhost(s, px, py); return; }
      if (Math.abs(dy) < 0.5) return;
      if (clock - hudSt.wheelAt > 250) hudSt.wheelAcc = 0;
      hudSt.wheelAt = clock; hudSt.wheelAcc += dy;
      if (Math.abs(hudSt.wheelAcc) < (ctrl ? WHEEL_NOTCH_PINCH : WHEEL_NOTCH)) return;
      const dir = hudSt.wheelAcc < 0 ? 1 : -1; hudSt.wheelAcc = 0;
      if (clock - hudSt.wheelStepAt < WHEEL_STEP_MS) return;
      hudSt.wheelStepAt = clock;
      call('render', 'zoomStep', dir, { x: px, y: py });
      if (live.state === 'PLACING' || live.state === 'DRAGGING') updateGhost(s, px, py);
    } catch (e) { uerr('wheel', e); }
  };
  const WHEEL_NOTCH = 40, WHEEL_NOTCH_PINCH = 8, WHEEL_STEP_MS = 90;

  // ---------------------------------------------------------------------------
  // Keyboard (ARCHITECTURE §7.4): precedence toast → focused input → card → map
  // ---------------------------------------------------------------------------
  let KEYMAP = null;
  function keyId(key, ctrl, shift) { return (ctrl ? 'C' : '') + (shift ? 'S' : '') + ':' + (typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key); }
  function keymap() {
    if (KEYMAP) return KEYMAP;
    KEYMAP = new Map();
    for (const k of ((BSU.data && BSU.data.keys) || [])) KEYMAP.set(keyId(k.key, !!k.ctrl, !!k.shift), k.action);
    return KEYMAP;
  }
  function panDirOf(key) {
    const pk = (BSU.data && BSU.data.panKeys) || {}; const km = keymap();
    for (const dir in pk) for (const k of pk[dir]) {
      if (k !== key) continue;
      const bound = km.get(keyId(k, false, false));
      if (bound && bound.indexOf('pan') !== 0) continue;   // `w` is the Water overlay (data.js note); arrows + a/s/d pan
      return dir;
    }
    return null;
  }
  function keyup(key) { const d = panDirOf(key); if (d) held[d] = false; if (key === 'Shift') { heldShift = false; if (live.state === 'PLACING') updateGhostQuiet(); } if (key === 'i' || key === 'I') { if (heldI) { heldI = false; applySpotlight(); } } }   // issue spotlight pass: releasing I restores the map
  /** keydown(key, mods) → true when handled (also headless.key) */
  M.keydown = function (key, mods) {
    try {
      mods = mods || M0; const s = stateOf(); if (!s || !s.ui) return false;
      if (key === 'Shift') { if (!heldShift) { heldShift = true; if (live.state === 'PLACING') updateGhostQuiet(); } return false; }   // design pass: flush placement while held
      const isBackquote = mods.code === 'Backquote' || key === '`';
      // (1) decision toast
      if (toast) {
        const tkeys = (BSU.data && BSU.data.toastKeys) || { yes: ['y', 'Enter'], no: ['n', 'Escape'] };
        if (toast.options && key.length === 1 && key >= '1' && key <= '9') { const o = toast.options[Number(key) - 1]; if (o) { answerToast(toast.id, o.key); return true; } }   // football pass D: 1/2/3 pick an engine option
        if (tkeys.yes.indexOf(key) >= 0) { answerToast(toast.id, 'yes'); return true; }
        if (tkeys.no.indexOf(key) >= 0) { answerToast(toast.id, 'no'); return true; }
      }
      // (2) a focused text field takes every key
      if (focusedInput) {
        if (key === 'Enter' || key === 'Escape') { if (renaming && focusedInput === renaming.input) { if (key === 'Enter') commitRename(s); else cancelRename(); return true; } if (focusedInput === E['title-seed'] && key === 'Enter') { charterClick(); return true; } }
        return false;
      }
      // (3) an open card takes Enter / Escape
      if (card) {
        if (key === 'Enter') { cardPrimary(s); return true; }
        if (key === 'Escape' && !s.ui.tool && !insp && !s.ui.panel) { if (card.spec.modal === true) return true; M.closeCard(); return true; }   // Esc peels one layer: tool → inspect → panel → card
      }
      if (titleOn) return false;
      // (3b) the coach-mark tour owns the keyboard while it is up: Enter/→/Space next, ← back, Esc skips
      if (coach.step >= 0 && !coach.paused) {
        if (key === 'Enter' || key === 'ArrowRight' || key === ' ') { coachNext(s, 1); return true; }
        if (key === 'ArrowLeft') { coachNext(s, -1); return true; }
        if (key === 'Escape') { coachFinish(s, false); return true; }
        return true;
      }
      // (4) the map
      if (isBackquote) { toggleDebug(s); return true; }
      if (key === 'Escape') {
        if (menuEdit) { M.closeMenuEditor(); return true; }   // menu layout pass: Esc closes the Edit menu overlay before anything else
        if (bm.open) { M.closeBuildMenu(); return true; }
        if (mcStep(live, { type: 'key', key: 'Escape', px: lastPx, py: lastPy })) return true;
        if (!E.popover.classList.contains('hidden')) { show(E.popover, false); return true; }
        if (s.ui.panel) { M.openPanel(null); return true; }
        if (card) { M.closeCard(); return true; }
        if (spotToggled || (issuesApi() && issuesApi().selectedId() !== null)) { clearIssueUi(); return true; }   // issue spotlight pass: Esc #5 clears the issue selection / spotlight
        if (notifs.length) { M.dismissNotifs(); return true; }   // gator pass: Esc #6 clears the notification stack
        return false;
      }
      // issue spotlight pass: I is handled here (not in data.keys, data.js is not edited in this pass): tap = next issue, hold = spotlight, Shift+I = toggle spotlight
      if ((key === 'i' || key === 'I') && !mods.ctrl && !mods.meta && !mods.alt) {
        if (mods.shift) { toggleSpotlight(); return true; }
        if (!mods.repeat) cycleIssue(s, 1);
        heldI = true; applySpotlight(); return true;
      }
      let k = key;
      if (k === '+') k = '=';   // hud + zoom pass: + (Shift+=) and = both zoom in
      if (mods.shift && typeof mods.code === 'string' && /^Digit[1-9]$/.test(mods.code)) k = mods.code.slice(5);
      const action = keymap().get(keyId(k, !!(mods.ctrl || mods.meta), !!mods.shift)) || (mods.shift ? keymap().get(keyId(k, !!(mods.ctrl || mods.meta), false)) : null);
      const pd = (!mods.ctrl && !mods.meta) ? panDirOf(key) : null;
      if (pd) { held[pd] = true; return true; }
      if (!action) return false;
      return doAction(s, action, mods);
    } catch (e) { uerr('keydown', e); return false; }
  };
  function doAction(s, action, mods) {
    switch (action) {
      case 'pause': { const sp = fin(s.ui.speed, 1); M.setSpeed(s, sp === 0 ? (fin(s.ui.speedBefore, 1) || 1) : 0); return true; }
      case 'speed1': M.setSpeed(s, 1); return true;
      case 'speed2': M.setSpeed(s, 2); return true;
      case 'speed4': M.setSpeed(s, 4); return true;
      case 'speed8': M.setSpeed(s, 8); return true;
      case 'budget': M.openPanel(s.ui.panel === 'budget' ? null : 'budget'); return true;
      case 'season': M.openPanel(s.ui.panel === 'season' ? null : 'season'); return true;
      case 'storm': M.openPanel(s.ui.panel === 'storm' ? null : 'storm'); return true;   // qa pass 4: no cone gate — since P4 the panel offers precautions with no storm (the topbar button never had the gate)
      case 'milestones': M.openPanel(s.ui.panel === 'milestones' ? null : 'milestones'); return true;
      case 'overlayFlood': case 'overlayWater': case 'overlayMosquito': case 'overlayPower': case 'overlayCoverage': case 'overlayEcology': {
        const ov = { overlayFlood: OV.FLOOD, overlayWater: OV.WATER, overlayMosquito: OV.MOSQUITO, overlayPower: OV.POWER, overlayCoverage: OV.COVERAGE, overlayEcology: OV.ECOLOGY }[action];
        M.setOverlay(s, s.ui.overlay === ov ? OV.NONE : ov); return true;
      }
      case 'zoomOut': call('render', 'zoomStep', -1, null); return true;
      case 'zoomIn': call('render', 'zoomStep', 1, null); return true;
      case 'hud': M.cycleHud(1); return true;   // hud + zoom pass: H
      case 'hudFull': M.setHudMode('full'); return true;   // Shift+H
      case 'nextTab': cycleTab(s, 1); return true;
      case 'prevTab': cycleTab(s, -1); return true;
      case 'bulldoze': { const t = s.ui.tool; if (toolLocked) return true; M.selectTool(s, t && t.id === 'bulldoze' ? null : 'bulldoze'); return true; }
      case 'buildMenu': { if (bm.open) M.closeBuildMenu(); else M.openBuildMenu(s, {}); return true; }
      case 'rotate': return mcStep(live, { type: 'key', key: 'r', px: lastPx, py: lastPy }) || true;
      case 'home': { const f = s.plot && s.plot.founders; if (f) call('render', 'panToTile', f.tx + 1, f.ty + 1); return true; }
      case 'follow': { const cam = s.ui.camera; if (cam && cam.follow >= 0) { call('render', 'follow', -1); } else { const a = call('agents', 'follow', s); if (a && Number.isFinite(a.id)) call('render', 'follow', a.id); } return true; }
      case 'escape': return mcStep(live, { type: 'key', key: 'Escape', px: lastPx, py: lastPy });
      case 'save': call('session', 'save', 'manual.0'); return true;
      case 'undo': doUndo(s); return true;
      case 'postcard': postcard(s); return true;
      case 'mute': toggleMute(); return true;
      case 'toastYes': return false;
      case 'debug': toggleDebug(s); return true;
      default: {
        const m = /^pick([1-9])$/.exec(action);
        if (m) { pickItem(s, parseInt(m[1], 10) - 1); return true; }
        if (action.indexOf('pan') === 0) return true;
        return false;
      }
    }
  }
  function heldPan() {
    let dx = 0, dy = 0; if (held.left) dx -= L.panPx; if (held.right) dx += L.panPx; if (held.up) dy -= L.panPx; if (held.down) dy += L.panPx;
    if (dx || dy) { const s = stateOf(); const z = s && s.ui.camera ? fin(s.ui.camera.zoom, 1) : 1; call('render', 'panBy', dx / z, dy / z, true); }
  }
  function toggleMute() { const s = stateOf(); if (!s) return; const set = M.settings(); const on = !set.muted; set.muted = on; call('audio', 'mute', on); M.saveSettings(); refreshMuteButtons(); }
  function refreshMuteButtons() { const set = M.settings(); const g = set && set.muted ? '🔇' : '🔊'; if (E['btn-mute-glyph']) setText(E['btn-mute-glyph'], g); if (E['btn-title-mute']) setText(E['btn-title-mute'], g); }
  function toggleDebug(s) { const open = !M.debug.open; M.debug.open = open; if (dom()) M.openPanel(open ? 'debug' : (s.ui.panel === 'debug' ? null : s.ui.panel)); call('progress', 'debugOpen', s, open); }
  function postcard(s) {
    const r = call('render', 'postcard', s, undefined); let url = typeof r === 'string' ? r : (r && typeof r.toDataURL === 'function' ? r.toDataURL('image/png') : '');
    if (!url || url.length < 40) { M.notify(s, { kind: 'info', text: 'Postcard not available here', ttl: 3000 }); return; }
    try { const a = document.createElement('a'); a.href = url; a.download = 'bayou-state-' + BSU.formatDate(dayOf(s)).replace(/[^A-Za-z0-9]+/g, '-') + '.png'; a.click(); M.notify(s, { kind: 'event', text: 'Postcard saved', ttl: 3000 }); } catch (e) { uerr('postcard', e); }
  }

  // ---------------------------------------------------------------------------
  // Tools, palette actions, ghost, placing
  // ---------------------------------------------------------------------------
  /** select a catalog row / 'bulldoze' / null (cancel); locked rows → invalid sound */
  M.selectTool = function (state, id) {
    try {
      if (typeof state === 'string' || state === null) { id = state; state = stateOf(); }
      const s = state || stateOf(); if (!s || !s.ui) return;
      if (id == null) { mcStep(live, { type: 'tool', id: null }); return; }
      if (toolLocked) return;
      if (id !== 'bulldoze') {
        const row = rowOf(id); if (!row) { uerr('selectTool', new Error('unknown tool ' + id)); return; }
        if (id !== 'founders_hall') { const u = call('buildings', 'unlocked', s, id); if (u && u.ok === false) { call('audio', 'play', 'invalid'); if (u.reason) M.notify(s, { kind: 'info', text: u.reason, ttl: 4000 }); return; } }
      }
      if (s.setPiece && !toolLocked && id !== 'founders_hall') return;
      if (insp && dom()) closeInspectDom();
      mcStep(live, { type: 'tool', id: id, px: lastPx, py: lastPy });
    } catch (e) { uerr('selectTool', e); }
  };
  M.tool = function () { const s = stateOf(); return s && s.ui ? s.ui.tool : null; };
  /** Objective 1: the Founders' ghost cannot be cancelled until placed — lockTool(on) or lockTool(state, on) */
  M.lockTool = function (a, b) { toolLocked = (typeof a === 'boolean') ? a : !!b; };
  function markToolDom(s) {
    if (!dom() || !s) return;
    const t = s.ui.tool; const id = t ? t.id : null;
    for (const k in E.itemEls) cls(E.itemEls[k], 'active', k === id);
    cls(E['btn-bulldoze'], 'active', id === 'bulldoze');
    cls(E.world, 'placing', !!id);
    if (!id) { show(E['ghost-label'], false); }
  }
  function ghostLabel(px, py, l1, l2, color) {
    const g = E['ghost-label']; if (!g) return;
    setText(E['ghost-l1'], l1); setText(E['ghost-l2'], l2 || ''); show(E['ghost-l2'], !!l2);
    g.dataset.color = color || 'green';
    const vw = fin(window.innerWidth, 1280), vh = fin(window.innerHeight, 800); const w = fin(g.offsetWidth, 200) || 200, h = fin(g.offsetHeight, 40) || 40;
    g.style.left = Math.round(clamp(px + 18, 4, vw - w - 4)) + 'px'; g.style.top = Math.round(clamp(py + 18, 4, vh - h - 4)) + 'px';
    show(g, true);
  }
  function ghostTarget(s, tool, px, py) {
    const t = call('render', 'screenToTile', px, py); if (!t) return null;
    let tx = Math.floor(fin(t.tx, 0)), ty = Math.floor(fin(t.ty, 0)); let cove = false;
    let pinned = false;   // issues v2: an armed ghost sits on the recommended spot until the pointer travels onto the map, then snaps to it within ~2 tiles; a building on the spot drops the pin
    if (ghostPin && ghostPin.id === tool.id && live.state !== 'DRAGGING') {
      if (call('buildings', 'at', s, ghostPin.tx, ghostPin.ty)) ghostPin = null;
      else {
        let near = !!ghostPin.fresh;
        if (!near) { const a = call('render', 'tileToScreen', ghostPin.tx, ghostPin.ty), b2 = call('render', 'tileToScreen', ghostPin.tx + 2, ghostPin.ty + 2); if (a && b2) near = Math.hypot(px - a.x, py - a.y) <= Math.hypot(b2.x - a.x, b2.y - a.y); }
        if (near) { tx = ghostPin.tx; ty = ghostPin.ty; pinned = true; }
      }
    }
    if (tool.id === 'founders_hall' && s.plot && s.plot.founders) { const c = s.plot.cove || []; const i = BSU.inBounds(tx, ty) ? ty * W + tx : -1; cove = i >= 0 && c.indexOf(i) >= 0; tx = s.plot.founders.tx; ty = s.plot.founders.ty; }
    const g = { tx: clamp(tx, 0, W - 1), ty: clamp(ty, 0, HGT - 1), cove: cove, setback: false };
    // design pass — soft spacing: a footprint that would touch another building snaps one tile out to leave a gap (Shift = flush)
    const row = rowOf(tool.id);
    if (row && row.kind === 'footprint' && tool.id !== 'founders_hall' && !heldShift && !cove && !pinned) {
      const sb = call('buildings', 'setbackSpot', s, tool.id, g.tx, g.ty, { rot: tool.rot });
      // connector pass: the setback must never push the ghost off its path — keep the candidate that touches a path
      // outright, else the one with the shorter tie, else the snapped one (Shift still forces flush)
      if (sb && sb.snapped && pathScore(s, tool, sb.tx, sb.ty) >= pathScore(s, tool, g.tx, g.ty)) { g.tx = sb.tx; g.ty = sb.ty; g.setback = true; }
    }
    return g;
  }
  /** how well a footprint candidate reaches the path network: touching 200, a tie 100 − its length, unplaceable −1 */
  function pathScore(s, tool, tx, ty) {
    const r = call('buildings', 'canPlace', s, tool.id, tx, ty, { rot: tool.rot, ignoreCash: true });
    if (!r || !r.ok) return -1;
    return r.connector && Array.isArray(r.connector.tiles) ? 100 - r.connector.tiles.length : 200;
  }
  /** re-run the ghost at the last pointer position (Shift released / pressed) */
  function updateGhostQuiet() { try { const s = stateOf(); if (s && s.ui && s.ui.tool && s.ui.tool.id !== 'bulldoze') updateGhost(s, lastPx, lastPy); } catch (e) { uerr('ghost', e); } }
  function updateGhost(s, px, py) {
    if (!s || !s.ui || !s.ui.tool) return;
    const tool = s.ui.tool;
    if (tool.id === 'bulldoze') { const i = tileIndexAt(px, py); const b = i >= 0 ? call('buildings', 'at', s, i % W, (i / W) | 0) : null; const row = b ? rowOf(b.type) : null; call('render', 'ghost', i >= 0 ? { tiles: b ? (call('buildings', 'footprint', s, b.id) || [i]) : [i], color: b && row && !row.demolishable ? 'red' : 'red', label: '' } : null); if (dom()) ghostLabel(px, py, b ? 'Demolish ' + (b.name || (row && row.name) || b.type) : 'Demolish', b && row && !row.demolishable ? 'Landmarks stay' : (b ? 'Refund 50%' : 'Click a path, road, levee, canal or fence'), 'red'); return; }
    const row = rowOf(tool.id); if (!row) return;
    const g = ghostTarget(s, tool, px, py); if (!g) return;
    const dragging = live.state === 'DRAGGING';
    const isRing = row.id === 'levee' || row.id === 'floodwall';
    const shrank = dragging && live.run.length < lastRunLen; lastRunLen = dragging ? live.run.length : 0;   // a backtrack changes the ring maths at once: never serve the throttled copy
    if (dragging && isRing && !shrank && clock - lastRingMs < L.ringThrottleMs && lastGhost) { drawGhost(s, tool, row, lastGhost.r, g, px, py, dragging); return; }
    const opts = { rot: tool.rot }; if (dragging) opts.tiles = live.run;
    const r = call('buildings', 'canPlace', s, tool.id, g.tx, g.ty, opts); if (!r) return;
    if (dragging && isRing) lastRingMs = clock;
    lastGhost = { r: r, tx: g.tx, ty: g.ty };
    drawGhost(s, tool, row, r, g, px, py, dragging);
  }
  /** canPlace's ridgeFull is a string or terrain's {text|reason} object: the label wants text, never '[object Object]' */
  /** canPlace's sink line is {rate, year, retrofit}: the wet-feet warning in words (GDD §4.8 subsidence) */
  function sinkText(sk) { if (!sk) return ''; if (typeof sk === 'string') return sk; if (typeof sk !== 'object') return ''; if (sk.text) return sk.text; return Number.isFinite(sk.rate) ? 'Wet ground: sinks ' + sk.rate + ' ft/yr' + (Number.isFinite(sk.year) ? ' · needs Pilings by Y' + sk.year : '') + (Number.isFinite(sk.retrofit) ? ' (' + money(sk.retrofit) + ' later)' : '') : ''; }
  function ridgeText(rf) { if (!rf) return ''; if (typeof rf === 'string') return rf; if (typeof rf !== 'object') return ''; if (rf.text || rf.reason) return rf.text || rf.reason; return Number.isFinite(rf.tx) ? 'Ridge full · best open site (' + rf.tx + ', ' + rf.ty + ') at ' + rf.elev + ' ft floods at ' + (rf.floodsAt || 'rain') : ''; }
  function drawGhost(s, tool, row, r, g, px, py, dragging) {
    const color = g.cove ? 'red' : (r.color || (r.ok ? 'green' : 'red'));
    let tiles = r.tiles && r.tiles.length ? r.tiles : [g.ty * W + g.tx];
    if (dragging && live.run.length) tiles = live.run;
    if (g.cove && s.plot && s.plot.cove) tiles = s.plot.cove;
    const conn = (!dragging && !g.cove && r.connector && Array.isArray(r.connector.tiles) && r.connector.tiles.length) ? r.connector : null;   // connector pass: the gravel tie this placement would lay
    const spec = { tiles: tiles, color: color, connectorTiles: conn ? conn.tiles : null, ringTiles: r.ring && Array.isArray(r.ring.tiles) ? r.ring.tiles : null, label: '', radius: fin(r.radius, 0), radiusCenter: { tx: g.tx, ty: g.ty } };
    if (row.kind === 'footprint' || row.kind === 'upgrade') spec.sprite = { id: tool.id, variant: r.needsPilings ? SPR.PILINGS : 0, tx: g.tx, ty: g.ty, rot: tool.rot };
    call('render', 'ghost', spec);
    if (!dom()) return;
    let l1, l2 = '';
    if (dragging) { const n = live.run.length; const per = fin(r.cost, row.cost) || row.cost; l1 = n + (n === 1 ? ' tile' : ' tiles') + ' · ' + money(per * n); if (r.ring && r.ring.text) l2 = r.ring.text; else if (r.ring && typeof r.ring.closed === 'boolean') l2 = r.ring.closed ? 'closes the ring' : (r.ring.shortText || ('still ' + fin(r.ring.short, 0) + ' tiles short')); if (!l2 && n > 1) l2 = 'Drag back to shorten · Esc cancels'; }
    else if (g.cove) { l1 = 'Not here'; l2 = 'The cove floods every rain. Build on the ridge.'; }
    else if (!r.ok) { l1 = r.reason || 'Cannot build here'; l2 = ridgeText(r.ridgeFull) || sinkText(r.sink) || ''; }
    else {
      l1 = money(r.cost); if (row.kind === 'drag') l1 += ' / tile';
      if (conn) { const n = conn.tiles.length; l1 += ' + ' + n + (n === 1 ? ' path tile ' : ' path tiles ') + money(conn.cost); }   // "+ 3 path tiles $6k"
      if (r.needsGrading) l1 += ' · Grade the site +' + money(r.gradingCost || 0); else if (r.needsPilings) l1 += ' · Pilings +' + money(r.pilingsCost || 0);
      if (ridgeText(r.ridgeFull)) l2 = ridgeText(r.ridgeFull); else if (sinkText(r.sink)) l2 = sinkText(r.sink); else if (r.ring && r.ring.text) l2 = r.ring.text; else if (!r.affordable) l2 = 'Not enough cash';
      else { const uw = utilityWarning(s, row, r); if (uw) l2 = uw; }
      if (r.unlinked) l2 = "This path isn't linked to campus yet — connect it to the Founders' Hall path" + (l2 ? ' · ' + l2 : '');
      if (g.setback) l2 = (l2 ? l2 + ' · ' : '') + 'Setback · hold Shift to place flush';
      if (tool.rot) l1 += ' · rotated (R)';
    }
    ghostLabel(px, py, l1, l2, color);
  }
  // ---------------------------------------------------------------------------
  // Undo (undo pass): Ctrl/Cmd+Z and the chip both land here. buildings.undo restores the last placement / drag run exactly
  // (or says why not); the ui adds the 5 s wall-clock half of the window (D16) and tells the player what happened.
  // ---------------------------------------------------------------------------
  function undoWallOpen() { return !!BSU.headlessMode || clock - undoAtMs <= fin(PU.undoSeconds, 5) * 1000 + 250; }
  function undoLabel(info) { if (!info) return ''; let t = info.n > 1 ? info.n + ' × ' + info.name : info.name; const k = fin(info.connector, 0); if (k > 0) t += ' + ' + k + (k === 1 ? ' path tile' : ' path tiles'); return t; }   // connector pass: "Dining Hall + 3 path tiles"
  function doUndo(s) {
    if (!s) return false;
    const info = call('buildings', 'undoInfo', s);
    let r;
    if (!undoWallOpen()) r = { ok: false, reason: info ? 'Too late to undo ' + undoLabel(info) + ' (' + fin(PU.undoSeconds, 5) + ' s window)' : 'Nothing to undo' };   // the ui half of the window (5 s wall-clock, D16) closed while the sim was paused
    else r = call('buildings', 'undo', s);
    if (r && r.ok) {
      call('audio', 'play', 'tick');
      const what = undoLabel(info) || (r.name ? (r.n > 1 ? r.n + ' × ' + r.name : r.name) : 'placement');
      M.notify(s, { kind: 'info', text: 'Undid ' + what + (r.refund > 0 ? ' · refunded ' + money(r.refund) : ''), ttl: 3500 });
      undoAtMs = -1e9; paletteDirty = true;
      if (live.state === 'PLACING') updateGhostQuiet();
    } else {
      call('audio', 'play', 'invalid');
      M.notify(s, { kind: 'info', text: (r && r.reason) || 'Nothing to undo', ttl: 3500 });
      undoAtMs = -1e9;
    }
    updateUndoChip(s);
    return !!(r && r.ok);
  }
  let undoChipKey = '';
  function updateUndoChip(s) {
    if (!dom() || !E['undo-chip']) return;
    const info = s && s.ui ? call('buildings', 'undoInfo', s) : null;
    const open = !!info && undoWallOpen() && !BSU.headlessMode;
    show(E['undo-chip'], open);
    if (!open) { undoChipKey = ''; return; }
    const key = info.id + '|' + info.n + '|' + info.refund; if (key !== undoChipKey) { undoChipKey = key; setText(E['undo-main'], 'Undo ' + undoLabel(info) + (info.refund > 0 ? ' · refund ' + money(info.refund) : '')); E['undo-chip'].title = 'Take back ' + undoLabel(info) + (info.refund > 0 ? ' and refund ' + money(info.refund) : '') + ' (Ctrl+Z)'; }
    const left = clamp(1 - (clock - undoAtMs) / (fin(PU.undoSeconds, 5) * 1000), 0, 1);
    const f = E['undo-fill']; if (f && f.style) f.style.width = Math.round(left * 100) + '%';
  }
  function clickPlace(s, px, py, mods) {
    if (!s || !s.ui.tool) return false;
    heldShift = !!(mods && mods.shift);
    const tool = s.ui.tool;
    if (tool.id === 'bulldoze') {
      const i = tileIndexAt(px, py); if (i < 0) return false;
      const b = call('buildings', 'at', s, i % W, (i / W) | 0);
      const r = b ? call('buildings', 'remove', s, b.id, 'demolish') : call('buildings', 'remove', s, { tile: i }, 'demolish');
      if (r && r.ok) { call('audio', 'play', 'tick'); if (dom()) ghostLabel(px, py, 'Removed' + (r.refund ? ' · refund ' + money(r.refund) : ''), '', 'green'); }   // undo covers the last placement only (GDD §11.2 / D16) — do not promise it here
      else { call('audio', 'play', 'invalid'); if (dom()) { ghostLabel(px, py, r && r.reason ? r.reason : 'Nothing here', '', 'red'); shakeLabel(); } }
      return false;   // the bulldozer stays selected
    }
    const row = rowOf(tool.id); if (!row) return false;
    const g = ghostTarget(s, tool, px, py); if (!g) return false;
    if (g.cove) { call('audio', 'play', 'invalid'); if (dom()) shakeLabel(); return false; }
    const pre = (lastGhost && lastGhost.tx === g.tx && lastGhost.ty === g.ty) ? lastGhost.r : null;
    const r = call('buildings', 'place', s, tool.id, g.tx, g.ty, { rot: tool.rot });
    if (r && r.ok) {
      call('audio', 'play', 'place'); undoAtMs = clock;
      if (toolLocked) toolLocked = false;
      if (dom()) ghostLabel(px, py, 'Placed · ' + money(r.cost), 'Ctrl+Z to undo', 'green');
      placedHint(s, row, pre);
      return true;
    }
    call('audio', 'play', 'invalid');
    if (dom()) { ghostLabel(px, py, r && r.reason ? r.reason : 'Cannot build here', '', 'red'); shakeLabel(); }
    return false;
  }
  function shakeLabel() { const g = E['ghost-label']; if (!g) return; cls(g, 'shake', true); shakeUntil = clock + 400; }
  function finishRun(s, run) {
    if (!s || !s.ui.tool || !run || !run.length) return;
    const tool = s.ui.tool;
    const r = call('buildings', 'placeRun', s, tool.id, run, {});
    if (!r) return;
    const placed = fin(r.placed, 0);
    for (let k = 0; k < Math.min(placed, 24); k++) call('audio', 'play', 'tick', { delayMs: 60 * k });
    if (placed > 0) { undoAtMs = clock; if (dom()) ghostLabel(lastPx, lastPy, placed + (placed === 1 ? ' tile' : ' tiles') + ' · ' + money(r.cost), 'Ctrl+Z to undo', 'green'); }
    else { const sk = r.skipped && r.skipped[0]; call('audio', 'play', 'invalid'); if (dom()) { ghostLabel(lastPx, lastPy, sk && sk.reason ? sk.reason : 'Nothing placed', '', 'red'); shakeLabel(); } }
  }

  // ---------------------------------------------------------------------------
  // Inspect (GDD §11.3)
  // ---------------------------------------------------------------------------
  function gatorsOf(s) { const g = (call('wildlife', 'gators', s) || []).slice(); if (s && s.wildlife && s.wildlife.leGrand) g.push(s.wildlife.leGrand); return g; }
  function gatorNear(s, tx, ty) { let best = null, bd = 1.5; for (const g of gatorsOf(s)) { if (!g) continue; const d = Math.max(Math.abs(fin(g.tx, -99) - (tx + 0.5)), Math.abs(fin(g.ty, -99) - (ty + 0.5))); if (d < bd) { bd = d; best = g; } } return best; }
  function clickInspect(s, px, py) {
    if (!s) return false;
    const i = tileIndexAt(px, py); if (i < 0) return false;
    const tx = i % W, ty = (i / W) | 0;
    const g = gatorNear(s, tx, ty);
    if (g) { M.inspect(s, { kind: 'gator', id: g.id, legend: g === s.wildlife.leGrand }); return true; }
    const a = call('agents', 'nearest', s, tx + 0.5, ty + 0.5, 1);
    if (a) { M.inspect(s, { kind: 'agent', id: a.id }); return true; }
    const b = call('buildings', 'at', s, tx, ty);
    if (b) { M.inspect(s, { kind: 'building', id: b.id }); return true; }
    if (s.tiles.crest[i] > 0) { M.inspect(s, { kind: 'levee', i: i }); return true; }
    M.inspect(s, { kind: 'tile', i: i }); return true;
  }
  /** open the inspect panel on {kind, id?, i?} */
  M.inspect = function (state, target) {
    try {
      const s = state || stateOf(); if (!s || !target || !target.kind) return;
      insp = { kind: target.kind, id: fin(target.id, -1), i: fin(target.i, -1), legend: !!target.legend }; inspAt = -1e9; renaming = null;
      if (dom()) { E.inspect.dataset.kind = insp.kind; show(E.inspect, true); cls(E.hud, 'inspect-open', true); refreshInspect(s); }
      if (live.state === 'IDLE') mcSet(live, 'INSPECTING');
    } catch (e) { uerr('inspect', e); }
  };
  M.closeInspect = function () { closeInspectDom(); if (live.state === 'INSPECTING') mcSet(live, 'IDLE'); };
  function closeInspectDom() { insp = null; renaming = null; if (menuEdit) M.closeMenuEditor(); if (focusedInput && focusedInput !== E['title-seed']) focusedInput = null; if (dom()) { show(E.inspect, false); cls(E.hud, 'inspect-open', false); } }
  function row(k, v, cls_) { const r = el('div', 'row' + (cls_ ? ' ' + cls_ : '')); r.appendChild(el('span', 'k', k)); r.appendChild(el('span', 'v', v)); return r; }
  function action(label, fn, cls_) { return btn(null, label, 'small' + (cls_ ? ' ' + cls_ : ''), function () { const s = stateOf(); const r = fn(s); if (r && r.ok === false && r.reason) M.notify(s, { kind: 'info', text: r.reason, ttl: 4000 }); inspAt = -1e9; }); }
  function stars(n) { n = clamp(fin(n, 0) | 0, 0, 5); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  /** P6: appeal 1–4 as four stars (the mean rounds) */
  function appealStars(n) { n = clamp(Math.round(fin(n, 0)), 0, 4); return '★★★★'.slice(0, n) + '☆☆☆☆'.slice(0, 4 - n); }
  /** the preset whose dishes (its first `cap`, any order) are exactly the card, or null */
  function menuPresetKey(ms) {
    const presets = (BSU.data && BSU.data.menuPresets) || {}, have = ms.menu.slice().sort().join();
    for (const key of ['cheap', 'classic', 'chef']) { const pr = presets[key]; if (pr && pr.dishes.slice(0, ms.cap).sort().join() === have) return key; }
    return null;
  }
  /** menu layout pass: the one-line summary the inspect panel and the overlay share — "Serves ~1,200/day · appeal ★★☆☆ · food $78k/mo · Campus Classic" */
  function menuSummary(s, b, ms) {
    const presets = (BSU.data && BSU.data.menuPresets) || {}, key = menuPresetKey(ms), food = call('economy', 'foodCostOf', s, b.id) || { total: 0 };
    const nb = function (t) { return t.replace(/ /g, '\u00a0'); }, segs = ['Serves ~' + ms.throughput.toLocaleString('en-US') + '/day', 'appeal ' + appealStars(ms.meanAppeal), 'food ' + money(food.total) + '/mo', key ? presets[key].name : 'Custom menu'];
    return segs.map(nb).join('\u00a0· ');   // no-break spaces keep each segment (and its dot) whole when the line wraps
  }
  /** P6 + menu layout pass: the inspect panel's Menu section for a kitchen — kicker + "x / cap", the one-line summary, and the Edit menu button (the presets and the dish grid live in the overlay) */
  function menuSection(s, b, ms) {
    const box = el('div', 'insp-menu'); box.id = 'insp-menu';
    const open = !!(menuEdit && menuEdit.id === b.id);
    const head = el('div', 'menu-head'); const ttl = el('span', 'menu-ttl'); ttl.appendChild(el('span', 'k', 'Menu')); ttl.appendChild(el('span', 'menu-count', ms.menu.length + ' / ' + ms.cap));
    head.appendChild(ttl);
    const eb = btn('btn-edit-menu', open ? 'Close editor' : 'Edit menu', 'small primary' + (open ? ' on' : ''), function () { if (menuEdit && menuEdit.id === b.id) M.closeMenuEditor(); else M.openMenuEditor(b.id); });
    eb.title = 'Pick dishes and presets (Esc closes)'; head.appendChild(eb);
    box.appendChild(head);
    box.appendChild(el('div', 'menu-sum', menuSummary(s, b, ms)));
    return box;
  }
  /** open the Edit menu overlay for a kitchen (default: the inspected one); false when it has no kitchen / is not built */
  M.openMenuEditor = function (id) {
    try {
      const s = stateOf(); if (!s) return false;
      const bid = id != null ? fin(id, -1) : (insp && insp.kind === 'building' ? insp.id : -1);
      const b = bid >= 0 ? call('buildings', 'get', s, bid) : null, ms = b ? call('buildings', 'menuOf', s, bid) : null;
      if (!b || !ms || b.ruin || b.built < 1) return false;
      if (!insp || insp.kind !== 'building' || insp.id !== bid) M.inspect(s, { kind: 'building', id: bid });
      menuEdit = { id: bid }; menuReason = { text: '', until: 0 }; menuSig = ''; fadeAt = -1e9;
      if (dom()) {
        if (s.ui && s.ui.panel) M.openPanel(null);
        if (bm.open) M.closeBuildMenu();
        cls(E.hud, 'menu-open', true); show(E['menu-overlay'], true); syncMenuOverlay(s); inspAt = -1e9;
      }
      return true;
    } catch (e) { uerr('openMenuEditor', e); return false; }
  };
  M.closeMenuEditor = function () {
    if (!menuEdit) return false;
    menuEdit = null; menuSig = ''; fadeAt = -1e9; inspAt = -1e9;
    if (dom()) { show(E['menu-overlay'], false); cls(E.hud, 'menu-open', false); }
    return true;
  };
  M.menuEditorOpen = function () { return !!menuEdit; };
  /** a refusal's reason (cap, one-dish floor, unknown dish) shows on the overlay's own reason line for 5 s */
  function menuFlash(text) { menuReason = { text: String(text || ''), until: clock + 5000 }; }
  /** build or update the overlay in place from the live card: the presets, the dish cells (class / title only; rebuilt only when the shown set changes, so scroll and focus stay), the count, the reason, the note */
  function syncMenuOverlay(s) {
    if (!dom() || !menuEdit || !E['menu-overlay']) return;
    const D = BSU.data || {}, dishes = D.dishes || [], presets = D.menuPresets || {};
    const b = call('buildings', 'get', s, menuEdit.id), ms = b && !b.ruin && b.built >= 1 ? call('buildings', 'menuOf', s, b.id) : null;
    if (!b || !ms) { M.closeMenuEditor(); return; }
    const r = rowOf(b.type) || { name: b.type };
    setText(E['menu-title'], (b.name || r.name) + ' · Menu'); setText(E['menu-sum'], menuSummary(s, b, ms));
    // presets (built once)
    const pre = E['menu-presets'];
    if (!pre.children.length) for (const key of ['cheap', 'classic', 'chef']) {
      const pr = presets[key]; if (!pr) continue;
      const pb = btn(null, pr.name, 'small preset', function () { const st = stateOf(); if (!menuEdit) return; const rr = call('buildings', 'applyMenuPreset', st, menuEdit.id, key); if (rr && rr.ok === false && rr.reason) menuFlash(rr.reason); inspAt = -1e9; syncMenuOverlay(st); });
      pb.title = pr.blurb || ''; pb.dataset.preset = key; pre.appendChild(pb);
    }
    const pk = menuPresetKey(ms);
    for (const pb of pre.children) cls(pb, 'on', pb.dataset.preset === pk);
    // dish grid
    const order = dishes.slice().sort(function (a, c) { return (ms.specials.indexOf(c.id) >= 0 ? 1 : 0) - (ms.specials.indexOf(a.id) >= 0 ? 1 : 0); }).filter(function (d) { return !d.festival || ms.menu.indexOf(d.id) >= 0 || ms.specials.indexOf(d.id) >= 0; });   // the festival special leads the grid while it is on the card and shows only then
    const sig = order.map(function (d) { return d.id; }).join(','), grid = E['menu-grid'];
    if (sig !== menuSig) {
      const keep = fin(E['menu-overlay'].scrollTop, 0); menuSig = sig; clear(grid);
      for (const d of order) {
        const cell = btn(null, null, 'dish tier-' + d.tier, function () {
          const st = stateOf(); if (!menuEdit) return; const sp = (call('buildings', 'menuOf', st, menuEdit.id) || { specials: [] }).specials.indexOf(d.id) >= 0;
          if (sp) menuFlash(d.name + ' joins every hall for the festival (free)');
          else { const rr = call('buildings', 'toggleDish', st, menuEdit.id, d.id); if (rr && rr.ok === false && rr.reason) menuFlash(rr.reason); else menuReason = { text: '', until: 0 }; }
          inspAt = -1e9; syncMenuOverlay(st);
        });
        cell.dataset.dish = d.id; cell.title = d.text + (d.window ? ' (' + d.window.start + '–' + d.window.end + ')' : '');
        cell.appendChild(el('span', 'nm', d.name));
        const chips = el('span', 'chips');
        chips.appendChild(el('span', 'chip-m cost', '$' + (Math.round(d.cost * 100) / 100)));
        chips.appendChild(el('span', 'chip-m prep', 'prep ' + d.prep));
        chips.appendChild(el('span', 'chip-m appeal', '★' + clamp(Math.round(fin(d.appeal, 1)), 1, 4)));   // "★4": narrow enough for four columns
        cell.appendChild(chips); grid.appendChild(cell);
      }
      if (keep > 0) E['menu-overlay'].scrollTop = keep;
    }
    for (const cell of grid.children) {
      const d = dishes.find(function (x) { return x.id === cell.dataset.dish; }); if (!d) continue;
      const listed = ms.menu.indexOf(d.id) >= 0, special = ms.specials.indexOf(d.id) >= 0, inSeason = call('buildings', 'dishActive', s, d.id) !== false;
      const c = 'btn dish tier-' + d.tier + (listed || special ? ' on' : '') + (!inSeason ? ' off-season' : '') + (special ? ' special' : '');
      if (cell.className !== c) cell.className = c;
      const nm = cell.children[0]; setText(nm, d.name + (special ? ' ✦' : ''));
    }
    // count + inline reason
    const full = ms.menu.length >= ms.cap;
    setText(E['menu-count'], ms.menu.length + ' / ' + ms.cap); cls(E['menu-count'], 'full', full);
    const flash = menuReason.text && clock < menuReason.until;
    setText(E['menu-reason'], flash ? menuReason.text : full ? 'Menu is full (' + ms.cap + ' of ' + ms.cap + ') — remove a dish to add another' : 'Click a dish to add or remove it · ' + ms.cap + ' at most');
    cls(E['menu-reason'], 'flash', !!flash); cls(E['menu-reason'], 'full', !flash && full);
    setText(E['menu-note'], (ms.specials.length ? 'Festival special on the card, free · ' : '') + (ms.active.length < ms.menu.length ? (ms.menu.length - ms.active.length) + ' out of season · ' : '') + 'prep ' + (Math.round(ms.meanPrep * 10) / 10) + ' → ×' + (Math.round(ms.mult * 100) / 100) + ' throughput · $' + (Math.round(ms.meanCost * 100) / 100) + ' a plate');
  }
  function ft(v, d) { return fin(v, 0).toFixed(d == null ? 1 : d) + ' ft'; }
  /** the half-second refresh rebuilds the body; keep the player's scroll position (the P6 Menu grid made a long body common) */
  function refreshInspect(s) {
    if (!insp || !dom() || !s) return;
    const body0 = E['insp-body'], keep = body0 ? fin(body0.scrollTop, 0) : 0;
    refreshInspectBody(s);
    if (body0 && keep > 0 && body0.scrollTop !== keep) body0.scrollTop = keep;
  }
  function refreshInspectBody(s) {
    if (!insp || !dom() || !s) return;
    inspAt = clock; inspDirty = false;
    const body = E['insp-body'], acts = E['insp-actions']; clear(body); clear(acts);
    const spr = E['insp-sprite']; let hasSprite = false;
    const kind = insp.kind;
    if (menuEdit && !(kind === 'building' && insp.id === menuEdit.id)) M.closeMenuEditor();   // the overlay belongs to the inspected kitchen
    if (kind === 'building') {
      const b = call('buildings', 'get', s, insp.id); if (!b) { closeInspectDom(); return; }
      const r = rowOf(b.type) || { name: b.type, effects: {}, wr: 0, tiers: [] }, ef = r.effects || {}, i0 = b.ty * W + b.tx, tl = s.tiles;
      if (!renaming) setText(E['insp-title'], b.name || r.name);
      setText(E['insp-sub'], r.name + (b.tier > 0 && r.tiers && r.tiers[b.tier - 1] ? ' · ' + (r.tiers[b.tier - 1].name || 'Tier ' + b.tier) : '') + (b.pilings ? ' · on pilings' : ''));
      call('render', 'drawIcon', spr, b.type); hasSprite = true;
      if (b.ruin) body.appendChild(row('Status', 'Ruin', 'bad')); else if (b.built < 1) body.appendChild(row('Status', 'Under construction ' + Math.round(fin(b.built, 0) * 100) + '%')); else if (b.flooded) body.appendChild(row('Status', 'Flooded', 'bad')); else if (b.blackout) body.appendChild(row('Status', 'Blackout', 'bad')); else if (b.closedUntil >= 0 && b.closedUntil > dayOf(s)) body.appendChild(row('Status', 'Closed · reopens ' + BSU.formatDate(b.closedUntil)));
      const ms = ef.feeds ? call('buildings', 'menuOf', s, b.id) : null;   // P6: a kitchen feeds its menu's throughput
      if (ms && b.built >= 1 && !b.ruin) body.appendChild(menuSection(s, b, ms));   // menu layout pass: first in the body, so the summary and Edit menu never need scrolling to
      if (ef.beds) body.appendChild(row('Beds', String(ef.beds))); if (ef.seats) body.appendChild(row('Seats', String(ef.seats))); if (ef.feeds) body.appendChild(row('Feeds', ms ? '~' + ms.throughput.toLocaleString('en-US') + ' a day (menu)' : String(ef.feeds)));
      if (ef.quality) body.appendChild(row('Quality', stars(ef.quality)));
      body.appendChild(row('Ground', (TILE_NAMES[tl.type[i0]] || '') + ' · ' + ft(tl.elev[i0])));
      const depth = call('hydro', 'footprintDepth', s, b.id); if (Number.isFinite(depth) && depth > 0.01) body.appendChild(row('Water', ft(depth), 'water'));
      body.appendChild(row('Saturation', Math.round(fin(tl.sat[i0], 0) * 100) + '%'));
      const rate = call('terrain', 'subsidenceRate', s, i0, true); if (Number.isFinite(rate) && rate > 0) body.appendChild(row('Sinking', rate.toFixed(2) + ' ft/yr · dropped ' + fin(b.sunk, 0).toFixed(2) + ' ft'));
      if (r.wr) body.appendChild(row('Wind rating', '▮▮▮▮▮'.slice(0, r.wr) + '▯▯▯▯▯'.slice(0, 5 - r.wr)));
      if (b.hp < 1) body.appendChild(row('Damage', Math.round((1 - fin(b.hp, 1)) * 100) + '%', 'bad'));
      if (ef.shelter) body.appendChild(row('Shelter', String(ef.shelter)));
      const util = []; if (r.needsPower) util.push('Power ' + (b.powered ? '✓' : '✗')); if (r.needsWater) util.push('Water ' + (b.watered ? '✓' : '✗')); if (util.length) body.appendChild(row('Utilities', util.join(' · ')));
      const risk = call('hydro', 'riskAt', s, i0); if (Number.isFinite(risk) && risk >= 0.3) body.appendChild(row('Flood risk', ft(risk) + ' after 2 in of rain ⚠', 'bad'));
      if (b.type === 'generator' && b.data) body.appendChild(row('Fuel', fin(b.data.fuelDays, 0) + ' days'));
      const res = (s.agents || []).find(function (a) { return a && a.home === b.id && a.state !== 'GONE'; });
      if (res) { const q = call('agents', 'inspect', s, res.id); if (q && q.quote) body.appendChild(row('A resident', '“' + q.quote + '”', 'quote')); }
      acts.appendChild(action('Rename', function () { startRename(b); return null; }));
      if (!b.pilings && r.kind === 'footprint' && b.built >= 1 && !b.ruin) acts.appendChild(action('Pilings', function (st) { return call('buildings', 'retrofitPilings', st, b.id, {}); }));
      if (b.hp < 1 && !b.ruin) acts.appendChild(action('Repair', function (st) { return call('buildings', 'repair', st, b.id); }));
      if (issuesApi()) { const li = issuesApi().byId(s, 'unlinked:' + b.id); if (li && li.action && li.action.link) acts.appendChild(action(li.resolvable ? 'Link to campus · ' + money(li.cost) : 'Link to campus', function (st) { const r2 = call('buildings', 'linkBuilding', st, b.id); if (r2 && r2.ok && issuesApi()) issuesApi().invalidate(); return r2; })); }   // issues v2: the gravel tie from the inspect panel too
      if (r.tiers && r.tiers.length > fin(b.tier, 0)) acts.appendChild(action('Upgrade', function (st) { return call('buildings', 'upgrade', st, b.id); }));
      if (b.type === 'generator') acts.appendChild(action('Refuel +3 days $5k', function (st) { return call('buildings', 'refuel', st, b.id); }));
      if (b.type === 'wildlife_post') acts.appendChild(action((b.data && b.data.nutriaBounty ? '✓ ' : '') + 'Nutria bounty', function (st) { return call('buildings', 'setPolicy', st, b.id, 'nutriaBounty', !(b.data && b.data.nutriaBounty)); }));
      if (b.type === 'abatement') acts.appendChild(action(b.data && b.data.active === false ? 'Abatement off → on' : 'Abatement on → off', function (st) { return call('buildings', 'setPolicy', st, b.id, 'active', !(b.data && b.data.active !== false)); }));
      if ((tl.type[i0] === T.WET || tl.type[i0] === T.DRAINED) && r.kind === 'footprint') acts.appendChild(action('Re-grade', function (st) { return call('buildings', 'regrade', st, b.id); }));
      if (r.demolishable !== false) acts.appendChild(action('Demolish', function (st) { const rr = call('buildings', 'remove', st, b.id, 'demolish'); if (rr && rr.ok) { closeInspectDom(); } return rr; }, 'danger'));
    } else if (kind === 'tile' || kind === 'levee') {
      const i = insp.i; if (i < 0 || i >= N) { closeInspectDom(); return; }
      const t = call('terrain', 'tileAt', s, i % W, (i / W) | 0) || { type: s.tiles.type[i], elev: s.tiles.elev[i], depth: s.tiles.depth[i], sat: s.tiles.sat[i], stand: s.tiles.stand[i], mosq: s.tiles.mosq[i], subs: s.tiles.subs[i], flags: s.tiles.flags[i], drainsTo: 'ground', crest: s.tiles.crest[i], integrity: s.tiles.integrity[i], sandbag: s.tiles.sandbag[i] };
      const tname = TILE_NAMES[t.type] || 'Ground';
      if (kind === 'levee') {
        const runs = call('buildings', 'leveeRuns', s) || []; const run = runs.find(function (x) { return x && x.tiles && x.tiles.indexOf(i) >= 0; });
        const rname = run ? ((s.runNames && s.runNames[run.key]) || run.name || '') : '';
        setText(E['insp-title'], rname || 'Levee'); setText(E['insp-sub'], tname + ' · (' + (i % W) + ', ' + ((i / W) | 0) + ')');
        const sand = fin(t.sandbag, 0); const sd = s.tiles.sandbagDay ? s.tiles.sandbagDay[i] : 0;
        body.appendChild(row('Crest', ft(t.crest) + (sand ? ' (+' + (sand / 10).toFixed(1) + ' sandbags, ' + Math.max(0, sd - dayOf(s)) + ' days left)' : '')));
        const integ = fin(t.integrity, 100); body.appendChild(row('Integrity', integ + '%' + (integ < 50 ? ' · halved' : integ < 80 ? ' · weak' : ''), integ < 80 ? 'bad' : ''));
        const bl = s.wildlife && s.wildlife.burrowLog && s.wildlife.burrowLog[i]; if (bl) body.appendChild(row('Burrows', bl.n + ' · last ' + BSU.formatDate(bl.day)));
        const H = fin(call('weather', 'forecastSurge', s), 5) || 5; const bnd = call('buildings', 'boundaryLevees', s, H); if (bnd && typeof bnd.indexOf === 'function') body.appendChild(row('Boundary at ' + H.toFixed(0) + ' ft', bnd.indexOf(i) >= 0 ? 'yes — on the ring' : 'no'));
        if (integ < 100) acts.appendChild(action('Repair $5k', function (st) { return call('buildings', 'repairLevee', st, i); }));
        if (integ < 100 && issuesApi()) { const wl = issuesApi().list(s).find(function (it) { return it.kind === 'weakLevee' && it.tiles.indexOf(i) >= 0; }); if (wl && wl.action && wl.action.run && wl.action.run.length > 1) acts.appendChild(action('Repair run · ' + money(wl.cost), function (st) { const r2 = call('buildings', 'repairLeveeRun', st, wl.action.run); if (r2 && r2.ok && issuesApi()) issuesApi().invalidate(); return r2; })); }   // issues v2
        acts.appendChild(action('Demolish', function (st) { const rr = call('buildings', 'remove', st, { tile: i }, 'demolish'); if (rr && rr.ok) closeInspectDom(); return rr; }, 'danger'));
      } else {
        setText(E['insp-title'], tname); setText(E['insp-sub'], 'Tile (' + (i % W) + ', ' + ((i / W) | 0) + ')');
        body.appendChild(row('Elevation', ft(t.elev)));
        if (fin(t.depth, 0) > 0.005) body.appendChild(row('Water', ft(t.depth), 'water'));
        body.appendChild(row('Saturation', Math.round(fin(t.sat, 0) * 100) + '%'));
        if (fin(t.stand, 0) > 0) body.appendChild(row('Standing', t.stand + (t.stand === 1 ? ' day' : ' days')));
        body.appendChild(row('Mosquitoes', fin(t.mosq, 0) < 0.1 ? 'ambient' : fin(t.mosq, 0) < 0.4 ? 'annoying' : fin(t.mosq, 0) < 0.7 ? 'biblical' : 'state bird'));
        const rate = call('terrain', 'subsidenceRate', s, i, false); if (Number.isFinite(rate) && rate > 0) body.appendChild(row('Sinking', rate.toFixed(2) + ' ft/yr'));
        if (t.flags & BSU.FLAG.WETLAND_ORIGINAL) body.appendChild(row('Wetland', 'original marsh'));
        if (t.flags & BSU.FLAG.PRESERVE) body.appendChild(row('Preserve', 'protected'));
        body.appendChild(row('Drains to', String(t.drainsTo || 'ground')));
        const can = t.type === T.MARSH ? 'Boardwalks, levees, canals; buildings on Pilings' : (t.type === T.OPEN_WATER || t.type === T.BAYOU) ? 'Boardwalk bridges, a Surge Barrier' : t.type === T.POND ? 'nothing — it is a pond' : 'anything with a path on its edge';
        body.appendChild(row('Can build', can));
      }
    } else if (kind === 'agent') {
      const a = (s.agents || [])[insp.id]; const q = call('agents', 'inspect', s, insp.id) || {};
      if (!a) { closeInspectDom(); return; }
      setText(E['insp-title'], q.name || a.name || 'Student'); setText(E['insp-sub'], (q.major || a.major || '') + ' · Year ' + fin(q.year || a.year, 1));
      const mood = clamp(fin(q.mood, fin(a.mood, 0.5)), 0, 1);
      body.appendChild(row('Mood', MOOD_FACES[Math.min(4, Math.floor(mood * 5))] + ' ' + Math.round(mood * 100) + '%'));
      body.appendChild(row('Doing', q.activity || a.state || ''));
      if (q.quote) body.appendChild(row('Says', '“' + q.quote + '”', 'quote'));
      if (a.home >= 0) body.appendChild(row('Lives at', nameOfBuilding(s, a.home)));
      acts.appendChild(action(s.ui.camera && s.ui.camera.follow === a.id ? 'Stop following' : 'Follow', function (st) { call('render', 'follow', st.ui.camera && st.ui.camera.follow === a.id ? -1 : a.id); return null; }));
    } else if (kind === 'gator') {
      const legend = insp.legend && s.wildlife && s.wildlife.leGrand; const g = legend ? s.wildlife.leGrand : gatorsOf(s).find(function (x) { return x && x.id === insp.id; });
      if (!g) { closeInspectDom(); return; }
      setText(E['insp-title'], g.name || 'Gator'); setText(E['insp-sub'], legend || g.size === 'legend' ? 'The legend of the cypress lake' : g.size === 'juvenile' ? 'Juvenile alligator' : 'Alligator');
      body.appendChild(row('Length', legend || g.size === 'legend' ? '5 m' : g.size === 'juvenile' ? '1.5 m' : '3–4 m'));
      const mood = legend ? 'Unbothered' : ({ SUN: 'Sunning', SWIM: 'Swimming', WANDER: 'Peckish', LOUNGE: 'Lounging', RETREAT: 'Heading home', WRANGLED: 'Wrangled' }[g.state] || 'Sunning');
      body.appendChild(row('Mood', mood));
      // calm alerts + ambient gators pass: where it is and what it is doing; nothing to fix, nothing it costs
      const st = legend ? null : call('wildlife', 'gatorStatus', s, g.id);
      if (st && st.onCampus) {
        const verb = ({ SUN: 'sunning', SWIM: 'swimming', WANDER: 'prowling', LOUNGE: 'lounging', RETREAT: 'heading home', WRANGLED: 'being walked home' }[g.state] || 'sunning');
        body.appendChild(row('Doing', verb + ' ' + (st.near ? 'by ' + st.near.name : 'on the bank') + ' · it will wander back to the water'));
        body.appendChild(row('On campus', st.visitDays === 0 ? 'since today' : st.visitDays + (st.visitDays === 1 ? ' day' : ' days')));
      } else if (st) {
        body.appendChild(row('Doing', mood.toLowerCase() + (st.near ? ' near ' + st.near.name : ' off campus')));
      }
      if (Number.isFinite(g.den) && g.den >= 0) body.appendChild(row('Home den', '(' + (g.den % W) + ', ' + ((g.den / W) | 0) + ')'));
      if (Number.isFinite(g.target) && g.target >= 0) { const ob = call('buildings', 'at', s, g.target % W, (g.target / W) | 0); body.appendChild(row('Headed for', ob ? 'the ' + (ob.name || (rowOf(ob.type) || {}).name) + ' dumpster' : 'the water')); }
      if (Number.isFinite(g.lastIncidentDay) && g.lastIncidentDay >= 0) body.appendChild(row('Last seen', BSU.formatDate(g.lastIncidentDay)));
      if (legend) acts.appendChild(action('Photograph', function (st2) { return call('wildlife', 'photographLeGrand', st2); }, 'primary'));
      acts.appendChild(action('Pan to', function () { call('render', 'panToTile', Math.floor(fin(g.tx, 32)), Math.floor(fin(g.ty, 32))); return null; }));
    } else {
      setText(E['insp-title'], insp.kind); setText(E['insp-sub'], '');
    }
    show(spr, hasSprite);
    if (menuEdit) syncMenuOverlay(s);
  }
  function startRename(b) {
    if (!dom()) return;
    const input = el('input'); input.type = 'text'; input.value = b.name || ''; input.className = 'rename'; input.setAttribute('maxlength', '32');
    const title = E['insp-title']; clear(title); title.appendChild(input);
    renaming = { id: b.id, input: input }; focusedInput = input;
    input.addEventListener('blur', function () { if (renaming && renaming.input === input) commitRename(stateOf()); });
    try { input.focus(); } catch (e) { /* stub */ }
  }
  function commitRename(s) { if (!renaming) return; const r = renaming; renaming = null; if (focusedInput === r.input) focusedInput = null; const v = String(r.input.value || '').trim(); if (v) call('buildings', 'rename', s, r.id, v); inspAt = -1e9; try { if (E.world && typeof E.world.focus === 'function') E.world.focus(); } catch (e) { /* stub */ } }
  function cancelRename() { if (!renaming) return; const r = renaming; renaming = null; if (focusedInput === r.input) focusedInput = null; inspAt = -1e9; }

  // ---------------------------------------------------------------------------
  // Hover tooltips / name tags (300 ms)
  // ---------------------------------------------------------------------------
  function hoverEntity(s, px, py) {
    if (!s) return; hoverPx = px; hoverPy = py;
    const i = tileIndexAt(px, py); let key = '';
    if (i >= 0) {
      const tx = i % W, ty = (i / W) | 0;
      const g = gatorNear(s, tx, ty); if (g) key = 'gator:' + (g === s.wildlife.leGrand ? 'legend' : g.id);
      else { const a = call('agents', 'nearest', s, tx + 0.5, ty + 0.5, 1); if (a) key = 'agent:' + a.id; else { const b = call('buildings', 'at', s, tx, ty); if (b) key = 'building:' + b.id; } }
    }
    if (key !== hoverKey) { hoverKey = key; hoverSince = clock; if (!key) hideTooltip(); }
  }
  function hideTooltip() { if (tipShown) { tipShown = ''; show(E.tooltip, false); } }
  /** (px, py) is the tooltip's top-left corner; `above` = (px, py) is the bottom-centre anchor instead (palette tiles: the card sits above the tile, never over its neighbours) */
  function showTooltipAt(text, px, py, above) {
    const t = E.tooltip; if (!t) return; if (tipShown !== text) { setText(t, text); tipShown = text; }
    const vw = fin(window.innerWidth, 1280), vh = fin(window.innerHeight, 800); const w = fin(t.offsetWidth, 160) || 160, h = fin(t.offsetHeight, 24) || 24;
    const x = above ? px - w / 2 : px, y = above ? py - h : py;
    t.style.left = Math.round(clamp(x, 4, vw - w - 4)) + 'px'; t.style.top = Math.round(clamp(y, 4, vh - h - 4)) + 'px'; show(t, true);
  }
  function updateTooltip(s) {
    if (!dom()) return;
    if (itemHover && itemHover.key) {
      if (clock - itemHover.since >= L.tooltipMs) { const txt = itemTooltip(s, itemHover.id); if (itemHover.ax != null) showTooltipAt(txt, itemHover.ax, itemHover.ay, true); else showTooltipAt(txt, itemHover.px, itemHover.py - 8); E.tooltip.dataset.kind = 'item'; }
      return;
    }
    if (!hoverKey || card || s.ui.panel || live.state === 'PLACING' || live.state === 'DRAGGING' || live.state === 'PANNING') { if (!taggedGator(s)) hideTooltip(); return; }
    if (clock - hoverSince < L.tooltipMs) return;
    const parts = hoverKey.split(':'); let text = '', at = null;
    if (parts[0] === 'gator') { const g = parts[1] === 'legend' ? s.wildlife.leGrand : gatorsOf(s).find(function (x) { return x && String(x.id) === parts[1]; }); if (g) { text = '🐊 ' + (g.name || 'Gator'); at = call('render', 'entityScreen', g); } }
    else if (parts[0] === 'agent') { const a = (s.agents || [])[parseInt(parts[1], 10)]; if (a) { text = a.name || 'Student'; at = call('render', 'entityScreen', a); } }
    else if (parts[0] === 'building') { const b = call('buildings', 'get', s, parseInt(parts[1], 10)); if (b) { const r = rowOf(b.type) || {}; text = (b.name || r.name || b.type) + (b.name && r.name && b.name !== r.name ? ' · ' + r.name : ''); } }
    if (!text) { hideTooltip(); return; }
    E.tooltip.dataset.kind = parts[0];
    if (at && Number.isFinite(at.x)) showTooltipAt(text, at.x - 40, at.y - 44); else showTooltipAt(text, hoverPx + 14, hoverPy - 28);
  }
  function taggedGator(s) {
    const selId = insp && insp.kind === 'gator' ? insp.id : -1, locId = issuesApi() && typeof issuesApi().selectedId() === 'string' && issuesApi().selectedId().indexOf('gator:') === 0 ? parseInt(issuesApi().selectedId().slice(6), 10) : -1;
    for (const g of gatorsOf(s)) { if (g && (g.id === selId || g.id === locId)) { const at = call('render', 'entityScreen', g); if (at && Number.isFinite(at.x)) {   // gator pass: tags only on hover (tooltip), selection or Locate — not for 3 s on every campus entry
      // only while the gator is in the map strip between the topbar and the palette: the tag is a world label, not HUD chrome (it floated over the palette icons)
      const top = fin(E.topbar && E.topbar.offsetHeight, 44) + 8, bot = (E.palette && !E.palette.classList.contains('hidden') ? fin(E.palette.getBoundingClientRect().top, 1e9) : fin(window.innerHeight, 800)) - 8;
      if (at.y < top || at.y > bot) return false;
      let ty = at.y - 44;   // gator pass: the tag drops under the gator when it would sit on the alert strip (beside an open inspect the strip shares the map centre)
      try { const st = E['alert-strip']; if (st && !st.classList.contains('hidden')) { const r = st.getBoundingClientRect(); if (ty + 32 > r.top && ty < r.bottom && at.x + 50 > r.left && at.x - 50 < r.right) ty = at.y + 12; } } catch (e) { /* stub */ }
      E.tooltip.dataset.kind = 'gator'; showTooltipAt('🐊 ' + (g.name || 'Gator'), at.x - 40, ty); return true; } } }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Palette (GDD §11.2; ARCHITECTURE §7.5)
  // ---------------------------------------------------------------------------
  let itemHover = null;   // {key, id, since, px, py}
  function tabsData() { return (BSU.data && BSU.data.tabs) || []; }
  function unlockOf(s, id) { const u = call('buildings', 'unlocked', s, id); return u ? { ok: u.ok !== false, reason: u.reason || '' } : { ok: true, reason: '' }; }
  /** pure rule: a tab shows when introduced and (essentials or ≥ 1 unlocked row) */
  function tabVisible(tabId, introduced, unlockedCount) { return !!introduced && (tabId === 'essentials' || unlockedCount > 0); }
  function visibleTabs(s) {
    const out = []; const intro = (s.ui && s.ui.tabsIntroduced) || {};
    for (const t of tabsData()) { let n = 0; for (const id of t.rows) if (id !== 'founders_hall' && unlockOf(s, id).ok) n++; if (tabVisible(t.id, intro[t.id], n)) out.push(t); }
    return out;
  }
  function currentTab(s) { const vis = visibleTabs(s); if (!vis.length) return null; const cur = vis.find(function (t) { return t.id === s.ui.paletteTab; }); return cur || vis[0]; }
  function setTab(s, tabId) { if (!s || !s.ui) return; if (s.ui.paletteTab !== tabId) { s.ui.paletteTab = tabId; } s.ui.tabsSeen[tabId] = true; if (s.ui.newPips[tabId]) delete s.ui.newPips[tabId]; paletteDirty = true; }
  function cycleTab(s, dir) { const vis = visibleTabs(s); if (!vis.length) return; const cur = currentTab(s); let k = vis.indexOf(cur); k = (k + dir + vis.length) % vis.length; setTab(s, vis[k].id); }
  function pickItem(s, n) { const tab = currentTab(s); if (!tab) return; const rows = tab.rows.filter(function (id) { return id !== 'founders_hall'; }); const id = rows[n]; if (id) M.selectTool(s, id); }
  /** progress: a tab becomes available (+ pip) — introduceTab(state, tab) */
  M.introduceTab = function (state, tab) { try { const s = state || stateOf(); if (!s || !s.ui || !tab) return; if (!s.ui.tabsIntroduced[tab]) { s.ui.tabsIntroduced[tab] = true; if (s.ui.paletteTab !== tab) s.ui.newPips[tab] = true; } paletteDirty = true; } catch (e) { uerr('introduceTab', e); } };
  /** palette pass: the label a tile shows when the full name will not fit two 15-px lines (the tooltip and the build menu keep the full name) */
  const PAL_SHORT = { 'Mosquito Abatement Station': 'Mosquito Abatement', 'Bat House / Purple Martin Tower': 'Bat House', 'Marsh Restoration Program': 'Marsh Restoration', 'Coastal Studies Institute': 'Coastal Institute' };
  let palShownTab = '';
  /** palette pass: fade the quick-bar's left / right edge only while there is more to scroll to that side */
  function paletteFade() {
    try {
      const it = E['palette-items']; if (!it || !dom()) return;
      const sl = fin(it.scrollLeft, 0), over = fin(it.scrollWidth, 0) - fin(it.clientWidth, 0);
      cls(it, 'fade-l', over > 1 && sl > 1); cls(it, 'fade-r', over > 1 && sl < over - 1);
    } catch (e) { /* stub */ }
  }
  /** rebuild tabs + items (on unlock:changed / tab change / reset) */
  M.refreshPalette = function (state) {
    try {
      const s = state || stateOf(); if (!dom() || !s || !s.ui) return;
      paletteDirty = false;
      const vis = visibleTabs(s), cur = currentTab(s);
      if (cur && s.ui.paletteTab !== cur.id) s.ui.paletteTab = cur.id;
      const key = vis.map(function (t) { return t.id; }).join(',') + '|' + (cur ? cur.id : '') + '|' + (cur ? cur.rows.map(function (id) { const u = unlockOf(s, id); return id + (u.ok ? '+' : '-' + u.reason); }).join(',') : '');
      if (key === paletteKey) { refreshPips(s); return; }
      const tabChanged = !!cur && cur.id !== palShownTab; palShownTab = cur ? cur.id : '';
      paletteKey = key; bm.dirty = true;
      const tabs = E['palette-tabs']; clear(tabs); E.tabEls = {};
      for (const t of vis) {
        const b = el('button', 'tab' + (cur && cur.id === t.id ? ' active' : '')); b.type = 'button'; b.dataset.tab = t.id;
        b.appendChild(el('span', 'tab-name', t.name)); const pip = el('span', 'pip hidden'); b.appendChild(pip);
        b.addEventListener('click', function () { setTab(stateOf(), t.id); });
        tabs.appendChild(b); E.tabEls[t.id] = { el: b, pip: pip };
      }
      const items = E['palette-items']; clear(items); E.itemEls = {};
      if (cur) for (const id of cur.rows) {
        if (id === 'founders_hall') continue;
        const r = rowOf(id); if (!r) continue; const u = unlockOf(s, id);
        const it = el('div', 'item' + (u.ok ? '' : ' locked')); it.dataset.id = id; it.setAttribute('tabindex', '0'); it.setAttribute('role', 'button');
        // palette pass: a vertical stack, nothing overlaps: framed icon -> name (two lines reserved, centred) -> price in plain dim gold (drag rows: '$2,000/tile')
        const ic = el('canvas', 'icon'); ic.width = 64; ic.height = 64; it.appendChild(ic); call('render', 'drawIcon', ic, id);
        const nm = el('div', 'name'); nm.appendChild(el('span', '', PAL_SHORT[r.name] || r.name)); it.appendChild(nm);
        const cost = el('div', 'cost', money(r.cost)); if (r.kind === 'drag') cost.appendChild(el('span', 'per', '/tile')); it.appendChild(cost);
        if (!u.ok) { const cd = el('div', 'cond'); cd.appendChild(el('span', 'k', 'Unlocks')); cd.appendChild(el('span', 'why', u.reason || 'Locked')); it.appendChild(cd); }
        it.addEventListener('click', function () { const st = stateOf(); if (!u.ok) { call('audio', 'play', 'invalid'); if (u.reason) M.notify(st, { kind: 'info', text: u.reason, ttl: 4000 }); return; } const t = st.ui.tool; M.selectTool(st, t && t.id === id ? null : id); });
        it.addEventListener('pointerenter', function (ev) { itemHover = { key: 'item:' + id, id: id, since: clock, px: fin(ev.clientX, 0), py: fin(ev.clientY, 0) }; try { const q = it.getBoundingClientRect(); itemHover.ax = q.left + q.width / 2; itemHover.ay = q.top - 8; } catch (e) { /* stub */ } });
        it.addEventListener('pointermove', function (ev) { if (itemHover && itemHover.id === id) { itemHover.px = fin(ev.clientX, itemHover.px); itemHover.py = fin(ev.clientY, itemHover.py); } });
        it.addEventListener('pointerleave', function () { if (itemHover && itemHover.id === id) { itemHover = null; hideTooltip(); } });
        items.appendChild(it); E.itemEls[id] = it;
      }
      if (tabChanged) { try { items.scrollLeft = 0; } catch (e) { /* stub */ } }
      refreshPips(s); markToolDom(s); paletteFade();
    } catch (e) { uerr('refreshPalette', e); }
  };
  function refreshPips(s) { const pk = JSON.stringify(s.ui.newPips || {}) + '|' + s.ui.paletteTab; if (pk === pipKey) return; pipKey = pk; for (const id in E.tabEls) { show(E.tabEls[id].pip, !!s.ui.newPips[id]); cls(E.tabEls[id].el, 'active', id === s.ui.paletteTab); } }
  function itemTooltip(s, id) {
    const r = rowOf(id); if (!r) return ''; const u = unlockOf(s, id);
    const parts = [r.name + ' · ' + money(r.cost) + (r.kind === 'drag' ? ' per tile' : '') + (r.w > 1 || r.h > 1 ? ' · ' + r.w + '×' + r.h : '')];
    if (r.upkeep) parts.push('Upkeep ' + money(r.upkeep) + '/mo');
    if (r.desc) parts.push(r.desc);
    if (!u.ok && u.reason) parts.push('Unlock: ' + u.reason);
    if (r.why) parts.push('“' + r.why + '”');
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // UX pass: goals tracker helpers, needs strip, build menu, placement hints, coach-mark tour
  // ---------------------------------------------------------------------------
  function guideOf(id) { return (BSU.data && BSU.data.guide && BSU.data.guide[id]) || null; }
  function needsData() { return (BSU.data && BSU.data.needs) || {}; }
  /** the building the current objective's "Build it" offers: the first unlocked goal building not yet built (drag/paint rows always count as unbuilt) */
  function objTarget(s, o) {
    if (!s || !o) return null;
    const g = guideOf(o.id); if (!g || !g.build || !g.build.length) return null;
    let first = null;
    for (const id of g.build) {
      if (id === 'founders_hall') continue;
      const r = rowOf(id); if (!r) continue;
      if (!unlockOf(s, id).ok) continue;
      if (!first) first = id;
      if (r.kind !== 'footprint') return id;
      if (fin(call('buildings', 'count', s, id), 0) === 0) return id;
    }
    return first;
  }
  function objBuildIt() {
    const s = stateOf(); if (!s) return;
    const o = call('progress', 'objective', s); const id = o ? objTarget(s, o) : null;
    if (!id) { M.openBuildMenu(s, {}); return; }
    if (!toolLocked && !s.setPiece) { bm.keepOpen = true; try { M.selectTool(s, id); } finally { bm.keepOpen = false; } }
    M.openBuildMenu(s, { focus: id, pulse: true });
  }
  /** the five gauges + the binding constraint, from the same numbers the Students popover uses (economy.capacity) plus live coverage */
  function needsOf(s) {
    const e = (s && s.economy) || {}; const students = fin(e.students, 0);
    const cap = call('economy', 'capacity', s) || e.capacityTerms || {};
    const cat = catalog(); const list = call('buildings', 'list', s) || [];
    let needP = 0, powered = 0, needW = 0, watered = 0, subs = 0, towers = 0, lots = 0;
    for (const b of list) {
      if (!b) continue; const r = cat[b.type]; if (!r || fin(b.built, 0) < 1) continue;
      if (r.needsPower) { needP++; if (b.powered) powered++; }
      if (r.needsWater) { needW++; if (b.watered) watered++; }
      if (b.type === 'substation') subs++; else if (b.type === 'water_tower') towers++; else if (b.type === 'parking') lots++;
    }
    const suppressed = !!e.suppressCoverage;
    const perSub = fin(cat.substation && cat.substation.effects.power.capacity, 40), perTower = fin(cat.water_tower && cat.water_tower.effects.water.capacity, 50);
    const terms = [
      { key: 'beds', used: students, cap: fin(cap.beds, 0) },
      { key: 'seats', used: students, cap: fin(cap.seats, 0) },
      { key: 'dining', used: students, cap: fin(cap.dining, 0) },
      { key: 'power', used: needP, cap: subs * perSub, short: suppressed ? 0 : needP - powered },
      { key: 'water', used: needW, cap: towers * perTower, short: suppressed ? 0 : needW - watered }
    ];
    const ND = needsData(); const nameOf = function (k) { const r = rowOf((ND[k] || {}).build); return r ? r.name : k; }; const labelOf = function (k) { return (ND[k] || {}).label || k; };
    const mk = function (key, text, level) { return { key: key, text: text, level: level, build: (ND[key] || {}).build || null }; };
    const ww = { key: 'wastewater', used: students, cap: fin(cap.wastewater, 1500) };
    let m = terms[0]; for (const t of [terms[1], terms[2], ww]) if (t.cap - t.used < m.cap - m.used) m = t;
    const need = fin(call('economy', 'lotsNeeded', s), Math.ceil(students / 600));   // P7: Magnolia Suites' parking spaces count toward the requirement
    let binding = null;
    if (m.cap <= m.used) binding = mk(m.key, labelOf(m.key) + ' full (' + m.used + ' / ' + m.cap + ') → build a ' + nameOf(m.key), 'bad');
    else if (terms[3].short > 0) binding = mk('power', terms[3].short + (terms[3].short === 1 ? ' building has' : ' buildings have') + ' no power → build a ' + nameOf('power'), 'bad');
    else if (terms[4].short > 0) binding = mk('water', terms[4].short + (terms[4].short === 1 ? ' building has' : ' buildings have') + ' no water → build a ' + nameOf('water'), 'bad');
    else if (m.used >= 0.85 * m.cap) binding = mk(m.key, labelOf(m.key) + ' nearly full (' + m.used + ' / ' + m.cap + ') → build a ' + nameOf(m.key), 'warn');
    else if (students > 600 && lots < need) binding = mk('parking', 'Students want parking (' + lots + ' / ' + need + ' lots) → build a ' + nameOf('parking'), 'warn');
    else binding = mk(m.key, 'Room for ' + (m.cap - m.used) + ' more students; ' + labelOf(m.key).toLowerCase() + ' fill first → next: ' + nameOf(m.key), 'ok');
    return { students: students, terms: terms, binding: binding, suppressed: suppressed };
  }
  let needsState = null;
  function needsNow(s) { if (!needsCache || needsState !== s || clock - needsAt >= L.refreshMs) { needsAt = clock; needsState = s; needsCache = needsOf(s); } return needsCache; }
  /** gold badges for the build menu: the objective's building ('Goal') and the needs strip's fix ('Needed' | 'Next') */
  function recommend(s) {
    const out = {};
    const o = call('progress', 'objective', s); const t = o ? objTarget(s, o) : null; if (t) out[t] = 'Goal';
    const n = needsNow(s); const b = n && n.binding;
    if (b && b.build) {
      // P7 housing tiers: the beds fix is the standard Dorm unless cash is short (then the economy Bunkhouse); a parking squeeze also badges the premium Suites (60 spaces each)
      let pick = b.build;
      if (b.key === 'beds' && unlockOf(s, 'bunkhouse').ok && fin(s.economy && s.economy.cash, 0) < 1.5 * fin((rowOf('dorm') || {}).cost, 700000)) pick = 'bunkhouse';
      if (unlockOf(s, pick).ok && !out[pick]) out[pick] = b.level === 'ok' ? 'Next' : 'Needed';
      if (b.key === 'parking' && unlockOf(s, 'suites').ok && !out.suites) out.suites = 'Needed';
    }
    return out;
  }
  function compactNum(n) { n = fin(n, 0); return n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }
  function refreshNeeds(s) {
    const n = needsNow(s); if (!n || !E.needEls) return;
    const key = JSON.stringify(n.terms) + '|' + (n.binding ? n.binding.text + n.binding.level : '');
    if (key === needsKey) return; needsKey = key;
    for (const t of n.terms) {
      const g = E.needEls[t.key]; if (!g) continue;
      const ratio = t.cap > 0 ? t.used / t.cap : (t.used > 0 ? 1 : 0);
      const w = Math.round(clamp(ratio, 0, 1) * 100) + '%'; if (g.fill.style.width !== w) g.fill.style.width = w;
      setText(g.val, compactNum(t.used) + ' / ' + compactNum(t.cap));   // 1500 / 7680 → 1.5k / 7.7k so five gauges fit the strip
      const lvl = (t.short > 0 || (t.cap <= t.used && t.used > 0)) ? 'bad' : (ratio >= 0.85 ? 'warn' : 'ok');
      if (g.el.dataset.level !== lvl) g.el.dataset.level = lvl;
      g.el.title = (needsData()[t.key] || {}).label + ': ' + t.used + ' ' + ((needsData()[t.key] || {}).unit || '') + ' using ' + t.cap + ' of capacity' + (t.short > 0 ? ' · ' + t.short + ' unserved' : '') + ' · click to build a ' + ((rowOf((needsData()[t.key] || {}).build) || {}).name || '');
    }
    const nt = E['needs-text']; if (n.binding) { setText(nt, n.binding.text); nt.dataset.level = n.binding.level; nt.dataset.build = n.binding.build || ''; nt.disabled = !n.binding.build; }
    try { const fam = n.binding && n.binding.level !== 'ok' ? ({ power: 'power', water: 'water', beds: 'capacity', seats: 'capacity', dining: 'capacity' })[n.binding.key] || '' : ''; const nl = E['needs-locate']; if (nl) { const any = fam && issuesApi() && issuesApi().ofFamily(s, fam).length > 0; nl.dataset.family = fam; show(nl, !!any); } } catch (e) { uerr('needsLocate', e); }
  }
  /** utility coverage warning for the ghost's second line (none while the tutorial suppresses coverage) */
  function utilityWarning(s, row, r) {
    if (!row || !r || (s.economy && s.economy.suppressCoverage)) return '';
    if (row.needsPower && r.power === false) return 'No power here yet: a Substation within ' + fin((rowOf('substation') || {}).effects && rowOf('substation').effects.power.radius, 10) + ' tiles';
    if (row.needsWater && r.water === false) return 'No water here yet: a Water Tower within ' + fin((rowOf('water_tower') || {}).effects && rowOf('water_tower').effects.water.radius, 12) + ' tiles';
    return '';
  }
  /** after a placement that is out of power/water coverage: one notification with a one-click overlay */
  function placedHint(s, row, pre) {
    try {
      if (!row || !pre || (s.economy && s.economy.suppressCoverage)) return;
      let text = '', ov = OV.NONE;
      if (row.needsPower && pre.power === false) { text = row.name + ' placed with no power yet. Build a Power Substation within 10 tiles (P shows coverage).'; ov = OV.POWER; }
      else if (row.needsWater && pre.water === false) { text = row.name + ' placed with no water yet. Build a Water Tower within 12 tiles (W shows coverage).'; ov = OV.WATER; }
      if (!text) return;
      try { if (BSU.issues) BSU.issues.invalidate(); } catch (e) { /* */ }
      M.notify(s, { kind: 'info', text: text, ttl: 9000, locate: ov === OV.POWER ? 'power' : 'water', action: { label: 'Show coverage', fn: function (st) { M.setOverlay(st, ov); } } });
    } catch (e) { uerr('placedHint', e); }
  }
  // ---- effects → plain lines (the detail card)
  const SPECIAL_TEXT = { boilPot: 'Crawfish boil pot', dumpster: 'Dumpster (gator bait)', porch: 'Porch parties', tailgate: 'Tailgates near the venue', festivalHost: 'Hosts festivals (revenue ×2)', idleHub: 'Students hang out here', pool: 'Pool', teamHeatFix: 'Fixes the team heat penalty', idleSpot: 'Students idle here', oakDecal: 'Plants a Live Oak', floodsAt03: 'Floods at 0.3 ft of water', tailgateLot: 'Tailgate lot', nutriaImmune: 'Nutria cannot burrow it', egret: 'Egrets visit', stockAfter10: 'Stocked with bream after a month', gatorBlock: 'Gators cannot cross', fogger: 'Fogger truck at dusk', martins: 'Purple martins swirl at dusk', officer: 'Relocates gators within 14', traps: 'Nutria traps', debris: 'Clears storm debris', cajunNavy: 'Cajun Navy rescues', preserve: 'Protected wetland', bells: 'Bells at midday and dusk', beacon: 'Beacon at night', tank: 'Water tank', habitat: 'Home of Roux the tiger', restore: 'Restores marsh', spoonbills: 'Spoonbills at dawn', postcardFrame: 'The postcard frame', discountSwamp: 'Levees, floodwalls, canals and pumps −15%', radar: 'Weather radar', wastewater: 'Sewage treatment' };
  function pct(mult) { return Math.round((1 - mult) * 100) + '%'; }
  function within(r) { return r > 0 ? ' within ' + r + ' tiles' : ''; }
  function effectLines(row) {
    const out = []; if (!row) return out; const e = row.effects || {};
    const add = function (t) { if (t) out.push(t); };
    if (e.beds) add(e.beds + ' beds');
    if (e.housingTier && e.beds) { const fee = fin(BSU.params.econ.housing && BSU.params.econ.housing.roomFee[e.housingTier], 0); add(['', 'Economy', 'Standard', 'Premium'][e.housingTier] + ' housing: ' + (fee > 0 ? 'room fee $' + fee + ' a bed each semester' : 'no room fee')); }
    if (e.parkingSpaces) add(e.parkingSpaces + ' parking spaces (they count toward the lot requirement)');
    if (e.seats) add(e.seats + ' lecture seats');
    if (e.feeds) add('Feeds ' + e.feeds.toLocaleString('en-US') + ' students' + within(e.diningRadius) + (row && (row.id === 'dining_hall' || row.id === 'poboy') ? ' with a standard menu (up to ' + (row.id === 'poboy' ? 3 : 10) + ' dishes: cheap feeds more, premium draws more)' : ''));
    if (e.quality) add('Housing quality ' + '★★★★★'.slice(0, clamp(e.quality | 0, 0, 5)));
    if (e.happiness && e.happiness.value) add((e.happiness.value > 0 ? '+' : '−') + Math.abs(e.happiness.value) + ' happiness' + (e.happiness.radius > 0 ? within(e.happiness.radius) : ' campus-wide'));
    if (e.landmark) add('Landmark +' + e.landmark + ' (prestige)');
    if (e.academic) add('Academic +' + e.academic + ' (prestige)');
    if (e.shelter) add('Shelters ' + e.shelter.toLocaleString('en-US') + ' in a hurricane');
    if (e.power && e.power.radius) add(e.power.capacity ? 'Powers ' + e.power.capacity + ' buildings' + within(e.power.radius) : 'Backup power' + within(e.power.radius));
    if (e.water && e.water.radius) add('Water for ' + e.water.capacity + ' buildings' + within(e.water.radius));
    if (e.fuelDays) add(e.fuelDays + ' days of fuel');
    if (e.mosquito && e.mosquito.radius) add('Mosquitoes −' + pct(e.mosquito.mult) + within(e.mosquito.radius) + (e.mosquito.stacksTo ? ' (stacks to −' + pct(e.mosquito.stacksTo) + ')' : ''));
    if (e.heat && e.heat.radius) add('Heat −' + pct(e.heat.mult) + within(e.heat.radius));
    if (e.illness && e.illness.radius) add('Mosquito illness −' + pct(e.illness.mosquito) + ', heat illness −' + pct(e.illness.heat) + within(e.illness.radius));
    if (e.windShield && e.windShield.radius) add('Wind damage −' + pct(e.windShield.mult) + within(e.windShield.radius));
    if (e.noise && e.noise.value) add('Noise: −' + e.noise.value + ' happiness to dorms' + within(e.noise.radius));
    if (e.ecology) add((e.ecology > 0 ? '+' : '') + e.ecology + ' ecology');
    if (e.ecologyPerTile) add((e.ecologyPerTile > 0 ? '+' : '') + e.ecologyPerTile + ' ecology per tile');
    if (e.ecologyDecayMult) add('Ecology decay −' + pct(e.ecologyDecayMult));
    if (e.gatorAttract) add('Attracts gators (+' + e.gatorAttract + ')');
    if (e.gatorAvoidRadius) add('Gators keep ' + e.gatorAvoidRadius + ' tiles away');
    if (e.research && e.research.base) add('Research grants ' + money(e.research.base) + '/mo (' + e.research.kind + ')');
    if (e.teamRating) add('Team rating +' + e.teamRating);
    if (e.attendanceSeats) add(e.attendanceSeats.toLocaleString('en-US') + ' stadium seats');
    if (e.homeWinBonus) add('Home win chance +' + Math.round(e.homeWinBonus * 100) + '%');
    if (e.revenueMonthly) add('+' + money(e.revenueMonthly) + '/mo');
    if (e.tickets) add('+' + money(e.tickets) + '/mo in tickets');
    if (e.parkingPer) add('Parks ' + e.parkingPer + ' students’ cars');
    if (e.capacityStudents) add('Sewage for ' + e.capacityStudents.toLocaleString('en-US') + ' students');
    if (e.crest) add('Holds water up to ' + e.crest + ' ft above the ground');
    if (e.canal) add('Carries water downhill to the bayou');
    if (e.gate) add('Closes against storm surge');
    if (e.pumpTileFt) add('Pumps ' + e.pumpTileFt + ' tile-ft of water a day');
    if (e.pondCapacity) add('Holds ' + e.pondCapacity + ' tile-ft of runoff');
    if (e.drainPerDay) add('Drains ' + e.drainPerDay + ' ft of water a day nearby');
    if (e.subsidenceRadius) add(e.subsidenceMult === 0 ? 'Stops the ground sinking' + within(e.subsidenceRadius) : 'Sinking −' + pct(e.subsidenceMult) + within(e.subsidenceRadius));
    if (e.coneDays) add('Storm cone ' + e.coneDays + ' days out' + (e.coneNarrow ? ', ' + Math.round(e.coneNarrow * 100) + '% narrower' : ''));
    if (Array.isArray(e.special)) for (const k of e.special) add(SPECIAL_TEXT[k] || '');
    if (Array.isArray(row.tiers)) for (const t of row.tiers) add('Tier ' + t.tier + ' · ' + t.name + ': ' + (t.seats ? t.seats.toLocaleString('en-US') + ' seats, ' : '') + money(t.cost) + (t.night ? ', night games' : ''));
    return out;
  }
  /** requirement glyphs for a row → [{glyph, text}] */
  const REQ_LABEL = { '⚡': 'Power', '💧': 'Water', '🚶': 'Path', '🛣': 'Road', '🪵': 'Pilings', '↔': 'Drag' };   // UI scale pass: the requirement glyphs carry a word
  function requirementsOf(row) {
    const RQ = (BSU.data && BSU.data.requirements) || {}; const out = []; if (!row) return out;
    const place = RQ.place && RQ.place[row.placeRule]; if (place && row.placeRule !== BSU.PLACE.LAND) out.push(place);
    if (row.pathAdjacency && RQ.path) out.push(RQ.path);
    if (row.roadWithin > 0 && RQ.road) out.push({ glyph: RQ.road.glyph, text: RQ.road.text.replace('{n}', String(row.roadWithin)) });
    if (row.needsPower && RQ.power) out.push(RQ.power);
    if (row.needsWater && RQ.water) out.push(RQ.water);
    if (row.alwaysPilings && RQ.marsh) out.push({ glyph: RQ.marsh.glyph, text: 'Always on Pilings (in the price)' });
    return out;
  }
  // ---- the build menu
  function buildBuildMenu() {
    const m = el('div', 'hidden'); m.id = 'build-menu';
    const head = el('div', 'bm-head'); head.appendChild(el('div', 'panel-title', 'Build')); const sub = el('div', 'bm-sub', 'Pick a category, then a building. ★ marks what the campus needs right now; greyed cards say what unlocks them.'); sub.id = 'bm-sub'; head.appendChild(sub);
    const close = btn('btn-bm-close', '✕', 'icon', function () { M.closeBuildMenu(); }); head.appendChild(close);
    const body = el('div', 'bm-body'); const cats = el('div'); cats.id = 'bm-cats'; const cards = el('div'); cards.id = 'bm-cards'; const detail = el('div'); detail.id = 'bm-detail';
    body.appendChild(cats); body.appendChild(cards); body.appendChild(detail);
    const foot = el('div', 'bm-foot'); const ft = el('span', null, ''); ft.id = 'bm-foot-text'; foot.appendChild(ft);
    const bull = btn('btn-bm-bulldoze', '🔨 Demolish', 'small', function () { const s = stateOf(); if (!s) return; M.selectTool(s, 'bulldoze'); M.closeBuildMenu(); }); foot.appendChild(bull);
    m.appendChild(head); m.appendChild(body); m.appendChild(foot);
    E['build-menu'] = m; E['bm-cats'] = cats; E['bm-cards'] = cards; E['bm-detail'] = detail; E['bm-foot-text'] = ft; E['btn-bm-close'] = close; E.bmCards = {}; E.bmCats = {}; return m;
  }
  function tabFor(s, id) {
    const vis = visibleTabs(s); const cur = vis.find(function (t) { return t.id === s.ui.paletteTab; });
    if (cur && cur.rows.indexOf(id) >= 0) return cur.id;
    const ess = vis.find(function (t) { return t.id === 'essentials'; }); if (ess && ess.rows.indexOf(id) >= 0) return 'essentials';
    const r = rowOf(id); const own = r && vis.find(function (t) { return t.id === r.tab; }); return own ? own.id : (cur ? cur.id : (vis[0] ? vis[0].id : null));
  }
  /** openBuildMenu(state, {tab?, focus?: id, pulse?}) — focus picks the tab holding that card, selects it in the detail and pulses it */
  M.openBuildMenu = function (state, opts) {
    try {
      const s = state || stateOf(); if (!s || !s.ui || titleOn || s.setPiece) return; opts = opts || {};
      if (!visibleTabs(s).length) return;
      if (menuEdit) M.closeMenuEditor();   // tutorial stages 1–3: no tab yet, the objective hands the tool over
      bm.open = true;
      if (opts.focus && rowOf(opts.focus)) { const t = tabFor(s, opts.focus); if (t) setTab(s, t); bm.selected = opts.focus; bm.pulseId = opts.pulse ? opts.focus : null; bm.pulseUntil = clock + 2600; bm.focusUntil = clock + 2600; }
      else if (opts.tab) setTab(s, opts.tab);
      bm.hover = null; bm.dirty = true;
      if (dom()) { show(E['build-menu'], true); cls(E.hud, 'bm-open', true); show(E.popover, false); hideTooltip(); refreshBuildMenu(s); scrollCardIntoView(opts.focus); }
      emit('ui:buildMenu', { open: true, tab: s.ui.paletteTab, focus: opts.focus || null });
    } catch (e) { uerr('openBuildMenu', e); }
  };
  /** scroll the card grid (never the page: scrollIntoView would shift the fixed #app) */
  function scrollCardIntoView(id) { const c = id && E.bmCards[id], grid = E['bm-cards']; if (!c || !grid) return; try { const top = fin(c.offsetTop, 0) - fin(grid.offsetTop, 0); if (Number.isFinite(top) && (top < fin(grid.scrollTop, 0) || top + fin(c.offsetHeight, 0) > fin(grid.scrollTop, 0) + fin(grid.clientHeight, 0))) grid.scrollTop = Math.max(0, top - 10); } catch (e) { /* stub */ } }
  M.closeBuildMenu = function () { try { if (!bm.open) return; bm.open = false; bm.hover = null; bm.pulseId = null; if (dom()) { show(E['build-menu'], false); cls(E.hud, 'bm-open', false); } emit('ui:buildMenu', { open: false }); } catch (e) { uerr('closeBuildMenu', e); } };
  M.buildMenuOpen = function () { return bm.open; };
  function badgeText(kind) { return kind === 'Goal' ? '★ Goal' : kind === 'Needed' ? '★ Needed now' : '★ Recommended'; }
  function refreshBuildMenu(s) {
    if (!dom() || !bm.open || !s || !s.ui) return;
    bm.dirty = false;
    const vis = visibleTabs(s), cur = currentTab(s); if (cur && s.ui.paletteTab !== cur.id) s.ui.paletteTab = cur.id;
    const reco = recommend(s);
    const key = vis.map(function (t) { return t.id + (s.ui.newPips[t.id] ? '!' : ''); }).join(',') + '|' + (cur ? cur.id : '') + '|' + (cur ? cur.rows.map(function (id) { const u = unlockOf(s, id); return id + (u.ok ? '+' : '-' + u.reason) + (reco[id] || ''); }).join(',') : '') + '|' + fin(s.economy && s.economy.cash, 0);
    const foot = needsNow(s); setText(E['bm-foot-text'], foot && foot.binding ? foot.binding.text : '');
    if (key !== bm.key) {
      bm.key = key;
      const cats = E['bm-cats']; clear(cats); E.bmCats = {};
      for (const t of vis) {
        const b = el('button', 'bm-cat' + (cur && cur.id === t.id ? ' active' : '')); b.type = 'button'; b.dataset.tab = t.id;
        b.appendChild(el('span', 'bm-cat-name', t.name)); const n = t.rows.filter(function (id) { return id !== 'founders_hall' && unlockOf(s, id).ok; }).length; b.appendChild(el('span', 'bm-cat-count', n + '/' + t.rows.filter(function (id) { return id !== 'founders_hall'; }).length));
        if (t.rows.some(function (id) { return reco[id]; })) b.appendChild(el('span', 'bm-cat-star', '★'));
        if (s.ui.newPips[t.id]) b.appendChild(el('span', 'pip'));
        b.addEventListener('click', function () { const st = stateOf(); setTab(st, t.id); bm.hover = null; bm.dirty = true; });
        cats.appendChild(b); E.bmCats[t.id] = b;
      }
      const cards = E['bm-cards']; clear(cards); E.bmCards = {};
      if (cur) for (const id of cur.rows) {
        if (id === 'founders_hall') continue; const r = rowOf(id); if (!r) continue; const u = unlockOf(s, id);
        const c = el('div', 'bm-card' + (u.ok ? '' : ' locked') + (reco[id] ? ' reco' : '')); c.dataset.id = id; c.setAttribute('tabindex', '0'); c.setAttribute('role', 'button');
        const top = el('div', 'bm-top'); const ic = el('canvas', 'icon'); ic.width = 64; ic.height = 64; top.appendChild(ic); call('render', 'drawIcon', ic, id);
        const tcol = el('div', 'bm-tcol'); tcol.appendChild(el('div', 'bm-name', r.name));
        const price = el('div', 'bm-price'); price.appendChild(el('span', 'bm-cost', money(r.cost) + (r.kind === 'drag' || r.kind === 'paint' ? '/tile' : (r.kind === 'upgrade' ? ' +40% of the building' : '')))); if (r.upkeep) price.appendChild(el('span', 'bm-upkeep', money(r.upkeep) + '/mo')); tcol.appendChild(price);
        const reqs = el('div', 'bm-reqs'); for (const q of requirementsOf(r)) { const sp = el('span', 'bm-req'); sp.appendChild(el('span', 'rq-g', q.glyph)); if (REQ_LABEL[q.glyph]) sp.appendChild(el('span', 'rq-l', REQ_LABEL[q.glyph])); sp.title = q.text; reqs.appendChild(sp); } if (r.w > 1 || r.h > 1) { const fp = el('span', 'bm-req fp', r.w + '×' + r.h); fp.title = 'Footprint ' + r.w + '×' + r.h + ' tiles' + (r.rotatable ? ' (R rotates)' : ''); reqs.appendChild(fp); } tcol.appendChild(reqs);
        top.appendChild(tcol); c.appendChild(top);
        c.appendChild(el('div', 'bm-blurb', r.blurb || r.desc || ''));
        c.appendChild(el('div', 'bm-why', r.why || ''));
        if (reco[id]) c.appendChild(el('div', 'bm-badge', badgeText(reco[id])));
        if (!u.ok) { const lk = el('div', 'bm-lock'); lk.appendChild(el('span', 'bm-lock-ic', '🔒')); lk.appendChild(el('span', null, 'Unlocks: ' + (u.reason || 'later'))); c.appendChild(lk); }
        c.addEventListener('click', function () { const st = stateOf(); if (!st) return; if (!u.ok) { call('audio', 'play', 'invalid'); M.notify(st, { kind: 'info', text: r.name + ' — unlocks: ' + (u.reason || 'later'), ttl: 4000 }); return; } bm.selected = id; M.selectTool(st, id); M.closeBuildMenu(); });
        c.addEventListener('pointerenter', function () { bm.hover = id; }); c.addEventListener('pointerleave', function () { if (bm.hover === id) bm.hover = null; });
        c.addEventListener('focus', function () { bm.hover = id; });
        cards.appendChild(c); E.bmCards[id] = c;
      }
      bm.detailKey = '';
    }
    refreshDetail(s, reco);
  }
  function refreshDetail(s, reco) {
    const cur = currentTab(s); const rows = cur ? cur.rows.filter(function (id) { return id !== 'founders_hall'; }) : [];
    const sel = bm.selected && rows.indexOf(bm.selected) >= 0 ? bm.selected : null;
    let id = (sel && clock < fin(bm.focusUntil, 0)) ? sel : (bm.hover || sel);
    if (!id) { for (const k of rows) if (reco[k]) { id = k; break; } }
    if (!id) id = rows[0] || null;
    const r = rowOf(id); const u = r ? unlockOf(s, id) : { ok: false, reason: '' };
    const key = (id || '') + '|' + (r ? (u.ok ? '+' : u.reason) : '') + '|' + (reco[id] || '') + '|' + (s.ui.tool ? s.ui.tool.id : '');
    for (const k in E.bmCards) { cls(E.bmCards[k], 'hover', k === id); cls(E.bmCards[k], 'active', !!(s.ui.tool && s.ui.tool.id === k)); }
    if (key === bm.detailKey) return; bm.detailKey = key;
    const d = E['bm-detail']; clear(d); if (!r) { d.appendChild(el('div', 'muted', 'Nothing to build in this category yet.')); return; }
    const head = el('div', 'bm-dhead'); const ic = el('canvas', 'icon'); ic.width = 96; ic.height = 96; head.appendChild(ic); call('render', 'drawIcon', ic, id);
    const col = el('div'); col.appendChild(el('div', 'bm-dname', r.name)); col.appendChild(el('div', 'bm-dsub', money(r.cost) + (r.kind === 'drag' || r.kind === 'paint' ? ' per tile' : '') + (r.upkeep ? ' · ' + money(r.upkeep) + '/mo upkeep' : ' · no upkeep') + (r.kind === 'footprint' ? ' · ' + r.w + '×' + r.h + ' tiles' : ''))); head.appendChild(col); d.appendChild(head);
    if (reco[id]) d.appendChild(el('div', 'bm-badge inline', badgeText(reco[id]) + (reco[id] === 'Goal' ? ' — your current objective' : ' — ' + ((needsNow(s) || {}).binding || {}).text)));
    d.appendChild(el('div', 'bm-dblurb', r.blurb || ''));
    d.appendChild(el('div', 'bm-dwhy', '“' + (r.why || '') + '”'));
    const eff = effectLines(r); if (eff.length) { d.appendChild(el('div', 'card-kicker', 'Effects')); const ul = el('div', 'bm-list'); for (const line of eff) ul.appendChild(el('div', 'bm-li', line)); d.appendChild(ul); }
    const rq = requirementsOf(r); if (rq.length) { d.appendChild(el('div', 'card-kicker', 'Needs')); const ul = el('div', 'bm-list'); for (const q of rq) ul.appendChild(el('div', 'bm-li', q.glyph + ' ' + q.text)); d.appendChild(ul); }
    if (r.desc) d.appendChild(el('div', 'bm-ddesc', r.desc));
    if (!u.ok) d.appendChild(el('div', 'bm-dlock', '🔒 Unlocks: ' + (u.reason || 'later')));
    else { const sel = !!(s.ui.tool && s.ui.tool.id === id); const go = btn(null, sel ? 'Place it on the map ▸' : 'Build this', 'primary', function () { const st = stateOf(); if (!st) return; bm.selected = id; if (!sel) M.selectTool(st, id); M.closeBuildMenu(); }); d.appendChild(go); }   // an already-selected tool (Build it) still needs the menu out of the way: the button closes it instead of going dead
  }
  function updateBuildMenu(s) {
    if (!dom()) return;
    if (!bm.open) return;
    if (bm.dirty || clock - needsAt >= L.refreshMs) refreshBuildMenu(s); else refreshDetail(s, recommend(s));
    for (const k in E.bmCards) cls(E.bmCards[k], 'pulse', k === bm.pulseId && clock < bm.pulseUntil);
    if (bm.pulseId && clock >= bm.pulseUntil) bm.pulseId = null;
  }
  // ---- the coach-mark tour (first game; replay from Settings)
  function buildCoach() {
    const c = el('div', 'hidden'); c.id = 'coach'; E.coachPanes = [];
    for (let k = 0; k < 4; k++) { const p = el('div', 'coach-pane'); c.appendChild(p); E.coachPanes.push(p); }
    const ring = el('div', 'coach-ring hidden'); c.appendChild(ring); E['coach-ring'] = ring;
    const box = el('div', 'coach-box'); box.id = 'coach-box'; const step = el('div', 'card-kicker', ''); step.id = 'coach-step'; const title = el('div', 'coach-title', ''); title.id = 'coach-title'; const text = el('div', 'coach-text', ''); text.id = 'coach-text';
    const acts = el('div', 'card-actions'); const back = btn('btn-coach-back', '◂ Back', 'small hidden', function () { coachNext(stateOf(), -1); }); const skip = btn('btn-coach-skip', 'Skip tour', 'small', function () { coachFinish(stateOf(), false); }); const next = btn('btn-coach-next', 'Next ▸', 'primary', function () { coachNext(stateOf(), 1); });
    acts.appendChild(back); acts.appendChild(skip); acts.appendChild(next);
    box.appendChild(step); box.appendChild(title); box.appendChild(text); box.appendChild(acts); c.appendChild(box);
    E.coach = c; E['coach-box'] = box; E['coach-step'] = step; E['coach-title'] = title; E['coach-text'] = text; E['btn-coach-back'] = back; E['btn-coach-skip'] = skip; E['btn-coach-next'] = next; return c;
  }
  function coachSteps() { return (BSU.data && BSU.data.coach) || []; }
  /** first game only, once the Essentials tab exists (tutorial stage 4) and the founders have landed — never in headless mode, never over a card, toast or set piece */
  function coachEligible(s) {
    if (M.settings().coachSeen || BSU.headlessMode || !dom() || titleOn) return false;
    if (card || toast || s.setPiece || !coachSteps().length) return false;
    const stage = fin(call('progress', 'tutorialStage', s), 6);
    if (stage < 4) { coach.armedAt = 0; return false; }
    if (!coach.armedAt) coach.armedAt = clock;
    return fin(s.economy && s.economy.students, 0) >= 100 || clock - coach.armedAt > 8000 * 10 / fin(PT.baseTps, 5);   // the founders' count-up runs on sim ticks: the fallback stretches with the base clock
  }
  /** the element a step spotlights: the 'menu' step rings the objective's Goal card when the open menu holds it (else the whole menu) */
  function coachTarget(s, st) {
    if (!st.target) return null;
    if (st.id === 'menu' && bm.open) { const o = call('progress', 'objective', s); const t = o ? objTarget(s, o) : null; const c = t && E.bmCards ? E.bmCards[t] : null; if (c) { scrollCardIntoView(t); return c; } }
    return E[st.target];
  }
  function updateCoach(s) {
    if (coach.step < 0) { if (coachEligible(s)) coachStart(s); return; }
    const pause = !!(card || toast || s.setPiece || titleOn);
    if (pause !== coach.paused) { coach.paused = pause; show(E.coach, !pause); }
    if (pause) return;
    if (clock - coach.layoutAt > 250) layoutCoach(s);
  }
  function coachStart(s) { coach.step = 0; coach.paused = false; coach.overlayBefore = fin(s.ui.overlay, OV.NONE); applyCoachStep(s); show(E.coach, true); emit('ui:coach', { step: 0 }); }
  function applyCoachStep(s) {
    const steps = coachSteps(); const st = steps[coach.step]; if (!st) { coachFinish(s, true); return; }
    if (st.id === 'menu') M.openBuildMenu(s, { tab: 'essentials' }); else if (bm.open) M.closeBuildMenu();
    if (st.id === 'swamp') M.setOverlay(s, OV.FLOOD); else if (fin(s.ui.overlay, 0) === OV.FLOOD && coach.overlayBefore !== OV.FLOOD) M.setOverlay(s, coach.overlayBefore);
    setText(E['coach-step'], 'Quick tour · ' + (coach.step + 1) + ' of ' + steps.length); setText(E['coach-title'], st.title); setText(E['coach-text'], st.text);
    setText(E['btn-coach-next'], coach.step === steps.length - 1 ? 'Geaux build ▸' : 'Next ▸'); show(E['btn-coach-back'], coach.step > 0);
    coach.expanded = st.target === 'needs-strip' ? ['goals', 'needs'] : st.target === 'objective-card' ? ['goals'] : st.target === 'build-menu' ? ['palette'] : [];   // hud + zoom pass: a step that points at a collapsed element opens it for the step (the tour itself always runs in the full HUD)
    updateHud(s);
    coach.layoutAt = -1e9; layoutCoach(s);
  }
  function coachNext(s, dir) { if (coach.step < 0) return; const n = coachSteps().length; const k = coach.step + dir; if (k >= n) { coachFinish(s, true); return; } coach.step = clamp(k, 0, n - 1); applyCoachStep(s); emit('ui:coach', { step: coach.step }); }
  function coachFinish(s, completed) {
    coach.step = -1; coach.paused = false; coach.expanded = []; show(E.coach, false); show(E['coach-ring'], false);
    M.settings().coachSeen = true; M.saveSettings();
    if (s && dom()) updateHud(s);   // hud + zoom pass: the player's mode and pills come back
    if (s && fin(s.ui.overlay, 0) === OV.FLOOD && coach.overlayBefore !== OV.FLOOD) M.setOverlay(s, coach.overlayBefore);
    // hand-off: land in the build menu on the goal's card (the existing objective chain takes it from here)
    if (s && !s.setPiece) { const o = call('progress', 'objective', s); const t = o ? objTarget(s, o) : null; M.openBuildMenu(s, t ? { focus: t, pulse: true } : { tab: 'essentials' }); }
    emit('ui:coach', { step: -1, completed: !!completed });
  }
  /** cut the spotlight around the step's target and park the caption where there is room */
  function layoutCoach(s) {
    coach.layoutAt = clock; const st = coachSteps()[coach.step]; if (!st || !dom()) return;
    const vw = fin(window.innerWidth, 1280), vh = fin(window.innerHeight, 800);
    let r = null; const tgt = coachTarget(s, st);
    try { if (tgt && typeof tgt.getBoundingClientRect === 'function' && !tgt.classList.contains('hidden')) { const b = tgt.getBoundingClientRect(); if (b && b.width > 0 && b.height > 0) r = { x: Math.max(0, b.left - 8), y: Math.max(0, b.top - 8), w: b.width + 16, h: b.height + 16 }; } } catch (e) { r = null; }
    const P4 = E.coachPanes; const put = function (p, x, y, w, h) { p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px'; p.style.width = Math.round(Math.max(0, w)) + 'px'; p.style.height = Math.round(Math.max(0, h)) + 'px'; };
    if (r) { put(P4[0], 0, 0, vw, r.y); put(P4[1], 0, r.y, r.x, r.h); put(P4[2], r.x + r.w, r.y, vw - r.x - r.w, r.h); put(P4[3], 0, r.y + r.h, vw, vh - r.y - r.h); put(E['coach-ring'], r.x, r.y, r.w, r.h); show(E['coach-ring'], true); }
    else { put(P4[0], 0, 0, vw, vh); put(P4[1], 0, 0, 0, 0); put(P4[2], 0, 0, 0, 0); put(P4[3], 0, 0, 0, 0); show(E['coach-ring'], false); }
    const box = E['coach-box']; const bw = fin(box.offsetWidth, 400) || 400, bh = fin(box.offsetHeight, 170) || 170;
    let bx, by;
    if (!r) { bx = (vw - bw) / 2; by = (vh - bh) / 2 - 40; }
    else {
      const pal = E.palette; let lim = vh - 8;   // UI scale pass: the box stays above the palette unless the palette is what is being shown
      try { if (pal && !pal.classList.contains('hidden') && tgt !== pal && !(pal.contains && tgt && pal.contains(tgt))) lim = Math.min(lim, fin(pal.getBoundingClientRect().top, vh) - 8); } catch (e) { /* stub */ }
      let side = false;
      if (r.y + r.h + 14 + bh <= lim) by = r.y + r.h + 14;
      else if (r.h > bh * 0.5 && r.x + r.w + 16 + bw <= vw - 12) { side = true; bx = r.x + r.w + 16; by = clamp(r.y, 12, Math.max(12, lim - bh)); }   // a tall docked card (the goals tracker): the box goes beside it
      else if (r.y - 14 - bh >= 8) by = r.y - 14 - bh; else by = vh - bh - 16;
      if (!side) bx = clamp(r.x + r.w / 2 - bw / 2, 12, vw - bw - 12);
      if (r.w > vw * 0.6 && r.h > vh * 0.5) { bx = clamp(r.x + r.w - bw - 12, 12, vw - bw - 12); by = vh - bh - 16; }   // a huge target (the build menu): bottom-right over it
    }
    box.style.left = Math.round(bx) + 'px'; box.style.top = Math.round(by) + 'px';
    box.dataset.pos = r ? (by > r.y ? 'below' : 'above') : 'center';
  }
  /** Settings → replay: forget the flag and let the next frame start the tour (Settings closes) */
  M.startCoach = function (state, opts) { try { const s = state || stateOf(); M.settings().coachSeen = false; M.saveSettings(); coach.step = -1; coach.armedAt = clock - 1e5; if (s && s.ui && s.ui.panel) M.openPanel(null); if (opts && opts.now === true && s && dom()) coachStart(s); } catch (e) { uerr('startCoach', e); } };   // hud + zoom pass: {now: true} starts the tour at once (tests; headless has no eligibility)
  M.coachStep = function () { return coach.step; };
  M._ux = { needsOf: needsOf, recommend: recommend, objTarget: objTarget, effectLines: effectLines, requirementsOf: requirementsOf, utilityWarning: utilityWarning };

  // ---------------------------------------------------------------------------
  // Issue spotlight pass: the Issues tray (docked under the minimap / overlay keys), Fix / Locate, keys
  // ---------------------------------------------------------------------------
  const tray = { key: '', ageAt: -1e9, rows: [], collapsed: false, userCollapsed: false, clearAt: -1e9, hadIssues: false, at: -1e9, lastCount: 0 };
  let heldI = false, spotToggled = false;
  function issuesApi() { const I = BSU.issues; return (I && typeof I.list === 'function') ? I : null; }
  function issueList(s) { const I = issuesApi(); return I ? I.list(s) : []; }
  function applySpotlight() { const I = issuesApi(); if (I) I.spotlight(spotToggled || heldI); if (E['issues-spot']) cls(E['issues-spot'], 'active', spotToggled); }
  function toggleSpotlight() { spotToggled = !spotToggled; applySpotlight(); tray.key = ''; }
  /** ease the camera to an issue, select it (the floating label) and flash its tiles */
  function locateIssue(s, it) {
    const I = issuesApi(); if (!I || !it) return false;
    I.select(it.id); const a = it.anchor || { tx: 32, ty: 32 };
    call('render', 'panToTile', fin(a.tx, 32), fin(a.ty, 32));
    if (it.tiles && it.tiles.length) call('render', 'flashTiles', it.tiles.slice(0, 64), 900);
    if (s && s.setPiece) call('render', 'captureCameraTouch', s);
    tray.key = ''; return true;
  }
  tray.open = {};   // issues v2: kind → the group is unfolded in the tray
  /** issues v2: open the build menu on the card AND arm the tool with the ghost pinned to the nearest legal spot within reach of the affected building (the player just clicks) */
  function armTool(s, it, a) {
    const id = a.arm; const row = rowOf(id);
    if (!row) { M.openBuildMenu(s, { focus: a.openMenuCard || id, pulse: true }); return { ok: true, spot: null }; }
    if (id !== 'founders_hall') { const u = call('buildings', 'unlocked', s, id); if (u && u.ok === false) { M.openBuildMenu(s, { focus: a.openMenuCard || id, pulse: true }); return { ok: false, reason: u.reason || (row.name + ' is locked') }; } }
    if (toolLocked || s.setPiece) { M.openBuildMenu(s, { focus: a.openMenuCard || id, pulse: true }); return { ok: true, spot: null }; }
    let near = null;
    if (Number.isFinite(a.near)) { const b = call('buildings', 'get', s, a.near); if (b) near = { tx: (b.tx | 0) + ((b.w | 0) - 1) / 2, ty: (b.ty | 0) + ((b.h | 0) - 1) / 2, target: b.id }; }
    if (!near && Number.isFinite(a.nearTile)) near = { tx: a.nearTile % W, ty: (a.nearTile / W) | 0, target: null };
    if (!near && it.anchor) near = { tx: fin(it.anchor.tx, 32), ty: fin(it.anchor.ty, 32), target: null };
    const reach = fin(a.reach, 12);
    const spot = near ? call('buildings', 'spotNear', s, id, Math.round(near.tx), Math.round(near.ty), { radius: Math.max(reach, 6), reach: reach, target: near.target }) : null;
    lastArm = { id: id, spot: spot || null, issue: it.id };
    if (!spot) {   // nothing legal in reach: the full build menu on the card, the player picks a spot by hand
      ghostPin = null; M.openBuildMenu(s, { focus: a.openMenuCard || id, pulse: true });
      bm.keepOpen = true; try { M.selectTool(s, id); } finally { bm.keepOpen = false; }
      M.notify(s, { kind: 'info', text: 'No clear spot for a ' + row.name + ' within ' + reach + ' tiles of it: pick one on the map', ttl: 5000 });
      return { ok: true, spot: null };
    }
    // a spot: no full-screen menu (it would hide the ghost) — the palette tab shows the card, the tool is armed and the ghost pinned on the spot; the camera jumps there
    if (bm.open) M.closeBuildMenu();
    const tab = tabFor(s, id); if (tab) setTab(s, tab);
    call('render', 'panToTile', spot.tx + ((row.w | 0) - 1) / 2, spot.ty + ((row.h | 0) - 1) / 2, false);
    const q = call('render', 'tileToScreen', spot.tx, spot.ty); if (q && Number.isFinite(q.x)) { lastPx = q.x; lastPy = q.y; }
    ghostPin = { id: id, tx: spot.tx, ty: spot.ty, fresh: true, px0: lastPx, py0: lastPy };
    M.selectTool(s, id);
    if (!s.ui.tool || s.ui.tool.id !== id) { ghostPin = null; return { ok: true, spot: null }; }
    M.notify(s, { kind: 'info', text: row.name + ' armed: click the glowing ghost to place it there (' + money(row.cost) + '), or anywhere else · Esc cancels', ttl: 5000 });
    return { ok: true, spot: spot };
  }
  /** run an issue's one-click fix: arm the card's tool (ghost pinned), repair / repair the whole run / link it / relocate, or open the card */
  function fixIssue(s, it) {
    const I = issuesApi(); if (!I || !it) return { ok: false, reason: 'No issue' };
    it = I.byId(s, it.id) || it;
    const a = it.action; let r = { ok: true };
    locateIssue(s, it);
    if (!a) return r;
    if (it.progress && !Number.isFinite(a.repair) && !Number.isFinite(a.repairLevee) && !a.link) { M.notify(s, { kind: 'info', text: 'Already in progress: ' + it.progress.text, ttl: 3500 }); I.invalidate(); tray.key = ''; return { ok: true, pending: true }; }
    if (a.arm) { r = armTool(s, it, a) || r; }
    else if (a.openMenuCard) { M.openBuildMenu(s, { focus: a.openMenuCard, pulse: true }); }
    else if (a.link) { r = call('buildings', 'linkBuilding', s, a.link) || { ok: false, reason: 'Cannot link' }; if (r.ok) { call('audio', 'play', 'tick'); I.select(null); M.notify(s, { kind: 'info', text: 'Linked to campus: ' + r.placed + (r.placed === 1 ? ' tile' : ' tiles') + ' of path · ' + money(r.cost), ttl: 3500 }); } }
    else if (a.tool) { M.selectTool(s, a.tool); }
    else if (Number.isFinite(a.overlay)) { M.setOverlay(s, a.overlay); }
    else if (Number.isFinite(a.repair)) { r = call('buildings', 'repair', s, a.repair) || r; }
    else if (Number.isFinite(a.repairLevee)) { r = (a.run && a.run.length ? call('buildings', 'repairLeveeRun', s, a.run) : call('buildings', 'repairLevee', s, a.repairLevee)) || r; }
    if (r && r.ok === false) { call('audio', 'play', 'invalid'); if (r.reason) M.notify(s, { kind: 'info', text: r.reason, ttl: 4000 }); }
    else if (Number.isFinite(a.repair) || Number.isFinite(a.repairLevee)) { I.select(null); M.notify(s, { kind: 'info', text: 'Fixed: ' + it.title + (r && r.cost > 0 ? ' · ' + money(r.cost) : ''), ttl: 3500 }); }
    I.invalidate(); tray.key = ''; inspAt = -1e9;
    return r;
  }
  /** issues v2: every zero-click fix at once (repairs and gravel ties within cash, free officer wrangles); a confirm line first when it costs money */
  function clearAllResolvable(s, confirmed) {
    const I = issuesApi(); if (!I) return { ok: false, reason: 'No issues', count: 0, total: 0 };
    const q = I.resolvable(s);
    if (!q.rows.length) { M.notify(s, { kind: 'info', text: 'Nothing to clear: no one-click fixes right now', ttl: 3000 }); return { ok: false, reason: 'Nothing to clear', count: 0, total: 0 }; }
    if (!confirmed && q.total > 0) {
      const by = {}; for (const it of q.rows) by[it.kind] = (by[it.kind] || 0) + 1;
      const parts = Object.keys(by).map(function (k) { return by[k] + ' × ' + I.labelOf(k).toLowerCase(); });
      M.notify(s, { kind: 'money', confirm: true, ttl: 20000, text: 'Clear ' + q.rows.length + (q.rows.length === 1 ? ' issue' : ' issues') + ' (' + parts.join(', ') + ') for ' + money(q.total) + ' total?', why: 'Repairs and gravel ties are charged now; officer wrangles are free.', action: { label: 'Confirm ' + money(q.total), fn: function (s2) { clearAllResolvable(s2, true); } } });
      return { ok: true, pending: true, count: q.rows.length, total: q.total };
    }
    let n = 0, spent = 0, failed = 0;
    for (const it of q.rows) { const r = fixOne(s, it); if (r && r.ok !== false) { n++; spent += fin(r.cost, 0); } else failed++; }
    I.invalidate(); tray.key = ''; inspAt = -1e9;
    if (n) call('audio', 'play', 'tick');
    M.notify(s, { kind: 'info', text: 'Cleared ' + n + (n === 1 ? ' issue' : ' issues') + (spent > 0 ? ' · ' + money(spent) : '') + (failed ? ' · ' + failed + ' could not be fixed' : ''), ttl: 4000 });
    return { ok: n > 0, count: n, total: spent, failed: failed };
  }
  /** the silent fix behind Clear all (no camera move, no per-row notification) */
  function fixOne(s, it) {
    const a = it.action || {};
    if (Number.isFinite(a.repair)) return call('buildings', 'repair', s, a.repair);
    if (Number.isFinite(a.repairLevee)) return a.run && a.run.length ? call('buildings', 'repairLeveeRun', s, a.run) : call('buildings', 'repairLevee', s, a.repairLevee);
    if (a.link) return call('buildings', 'linkBuilding', s, a.link);
    return { ok: false, reason: 'Not a one-click fix' };
  }
  function cycleIssue(s, dir) { const I = issuesApi(); if (!I) return null; const it = I.cycle(s, dir); if (it) locateIssue(s, it); else { I.select(null); M.notify(s, { kind: 'info', text: 'All clear: no issues on campus', ttl: 2500 }); } return it; }
  function clearIssueUi() { const I = issuesApi(); if (I) I.select(null); spotToggled = false; heldI = false; applySpotlight(); tray.key = ''; }
  function issueFirstOf(s, kinds) { const I = issuesApi(); if (!I) return null; const l = I.ofKinds(s, kinds); return l.length ? l[0] : null; }
  // ---------------------------------------------------------------------------
  // calm alerts pass: the Alerts mode (Settings → Alerts: Normal / Quiet / Off, settings.alerts) and per-kind mutes (settings.mutedIssues)
  // ---------------------------------------------------------------------------
  const ALERT_MODES = (P.issues && Array.isArray(P.issues.alertModes) && P.issues.alertModes.length === 3) ? P.issues.alertModes.slice() : ['normal', 'quiet', 'off'];
  function alertModeOf() { const m = M.settings().alerts; return ALERT_MODES.indexOf(m) >= 0 ? m : ALERT_MODES[0]; }
  M.alertMode = function () { return alertModeOf(); };
  M.alertModes = function () { return ALERT_MODES.slice(); };
  /** setAlertMode('normal' | 'quiet' | 'off'): Normal = beacons from severity 2 (≤ 6), toasts once per kind per week; Quiet = severity-3 beacons, no toasts but decisions; Off = the tray pill only */
  M.setAlertMode = function (mode) {
    try {
      if (ALERT_MODES.indexOf(mode) < 0) return alertModeOf();
      const set = M.settings(); if (set.alerts !== mode) { set.alerts = mode; M.saveSettings(); }
      const I = issuesApi(); if (I) I.invalidate(); tray.key = ''; alertAt = -1e9; alertKey = '';
      const s = stateOf(); if (s && dom()) { updateHud(s); if (mode === 'off') { for (let k = notifs.length - 1; k >= 0; k--) if (locateKindsOf(notifs[k].spec)) closeNotif(notifs[k], 'alertsOff'); } }
      return mode;
    } catch (e) { uerr('setAlertMode', e); return alertModeOf(); }
  };
  /** mute / unmute one issue kind: its rows sit under Suggestions (no beacon, no toast, not in Clear N); remembered in the settings */
  M.muteIssueKind = function (kind, on) {
    const I = issuesApi(); const s = stateOf(); if (!I || !s) return false;
    const v = I.mute(s, kind, on); M.saveSettings(); tray.key = '';
    return v;
  };
  function closeAlert() { alertClosedKey = alertKey; alertAt = -1e9; alertKey = ''; show(E['alert-strip'], false); }
  M.closeAlert = function () { closeAlert(); };
  M.dismissNotifs = function () { for (let k = notifs.length - 1; k >= 0; k--) closeNotif(notifs[k], 'dismissed'); };
  /** which issue kinds a notification / needs line is about (used to add a 'Locate' button) */
  function locateKindsOf(spec) {
    if (!spec || spec.milestone) return null;   // milestone notes never carry a Locate
    if (spec.locate) { const lc = spec.locate; if (typeof lc === 'string') return (issuesApi() && issuesApi().families()[lc]) || [lc]; if (Array.isArray(lc)) return lc; if (lc.kind) return [lc.kind]; if (lc.family) return (issuesApi() && issuesApi().families()[lc.family]) || null; return null; }
    const t = String(spec.text || ''); const F = issuesApi() ? issuesApi().families() : null; if (!F) return null;
    if (/flood/i.test(t)) return F.flood; if (/levee/i.test(t)) return F.levee; if (/mosquito/i.test(t)) return F.mosquito;
    if (/blackout|brownout|no power|unpowered/i.test(t)) return F.power; if (/boil|no water/i.test(t)) return F.water; if (/damage|ruin/i.test(t)) return F.damage;
    return null;
  }
  function buildIssuesTray() {
    const wrap = el('div', 'hidden'); wrap.id = 'issues-tray';
    const head = el('div'); head.id = 'issues-head';
    const n = el('span', 'n', ''); n.id = 'issues-count'; const sub = el('span', 'sub', ''); sub.id = 'issues-sub';
    const clr = btn('issues-clear', 'Clear all', 'small hidden', function () { const s = stateOf(); if (s) clearAllResolvable(s, false); }); clr.title = 'Run every one-click fix: repairs within cash, gravel ties, free officer wrangles (a confirm line shows the total)';
    const spot = btn('issues-spot', 'Spotlight', 'small', function () { toggleSpotlight(); }); spot.title = 'Dim the map except the issues (Shift+I; hold I)';
    const car = btn('issues-toggle', '▾', 'icon small', function () { if (hudEffective() === 'compact') hudPeek('issues', false); else M.hudCollapse('issues'); }); car.title = 'Collapse / expand (remembered)';   // hud + zoom pass: the caret is the tray's collapse chevron
    head.appendChild(n); head.appendChild(sub); head.appendChild(clr); head.appendChild(spot); head.appendChild(car);
    head.addEventListener('click', function (ev) { if (ev && ev.target && (ev.target === spot || ev.target === car || ev.target === clr)) return; if (M.hudPill('issues')) { if (hudEffective() === 'compact') hudPeek('issues', true); else M.hudCollapse('issues', false); } else { const s = stateOf(); if (s) cycleIssue(s, 1); } });
    hudHover('issues', wrap);   // hud + zoom pass: hovering the pill peeks the rows
    const list = el('div'); list.id = 'issues-list';
    const prog = el('div', 'hidden'); prog.id = 'issues-progress'; prog.appendChild(el('div', 'ph', 'In progress')); const plist = el('div'); plist.id = 'issues-progress-list'; prog.appendChild(plist);
    const more = el('div', 'hidden', ''); more.id = 'issues-more';
    const hid = btn('issues-hidden', '', 'small hidden', function () { const I = issuesApi(); const s = stateOf(); if (I) { I.restoreAll(s); tray.key = ''; } }); hid.title = 'Snoozed and dismissed rows: click to show them again';
    // calm alerts pass: the collapsed Suggestions group (severity-1 kinds and muted kinds) at the bottom of the tray
    const sg = el('div', 'hidden'); sg.id = 'issues-suggest';
    const sh = btn('issues-suggest-head', 'Suggestions', 'small', function () { tray.suggestOpen = !tray.suggestOpen; tray.key = ''; }); sh.title = 'Low-priority rows (unlinked paths, mosquito hotspots) and muted kinds: never a beacon, never a toast · click to list them';
    const sl = el('div'); sl.id = 'issues-suggest-list'; sg.appendChild(sh); sg.appendChild(sl);
    wrap.appendChild(head); wrap.appendChild(list); wrap.appendChild(prog); wrap.appendChild(more); wrap.appendChild(sg); wrap.appendChild(hid);
    E['issues-tray'] = wrap; E['issues-head'] = head; E['issues-count'] = n; E['issues-sub'] = sub; E['issues-clear'] = clr; E['issues-spot'] = spot; E['issues-toggle'] = car; E['issues-list'] = list; E['issues-progress'] = prog; E['issues-progress-list'] = plist; E['issues-more'] = more; E['issues-hidden'] = hid;
    E['issues-suggest'] = sg; E['issues-suggest-head'] = sh; E['issues-suggest-list'] = sl;
    return wrap;
  }
  function rowTitle(it) { let t = it.fix || it.title; if (it.persist) t += '\nWhy it persists: ' + it.persist; return t; }
  /** one tray row; opts.lead = the first row of a kind (carries the ×N badge), opts.sub = an unfolded sibling, opts.progress = an "In progress" row (Locate only) */
  function issueRow(s, it, sel, opts) {
    opts = opts || {};
    const row = el('div', 'issue-row' + (sel ? ' sel' : '') + (opts.lead ? ' lead' : '') + (opts.sub ? ' sub' : '') + (opts.progress ? ' progress' : '')); row.dataset.id = it.id; row.dataset.kind = it.kind;
    try { row.style.borderLeftColor = it.color || '#FDD023'; if (sel) row.style.boxShadow = '0 0 0 .2rem ' + (it.color || '#FDD023'); } catch (e) { /* stub */ }
    row.title = (opts.progress && it.progress) ? ('In progress: ' + it.progress.text + '\n' + rowTitle(it)) : rowTitle(it);
    const ic = el('canvas'); ic.width = 18; ic.height = 18; try { const g = ic.getContext('2d'); if (g && has('render', 'drawIssueGlyph')) call('render', 'drawIssueGlyph', g, it.glyph, 9, 9, 7, it.color || '#FDD023'); } catch (e) { /* stub */ }
    const col = el('div', 't', (opts.progress && it.progress) ? it.progress.text : it.title); const age = el('span', 'a', ' · ' + (issuesApi() ? issuesApi().ageText(s, it) : '')); col.appendChild(age);
    row.appendChild(ic); row.appendChild(col);
    const I = issuesApi(), sd = fin(P.issues && P.issues.snoozeDays, 3);
    if (opts.count > 1) { const bd = btn(null, '×' + opts.count, 'small badge', function () { const o = opts.suggest ? tray.sopen : tray.open; o[it.kind] = !o[it.kind]; tray.key = ''; }); bd.title = opts.count + ' ' + (I ? I.labelOf(it.kind).toLowerCase() : it.kind) + ' issues: click to ' + (opts.expanded ? 'fold them' : 'list them all'); row.appendChild(bd); }
    let fix = null;
    if (!opts.progress) { fix = btn(null, 'Fix', 'small fix', function () { const st = stateOf(); if (st) fixIssue(st, issuesApi().byId(st, it.id) || it); }); fix.title = it.fix || 'Fix it'; row.appendChild(fix); }
    const loc = btn(null, '⌖', 'small icon-sm locate', function () { const st = stateOf(); if (st) locateIssue(st, issuesApi().byId(st, it.id) || it); }); loc.title = 'Locate: ease the camera there (I cycles)'; loc.dataset.act = 'locate'; row.appendChild(loc);
    if (!opts.progress) {
      const zz = btn(null, 'zz', 'small icon-sm', function () { const st = stateOf(); const I2 = issuesApi(); if (st && I2 && I2.snooze(st, it.id)) { tray.key = ''; M.notify(st, { kind: 'info', text: 'Snoozed ' + sd + ' days: ' + it.title, ttl: 2500 }); } }); zz.title = 'Snooze ' + sd + ' days: hides this row until ' + BSU.formatDate(dayOf(s) + sd) + '; it comes back sooner if it gets worse'; zz.dataset.act = 'snooze'; row.appendChild(zz);
      const dm = btn(null, '✕', 'small icon-sm', function () { const st = stateOf(); const I2 = issuesApi(); if (st && I2 && I2.dismiss(st, it.id)) tray.key = ''; }); dm.title = 'Dismiss: hides this row until the condition changes (it gets worse, or moves to a new stage)'; dm.dataset.act = 'dismiss'; row.appendChild(dm);
    }
    // calm alerts pass: the bell on a group's lead row mutes that kind (rows move under Suggestions, no beacons, no toasts; remembered); a muted kind's bell unmutes it
    if (opts.lead && !opts.progress && I && (opts.muted || !opts.suggest)) { const bell = btn(null, opts.muted ? '🔕' : '🔔', 'small icon-sm bell' + (opts.muted ? ' muted' : ''), function () { M.muteIssueKind(it.kind, !opts.muted); const st = stateOf(); if (st) M.notify(st, { kind: 'info', text: (opts.muted ? 'Unmuted: ' : 'Muted: ') + (I.labelOf(it.kind)) + (opts.muted ? '' : ' · its rows sit under Suggestions (no beacons, no toasts)'), ttl: 3000 }); }); bell.title = opts.muted ? 'Unmute ' + I.labelOf(it.kind).toLowerCase() + ': back to the main list, beacons and toasts' : 'Mute ' + I.labelOf(it.kind).toLowerCase() + ': rows move under Suggestions, no beacons, no toasts (remembered)'; bell.dataset.act = 'mute'; row.appendChild(bell); }
    const why = (!opts.progress && it.why) ? el('div', 'why', it.why) : null; if (why) { why.title = it.why; row.appendChild(why); }   // gator pass: the one-line "why it matters" as a full-width second grid row
    row.addEventListener('click', function (ev) { if (ev && ev.target && ev.target !== row && ev.target !== col && ev.target !== ic && ev.target !== age && ev.target !== why) return; const st = stateOf(); if (st) locateIssue(st, issuesApi().byId(st, it.id) || it); });
    return { el: row, age: age, id: it.id };
  }
  /** rows that fit between the overlay keys and the palette; < 2 → chip only ("space is tight") */
  function trayRowsFit(withWhy) {
    try {
      if (E.hud && E.hud.classList.contains('inspect-open')) return 0;   // qa pass 4: the tray is display:none beside an open inspect panel (style.css); no rows to build
      const sc = effScale || 1, px = 10 * sc, top = (5.6 + 28.4) * px, bot = (18 + 2.8 + 2 + 1) * px, head = 3.4 * px, row = (withWhy ? 5.4 : 3.9) * px;   // gator pass: a why-line adds a second grid row (measured 53 px at 1×)
      const h = fin(window.innerHeight, 800) - top - bot - head; return clamp(Math.floor(h / row), 0, 6);
    } catch (e) { return 4; }
  }
  function hiddenLine(hidden) {
    const e = E['issues-hidden']; if (!e) return;
    if (!hidden.length) { show(e, false); return; }
    let sn = 0, dm = 0; for (const it of hidden) { if (it.hidden === 'snoozed') sn++; else dm++; }
    const parts = []; if (sn) parts.push(sn + ' snoozed'); if (dm) parts.push(dm + ' dismissed');
    setText(e, parts.join(' · ') + ' · show'); show(e, true);
  }
  function updateIssues(s) {
    if (!dom() || !E['issues-tray']) return;
    const I = issuesApi(); if (!I) return;
    if (clock - tray.at < 250) return; tray.at = clock;
    if (titleOn || coach.step >= 0) { show(E['issues-tray'], false); tray.key = ''; return; }
    const list = I.list(s), main = I.main(s), sugg = I.suggestions(s), prog = I.inProgress(s), hidden = I.hiddenList(s), sel = I.selectedId();
    const fit = trayRowsFit(main.some(function (it) { return !!it.why; }));
    const collapsed = fit < 2 || M.hudPill('issues');   // hud + zoom pass: collapsed = the tray's pill (compact mode, the caret in full mode, or Alerts: Off) unless hovered open
    if (list.length === 0) {
      if (tray.hadIssues) { tray.hadIssues = false; tray.clearAt = clock; }
      const showClear = clock - tray.clearAt < 3000 || hidden.length > 0;
      show(E['issues-tray'], showClear); if (!showClear) { tray.key = ''; return; }
      const k = 'clear|' + hidden.length;
      if (tray.key !== k) { tray.key = k; setText(E['issues-count'], 'All clear ✓'); setText(E['issues-sub'], ''); cls(E['issues-head'], 'clear', true); cls(E['issues-tray'], 'collapsed', true); clear(E['issues-list']); clear(E['issues-progress-list']); show(E['issues-progress'], false); clear(E['issues-suggest-list']); show(E['issues-suggest'], false); tray.rows = []; show(E['issues-more'], false); show(E['issues-clear'], false); hiddenLine(hidden); }
      return;
    }
    tray.hadIssues = true; show(E['issues-tray'], true);
    const groups = I.groups(s), sgroups = I.suggestionGroups(s), res = I.resolvable(s);
    // the plan: one lead row per kind (count badge) + the siblings when the group is unfolded; the row budget is shared with the In progress section and the open Suggestions group
    const plan = []; for (const g of groups) { const open = !!tray.open[g.kind]; plan.push({ it: g.rows[0], lead: true, count: g.rows.length, expanded: open, muted: g.muted }); if (open) for (let k = 1; k < g.rows.length; k++) plan.push({ it: g.rows[k], sub: true }); }
    const splan = []; for (const g of sgroups) { const open = !!tray.sopen[g.kind]; splan.push({ it: g.rows[0], lead: true, count: g.rows.length, expanded: open, muted: g.muted, suggest: true }); if (open) for (let k = 1; k < g.rows.length; k++) splan.push({ it: g.rows[k], sub: true, suggest: true }); }
    const progFit = prog.length ? Math.max(1, Math.min(prog.length, Math.floor(fit / 3))) : 0;
    const shown = collapsed ? 0 : Math.min(Math.max(0, fit - progFit), plan.length), pShown = collapsed ? 0 : progFit;
    const sShown = (collapsed || !tray.suggestOpen) ? 0 : Math.min(splan.length, Math.max(1, fit - shown - pShown));
    const key = [main.length, sugg.length, prog.length, hidden.length, shown, pShown, sShown, tray.suggestOpen ? 'S' : '', sel || '', res.rows.length, res.total, plan.slice(0, shown).map(function (p) { return p.it.id + p.it.title + p.it.severity + (p.count || 0) + (p.expanded ? 'o' : '') + (p.muted ? 'm' : ''); }).join(';'), prog.slice(0, pShown).map(function (it) { return it.id + it.progress.text; }).join(';'), splan.slice(0, sShown).map(function (p) { return p.it.id + p.it.title + (p.count || 0) + (p.expanded ? 'o' : '') + (p.muted ? 'm' : ''); }).join(';')].join('|');
    if (key !== tray.key) {
      tray.key = key; tray.ageAt = clock;
      const none = main.length === 0;
      setText(E['issues-count'], none ? (prog.length ? 'No open issues' : 'All clear ✓') : main.length + (main.length === 1 ? ' issue' : ' issues'));
      const w3 = main.filter(function (it) { return it.severity >= 3; }).length; const subs = []; if (w3) subs.push(w3 + ' urgent'); if (prog.length) subs.push(prog.length + ' in progress'); if (none && sugg.length) subs.push(sugg.length + (sugg.length === 1 ? ' suggestion' : ' suggestions')); if (!subs.length && collapsed) subs.push('click to cycle');
      setText(E['issues-sub'], subs.join(' · '));
      show(E['issues-clear'], res.rows.length > 0 && !collapsed); setText(E['issues-clear'], 'Clear ' + res.rows.length);
      E['issues-clear'].title = res.rows.length + ' one-click fix' + (res.rows.length === 1 ? '' : 'es') + ' (repairs within cash, gravel ties; suggestions and muted kinds are never counted): ' + (res.total > 0 ? money(res.total) + ' total, confirm first' : 'free');
      cls(E['issues-head'], 'clear', none); cls(E['issues-tray'], 'collapsed', collapsed); setText(E['issues-toggle'], collapsed ? '▸' : '▾');
      clear(E['issues-list']); tray.rows = [];
      for (let k = 0; k < shown; k++) { const p = plan[k]; const r = issueRow(s, p.it, p.it.id === sel, p); E['issues-list'].appendChild(r.el); tray.rows.push(r); }
      clear(E['issues-progress-list']); for (let k = 0; k < pShown; k++) { const r = issueRow(s, prog[k], prog[k].id === sel, { progress: true }); E['issues-progress-list'].appendChild(r.el); tray.rows.push(r); }
      show(E['issues-progress'], pShown > 0);
      const rest = (plan.length - shown) + (prog.length - pShown); setText(E['issues-more'], rest > 0 ? '+' + rest + ' more · I cycles through all' : ''); show(E['issues-more'], rest > 0 && !collapsed);
      // the Suggestions group: a one-line header (count, caret), the rows only while unfolded
      clear(E['issues-suggest-list']); show(E['issues-suggest'], sugg.length > 0 && !collapsed);
      if (sugg.length) { setText(E['issues-suggest-head'], (tray.suggestOpen ? '▾ ' : '▸ ') + 'Suggestions · ' + sugg.length + (sShown < splan.length && tray.suggestOpen ? ' (' + sShown + ' shown)' : '')); cls(E['issues-suggest'], 'open', tray.suggestOpen && sShown > 0); for (let k = 0; k < sShown; k++) { const p = splan[k]; const r = issueRow(s, p.it, p.it.id === sel, p); r.el.classList.add('suggest'); E['issues-suggest-list'].appendChild(r.el); tray.rows.push(r); } }
      hiddenLine(hidden);
    } else if (clock - tray.ageAt >= 1000) {
      tray.ageAt = clock; for (const r of tray.rows) { const it = I.byId(s, r.id); if (it) setText(r.age, ' · ' + I.ageText(s, it)); }
    }
  }
  M.issues = { locate: function (s, idOrIt) { const I = issuesApi(); const it = typeof idOrIt === 'string' ? (I && I.byId(s || stateOf(), idOrIt)) : idOrIt; return locateIssue(s || stateOf(), it); }, fix: function (s, idOrIt) { const I = issuesApi(); const it = typeof idOrIt === 'string' ? (I && I.byId(s || stateOf(), idOrIt)) : idOrIt; return fixIssue(s || stateOf(), it); }, cycle: function (s, dir) { return cycleIssue(s || stateOf(), dir); }, spotlight: function (on) { if (on !== undefined) { spotToggled = !!on; applySpotlight(); } return spotToggled; }, clear: clearIssueUi, rowsFit: trayRowsFit, kindsOf: locateKindsOf, held: function () { return heldI; } };
  Object.assign(M.issues, {   // issues v2: snooze / dismiss / Clear all / the armed ghost
    snooze: function (s, id, days) { const I = issuesApi(); const r = !!(I && I.snooze(s || stateOf(), id, days)); tray.key = ''; return r; },
    dismiss: function (s, id) { const I = issuesApi(); const r = !!(I && I.dismiss(s || stateOf(), id)); tray.key = ''; return r; },
    restoreAll: function () { const I = issuesApi(); const n = I ? I.restoreAll() : 0; tray.key = ''; return n; },
    clearAll: function (s, confirmed) { return clearAllResolvable(s || stateOf(), !!confirmed); },
    arm: function (s, idOrIt) { const I = issuesApi(); const st = s || stateOf(); const it = typeof idOrIt === 'string' ? (I && I.byId(st, idOrIt)) : idOrIt; return (it && it.action && it.action.arm) ? armTool(st, it, it.action) : { ok: false, reason: 'Not an arm action' }; },
    lastArm: function () { return lastArm; }, pin: function () { return ghostPin; }, toggleGroup: function (kind) { tray.open[kind] = !tray.open[kind]; tray.key = ''; }, groupOpen: function (kind) { return !!tray.open[kind]; },
    // calm alerts pass
    mute: function (kind, on) { return M.muteIssueKind(kind, on); }, muted: function (kind) { const I = issuesApi(); return !!(I && I.muted(stateOf(), kind)); },
    alertMode: function () { return alertModeOf(); }, setAlertMode: function (mode) { return M.setAlertMode(mode); },
    toggleSuggestions: function (on) { tray.suggestOpen = on === undefined ? !tray.suggestOpen : !!on; tray.key = ''; return tray.suggestOpen; }, suggestionsOpen: function () { return !!tray.suggestOpen; }
  });
  tray.sopen = {}; tray.suggestOpen = false;

  // ---------------------------------------------------------------------------
  // Notifications, hints
  // ---------------------------------------------------------------------------
  function mapAction(s, a) {
    if (!a) return null;
    if (typeof a.fn === 'function') return a;
    const out = { label: a.label || 'Do it' };
    if (a.fn === 'buildPath' && Array.isArray(a.tiles)) out.fn = function (st) { const r = call('buildings', 'placeRun', st, 'path', a.tiles, {}); if (r && !r.placed && r.skipped && r.skipped[0]) M.notify(st, { kind: 'info', text: r.skipped[0].reason || 'Path not laid', ttl: 4000 }); };
    else if (Number.isFinite(a.overlay)) out.fn = function (st) { M.setOverlay(st, a.overlay); };
    else if (a.event) out.fn = function () { emit(a.event, a.payload || {}); };
    else if (a.panel) out.fn = function () { M.openPanel(a.panel); };
    else return null;
    return out;
  }
  function showMe(s, sm) {
    if (sm == null) return;
    let tx, ty, tiles = null;
    if (typeof sm === 'number') { if (sm < 0 || sm >= N) return; tx = sm % W; ty = (sm / W) | 0; tiles = [sm]; }
    else { tx = fin(sm.tx, -1); ty = fin(sm.ty, -1); tiles = Array.isArray(sm.tiles) ? sm.tiles : null; if (tx < 0 && tiles && tiles.length) { tx = tiles[0] % W; ty = (tiles[0] / W) | 0; } }
    if (tx < 0) return;
    call('render', 'panToTile', tx, ty); if (tiles && tiles.length) call('render', 'flashTiles', tiles, fin(P.progress && P.progress.showMeFlashMs, 1200));
  }
  /** notify(state, {text, kind, action?, showMe?, ttl?, onClose?, stamp?}) — max 3, newest at the bottom; onClose exactly once */
  M.notify = function (state, spec) {
    try {
      const s = state || stateOf(); if (!spec || !spec.text) return;
      const kind = spec.kind || 'info';
      const act = mapAction(s, spec.action);
      let onClose = spec.onClose; if (onClose === 'restoreWarning') onClose = function () { call('progress', 'warningClosed', s); }; if (typeof onClose !== 'function') onClose = null;
      // calm alerts pass: an issue toast (one that names issue kinds) passes the registry's gate: never under Alerts Off / Quiet, never for a
      // severity-1 kind or a muted kind, once per kind per week. A confirm line (the player's own click) always shows. A gated toast with an
      // onClose (the speed-dropping first warning) still runs it, so nothing stays paused.
      if (!spec.confirm && !spec.milestone && issuesApi()) {
        const lk0 = locateKindsOf(spec);
        if (lk0 && lk0.length && !issuesApi().toastGate(s, typeof spec.locate === 'string' ? spec.locate : lk0)) { if (onClose) { try { onClose('gated'); } catch (e) { uerr('notif:gated', e); } } return; }
      }
      const n = { spec: spec, kind: kind, el: null, born: clock, bornTick: tickOf(s), ttl: fin(spec.ttl, L.notifMs), closed: false, onClose: onClose };
      if (dom()) {
        const d = el('div', 'notif' + (spec.stamp === 'paw' || spec.milestone ? ' paw' : '')); d.dataset.kind = kind;
        d.appendChild(el('span', 'notif-text', spec.text));
        if (spec.why) d.appendChild(el('span', 'notif-why', spec.why));   // gator pass: the one-line "why it matters"
        if (act) { const b = btn(null, act.label || 'Do it', 'notif-action small', function () { try { act.fn(stateOf()); } catch (e) { uerr('notif:action', e); } closeNotif(n, 'action'); }); d.appendChild(b); }
        if (spec.showMe != null) { const b = btn(null, 'Show me', 'notif-action small', function () { showMe(stateOf(), spec.showMe); }); d.appendChild(b); }
        const lk = locateKindsOf(spec); if (lk && lk.length && issuesApi() && issuesApi().ofKinds(s, lk).length) { const b = btn(null, 'Locate', 'notif-action small locate', function () { const st = stateOf(); const it = issueFirstOf(st, lk); if (it) locateIssue(st, it); else M.notify(st, { kind: 'info', text: 'Already resolved', ttl: 2500 }); closeNotif(n, 'action'); }); d.appendChild(b); }   // issue spotlight pass
        const x = btn(null, '✕', 'notif-close icon', function () { closeNotif(n, 'close'); }); d.appendChild(x);
        E.notifications.appendChild(d); n.el = d;
      }
      notifs.push(n);
      while (notifs.length > L.notifMax) closeNotif(notifs[0], 'replaced');
      const payload = { text: spec.text, kind: kind }; if (act) payload.action = { label: act.label }; if (spec.showMe != null) payload.showMe = spec.showMe; if (spec.ttl != null) payload.ttl = spec.ttl;
      emit('ui:notify', payload);
    } catch (e) { uerr('notify', e); }
  };
  function closeNotif(n, why) {
    if (!n || n.closed) return; n.closed = true;
    const k = notifs.indexOf(n); if (k >= 0) notifs.splice(k, 1);
    if (n.el && n.el.parentNode) n.el.parentNode.removeChild(n.el);
    if (n.onClose) { try { n.onClose(why); } catch (e) { uerr('notif:onClose', e); } }
  }
  function updateNotifs(s) {
    for (let k = notifs.length - 1; k >= 0; k--) { const n = notifs[k]; if (clock - n.born > n.ttl || (BSU.headlessMode && tickOf(s) - n.bornTick > L.notifTicks)) closeNotif(n, 'ttl'); }
    if (E['notif-dismiss']) show(E['notif-dismiss'], notifs.length >= 3);   // gator pass: 'Dismiss all' once three are stacked (Esc does the same)
  }
  /** one-time hint (state.progress.hints[id] via progress.markHint); text may be omitted for known ids */
  M.hint = function (state, id, text, opts) {
    try {
      const s = state || stateOf(); if (!s || !id) return;
      if (text && typeof text === 'object' && !opts) { opts = text; text = null; }
      const hints = (s.progress && s.progress.hints) || {}; if (hints[id]) return;
      if (has('progress', 'markHint')) call('progress', 'markHint', s, id); else if (s.progress && s.progress.hints) s.progress.hints[id] = true;
      let t = text || HINT_TEXT[id] || String(id); if (id === 'saveUnavailable' && opts && opts.slot) t = HINT_TEXT.saveUnavailable;
      let act = null; if (opts && opts.action) act = typeof opts.action === 'string' ? mapAction(s, { fn: opts.action, tiles: opts.tiles, label: opts.action === 'buildPath' ? 'Build it' : 'Do it' }) : mapAction(s, opts.action);
      if (opts && opts.action === 'buildPath' && Array.isArray(opts.tiles)) t += ' · ' + money(opts.tiles.length * ((rowOf('path') || {}).cost || 2000));
      hint = { until: clock + L.hintMs, untilTick: tickOf(s) + L.hintTicks, action: act, text: t };
      if (dom()) { setText(E['hint-text'], t); show(E['btn-hint-action'], !!act); if (act) setText(E['btn-hint-action'], act.label || 'Do it'); show(E.hint, true); }
    } catch (e) { uerr('hint', e); }
  };
  function hideHint() { hint = null; if (dom()) show(E.hint, false); }
  function updateHint(s) { if (hint && (clock > hint.until || (BSU.headlessMode && tickOf(s) > hint.untilTick))) hideHint(); }

  // ---------------------------------------------------------------------------
  // Decision toast (GDD §6.2, §8; D43): one open at a time, tick-based countdown, decision:closed exactly once
  // ---------------------------------------------------------------------------
  M.decision = function (state, spec) {
    try { const s = state || stateOf(); if (!s || !spec || !spec.id) return; if (toast) { if (toast.id !== spec.id && !toastQueue.some(function (q) { return q.id === spec.id; })) toastQueue.push(spec); return; } openToast(s, spec); } catch (e) { uerr('decision', e); }
  };
  function openToast(s, spec) {
    const ticks = Math.max(1, fin(spec.ticks, L.toastTicks)); const t0 = tickOf(s);
    let gd = gameDecs[spec.id] || null;
    if (!gd && (spec.id === 'halftime' || spec.id === 'fourthDown' || spec.id === 'twoPoint')) {   // a toast re-issued after a load: game:decision is not re-emitted, the engine's live view still holds the options
      const lv = call('sports', 'live', s), d = lv && lv.decision;
      if (d && d.id === spec.id && Array.isArray(d.options)) gd = { id: d.id, kind: d.kind, options: d.options, def: d.def };
    }
    const options = spec.options || (gd && gd.options) || null;
    toast = { id: spec.id, text: spec.text || '', ticks: ticks, startTick: t0, untilTick: Number.isFinite(spec.untilTick) && spec.untilTick > t0 ? spec.untilTick : t0 + ticks, onAnswer: typeof spec.onAnswer === 'function' ? spec.onAnswer : null, resolved: false,
      game: !!gd, options: Array.isArray(options) && options.length ? options.slice(0, 9) : null, def: (gd && gd.def) || spec.def || null, kind: (gd && gd.kind) || spec.kind || null, secs: -1 };
    if (toast.options) toast.secs = Math.max(0, Math.ceil((toast.untilTick - t0) / L.autoCardTicksPerSec));
    if (toast.options && toast.kind === 'fourthDown' && toast.text.indexOf(' · ') > 0) toast.text = toast.text.slice(0, toast.text.indexOf(' · '));   // the buttons carry the Go / FG / Punt odds the engine text repeats
    if (dom()) {
      setText(E['dt-text'], toast.text); setText(E['btn-dt-yes'], spec.yes || 'Yes'); E['btn-dt-yes'].appendChild(el('span', 'key', 'Y')); setText(E['btn-dt-no'], spec.no || 'No'); E['btn-dt-no'].appendChild(el('span', 'key', 'N')); E['dt-fill'].style.width = '100%';
      renderToastOptions();
      show(E.popover, false); show(E['decision-toast'], true);
    }
    emit('decision:open', { id: toast.id });
  }
  /** football pass D: the option buttons of an engine decision ("1 Go for it · 54% · best", "2 Punt · 49% · -5"): win probability as the engine supplies it, delta against the best option */
  function renderToastOptions() {
    const t = toast; const box = E['dt-options']; if (!t || !box) return;
    clear(box);
    const on = !!t.options; show(box, on); show(E['dt-actions'], !on); cls(E['decision-toast'], 'dt-opts', on);
    if (!on) { show(E['dt-foot'], false); return; }
    let best = -1, bp = -1; t.options.forEach(function (o, i) { const p = fin(o.p, -1); if (p > bp) { bp = p; best = i; } });
    t.options.forEach(function (o, i) {
      const p = fin(o.p, NaN); const d = Number.isFinite(p) && bp >= 0 ? Math.round(p * 100) - Math.round(bp * 100) : null;
      const b = btn('btn-dt-opt-' + i, String(o.label || o.key), (i === best ? 'primary' : '') + (o.key === t.def ? ' def' : ''), function () { if (toast && toast.id === t.id) answerToast(t.id, o.key); });
      b.dataset.key = String(o.key); b.appendChild(el('span', 'key', String(i + 1)));
      if (Number.isFinite(p)) { b.appendChild(el('span', 'dt-p', Math.round(p * 100) + '%')); if (d !== null) b.appendChild(el('span', 'dt-d' + (d < 0 ? ' down' : ' up'), d === 0 ? (i === best ? 'best' : '=') : String(d))); }
      box.appendChild(b);
    });
    show(E['dt-foot'], true); toastFoot();
  }
  function toastFoot() {
    const t = toast; if (!t || !t.options || !E['dt-foot']) return;
    const defOpt = t.options.filter(function (o) { return o.key === t.def; })[0];
    setText(E['dt-foot'], 'Win probability per option (change vs the best) · keys 1-' + t.options.length + ' or Y / N' + (defOpt ? ' · default: ' + defOpt.label : '') + (t.secs >= 0 ? ' · ' + t.secs + 's' : ''));
  }
  /** a toast answer: engine decisions go through sports.decide (the halftime / 4th-down / two-point hook); anything else (storm, play-through) closes by id */
  function answerToast(id, choice) {
    const t = toast; if (!t || t.id !== id) return;
    if (t.game) { const s = stateOf(); const r = s ? call('sports', 'decide', s, choice) : null; if (r && r.ok) { if (toast && toast.id === id) M.answerDecision(id, 'default'); return; } }
    M.answerDecision(id, choice);
  }
  /** idempotent: resolves the open toast with 'yes'|'no'|'default' — emits decision:closed once */
  M.answerDecision = function (id, answer) {
    try {
      if (!toast || toast.id !== id || toast.resolved) return;
      const t = toast; t.resolved = true; toast = null; delete gameDecs[id];
      if (dom()) { show(E['decision-toast'], false); cls(E['decision-toast'], 'dt-opts', false); show(E['dt-options'], false); show(E['dt-foot'], false); show(E['dt-actions'], true); }
      emit('decision:closed', { id: id, answer: answer || 'default' });
      if (t.onAnswer) { try { t.onAnswer(answer || 'default'); } catch (e) { uerr('toast:onAnswer', e); } }
      if (toastQueue.length) { const next = toastQueue.shift(); const s = stateOf(); if (s) openToast(s, next); }
    } catch (e) { uerr('answerDecision', e); }
  };
  function updateToast(s) {
    if (!toast) return;
    const tick = tickOf(s);
    if (tick >= toast.untilTick) { M.answerDecision(toast.id, 'default'); return; }
    if (dom()) {
      const frac = clamp((toast.untilTick - tick) / Math.max(1, toast.untilTick - toast.startTick), 0, 1); const w = Math.round(frac * 100) + '%'; if (E['dt-fill'].style.width !== w) E['dt-fill'].style.width = w;
      if (toast.options) { const secs = Math.max(0, Math.ceil((toast.untilTick - tick) / L.autoCardTicksPerSec)); if (secs !== toast.secs) { toast.secs = secs; toastFoot(); } }   // the footer's countdown ticks once a second; the buttons are built once (a re-render would eat a half-finished click)
    }
  }

  // ---------------------------------------------------------------------------
  // Cards (D45): card(state, idOrSpec, payload) — queued, one at a time
  // ---------------------------------------------------------------------------
  M.card = function (state, idOrSpec, payload) {
    try {
      const s = state || stateOf(); let spec;
      if (typeof idOrSpec === 'string') {
        const b = M.cards[idOrSpec];
        if (typeof b !== 'function') { uerr('card', new Error('unknown card ' + idOrSpec)); return; }
        spec = b(s, payload || {}); if (!spec) return; if (!spec.id) spec.id = idOrSpec;
      } else spec = idOrSpec;
      if (!spec || typeof spec !== 'object') return;
      if (spec.side === 'voice') { showVoice(s, spec); return; }
      // a modal card must not cover a set piece (the Board's proposal over the Mardi Gras parade): hold it until setpiece:end
      if (s && s.setPiece && !spec.duringSetPiece) { if (!cardQueue.some(function (q) { return q.id === spec.id; }) || spec.allowDuplicate) cardQueue.push(spec); return; }
      if (card) { if (card.spec.id !== spec.id || spec.allowDuplicate) cardQueue.push(spec); return; }
      openCard(s, spec);
    } catch (e) { uerr('card', e); }
  };
  function openCard(s, spec) {
    card = { spec: spec, el: null, born: clock, bornTick: tickOf(s) };
    if (!dom()) return;
    const c = el('div', 'card'); c.id = 'card-' + String(spec.id).replace(/[^A-Za-z0-9_-]/g, '');
    if (spec.kicker) c.appendChild(el('div', 'card-kicker', spec.kicker));
    c.appendChild(el('div', 'card-title', spec.title || ''));
    if (typeof spec.canvas === 'function') { const cv = el('canvas', 'card-canvas'); cv.width = fin(spec.canvasW, 320); cv.height = fin(spec.canvasH, 120); c.appendChild(cv); try { spec.canvas(cv.getContext('2d'), cv); } catch (e) { uerr('card:canvas', e); } }
    const body = el('div', 'card-body'); if (isEl(spec.body)) body.appendChild(spec.body); else if (Array.isArray(spec.body)) spec.body.forEach(function (line) { body.appendChild(el('p', null, String(line))); }); else setText(body, spec.body || ''); c.appendChild(body);
    const acts = el('div', 'card-actions'); const list = Array.isArray(spec.actions) ? spec.actions : [];
    list.forEach(function (a, k) { const b = btn(null, a.label || 'OK', (a.primary || (list.length === 1 && k === 0 && a.primary !== false) ? 'primary' : '') + (a.danger ? ' danger' : ''), function () { runCardAction(a); }); acts.appendChild(b); });
    if (!list.length && !spec.modal) acts.appendChild(btn(null, spec.closeLabel || 'Continue', 'primary', function () { M.closeCard(); }));
    c.appendChild(acts);
    if (spec.clickToClose) c.addEventListener('click', function () { M.closeCard(); });
    clear(E.cards); E.cards.appendChild(c); show(E.cards, true); card.el = c;
  }
  function runCardAction(a) { const s = stateOf(); let keep = false; try { if (typeof a.fn === 'function') keep = a.fn(s) === true || a.keep === true; } catch (e) { uerr('card:action', e); } if (!keep) M.closeCard(); }
  function cardPrimary(s) { if (!card) return; const list = Array.isArray(card.spec.actions) ? card.spec.actions : []; const a = list.find(function (x) { return x.primary; }) || list[0]; if (a) runCardAction(a); else if (!card.spec.modal) M.closeCard(); }
  /** close the current card (or a queued one by id) */
  M.closeCard = function (id) {
    try {
      if (id && card && card.spec.id !== id) { for (let k = cardQueue.length - 1; k >= 0; k--) if (cardQueue[k].id === id) cardQueue.splice(k, 1); return; }
      if (!card) return;
      const c = card; card = null;
      if (dom()) { clear(E.cards); show(E.cards, false); }
      if (typeof c.spec.onClose === 'function') { try { c.spec.onClose(stateOf()); } catch (e) { uerr('card:onClose', e); } }
      if (cardQueue.length) { const s = stateOf(); if (s) openCard(s, cardQueue.shift()); }
    } catch (e) { uerr('closeCard', e); }
  };
  function updateCards(s) {
    if (!card) return;
    const ms = fin(card.spec.autoMs, 0);
    if (ms > 0 && (clock - card.born >= ms || tickOf(s) - card.bornTick >= Math.ceil(ms / 100))) M.closeCard();
  }
  function showVoice(s, spec) {
    if (!dom()) return;
    setText(E['voice-student'], (spec.student || '') + (spec.major ? ' · ' + spec.major : '')); setText(E['voice-text'], spec.text || ''); setText(E['voice-payoff'], spec.payoff || '');
    E['voice-card'].dataset.voice = spec.voiceId || ''; show(E['voice-card'], true);
  }
  function answerVoice(accept) { const s = stateOf(); const id = E['voice-card'] && E['voice-card'].dataset.voice; if (s && id) call('progress', 'answerVoice', s, id, !!accept); if (dom()) show(E['voice-card'], false); }
  function registerBuiltins() {
    const reg = function (id, fn) { if (!M.cards[id]) M.registerCard(id, fn); };
    reg('charter', function (s, p) {
      const txt = (BSU.data && BSU.data.tutorial && BSU.data.tutorial[1] && BSU.data.tutorial[1].card) || '$4,000,000, one ridge, and a swamp. Build a university. Geaux.';
      return { id: 'charter', kicker: 'The charter', title: 'BAYOU STATE', body: txt, actions: [{ label: 'Geaux', primary: true }], autoMs: fin(p && p.autoMs, fin(PT.charterCardMs, 3000)), clickToClose: true, onClose: function (st) { call('progress', 'advanceTutorial', st, 2); } };
    });
    reg('obj8', function (s, p) { return { id: 'obj8', kicker: 'Objective 8', title: 'Capped', body: (p && p.text) || ('Enrollment is capped at ' + fin(p && p.students, 0) + '. Beds, seats and dining set the ceiling.'), actions: [{ label: 'Show me the Budget', fn: function () { M.openPanel('budget'); } }, { label: 'OK', primary: true }] }; });
    reg('voice', function (s, p) { p = p || {}; return { id: 'voice', side: 'voice', voiceId: p.id, student: p.student, major: p.major, text: p.text, payoff: p.payoff }; });
    reg('board', function (s, p) {
      const cards = (p && Array.isArray(p.cards)) ? p.cards : []; const defs = (BSU.data && BSU.data.boardCards) || [];
      const body = el('div', 'board-list');
      const actions = [];
      cards.forEach(function (cid) { const d = defs.find(function (x) { return x.id === cid; }) || { id: cid, name: cid, text: '' }; const b = btn(null, '', 'board-card', function () { call('progress', 'answerBoard', stateOf(), cid); M.closeCard(); }); b.appendChild(el('div', 'board-name', d.name)); b.appendChild(el('div', 'board-text', d.text)); body.appendChild(b); });
      actions.push({ label: 'Decline all', fn: function (st) { call('progress', 'answerBoard', st, null); } });
      return { id: 'board', kicker: 'Board of Regents', title: 'The Board has a proposal', body: body, actions: actions };
    });
    reg('recap', function (s, p) {
      p = p || {}; const lines = [];
      if (Array.isArray(p.lines)) lines.push.apply(lines, p.lines); else { for (const k in p) if (typeof p[k] === 'string' || typeof p[k] === 'number') lines.push(k.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }) + ': ' + (typeof p[k] === 'number' && Math.abs(p[k]) >= 1000 ? money(p[k]) : p[k])); }
      return { id: 'recap', kicker: "Founders' Day", title: p.title || ('Year ' + fin(p.year, fin(s && s.calendar && s.calendar.year, 1) - 1) + ' in review'), body: lines.length ? lines : ['Another year on the ridge.'], actions: [{ label: 'Postcard', fn: function (st) { postcard(st); return true; } }, { label: 'Onward', primary: true }] };
    });
    reg('versionMismatch', function (s, p) { p = p || {}; return { id: 'versionMismatch', kicker: 'Save', title: 'That save is from another version', body: 'Version ' + fin(p.version, 0) + ' cannot be loaded here. Start fresh with the same seed (' + fin(p.seed, 0) + ')?', actions: [{ label: 'Start fresh, same seed', primary: true, fn: function () { call('audio', 'unlock'); M.showTitle(false); call('session', 'newGame', { seed: fin(p.seed, 0) >>> 0 }); } }, { label: 'Back' }] }; });
    if (!panels.settings) M.registerPanel('settings', { build: buildSettingsPanel, refresh: refreshSettingsPanel, events: ['speed:changed'] });
    if (!panels.debug) M.registerPanel('debug', { build: buildDebugPanel, refresh: refreshDebugPanel, events: [] });
    if (!panels.milestones) M.registerPanel('milestones', { build: function (host) { host.appendChild(el('div', 'panel-title', 'Milestones')); const list = el('div', 'ms-list'); host.appendChild(list); host._list = list; }, refresh: function (s, host) { const list = host._list; if (!list) return; clear(list); for (const r of (call('progress', 'nearestMilestones', s, 8) || [])) { const d = el('div', 'ms-row'); d.appendChild(el('span', 'ms-name', r.name)); const b = el('div', 'bar'); const f = el('div', 'fill'); f.style.width = Math.round(clamp(r.goal > 0 ? r.progress / r.goal : 0, 0, 1) * 100) + '%'; b.appendChild(f); d.appendChild(b); d.appendChild(el('span', 'ms-count', r.goal > 1 ? Math.round(r.progress) + ' / ' + r.goal : '')); list.appendChild(d); } }, events: ['milestone:earned'] });
  }

  // ---------------------------------------------------------------------------
  // Panels (one open at a time), overlay, speed, title, settings, breakdown
  // ---------------------------------------------------------------------------
  function panelHost(name) {
    const p = panels[name]; if (!p) return null;
    if (!p.el && dom()) { const host = el('div', 'panel hidden'); host.id = 'panel-' + name; const head = el('div', 'panel-head'); const x = btn(null, '✕', 'icon', function () { M.openPanel(null); }); head.appendChild(x); host.appendChild(head); E.panels.appendChild(host); p.el = host; E['panel-' + name] = host; }
    return p.el;
  }
  /** open a registered panel (closes any other); null closes; `Esc` closes */
  M.openPanel = function (name) {
    try {
      const s = stateOf(); if (!s || !s.ui) return;
      const prev = s.ui.panel;
      if (name && menuEdit) M.closeMenuEditor();   // one centred overlay at a time
      if (prev && prev !== name) { const pp = panels[prev]; if (pp && pp.el && dom()) show(pp.el, false); if (pp && typeof pp.close === 'function') { try { pp.close(s); } catch (e) { uerr('panel:close', e); } } if (prev === 'debug' && name !== 'debug') { M.debug.open = false; call('progress', 'debugOpen', s, false); } }
      if (!name) { s.ui.panel = null; if (prev) emit('ui:panel', { panel: null }); return; }
      const p = panels[name]; if (!p) { s.ui.panel = null; M.notify(s, { kind: 'info', text: (PANEL_KEYS[name] || name) + ' panel is not available yet', ttl: 3000 }); return; }
      s.ui.panel = name;
      if (dom()) {
        show(E.popover, false); hideTooltip();
        const host = panelHost(name);
        if (host) { if (!p.built) { p.built = true; try { if (typeof p.build === 'function') p.build(host, s); } catch (e) { uerr('panel:build:' + name, e); } } show(host, true); refreshPanel(s, name); }
        if (E.hud) E.hud.dataset.panel = name;
      }
      if (name === 'debug') { M.debug.open = true; call('progress', 'debugOpen', s, true); }
      if (prev !== name) emit('ui:panel', { panel: name });
    } catch (e) { uerr('openPanel', e); }
  };
  M.panel = function () { const s = stateOf(); return s && s.ui ? s.ui.panel : null; };
  function refreshPanel(s, name) { const p = panels[name]; if (!p || !p.el) return; p.lastRefresh = clock; try { if (typeof p.refresh === 'function') p.refresh(s, p.el); } catch (e) { uerr('panel:refresh:' + name, e); } }
  /** UI scale pass: a panel wide enough to reach the docked cards (goals tracker, minimap, overlay keys, notifications, voice card) fades just the ones it overlaps, so no half-hidden text peeks out around it */
  const FADE_IDS = ['objective-card', 'minimap-wrap', 'overlay-buttons', 'notifications', 'voice-card', 'alert-strip', 'issues-tray', 'undo-chip', 'inspect'];   // 'inspect' fades only under the Edit menu overlay (menu layout pass)   // qa pass 4: the tray sat crisp beside an open panel
  let fadeAt = -1e9;
  function syncPanelFade(s) {
    if (!dom() || clock - fadeAt < 250) return; fadeAt = clock;
    try {
      const name = s && s.ui ? s.ui.panel : null; let host = name && panels[name] ? panels[name].el : null;
      if (menuEdit && E['menu-overlay']) host = E['menu-overlay'];
      let p = null; if (host && !host.classList.contains('hidden') && typeof host.getBoundingClientRect === 'function') p = host.getBoundingClientRect();
      for (const id of FADE_IDS) {
        const e = E[id]; if (!e) continue; let over = false;
        if (p && p.width > 0 && !e.classList.contains('hidden') && (id !== 'inspect' || menuEdit)) { const r = e.getBoundingClientRect(); over = r.width > 0 && r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top; }
        cls(e, 'hud-fade', over);
      }
    } catch (e) { /* stub */ }
  }
  function updatePanels(s) { syncPanelFade(s); const name = s.ui.panel; if (!name) { if (E.hud && E.hud.dataset.panel) E.hud.dataset.panel = ''; return; } const p = panels[name]; if (!p) return; if (clock - p.lastRefresh >= L.refreshMs) refreshPanel(s, name); }
  /** switch the overlay (render owns the write; the legend chip follows) */
  M.setOverlay = function (state, ov) { try { const s = state || stateOf(); if (!s) return; ov = fin(ov, OV.NONE) | 0; if (has('render', 'setOverlay')) call('render', 'setOverlay', ov); else s.ui.overlay = ov; emit('ui:overlay', { overlay: s.ui.overlay }); } catch (e) { uerr('setOverlay', e); } };
  /** user intent → session.setSpeed(state, speed, 'user') */
  M.setSpeed = function (state, speed) { try { const s = state || stateOf(); if (!s) return; if (s.setPiece) return; speed = fin(speed, 1); if (has('session', 'setSpeed')) call('session', 'setSpeed', s, speed, 'user'); else s.ui.speed = speed; speedKey = ''; } catch (e) { uerr('setSpeed', e); } };
  /** showTitle(on, opts) or showTitle(state, on, opts) */
  M.showTitle = function (a, b, c) {
    try {
      let on, opts; if (typeof a === 'boolean') { on = a; opts = b || {}; } else { on = !!b; opts = c || {}; }
      titleOn = on;
      if (!dom()) return;
      show(E.title, on); show(E.hud, !on); cls(E.app, 'title-on', on);
      if (on) {
        let can = !!opts.canContinue; if (!can) { try { can = !!window.localStorage.getItem('bsu.last'); } catch (e) { can = false; } }
        E['btn-continue'].disabled = !can; show(E['btn-continue'], can); refreshMuteButtons(); refreshTitleSize();
        try { const slots = call('session', 'slots') || []; const last = slots.find(function (x) { return x && (x.last || x.slot === 'bsu.last'); }); if (last && last.label) E['btn-continue'].title = last.label; } catch (e) { /* optional */ }
      } else { if (focusedInput === E['title-seed']) focusedInput = null; }
    } catch (e) { uerr('showTitle', e); }
  };
  function charterClick() {
    const s = stateOf();
    call('audio', 'unlock'); M.showTitle(false);
    let seed; try { const v = parseInt(String(E['title-seed'].value || '').trim(), 10); if (Number.isFinite(v)) seed = v >>> 0; } catch (e) { seed = undefined; }
    call('session', 'newGame', seed === undefined ? {} : { seed: seed });
    void s;
  }
  M.settings = function () { const s = stateOf(); if (s && s.ui && s.ui.settings) return s.ui.settings; return { volume: 0.5, muted: false, particles: 'high', shake: true, colorblind: false, autoSimHint: false, hudMode: 'full', hudCollapsed: {}, alerts: 'normal', mutedIssues: {} }; };
  /** mirror state.ui.settings to localStorage['bsu.settings'] (a failure → one 'saveUnavailable' hint) */
  M.saveSettings = function () { try { window.localStorage.setItem('bsu.settings', JSON.stringify(M.settings())); } catch (e) { const s = stateOf(); if (s) M.hint(s, 'saveUnavailable'); } };
  /** stat popover from economy.breakdown */
  M.breakdown = function (state, stat) {
    try {
      const s = state || stateOf(); if (!s || !dom()) return;
      const r = call('economy', 'breakdown', s, stat) || { value: 0, lines: [], next: '' };
      const label = { cash: 'Cash', students: 'Students', prestige: 'Prestige', happiness: 'Happiness', ecology: 'Ecology' }[stat] || stat;
      const val = stat === 'cash' ? money(r.value) : (Math.round(fin(r.value, 0) * 10) / 10);
      setText(E['pop-title'], label + ' · ' + val);
      const lines = Array.isArray(r.lines) ? r.lines.slice(0, L.popLines) : [];
      E.popLines.forEach(function (pl, k) { const ln = lines[k]; show(pl.row, !!ln); if (ln) { setText(pl.k, ln.label || ''); const v = fin(ln.value, 0); setText(pl.v, stat === 'cash' || Math.abs(v) >= 10000 ? (v > 0 ? '+' : '') + money(v) : (v > 0 && stat !== 'students' ? '+' : '') + (Math.round(v * 10) / 10)); pl.v.dataset.sign = v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero'; } });
      setText(E['pop-next'], r.next || ''); show(E['pop-next'], !!r.next);
      const anchor = E['stat-' + stat]; let left = 200; try { const rc = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null; if (rc) left = fin(rc.left, 200); } catch (e) { left = 200; }
      const pw = fin(E.popover.offsetWidth, 0) || Math.round(340 * effScale); E.popover.style.left = Math.round(clamp(left, 8, fin(window.innerWidth, 1280) - pw - 20)) + 'px';
      // never cover an open decision toast (its buttons must stay clickable): drop below it
      let top = ''; try { const dt = E['decision-toast']; if (dt && !dt.classList.contains('hidden') && dt.getBoundingClientRect) { const rc = dt.getBoundingClientRect(); if (rc.height > 0) top = Math.round(rc.bottom + 6) + 'px'; } } catch (e) { top = ''; }
      if (!top) { try { const oc = E['objective-card']; if (oc && !oc.classList.contains('hidden') && oc.getBoundingClientRect) { const rc = oc.getBoundingClientRect(); const pl = parseFloat(E.popover.style.left) || 0; if (rc.height > 0 && pl < rc.right + 8 && pl + pw > rc.left) top = Math.round(rc.bottom + 6) + 'px'; } } catch (e) { top = ''; } }   // the goals tracker sits top-left: drop below it
      E.popover.style.top = top;
      show(E.popover, true);
    } catch (e) { uerr('breakdown', e); }
  };

  // Settings panel (built in; ui_panels may re-register 'settings' with a fuller sheet)
  function buildSettingsPanel(host, s) {
    host.appendChild(el('div', 'panel-title', 'Settings'));
    const set = M.settings();
    const rowEl = function (label, control) { const r = el('div', 'set-row'); r.appendChild(el('span', 'k', label)); r.appendChild(control); host.appendChild(r); return r; };
    const chk = function (id, label, get, put) { const b = btn(id, '', 'toggle', function () { put(!get()); M.saveSettings(); refreshSettingsPanel(stateOf(), host); }); b.setAttribute('aria-pressed', get() ? 'true' : 'false'); setText(b, get() ? 'On' : 'Off'); rowEl(label, b); b._get = get; return b; };
    host._audio = chk('chk-audio', 'Sound', function () { return !M.settings().muted; }, function (v) { M.settings().muted = !v; call('audio', 'mute', !v); refreshMuteButtons(); });
    const vol = el('input'); vol.id = 'sl-volume'; vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05'; vol.value = String(fin(set.volume, 0.5)); vol.addEventListener('input', function () { const v = clamp(parseFloat(vol.value) || 0, 0, 1); M.settings().volume = v; call('audio', 'setVolume', v); M.saveSettings(); }); rowEl('Volume', vol); host._vol = vol;
    host._particles = chk('seg-particles', 'Particles (high)', function () { return M.settings().particles !== 'low'; }, function (v) { M.settings().particles = v ? 'high' : 'low'; });
    host._shake = chk('chk-shake', 'Screen shake', function () { return M.settings().shake !== false; }, function (v) { M.settings().shake = v; });
    host._cb = chk('chk-colorblind', 'Colorblind overlays', function () { return !!M.settings().colorblind; }, function (v) { M.settings().colorblind = v; });
    const sp = el('div', 'seg'); [0, 1, 2, 4, 8].forEach(function (v) { const b = btn(null, v === 0 ? 'Pause' : v + '×', 'seg-btn', function () { M.setSpeed(stateOf(), v); refreshSettingsPanel(stateOf(), host); }); b.dataset.speed = String(v); sp.appendChild(b); }); rowEl('Speed', sp); host._speed = sp;
    const us = el('div', 'seg'); host._uiScale = us; UI_SCALES.forEach(function (v) { const b = btn('btn-uiscale-' + Math.round(v * 100), Math.round(v * 100) + '%', 'seg-btn', function () { M.setUiScale(v); refreshSettingsPanel(stateOf(), host); }); b.dataset.scale = String(v); b.title = 'Interface size ' + Math.round(v * 100) + '%'; us.appendChild(b); });
    { const ab = btn('btn-uiscale-auto', 'Auto', 'seg-btn', function () { M.setUiScale('auto'); refreshSettingsPanel(stateOf(), host); }); ab.dataset.scale = 'auto'; ab.title = 'Pick the interface size from this window'; us.appendChild(ab); }   // P5
    const uw = el('div', 'seg-wrap'); const un = el('div', 'seg-note hidden', ''); host._uiNote = un; uw.appendChild(us); uw.appendChild(un); rowEl('UI size', uw);   // UI scale pass (C7)
    const hs = el('div', 'seg'); host._hud = hs; [['full', 'Full'], ['compact', 'Compact'], ['hidden', 'Hidden']].forEach(function (d) { const b = btn('btn-hud-' + d[0], d[1], 'seg-btn', function () { M.setHudMode(d[0]); refreshSettingsPanel(stateOf(), host); }); b.dataset.hud = d[0]; b.title = d[0] === 'full' ? 'Every panel' : d[0] === 'compact' ? 'Each panel folds to a pill that opens on hover or click' : 'Only the decision toasts and a small chip'; hs.appendChild(b); });
    const hw = el('div', 'seg-wrap'); hw.appendChild(hs); hw.appendChild(el('div', 'seg-note', 'H cycles Full → Compact → Hidden · Shift+H restores · the ▾ on a panel folds just that one')); rowEl('HUD', hw);   // hud + zoom pass
    // calm alerts pass: Alerts Normal / Quiet / Off
    const as = el('div', 'seg'); host._alerts = as; [['normal', 'Normal', 'Map beacons from severity 2 (at most 6), issue toasts once per kind per week'], ['quiet', 'Quiet', 'Beacons only for severity 3; no toasts except decisions'], ['off', 'Off', 'The Issues tray folds to its count; no beacons, no toasts']].forEach(function (d) { const b = btn('btn-alerts-' + d[0], d[1], 'seg-btn', function () { M.setAlertMode(d[0]); refreshSettingsPanel(stateOf(), host); }); b.dataset.alerts = d[0]; b.title = d[2]; as.appendChild(b); });
    const aw = el('div', 'seg-wrap'); aw.appendChild(as); aw.appendChild(el('div', 'seg-note', 'Low-priority rows (unlinked paths, mosquito hotspots) and muted kinds sit under Suggestions in the tray · the 🔔 on a tray row mutes that kind · hold I or toggle Spotlight to light every issue')); rowEl('Alerts', aw);
    rowEl('Tour', btn('btn-coach-replay', 'Replay the 60-second tour', 'small', function () { M.startCoach(stateOf()); }));
    const leg = el('div', 'legend-table'); for (const o of ((BSU.data && BSU.data.overlays) || [])) { const r = el('div', 'legend-row'); r.appendChild(el('span', 'key', o.key)); r.appendChild(el('span', 'k', o.name)); r.appendChild(el('span', 'v', o.legend.join(' · '))); leg.appendChild(r); } rowEl('Overlays', leg);
    const keys = el('div', 'keys-table'); keys.id = 'keys'; const KEYNAMES = { ' ': 'Space' }; for (const k of ((BSU.data && BSU.data.keys) || [])) { if (/^pan|^pick[2-9]|^toast/.test(k.action)) continue; const r = el('div', 'legend-row'); r.appendChild(el('span', 'key', (k.ctrl ? 'Ctrl+' : '') + (k.shift ? 'Shift+' : '') + (KEYNAMES[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key)))); r.appendChild(el('span', 'k', k.action === 'pick1' ? 'pick item 1–9' : k.action.replace(/([A-Z])/g, ' $1').toLowerCase())); keys.appendChild(r); } rowEl('Keys', keys);
    const acts = el('div', 'card-actions');
    acts.appendChild(btn('btn-save-manual', 'Save', 'small', function () { call('session', 'save', 'manual.0'); }));
    acts.appendChild(btn('btn-load', 'Load', 'small', function () { call('session', 'continue_'); M.openPanel(null); }));
    acts.appendChild(btn('btn-newgame', 'New game', 'small danger', function () { M.openPanel(null); M.showTitle(true, {}); }));
    host.appendChild(acts);
    void s;
  }
  function refreshSettingsPanel(s, host) {
    if (!host) return;
    [host._audio, host._particles, host._shake, host._cb].forEach(function (b) { if (!b || !b._get) return; const on = !!b._get(); setText(b, on ? 'On' : 'Off'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (host._alerts) for (const b of host._alerts.children) cls(b, 'active', b.dataset.alerts === alertModeOf());   // calm alerts pass
    if (host._speed) for (const b of host._speed.children) cls(b, 'active', String(fin(s.ui.speed, 1)) === b.dataset.speed);
    if (host._vol) host._vol.value = String(fin(M.settings().volume, 0.5));
    if (host._uiScale) for (const b of host._uiScale.children) { const d = b.dataset.scale; cls(b, 'active', d === 'auto' ? uiMode === 'auto' : uiMode !== 'auto' && Number(d) === appliedScale); }
    if (host._hud) for (const b of host._hud.children) cls(b, 'active', b.dataset.hud === hudModeOf());
    if (host._uiNote) { const lim = effScale < appliedScale - 0.005; const txt = uiMode === 'auto' ? 'Auto picks ' + Math.round(effScale * 100) + '% for this window.' : lim ? 'Limited to ' + Math.round(effScale * 100) + '% by this window size.' : ''; show(host._uiNote, !!txt); if (txt) setText(host._uiNote, txt); }
  }
  // Debug panel (built in; hidden; Backquote). ui_panels may re-register 'debug' with the full params tree.
  function buildDebugPanel(host) {
    host.appendChild(el('div', 'panel-title', 'Debug'));
    const grid = el('div', 'dbg-grid'); host.appendChild(grid);
    const add = function (label, fn) { grid.appendChild(btn(null, label, 'small', function () { const s = stateOf(); try { fn(s); } catch (e) { uerr('debug:' + label, e); } refreshDebugPanel(s, host); })); };
    add('+$1M', function (s) { call('economy', 'post', s, 'misc', 1e6); });
    add('+500 students', function (s) { call('economy', 'addStudents', s, 500, 'debug'); });
    add('Skip 10 days', function (s) { if (has('session', 'skipToDate')) { const d = BSU.dayParts(dayOf(s) + 10); call('session', 'skipToDate', s, d.date, d.year - fin(s.calendar.year, 1)); } });
    add('Cat 3 in 6 days', function (s) { call('weather', 'spawnStorm', s, { cat: 3, coneNowTick: tickOf(s), landfallTick: tickOf(s) + fin(P.storm && P.storm.coneDays, 6) * fin(PT.ticksPerDay, 200), compressed: true }); });
    add('Rain here', function (s) { const i = M.hoverTile >= 0 ? M.hoverTile : (s.plot && s.plot.founders ? BSU.idx(s.plot.founders.tx, s.plot.founders.ty) : 2080); call('hydro', 'forceRain', s, { i: i, tx: i % W, ty: (i / W) | 0, inches: 2 }); });
    add('Spawn gator', function (s) { const i = M.hoverTile >= 0 ? M.hoverTile : -1; if (i >= 0) call('wildlife', 'spawnGator', s, i); else call('wildlife', 'forceFirstGator', s); });
    add('Mosquitoes', function (s) { call('wildlife', 'forceMosquito', s, 0.8); });
    add('Home game', function (s) { call('sports', 'playHome', s); });
    add('Fire toasts', function (s) { call('progress', 'fireAllToasts', s); });
    add('Time-lapse 20×', function (s) { call('session', 'setSpeed', s, 20, 'user'); });
    add('Hydro numbers', function () { M.debug.hydroNumbers = !M.debug.hydroNumbers; });
    add('Perf HUD', function () { M.debug.perfHud = !M.debug.perfHud; show(E['perf-chip'], M.debug.perfHud); });
    const info = el('div', 'dbg-info', ''); host.appendChild(info); host._info = info;
  }
  function refreshDebugPanel(s, host) {
    if (!host || !host._info) return;
    const pf = call('render', 'perf') || {};
    setText(host._info, 'tick ' + tickOf(s) + ' · day ' + dayOf(s) + ' · ' + BSU.formatDate(dayOf(s)) + ' · speed ' + fin(s.ui.speed, 0) + '× · frame ' + fin(pf.frameMs, 0).toFixed(1) + ' ms · ' + fin(pf.drawCalls, 0) + ' draws · ' + fin(pf.memMB, 0) + ' MB · errors ' + (BSU.errors ? BSU.errors.size : 0) + ' · hydro ' + (M.debug.hydroNumbers ? 'on' : 'off') + ' · machine ' + live.state);
  }

  // ---------------------------------------------------------------------------
  // Alert strip (priority order; one action)
  // ---------------------------------------------------------------------------
  let currentAlert = null;
  /** manual override of the strip: alert(state, {icon, text, action?: {label, fn}, gator?: {name, i}} | null) */
  M.alert = function (state, spec) { manualAlert = spec || null; alertAt = -1e9; void state; };
  function autoAlert(s) {
    const day = dayOf(s);
    const mode = alertModeOf(); if (mode === 'off') return null;   // calm alerts pass: Off = no strip at all; Quiet = the danger chips only (storm, heat, blackout)
    if (mode === 'quiet') { const a = autoAlertFull(s, day); return a && a.kind === 'danger' ? a : null; }
    return autoAlertFull(s, day);
  }
  function autoAlertFull(s, day) {
    const st = call('weather', 'storm', s);
    if (st && !st.nearMiss && st.phase >= STORM.NAMED && st.phase <= STORM.LANDFALL) {
      const H = fin(call('weather', 'forecastSurge', s), 0); const g = H > 0 ? call('buildings', 'gaps', s, H) : null; const gl = g && Array.isArray(g.gaps) ? g.gaps : [];
      const ring = gl.length ? 'ring open at ' + (gl[0].name || 'the shore') : (H > 0 ? 'ring holds at ' + H.toFixed(0) + ' ft' : '');
      const days = Math.max(0, fin(st.landfallDay, day) - day);
      return { icon: '🌀', text: (st.name || 'Hurricane') + ' · Cat ' + fin(st.forecastCat || st.cat, 1) + (st.phase >= STORM.LANDFALL ? ' · landfall' : ' · landfall in ' + days + (days === 1 ? ' day' : ' days')) + (ring ? ' · ' + ring : ''), action: { label: 'Prepare', fn: function () { M.openPanel('storm'); } }, kind: 'danger' };
    }
    if (s.wildlife && fin(s.wildlife.biblicalDays, 0) > 0) return { icon: '🦟', text: 'Mosquito emergency · biblical', action: { label: 'Show', fn: function (st) { M.setOverlay(st, OV.MOSQUITO); } }, kind: 'wildlife' };
    const heat = call('weather', 'heat', s); if (heat && heat.wave) return { icon: '🌡', text: 'Heat wave · index ' + Math.round(fin(heat.index, 0)), kind: 'danger' };
    const list = call('buildings', 'list', s) || [];
    const black = list.find(function (b) { return b && b.blackout && b.built >= 1 && !b.ruin; }); if (black) return { icon: '⚡', text: 'Blackout · ' + (black.name || black.type), action: { label: 'Show me', fn: function () { call('render', 'panToTile', black.tx, black.ty); } }, kind: 'danger' };
    const flooded = list.find(function (b) { if (!b || !b.flooded || b.ruin) return false; const r = rowOf(b.type); return b.type === 'founders_hall' || (r && r.needsPower); });
    if (flooded) return { icon: '🌊', text: (flooded.name || flooded.type) + ' is flooded', action: { label: 'Show me', fn: function () { call('render', 'panToTile', flooded.tx, flooded.ty); } }, kind: 'water' };
    if (call('buildings', 'boilWaterTriggered', s)) return { icon: '🚱', text: 'Boil-water advisory', kind: 'water' };
    const lg = s.wildlife && s.wildlife.leGrand; if (lg) { const left = Math.max(0, fin(s.wildlife.leGrandDay, day) + 3 - day); const i = clamp(Math.floor(fin(lg.tx, 0)), 0, W - 1) + clamp(Math.floor(fin(lg.ty, 0)), 0, HGT - 1) * W; return { icon: '🐊', text: '', gator: { name: 'Le Grand at the cypress lake · ' + left + (left === 1 ? ' day' : ' days'), i: i }, kind: 'wildlife' }; }
    return null;
  }
  function updateAlert(s) {
    if (clock - alertAt < L.refreshMs) return; alertAt = clock;
    const spec = manualAlert || autoAlert(s); currentAlert = spec;
    const key = spec ? (spec.icon || '') + '|' + (spec.text || '') + '|' + (spec.gator ? spec.gator.name : '') + '|' + (spec.action ? spec.action.label : '') : '';
    if (key === alertKey) return; alertKey = key;
    if (!spec || key === alertClosedKey) { show(E['alert-strip'], false); return; }   // gator pass: a chip closed with ✕ stays closed until the alert changes
    setText(E['alert-icon'], spec.icon || ''); setText(E['alert-text'], spec.text || ''); show(E['alert-text'], !!spec.text);
    show(E['alert-action'], !!(spec.action && spec.action.label)); if (spec.action) setText(E['alert-action'], spec.action.label || 'Go');
    show(E['alert-gator'], !!spec.gator); if (spec.gator) setText(E['alert-gator'], spec.gator.name);
    E['alert-strip'].dataset.kind = spec.kind || 'info'; show(E['alert-strip'], true);
  }

  // ---------------------------------------------------------------------------
  // Top bar (GDD §11.1): odometers, delta flash, chips, speed, storm dot, mute
  // ---------------------------------------------------------------------------
  function flashDelta(delta) { if (!dom()) return; const d = E['stat-cash-delta']; setText(d, (delta > 0 ? '+' : '−') + money(Math.abs(delta))); d.dataset.sign = delta > 0 ? 'pos' : 'neg'; cls(d, 'on', true); odo.deltaUntil = clock + L.deltaMs; }
  function updateTopbar(s, dtMs) {
    const e = s.economy || {}; const k = Math.min(1, dtMs / L.odoMs);
    if (clock - fitAt > 500) { fitAt = clock; fitTopbar(); }
    // cash odometer
    const cash = fin(e.cash, 0); if (!Number.isFinite(odo.cash)) odo.cash = cash; else odo.cash += (cash - odo.cash) * k; if (Math.abs(cash - odo.cash) < 1) odo.cash = cash;
    setText(E['stat-cash-value'], money(Math.round(odo.cash))); cls(E['stat-cash'], 'neg', cash < 0);
    if (odo.deltaUntil && clock > odo.deltaUntil) { cls(E['stat-cash-delta'], 'on', false); odo.deltaUntil = 0; }
    // students odometer (held until agent:arrive for cohort jumps)
    const students = fin(e.students, 0);
    if (!Number.isFinite(odo.lastStudents)) { odo.lastStudents = students; odo.students = students; }
    if (students - odo.lastStudents >= 20) { odo.holdUntil = tickOf(s) + L.holdTicks; }
    odo.lastStudents = students;
    if (odo.holdUntil >= 0 && tickOf(s) >= odo.holdUntil) odo.holdUntil = -1;
    if (odo.holdUntil < 0) { odo.students += (students - odo.students) * k; if (Math.abs(students - odo.students) < 0.5) odo.students = students; }
    setText(E['stat-students-value'], String(Math.round(odo.students)));
    // capacity chip
    const stage = fin(call('progress', 'tutorialStage', s), 6);
    const capOn = stage >= 5 || !!call('progress', 'offered', s, '4');
    if (capOn !== capacityShown) { capacityShown = capOn; show(E['chip-capacity'], capOn); show(E['stat-students-label'], !capOn); }
    if (capOn) { setText(E['chip-capacity'], 'Apps ' + fin(e.applicants, 0) + ' / Cap ' + fin(e.capacity, 0)); const ct = e.capacityTerms || {}; let bind = '', bv = Infinity; for (const key in ct) { if (Number.isFinite(ct[key]) && ct[key] < bv) { bv = ct[key]; bind = key; } } E['chip-capacity'].title = bind ? ({ beds: 'beds', seats: 'seats', dining: 'dining', wastewater: 'wastewater' }[bind] || bind) + ' are the bottleneck' : ''; }
    // prestige / happiness / ecology
    [['prestige', e.prestige], ['happiness', e.happiness], ['ecology', e.ecology]].forEach(function (p) { const v = fin(p[1], 0); setText(E['stat-' + p[0] + '-value'], String(Math.round(v))); E['stat-' + p[0]].title = p[0][0].toUpperCase() + p[0].slice(1) + ' ' + (Math.round(v * 10) / 10); });
    // date + sky glyph
    const d = call('weather', 'date', s) || { str: BSU.formatDate(dayOf(s)), season: s.calendar ? s.calendar.season : '' };
    const season = d.season ? d.season[0].toUpperCase() + d.season.slice(1) : '';
    setText(E['stat-date-text'], (d.str || '') + (season ? ' · ' + season : ''));
    const ph = clamp(fin(s.sky && s.sky.phase, SKY.DAY), 0, 4);
    const stm = call('weather', 'storm', s); const sph = (stm && !stm.nearMiss) ? fin(stm.phase, 0) : 0;   // the storm owns the glyph from the outer bands through landfall
    setText(E['sky-glyph'], sph === STORM.LANDFALL ? '🌀' : sph === STORM.BANDS ? '⛈' : SKY_GLYPH[ph]); E['sky-glyph'].title = sph === STORM.LANDFALL ? 'Landfall' : sph === STORM.BANDS ? 'Outer bands' : SKY_NAME[ph];
    // weather chip
    const heat = call('weather', 'heat', s) || { index: fin(s.weather && s.weather.heat, 70), advisory: false }; const river = call('weather', 'riverStage', s) || { river: 0, window: false };
    let rainTmrw = false; try { const rd = s.weather && s.weather.rainDays; if (Array.isArray(rd)) { const tm = dayOf(s) + 1; rainTmrw = rd.some(function (r) { return r === tm || (r && r.day === tm); }); } } catch (err) { rainTmrw = false; }
    let wx = Math.round(fin(heat.index, 0)) + '°'; if (rainTmrw) wx += ' · Rain tmrw'; if (river.window && fin(river.river, 0) > 0) wx += ' · River +' + fin(river.river, 0).toFixed(0) + ' ft'; if (s.weather && fin(s.weather.rainRate, 0) > 0) wx = '🌧 ' + wx;
    setText(E['chip-weather'], wx); cls(E['chip-weather'], 'warn', !!heat.advisory); cls(E['chip-weather'], 'water', !!river.window);
    // endowment
    show(E['chip-endowed'], fin(e.endowment, 0) > 0);
    // speed buttons
    const sp = fin(s.ui.speed, 1); const sk = sp + '|' + (s.setPiece ? 'sp' : '');
    if (sk !== speedKey) { speedKey = sk; for (const v in E.speedBtns) { const b = E.speedBtns[v]; const on = Number(v) === sp; b.setAttribute('aria-pressed', on ? 'true' : 'false'); cls(b, 'active', on); b.disabled = !!s.setPiece; } }
    // storm button
    const st = call('weather', 'storm', s); const stormOn = !!(st && !st.nearMiss && st.phase >= STORM.NAMED && st.phase <= STORM.LANDFALL);
    cls(E['btn-storm'], 'live', stormOn); E['btn-storm'].disabled = !stormOn;
    // mute glyph
    refreshMuteButtons();
    // HUD stat fade-in (tutorial)
    const hints = (s.progress && s.progress.hints) || {};
    const pre = stage < 3 && !hints.hudShown && !hudFade;
    cls(E.stats, 'pre', pre);
    if (hudFade && !hints.hudShown && clock - hudFadeAt > 5 * L.hudStaggerMs + 600) { call('progress', 'markHint', s, 'hudShown'); hudFade = false; }
  }

  // ---------------------------------------------------------------------------
  // Objective card, speech bubble, milestones card
  // ---------------------------------------------------------------------------
  function objShowMe() { const s = stateOf(); const o = s ? call('progress', 'objective', s) : null; if (!o) return; const r = call('progress', 'showMe', s, o.id); if (r) showMe(s, r); }
  /** what the tracker shows: the active objective, else (after the chain) the nearest milestone */
  function trackerView(s, o, stage) {
    if (o) {
      const g = guideOf(o.id);
      const target = objTarget(s, o);
      let next = '';
      if (o.background && o.background.id !== o.id) next = 'Next up: ' + (o.background.title || o.background.text || '');
      else { const ms = call('progress', 'nearestMilestones', s, 1) || []; if (ms[0]) next = 'Next milestone: ' + ms[0].name + (ms[0].goal > 1 ? ' · ' + Math.round(fin(ms[0].progress, 0)) + ' / ' + ms[0].goal : ''); }
      return { id: o.id, kind: o.kind === BSU.OBJ.BACKGROUND ? 'background' : 'interrupt', kicker: o.kind === BSU.OBJ.BACKGROUND ? 'Goal · in the background' : 'Goal', title: o.title || '', text: o.text || '', why: g ? g.why : '', progress: fin(o.progress, 0), goal: fin(o.goal, 0), deadline: o.deadline, target: target, next: next, showme: true, dismiss: true, postcard: o.id === '7' && /parade|postcard/i.test(o.text || ''), capped: o.id === '8' && /capped/i.test(o.text || '') };
    }
    if (stage < 6) return null;
    const ms = call('progress', 'nearestMilestones', s, 2) || []; const m = ms[0]; if (!m) return null;
    const def = ((BSU.data && BSU.data.milestones) || []).find(function (x) { return x.id === m.id; }) || {};
    return { id: 'ms:' + m.id, kind: 'milestone', kicker: 'Next milestone', title: m.name || '', text: def.text || '', why: def.reward ? '' : '', progress: fin(m.progress, 0), goal: fin(m.goal, 0), deadline: -1, target: null, next: ms[1] ? 'Then: ' + ms[1].name : '', showme: false, dismiss: false, postcard: false, capped: false };
  }
  function updateObjective(s) {
    const o = call('progress', 'objective', s);
    const stage = fin(call('progress', 'tutorialStage', s), 6);
    const view = trackerView(s, o, stage);
    show(E['milestones-card'], false);   // the tracker carries the nearest milestone now
    if (!view) { if (objKey !== '') { objKey = ''; show(E['objective-card'], false); show(E['speech-bubble'], false); } return; }
    const sp = !!s.setPiece;
    const key = view.id + '|' + view.title + '|' + view.text + '|' + view.progress + '/' + view.goal + '|' + (view.deadline >= 0 ? view.deadline : '') + '|' + (view.target || '') + '|' + view.next + '|' + (sp ? 'sp' : '') + '|' + (s.ui.tool ? s.ui.tool.id : '');
    if (key !== objKey) {
      objKey = key; bubble.since = clock; bubble.key = '';
      setText(E['obj-kicker'], view.kicker); setText(E['obj-title'], view.title); setText(E['obj-text'], view.text);
      setText(E['obj-why'], view.why); show(E['obj-why'], !!view.why);
      show(E['obj-prog-row'], view.goal > 1 || view.deadline >= 0);
      show(E['obj-progress'], view.goal > 1); if (view.goal > 1) { const w = Math.round(clamp(view.progress / view.goal, 0, 1) * 100) + '%'; if (E['obj-fill'].style.width !== w) E['obj-fill'].style.width = w; }
      setText(E['obj-count'], view.goal > 1 ? Math.round(view.progress) + ' / ' + view.goal : (view.deadline >= 0 ? 'by ' + BSU.formatDate(view.deadline) : ''));
      const tRow = view.target ? rowOf(view.target) : null; const selected = !!(s.ui.tool && tRow && s.ui.tool.id === view.target);
      show(E['btn-obj-build'], !!tRow && !sp); if (tRow) { setText(E['btn-obj-build'], selected ? 'Placing ' + tRow.name + '…' : 'Build it: ' + tRow.name); E['btn-obj-build'].dataset.id = view.target; E['btn-obj-build'].title = (tRow.blurb || '') + ' ' + money(tRow.cost); }
      show(E['btn-showme'], view.showme && !sp); show(E['btn-obj-dismiss'], view.dismiss && !sp);
      show(E['btn-postcard-obj'], view.postcard);
      E['obj-title'].title = view.capped ? 'Pilings lift a building 3 ft above the flood line' : '';
      setText(E['obj-next'], view.next); show(E['obj-next'], !!view.next);
      show(E['obj-background'], false);
      E['objective-card'].dataset.kind = view.kind;
      show(E['objective-card'], true);
      call('render', 'drawPortrait', E['obj-portrait'], 0);
    }
    // needs strip once the Essentials tab exists (tutorial stage 4+); hidden while collapsed
    const needsOn = stage >= 4 && !sp;
    show(E['needs-strip'], needsOn); if (needsOn) refreshNeeds(s);
    // speech bubble: idle 8 s → the last ticker line for 6 s (not while collapsed)
    const bubOn = !E['speech-bubble'].classList.contains('hidden');
    if (sp || coach.step >= 0) { if (bubOn) { show(E['speech-bubble'], false); bubble.since = clock; } return; }
    if (!bubOn && clock - bubble.since >= L.bubbleIdleMs && s.ticker && s.ticker.length) {
      const line = s.ticker[s.ticker.length - 1]; const bk = line.text + '|' + line.tick;
      if (bk !== bubble.key) { bubble.key = bk; bubble.until = clock + L.bubbleMs; setText(E['speech-bubble'], line.text); show(E['speech-bubble'], true); call('render', 'drawPortrait', E['obj-portrait'], 1); }
      else bubble.since = clock;
    } else if (bubOn && clock > bubble.until) { show(E['speech-bubble'], false); bubble.since = clock; call('render', 'drawPortrait', E['obj-portrait'], 0); }
  }

  // ---------------------------------------------------------------------------
  // Ticker (60 px/s), ticker log
  // ---------------------------------------------------------------------------
  /** re-read state.ticker (progress pushes) */
  M.ticker = function (state) { tk.lastLen = -1; if (tk.logOpen) rebuildLog(state || stateOf()); };
  function nextTickerLine(s) {
    const lines = s.ticker || []; if (!lines.length) return null;
    if (tk.seen < lines.length) { const l = lines[tk.seen]; tk.seen++; return l; }
    const recent = lines.slice(Math.max(0, lines.length - 5)); const l = recent[tk.cycle % recent.length]; tk.cycle = (tk.cycle || 0) + 1; return l;
  }
  function updateTicker(s, dtMs) {
    const lines = s.ticker || [];
    if (tk.lastLen !== lines.length) { tk.lastLen = lines.length; if (tk.seen > lines.length) tk.seen = Math.max(0, lines.length - 1); if (lines.length && lines.length - tk.seen > 3) tk.seen = lines.length - 3; }
    const vw = fin(E.ticker.clientWidth, fin(window.innerWidth, 1280)) || 1280;
    if (!tk.line) { tk.line = nextTickerLine(s); if (!tk.line) { setText(E['ticker-track'], ''); return; } setText(E['ticker-track'], tk.line.text || ''); E['ticker-track'].dataset.kind = tk.line.kind || 'info'; tk.x = vw; tk.w = fin(E['ticker-track'].offsetWidth, 0) || (String(tk.line.text || '').length * 7); }
    tk.x -= L.tickerPxPerSec * dtMs / 1000;
    if (tk.x < -tk.w - 40) { tk.line = null; return; }
    const tr = 'translateX(' + Math.round(tk.x) + 'px)'; if (E['ticker-track'].style.transform !== tr) E['ticker-track'].style.transform = tr;
  }
  function rebuildLog(s) {
    if (!dom() || !s) return; const lg = E['ticker-log']; clear(lg);
    const lines = (s.ticker || []).slice(-L.logMax).reverse();
    if (!lines.length) lg.appendChild(el('div', 'log-line muted', 'Nothing yet.'));
    for (const l of lines) { const d = el('div', 'log-line'); d.dataset.kind = l.kind || 'info'; d.appendChild(el('span', 'log-day', BSU.formatDate(fin(l.day, 0)))); d.appendChild(el('span', 'log-text', l.text || '')); if (Number.isFinite(l.subject) && l.subject >= 0) d.addEventListener('click', function () { const p = tileOf(l.subject); call('render', 'panToTile', p.tx, p.ty); }); lg.appendChild(d); }
  }

  // ---------------------------------------------------------------------------
  // Set pieces, perf chip, uiQueue
  // ---------------------------------------------------------------------------
  function updateSetPiece(s) {
    const sp = s.setPiece; const hidePalette = !!sp || titleOn || !paletteKey.split('|')[0];
    if (hidePalette !== paletteHidden) { paletteHidden = hidePalette; show(E.palette, !hidePalette); cls(E.hud, 'no-palette', hidePalette); if (hidePalette) hideTooltip(); }   // a palette-item tooltip must not outlive the palette
    cls(E.hud, 'setpiece', !!sp); cls(E['objective-card'], 'collapsed', !!sp);
    if (sp && bm.open) M.closeBuildMenu();
    const skip = !!(sp && sp.skippable && fin(sp.tick, 0) >= L.skipAfterTick);
    if (skip !== skipShown) { skipShown = skip; show(E['btn-skip'], skip); }
    if (sp && s.ui.tool && !toolLocked) M.selectTool(s, null);
  }
  function updatePerf(s) {
    show(E['perfmode-chip'], !!s.ui.perfMode);
    if (!M.debug.perfHud) { if (!E['perf-chip'].classList.contains('hidden')) show(E['perf-chip'], false); return; }
    if (clock - perfAt < L.refreshMs) return; perfAt = clock;
    const pf = call('render', 'perf') || {}; setText(E['perf-chip'], fin(pf.frameMs, 0).toFixed(1) + ' ms · ' + fin(pf.drawCalls, 0) + ' draws · ' + fin(pf.agentsDrawn, 0) + ' agents · ' + fin(pf.hydroActive, 0) + ' wet · ' + fin(pf.memMB, 0) + ' MB · err ' + (BSU.errors ? BSU.errors.size : 0)); show(E['perf-chip'], true);
  }
  function drainQueue(s) {
    const q = s.progress && s.progress.uiQueue; if (!Array.isArray(q) || !q.length) return;
    const items = q.slice(); q.length = 0; const tick = tickOf(s);
    for (const e of items) {
      const a = Array.isArray(e.args) ? e.args : [];
      try {
        switch (e.kind) {
          case 'card': M.card(s, a[0], a[1]); break;
          case 'notify': if (tick - fin(e.tick, tick) <= 600 && a[0]) M.notify(s, a[0]); break;
          case 'hint': M.hint(s, a[0], a[1], a[2]); break;
          case 'introduceTab': M.introduceTab(s, a[0]); break;
          case 'selectTool': M.selectTool(s, a[0]); break;
          case 'lockTool': M.lockTool(s, a[0]); break;
          case 'closeCard': M.closeCard(a[0]); break;
          default: break;
        }
      } catch (err) { uerr('uiQueue:' + e.kind, err); }
    }
  }
  function updateGhostCosmetics() { if (shakeUntil && clock > shakeUntil) { shakeUntil = 0; cls(E['ghost-label'], 'shake', false); } }

  // ---------------------------------------------------------------------------
  // update / reset
  // ---------------------------------------------------------------------------
  function sec(name, fn, s, dt) { try { fn(s, dt); } catch (e) { uerr('update:' + name, e); } }
  /** per frame: diff the HUD against state (each section in try/catch; ≤ 1 ms) */
  M.update = function (state, dtMs) {
    if (!inited || !state || !state.ui) return;
    root = state; dtMs = fin(dtMs, 16.67); clock += dtMs;
    if (dom()) { try { const raw = M.settings().uiScale; const want = wantScale(raw); if (want !== appliedScale || (isAuto(raw) ? 'auto' : want) !== uiMode) applyScale(raw); if (clock - fitAt > 1000) { fitAt = clock; const tb = E.topbar; if (tb && fitLevel < 6 && tb.scrollWidth > tb.clientWidth + 1) fitTopbar(); } } catch (e) { /* stub */ } }
    if (titleOn) { sec('title', function (s) { refreshMuteButtons(); if (s.ui.panel) updatePanels(s); }, state, dtMs); return; }
    sec('queue', drainQueue, state, dtMs);
    sec('pan', heldPan, state, dtMs);
    sec('topbar', updateTopbar, state, dtMs);
    sec('hud', updateHud, state, dtMs);   // hud + zoom pass: mode + pills
    sec('scorebug', function (s) { if (typeof M.scoreBug === 'function') M.scoreBug(s); }, state, dtMs);   // ui_panels' live score bug (hidden when no game)
    sec('alert', updateAlert, state, dtMs);
    sec('objective', updateObjective, state, dtMs);
    sec('notifs', updateNotifs, state, dtMs);
    sec('toast', updateToast, state, dtMs);
    sec('cards', updateCards, state, dtMs);
    sec('inspect', function (s) { if (insp && (inspDirty || clock - inspAt >= L.refreshMs)) refreshInspect(s); }, state, dtMs);
    sec('ticker', updateTicker, state, dtMs);
    sec('palette', function (s) { if (paletteDirty) M.refreshPalette(s); else refreshPips(s); }, state, dtMs);
    sec('buildmenu', updateBuildMenu, state, dtMs);
    sec('coach', updateCoach, state, dtMs);
    sec('hint', updateHint, state, dtMs);
    sec('setpiece', updateSetPiece, state, dtMs);
    sec('panels', updatePanels, state, dtMs);
    sec('tooltip', updateTooltip, state, dtMs);
    sec('ghost', updateGhostCosmetics, state, dtMs);
    sec('undochip', updateUndoChip, state, dtMs);
    sec('perf', updatePerf, state, dtMs);
    sec('issues', updateIssues, state, dtMs);
    sec('legend', function (s) { const ov = fin(s.ui.overlay, 0); const list = (BSU.data && BSU.data.overlays) || []; for (const o of list) cls(E.ovBtns[o.ov], 'active', o.ov === ov); const o = list.find(function (x) { return x.ov === ov; }); show(E.legend, !!o); if (o) setText(E.legend, o.name + ' · ' + o.legend.join(' → ')); }, state, dtMs);
  };
  /** every newGame (fresh) and load: close everything, tool null, palette refresh from the new root */
  M.reset = function (state, fresh) {
    try {
      root = state || null; void fresh;
      toolLocked = false; live.down = null; live.run = []; live.runTile = -1; mcSet(live, 'IDLE');
      if (state && state.ui) { state.ui.tool = null; state.ui.panel = null; }
      card = null; cardQueue.length = 0; toast = null; toastQueue.length = 0; for (const k in gameDecs) delete gameDecs[k]; insp = null; renaming = null; focusedInput = null; hint = null; manualAlert = null; itemHover = null; hoverKey = '';
      for (let k = notifs.length - 1; k >= 0; k--) { notifs[k].closed = true; } notifs.length = 0;
      odo.cash = NaN; odo.students = NaN; odo.lastStudents = NaN; odo.holdUntil = -1; odo.deltaUntil = 0;
      tk = { x: 0, line: null, seen: Math.max(0, ((state && state.ticker) || []).length - 1), w: 0, lastLen: -1, logOpen: false, cycle: 0 };
      alertClosedKey = ''; tray.suggestOpen = false; tray.sopen = {};
      bubble = { since: clock, until: 0, key: '' }; objKey = ''; alertKey = ''; alertAt = -1e9; msAt = -1e9; speedKey = ''; paletteKey = ''; palShownTab = ''; pipKey = ''; paletteDirty = true; capacityShown = false; skipShown = false; paletteHidden = null; hudFade = false;   // null: the first updateSetPiece re-syncs #palette and #hud.no-palette (a stale no-palette from the title / tutorial left a 0-height palette after newGame/load)
      M.debug.open = false; M.hoverTile = -1; lastGhost = null;
      tray.key = ''; tray.rows = []; tray.hadIssues = false; tray.clearAt = -1e9; heldI = false; spotToggled = false; try { if (BSU.issues) { BSU.issues.select(null); BSU.issues.spotlight(false); BSU.issues.pulse(null); } } catch (e) { /* */ }
      bm.open = false; bm.hover = null; bm.selected = null; bm.pulseId = null; bm.key = ''; bm.detailKey = ''; bm.dirty = true; needsCache = null; needsAt = -1e9; needsKey = ''; coach.step = -1; coach.armedAt = 0; coach.paused = false;
      for (const k in held) held[k] = false;
      if (dom()) {
        show(E.cards, false); clear(E.cards); show(E['decision-toast'], false); show(E.inspect, false); cls(E.hud, 'inspect-open', false); show(E['ghost-label'], false); show(E.tooltip, false); show(E.popover, false); show(E.hint, false); show(E['voice-card'], false); show(E['alert-strip'], false); show(E['ticker-log'], false); show(E['btn-skip'], false); show(E.palette, true); show(E['build-menu'], false); cls(E.hud, 'bm-open', false); show(E.coach, false); cls(E['objective-card'], 'collapsed', false);
        clear(E.notifications); show(E['notif-dismiss'], false); setText(E['ticker-track'], ''); E['ticker-track'].style.transform = 'translateX(0px)';
        for (const name in panels) { const p = panels[name]; if (p.el) show(p.el, false); }
        if (E.hud) E.hud.dataset.panel = '';
        call('render', 'ghost', null);
        if (state && state.ui) { M.refreshPalette(state); markToolDom(state); refreshMuteButtons(); }
      }
    } catch (e) { uerr('reset', e); }
  };

  // ---------------------------------------------------------------------------
  // selfTest (ARCHITECTURE §10.6): pure over a private state; emits through a recorder; no DOM writes (dry mode)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const A = BSU.assert; const notes = [];
    const saved = { root: root, dry: dry, toast: toast, toastQ: toastQueue.slice(), card: card, cardQ: cardQueue.slice(), focused: focusedInput, emit: M._deps.emit, debugOpen: M.debug.open, locked: toolLocked, live: { state: live.state, down: live.down, run: live.run, prev: live.prev } };
    const rec = [];
    try {
      dry = true; M._deps.emit = function (name, p) { rec.push({ name: name, p: p }); };
      const s = BSU.newState(1234); s.ui.tabsIntroduced = { essentials: true, paths: true, housing: true }; root = s;
      // 1. key table
      const keys = BSU.data.keys; const seen = new Set();
      for (const k of keys) { const id = keyId(k.key, !!k.ctrl, !!k.shift); A(!seen.has(id), 'duplicate key binding ' + id); seen.add(id); }
      const need = [' ', '1', '2', '3', 'b', 'n', 't', 'l', 'f', 'w', 'k', 'p', 'c', 'e', '-', '=', 'Tab', 'x', 'r', 'h', '.', 'Escape', 'm', 'y', '`'];
      for (const k of need) A(seen.has(keyId(k, false, false)), 'key missing: ' + k);
      A(seen.has(keyId('s', true, false)) && seen.has(keyId('z', true, false)) && seen.has(keyId('p', true, false)), 'ctrl S/Z/P present');
      A(!seen.has(keyId('q', false, false)), 'q is unbound');
      A(seen.has(keyId('g', false, false)) && keymap().get(keyId('g', false, false)) === 'buildMenu', 'G opens the build menu');
      // UX pass helpers (pure over the private state)
      s.economy.students = 500; const nd = needsOf(s); A(nd.terms.length === 5 && nd.binding && nd.binding.build === 'dorm' && /Beds full/.test(nd.binding.text), 'needs: 500 students, no beds → Beds full → dorm (' + (nd.binding && nd.binding.text) + ')');
      const rc = recommend(s); A(rc.dorm === 'Needed', 'recommend marks the binding fix (' + JSON.stringify(rc) + ')');
      A(effectLines(rowOf('dorm')).some(function (l) { return /300 beds/.test(l); }) && effectLines(rowOf('substation')).some(function (l) { return /40 buildings/.test(l); }), 'effectLines read the effects');
      A(objTarget(s, { id: '3' }) === 'dorm' && objTarget(s, { id: '5' }) === 'substation' && objTarget(s, { id: '13' }) === null, 'objTarget picks the first unbuilt unlocked goal building');
      s.economy.students = 0;
      for (const k of keys) if (['1', '2', '3'].indexOf(k.key) >= 0 && !k.shift) A(/^speed/.test(k.action), 'digit ' + k.key + ' maps to a speed');
      // 2. machine transitions on synthetic events
      let placed = 0, runs = []; let tool = null, inspOpen = false;
      const m = M._machine({ getTool: function () { return tool; }, setTool: function (t) { tool = t; }, inspecting: function () { return inspOpen; }, inspectAt: function () { inspOpen = true; return true; }, closeInspect: function () { inspOpen = false; }, place: function () { placed++; return true; }, placeRun: function (r) { runs.push(r.slice()); } });
      A(m.state === 'IDLE', 'starts IDLE');
      m.step({ type: 'down', px: 100, py: 100, button: 0, mods: M0 }); A(m.state === 'IDLE' && m.mc.down, 'down → armed');
      m.step({ type: 'move', px: 102, py: 102, button: 0, mods: M0 }); A(m.state === 'IDLE', 'move 3 px stays armed');
      m.step({ type: 'move', px: 106, py: 104, button: 0, mods: M0 }); A(m.state === 'PANNING', 'move > 4 px → PANNING');
      m.step({ type: 'up', px: 106, py: 104, button: 0, mods: M0 }); A(m.state === 'IDLE', 'PANNING + up → IDLE');
      m.step({ type: 'down', px: 100, py: 100, button: 0, mods: M0 }); m.step({ type: 'up', px: 101, py: 100, button: 0, mods: M0 }); A(m.state === 'INSPECTING' && inspOpen, 'click → INSPECTING');
      A(m.step({ type: 'key', key: 'Escape' }) === true && m.state === 'IDLE' && !inspOpen, 'INSPECTING + Esc → IDLE');
      m.step({ type: 'tool', id: 'dorm' }); A(m.state === 'PLACING' && tool && tool.id === 'dorm', 'selectTool(dorm) → PLACING');
      A(m.step({ type: 'key', key: 'r' }) === true && tool.rot === 1, 'r rotates a rotatable row');
      m.step({ type: 'key', key: 'Escape' }); A(m.state === 'IDLE' && tool === null, 'PLACING + Esc → IDLE');
      m.step({ type: 'tool', id: 'dorm' }); m.step({ type: 'down', px: 100, py: 100, button: 0, mods: M0 }); m.step({ type: 'up', px: 100, py: 100, button: 0, mods: M0 }); A(placed === 1 && m.state === 'IDLE', 'footprint click places and returns to IDLE');
      m.step({ type: 'tool', id: 'dorm' }); m.step({ type: 'down', px: 100, py: 100, button: 2, mods: M0 }); m.step({ type: 'up', px: 101, py: 101, button: 2, mods: M0 }); A(m.state === 'IDLE' && tool === null, 'right-click ≤ 4 px cancels the tool');
      m.step({ type: 'tool', id: 'path' }); m.step({ type: 'down', px: 200, py: 110, button: 0, mods: M0 }); A(m.state === 'DRAGGING' && m.run.length === 1, 'drag row + down → DRAGGING');
      m.step({ type: 'move', px: 280, py: 132, button: 0, mods: M0 });
      const r1 = m.run.slice(); A(r1.length > 2, 'run grows');
      for (let k = 1; k < r1.length; k++) { const d = Math.abs(r1[k] - r1[k - 1]); A(d === 1 || d === W, 'run is 4-connected (step ' + k + ')'); }
      m.step({ type: 'up', px: 280, py: 132, button: 0, mods: M0 }); A(m.state === 'PLACING' && runs.length === 1 && runs[0].length === r1.length && tool && tool.id === 'path', 'DRAGGING + up → placeRun, PLACING, tool kept');
      // 3. straight line with Shift from (10,10) to (14,12) → all on ty 10
      const ln = lineRun(10 * W + 10, 12 * W + 14); A(ln.length === 5 && ln.every(function (i) { return ((i / W) | 0) === 10; }), 'Shift line keeps ty 10 (larger delta axis x)');
      // 4. Esc layer order via the live keydown in dry mode: tool → inspect → panel → card (the live game's queued cards are restored at the end)
      cardQueue.length = 0; s.ui.tool = { id: 'dorm', rot: 0, shift: false }; mcSet(live, 'PLACING'); insp = { kind: 'tile', i: 5 }; s.ui.panel = 'settings'; card = { spec: { id: 'x', title: 't', body: 'b', actions: [] }, born: 0, bornTick: 0 };
      A(M.keydown('Escape', M0) === true && s.ui.tool === null && insp !== null && s.ui.panel === 'settings', 'Esc #1 cancels the tool');
      A(M.keydown('Escape', M0) === true && insp === null && s.ui.panel === 'settings' && card, 'Esc #2 closes inspect');
      A(M.keydown('Escape', M0) === true && s.ui.panel === null && card, 'Esc #3 closes the panel');
      A(M.keydown('Escape', M0) === true && card === null, 'Esc #4 closes the card');
      // 5. decision toast
      let answered = 0; toast = null; toastQueue.length = 0; rec.length = 0;
      M.decision(s, { id: 't', text: 'x', ticks: 80, onAnswer: function () { answered++; } });
      A(rec.some(function (e) { return e.name === 'decision:open' && e.p.id === 't'; }), 'decision:open emitted');
      M.answerDecision('t', 'yes'); M.answerDecision('t', 'no');
      const closed = rec.filter(function (e) { return e.name === 'decision:closed'; });
      A(closed.length === 1 && closed[0].p.id === 't' && closed[0].p.answer === 'yes' && answered === 1, 'exactly one decision:closed{yes}; onAnswer once');
      rec.length = 0; M.decision(s, { id: 'u', ticks: 80 }); s.tick += 80; updateToast(s);
      A(rec.some(function (e) { return e.name === 'decision:closed' && e.p.id === 'u' && e.p.answer === 'default'; }) && toast === null, 'timeout resolves default');
      // 6. precedence
      M.decision(s, { id: 'v', ticks: 80 }); A(M.keydown('y', M0) === true && toast === null, 'toast captures y');
      focusedInput = {}; A(M.keydown('b', M0) === false, 'focused input: b not handled'); focusedInput = null;
      let prim = 0; card = { spec: { id: 'c', title: 't', body: 'b', actions: [{ label: 'ok', primary: true, fn: function () { prim++; } }] }, born: 0, bornTick: 0 };
      A(M.keydown('Enter', M0) === true && prim === 1 && card === null, 'card: Enter fires the primary action');
      // 7. formatMoney
      A(money(4120000) === '$4.12M' && money(340000) === '$340k' && money(-1400000) === '−$1.4M', 'formatMoney samples');
      // 8. palette visibility rule
      A(tabVisible('housing', true, 0) === false && tabVisible('housing', true, 2) === true && tabVisible('essentials', true, 0) === true && tabVisible('paths', false, 3) === false, 'tab visibility rule');
      // 9. skeleton through M.el
      if (inited) {
        const ids = ['hud', 'topbar', 'brand', 'stat-cash', 'stat-students', 'chip-capacity', 'stat-prestige', 'stat-happiness', 'stat-ecology', 'stat-date', 'sky-glyph', 'chip-weather', 'speed', 'btn-budget', 'btn-season', 'btn-storm', 'btn-almanac', 'btn-menu', 'btn-mute', 'chip-endowed', 'alert-strip', 'alert-icon', 'alert-text', 'alert-action', 'alert-gator', 'minimap-wrap', 'minimap', 'minimap-viewport', 'overlay-buttons', 'legend', 'objective-card', 'obj-portrait', 'obj-title', 'obj-text', 'obj-progress', 'obj-count', 'btn-showme', 'btn-obj-dismiss', 'obj-background', 'speech-bubble', 'voice-card', 'milestones-card', 'notifications', 'decision-toast', 'dt-text', 'dt-countdown', 'btn-dt-yes', 'btn-dt-no', 'inspect', 'insp-title', 'insp-sub', 'btn-insp-close', 'insp-sprite', 'insp-body', 'insp-actions', 'ghost-label', 'undo-chip', 'tooltip', 'popover', 'pop-title', 'pop-next', 'ticker', 'ticker-track', 'btn-ticker-log', 'ticker-log', 'palette', 'palette-tabs', 'palette-items', 'btn-bulldoze', 'btn-palette-info', 'cards', 'perf-chip', 'perfmode-chip', 'hint', 'panels', 'title', 'title-name', 'title-tag', 'btn-charter', 'btn-continue', 'title-seed', 'btn-title-settings', 'btn-title-mute', 'title-campus'];
        for (const id of ids) A(isEl(E[id]) && E[id].id === id, 'skeleton id through M.el: ' + id);
        A(E.msRows.length === 3 && E.popLines.length === L.popLines && Object.keys(E.speedBtns).length === 5 && Object.keys(E.ovBtns).length === 6, 'ms-rows, pop-lines, speed and overlay buttons exist');
      } else notes.push('skeleton check skipped (init not run)');
      // 10. cards
      let threw = false; card = null; cardQueue.length = 0;
      try { M.card(s, 'nope'); } catch (e) { threw = true; }
      A(threw && card === null, 'unknown card id → one BSU.error, nothing opens');
      M.card(s, { id: 'x', title: 't', body: 'b', actions: [] }); A(card && card.spec.id === 'x' && cardQueue.length === 0, 'spec card opens');
      M.card(s, { id: 'y', title: 't', body: 'b', actions: [] }); A(cardQueue.length === 1, 'second card queues'); M.closeCard(); A(card && card.spec.id === 'y', 'queue advances'); M.closeCard(); A(card === null, 'queue empties');
      // 11. Backquote variants toggle debug
      const d0 = M.debug.open; s.ui.panel = null;
      A(M.keydown('`', M0) === true && M.debug.open === !d0, 'backquote key toggles debug');
      A(M.keydown('Dead', { ctrl: false, shift: false, meta: false, alt: false, code: 'Backquote' }) === true && M.debug.open === d0, 'Dead + code Backquote toggles back');
      A(M.keydown('Backquote', { ctrl: false, shift: false, meta: false, alt: false, code: 'Backquote' }) === true && M.debug.open === !d0, 'Backquote name toggles');
      M.debug.open = d0;
      // 12. issue spotlight pass: I / Shift+I / Esc and the Fix action on a synthetic unpowered dorm
      if (BSU.issues) {
        const I = BSU.issues; I.reset(); s.economy.suppressCoverage = false; s.buildings = []; const dr = rowOf('dorm');
        s.buildings[0] = { id: 0, type: 'dorm', tx: 20, ty: 20, w: dr ? dr.w : 3, h: dr ? dr.h : 2, rot: 0, name: 'Test Hall', hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: false, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false };
        s.plot = s.plot || {}; s.plot.founders = { tx: 20, ty: 26 }; for (let y = 22; y < 26; y++) s.tiles.surface[BSU.idx(20, y)] = BSU.SURF.PATH;
        I.invalidate(); const li = I.list(s); A(li.length >= 1 && li[0].kind === 'unpowered', 'synthetic dorm → unpowered issue');
        A(M.keydown('i', M0) === true && I.selectedId() === li[0].id && heldI === true && I.spotlight() === true, 'I selects the first issue and spotlights while held');
        keyup('i'); A(heldI === false && I.spotlight() === false, 'releasing I restores the map');
        A(M.keydown('i', { ctrl: false, shift: false, meta: false, alt: false, repeat: true }) === true && I.selectedId() === li[0].id, 'key repeat does not cycle'); keyup('i');
        A(M.keydown('I', { ctrl: false, shift: true, meta: false, alt: false }) === true && I.spotlight() === true && spotToggled, 'Shift+I toggles spotlight on');
        s.ui.tool = null; s.ui.panel = null; A(M.keydown('Escape', M0) === true && I.spotlight() === false && I.selectedId() === null, 'Esc clears the selection and the spotlight');
        A(locateKindsOf({ text: 'Tiger Hall is flooded' })[0] === 'flooded' && locateKindsOf({ text: 'A gator is on the quad' }) === null && locateKindsOf({ locate: 'power' }).length === 3 && locateKindsOf({ text: 'Saved' }) === null, 'locate kinds from a notification (gators are not issues)');
        const r = fixIssue(s, li[0]); A(r && r.ok !== false && (bm.open === true || (s.ui.tool && s.ui.tool.id === 'substation')) && I.selectedId() === li[0].id, 'Fix arms the Substation (palette card, or the build menu when no spot is in reach)'); M.closeBuildMenu(); M.selectTool(s, null);
        s.buildings = []; I.invalidate(); A(I.list(s).length === 0 && I.selectedId() === null, 'issue gone → selection gone'); I.reset();
      }
      for (const t of M._tests) { try { t(s, A); } catch (e) { throw e; } }
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: (e && e.message) || String(e) };
    } finally {
      root = saved.root; dry = saved.dry; toast = saved.toast; toastQueue.length = 0; saved.toastQ.forEach(function (x) { toastQueue.push(x); }); card = saved.card; cardQueue.length = 0; saved.cardQ.forEach(function (x) { cardQueue.push(x); });
      focusedInput = saved.focused; M._deps.emit = saved.emit; M.debug.open = saved.debugOpen; toolLocked = saved.locked; insp = null;
      live.state = saved.live.state; live.down = saved.live.down; live.run = saved.live.run; live.prev = saved.live.prev; M.state = live.state;
    }
  };
})();
