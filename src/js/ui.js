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
//   │  ├─ #minimap-wrap  canvas#minimap(160×160) #minimap-viewport
//   │  ├─ #overlay-buttons  .ov-btn[data-ov=1..6] · #legend.chip
//   │  ├─ #objective-card  canvas#obj-portrait #obj-title #obj-text #obj-progress(.fill) #obj-count #btn-showme #btn-obj-dismiss #obj-background #speech-bubble
//   │  ├─ #voice-card.hidden  #voice-text #voice-payoff #btn-voice-accept #btn-voice-decline
//   │  ├─ #milestones-card.hidden  .ms-row×3
//   │  ├─ #notifications  .notif[data-kind]
//   │  ├─ #decision-toast.hidden  #dt-text #dt-countdown.bar #btn-dt-yes #btn-dt-no
//   │  ├─ #inspect.panel.side.hidden  #insp-title #insp-sub #btn-insp-close canvas#insp-sprite #insp-body #insp-actions
//   │  ├─ #ghost-label.hidden · #tooltip.hidden · #popover.hidden(#pop-title .pop-line×4 #pop-next)
//   │  ├─ #ticker  #ticker-track · #btn-ticker-log · #ticker-log.hidden
//   │  ├─ #palette  #palette-tabs(.tab[data-tab] .pip) · #palette-items(.item[data-id]) · #btn-bulldoze · #btn-palette-info
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
//   DRAGGING + move                         → run grows 4-connected (x then y staircase)
//   DRAGGING + up                           → buildings.placeRun → PLACING (tool kept)
//   PLACING/DRAGGING + Esc/right-click      → IDLE;  R → rotate in place
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
    deltaMs: 600, odoMs: 150, holdTicks: 600, logMax: fin(PU.tickerMax, 30), popLines: 4, minimapPx: fin(PR.minimapPx, 160),
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
  let toolLocked = false, undoAtMs = -1e9, lastGhost = null, lastRingMs = -1e9, shakeUntil = 0, ghostCache = null;
  let hoverKey = '', hoverSince = 0, hoverPx = 0, hoverPy = 0, tipShown = '', lastPx = 0, lastPy = 0;
  const notifs = [];                       // {spec, el, born, bornTick, closed}
  let toast = null; const toastQueue = [];
  let card = null; const cardQueue = [];
  let insp = null, inspAt = -1e9, inspDirty = false, renaming = null;
  let tk = { x: 0, line: null, seen: 0, w: 0, lastLen: 0, logOpen: false };
  const odo = { cash: NaN, students: NaN, shownStudents: NaN, holdUntil: -1, lastStudents: NaN, deltaUntil: 0 };
  const held = { up: false, down: false, left: false, right: false };
  let hint = null;                         // {until, untilTick}
  let bubble = { since: 0, until: 0, key: '' };
  let manualAlert = null, alertAt = -1e9, alertKey = '';
  let paletteDirty = true, paletteKey = '', paletteTab = '', pipKey = '', hudFade = false, hudFadeAt = 0, capacityShown = false;
  let objKey = '', msAt = -1e9, panelAt = -1e9, perfAt = -1e9, speedKey = '', skipShown = false, paletteHidden = false, errCount = 0;
  let pendingPlaceSound = 0;

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
    const b = btn(id, null, 'tb', onClick); b.title = title;
    const g = el('span', 'glyph', glyph), l = el('span', 'label', label); b.appendChild(g); b.appendChild(l); E[id] = b; E[id + '-glyph'] = g; return b;
  }
  function buildTopbar() {
    const tb = el('div'); tb.id = 'topbar'; E.topbar = tb;
    const brand = el('div', null, '▣ BAYOU STATE'); brand.id = 'brand'; E.brand = brand; tb.appendChild(brand);
    const stats = el('div', 'stats'); E.stats = stats; tb.appendChild(stats);
    stats.appendChild(statEl('stat-cash', 'Cash', 'cash'));
    const st = statEl('stat-students', 'Students', 'students'); const cap = el('span', 'chip hidden', ''); cap.id = 'chip-capacity'; E['chip-capacity'] = cap; st.appendChild(cap); stats.appendChild(st);
    stats.appendChild(statEl('stat-prestige', 'Prestige', 'prestige'));
    stats.appendChild(statEl('stat-happiness', 'Happiness', 'happiness'));
    stats.appendChild(statEl('stat-ecology', 'Ecology', 'ecology'));
    const date = el('div'); date.id = 'stat-date'; const dateText = el('span', 'date-text', ''); const glyph = el('span', null, '☀'); glyph.id = 'sky-glyph'; date.appendChild(dateText); date.appendChild(glyph); E['stat-date'] = date; E['stat-date-text'] = dateText; E['sky-glyph'] = glyph; tb.appendChild(date);
    const wx = el('div', 'chip', ''); wx.id = 'chip-weather'; E['chip-weather'] = wx; tb.appendChild(wx);
    const sp = el('div'); sp.id = 'speed'; E.speed = sp; E.speedBtns = {};
    [[0, '⏸', 'Pause (Space)'], [1, '1×', 'Normal speed (1)'], [2, '2×', 'Double speed (2)'], [4, '4×', 'Fast (3)']].forEach(function (d) {
      const b = btn(null, d[1], 'speed-btn', function () { M.setSpeed(stateOf(), d[0]); }); b.dataset.speed = String(d[0]); b.title = d[2]; b.setAttribute('aria-pressed', 'false'); sp.appendChild(b); E.speedBtns[d[0]] = b;
    });
    tb.appendChild(sp);
    const pb = el('div', 'panel-btns'); E.panelBtns = pb; tb.appendChild(pb);
    pb.appendChild(topbarButton('btn-budget', '◆', 'Budget', 'Budget (B)', function () { M.openPanel('budget'); }));
    pb.appendChild(topbarButton('btn-season', '🏈', 'Season', 'Season (N)', function () { M.openPanel('season'); }));
    const storm = topbarButton('btn-storm', '🌀', 'Storm', 'Storm (T)', function () { M.openPanel('storm'); }); const dot = el('span', 'dot'); storm.appendChild(dot); E['btn-storm-dot'] = dot; storm.disabled = true; pb.appendChild(storm);
    pb.appendChild(topbarButton('btn-almanac', '📖', 'Almanac', 'Almanac (L)', function () { M.openPanel('almanac'); }));
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
    a.appendChild(ic); a.appendChild(tx); a.appendChild(act); a.appendChild(g);
    E['alert-strip'] = a; E['alert-icon'] = ic; E['alert-text'] = tx; E['alert-action'] = act; E['alert-gator'] = g; return a;
  }
  function buildMinimap() {
    const wrap = el('div'); wrap.id = 'minimap-wrap';
    const c = el('canvas'); c.id = 'minimap'; c.width = L.minimapPx; c.height = L.minimapPx; const vp = el('div'); vp.id = 'minimap-viewport';
    wrap.appendChild(c); wrap.appendChild(vp);
    let mdown = false;
    const go = function (ev) { const mx = fin(ev.offsetX, L.minimapPx / 2), my = fin(ev.offsetY, L.minimapPx / 2); call('render', 'panToTile', clamp(mx / (L.minimapPx / W), 0, W - 1), clamp(my / (L.minimapPx / HGT), 0, HGT - 1), false); const s = stateOf(); if (s && s.setPiece) call('render', 'captureCameraTouch', s); };
    c.addEventListener('pointerdown', function (ev) { mdown = true; go(ev); if (ev.preventDefault) ev.preventDefault(); });
    c.addEventListener('pointermove', function (ev) { if (mdown) go(ev); });
    c.addEventListener('pointerup', function () { mdown = false; }); c.addEventListener('pointerleave', function () { mdown = false; });
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
    const c = el('div', 'hidden'); c.id = 'objective-card';
    const head = el('div', 'obj-head'); const portrait = el('canvas'); portrait.id = 'obj-portrait'; portrait.width = 48; portrait.height = 48;
    const col = el('div', 'obj-col'); const title = el('div', null, ''); title.id = 'obj-title'; const text = el('div', null, ''); text.id = 'obj-text';
    const prog = el('div', 'bar'); prog.id = 'obj-progress'; const fill = el('div', 'fill'); prog.appendChild(fill); const count = el('span', null, ''); count.id = 'obj-count';
    const acts = el('div', 'obj-actions');
    const showme = btn('btn-showme', 'Show me', 'small', function () { objShowMe(); });
    const post = btn('btn-postcard-obj', 'Postcard', 'small hidden', function () { postcard(stateOf()); });
    const dis = btn('btn-obj-dismiss', '✕', 'icon', function () { const s = stateOf(); const o = s ? call('progress', 'objective', s) : null; if (o) call('progress', 'dismiss', s, o.id); });
    acts.appendChild(showme); acts.appendChild(post); acts.appendChild(count);
    col.appendChild(title); col.appendChild(text); col.appendChild(prog); col.appendChild(acts);
    head.appendChild(portrait); head.appendChild(col); head.appendChild(dis);
    const bg = el('div', 'row hidden', ''); bg.id = 'obj-background'; const bub = el('div', 'hidden', ''); bub.id = 'speech-bubble';
    c.appendChild(bub); c.appendChild(head); c.appendChild(bg);
    E['objective-card'] = c; E['obj-portrait'] = portrait; E['obj-title'] = title; E['obj-text'] = text; E['obj-progress'] = prog; E['obj-fill'] = fill; E['obj-count'] = count; E['btn-showme'] = showme; E['btn-postcard-obj'] = post; E['btn-obj-dismiss'] = dis; E['obj-background'] = bg; E['speech-bubble'] = bub;
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
    const acts = el('div', 'card-actions'); const y = btn('btn-dt-yes', 'Yes', 'primary', function () { if (toast) M.answerDecision(toast.id, 'yes'); }); const n = btn('btn-dt-no', 'No', '', function () { if (toast) M.answerDecision(toast.id, 'no'); });
    const ky = el('span', 'key', 'Y'), kn = el('span', 'key', 'N'); y.appendChild(ky); n.appendChild(kn); acts.appendChild(y); acts.appendChild(n);
    t.appendChild(tx); t.appendChild(bar); t.appendChild(acts);
    E['decision-toast'] = t; E['dt-text'] = tx; E['dt-countdown'] = bar; E['dt-fill'] = fill; E['btn-dt-yes'] = y; E['btn-dt-no'] = n; return t;
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
    const info = btn('btn-palette-info', '⋯', '', function () { cls(E.palette, 'compact', !E.palette.classList.contains('compact')); }); info.title = 'Compact palette';
    side.appendChild(bull); side.appendChild(info);
    p.appendChild(tabs); p.appendChild(items); p.appendChild(side);
    E.palette = p; E['palette-tabs'] = tabs; E['palette-items'] = items; E['btn-bulldoze'] = bull; E['btn-palette-info'] = info; E.tabEls = {}; E.itemEls = {}; return p;
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
    const campus = el('canvas', 'hidden'); campus.id = 'title-campus'; campus.width = 320; campus.height = 200;
    const foot = el('div', 'title-foot', 'Louisiana. One ridge. Mind the water.');
    box.appendChild(kicker); box.appendChild(name); box.appendChild(tag); box.appendChild(charter); box.appendChild(cont); box.appendChild(row); box.appendChild(campus); box.appendChild(foot);
    t.appendChild(box);
    E.title = t; E['title-name'] = name; E['title-tag'] = tag; E['btn-charter'] = charter; E['btn-continue'] = cont; E['title-seed'] = seed; E['btn-title-settings'] = ts; E['btn-title-mute'] = tm; E['title-campus'] = campus; return t;
  }
  function buildPanelsHost() { const p = el('div'); p.id = 'panels'; E.panels = p; return p; }
  function buildChips() {
    const perf = el('div', 'chip hidden', ''); perf.id = 'perf-chip'; const pm = el('div', 'chip hidden', 'Performance mode'); pm.id = 'perfmode-chip';
    const h = el('div', 'hidden'); h.id = 'hint'; const ht = el('span', null, ''); const ha = btn('btn-hint-action', '', 'small hidden', function () { if (hint && hint.action && typeof hint.action.fn === 'function') { hint.action.fn(stateOf()); } hideHint(); }); h.appendChild(ht); h.appendChild(ha);
    const skip = btn('btn-skip', 'Skip ▸', 'hidden', function () { const s = stateOf(); if (s && s.setPiece) call('session', 'skipSetPiece', s); });
    E['perf-chip'] = perf; E['perfmode-chip'] = pm; E.hint = h; E['hint-text'] = ht; E['btn-hint-action'] = ha; E['btn-skip'] = skip; return [perf, pm, h, skip];
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
    hud.appendChild(buildTopbar()); hud.appendChild(buildAlert()); hud.appendChild(buildMinimap()); hud.appendChild(buildOverlays());
    buildObjective().forEach(function (x) { hud.appendChild(x); });
    const notes = el('div'); notes.id = 'notifications'; E.notifications = notes; hud.appendChild(notes);
    hud.appendChild(buildToast()); hud.appendChild(buildInspect());
    buildLabels().forEach(function (x) { hud.appendChild(x); });
    hud.appendChild(buildPopover()); hud.appendChild(buildTicker()); hud.appendChild(buildPalette()); hud.appendChild(buildCards());
    buildChips().forEach(function (x) { hud.appendChild(x); });
    app.appendChild(hud); app.appendChild(buildPanelsHost()); app.appendChild(buildTitle());
    try { call('render', 'attachMinimap', E.minimap); } catch (e) { uerr('init:minimap', e); }
    attachInput(world);
    subscribe();
    registerBuiltins();
    try { const w = fin(window.innerWidth, 1280); cls(E.palette, 'compact', w < L.compactWidth); } catch (e) { /* stub */ }
  };

  // ---------------------------------------------------------------------------
  // DOM listeners → the machine (pointer / wheel / keys / gestures)
  // ---------------------------------------------------------------------------
  function modsOf(e) { return { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, meta: !!e.metaKey, alt: !!e.altKey, code: e.code }; }
  function attachInput(world) {
    const pt = function (type) { return function (e) { try { if (type === 'down' && typeof world.focus === 'function') world.focus(); M.pointer(type, fin(e.offsetX, 0), fin(e.offsetY, 0), fin(e.button, 0), modsOf(e)); if (type === 'down' && e.preventDefault) e.preventDefault(); } catch (err) { uerr('pointer:' + type, err); } }; };
    world.addEventListener('pointerdown', pt('down'));
    world.addEventListener('pointermove', pt('move'));
    world.addEventListener('pointerup', pt('up'));
    world.addEventListener('pointercancel', function () { M.pointer('cancel', lastPx, lastPy, 0, M0); });
    world.addEventListener('pointerleave', function () { hideTooltip(); if (live.down) M.pointer('cancel', lastPx, lastPy, 0, M0); });
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
        window.addEventListener('resize', function () { try { const w = fin(window.innerWidth, 1280); cls(E.palette, 'compact', w < L.compactWidth); } catch (err) { /* stub */ } });
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
    on('econ:stat', function (p) { if (p.stat === 'cash' && fin(p.delta, 0) !== 0) { flashDelta(p.delta); } });
    on('agent:arrive', function () { odo.holdUntil = -1; });
    on('unlock:changed', function (p) { paletteDirty = true; const s = stateOf(); if (!s) return; for (const id of (p.ids || [])) { const r = rowOf(id); if (r && r.tab && s.ui.tabsIntroduced[r.tab] && r.tab !== s.ui.paletteTab) s.ui.newPips[r.tab] = true; } });
    on('objective:offered', function () { objKey = ''; bubble.since = clock; });
    on('objective:complete', function (p) { objKey = ''; if (p.id === '1') { hudFade = true; hudFadeAt = clock; } });
    on('objective:dismissed', function () { objKey = ''; }); on('objective:progress', function () { objKey = ''; });
    on('ring:changed', function () { objKey = ''; });
    on('milestone:earned', function () { msAt = -1e9; paletteDirty = true; });   // progress posts the paw-stamped notify itself
    on('storm:toast', function (p) { const s = stateOf(); if (s) M.decision(s, { id: p.id, text: p.text, yes: p.yes, no: p.no, untilTick: p.untilTick, ticks: L.toastTicks }); });
    on('storm:named', function () { alertAt = -1e9; }); on('storm:watch', function () { alertAt = -1e9; }); on('storm:bands', function () { alertAt = -1e9; }); on('storm:landfall', function () { alertAt = -1e9; }); on('storm:passed', function () { alertAt = -1e9; });
    on('mosquito:warning', function (p) { alertAt = -1e9; const s = stateOf(); if (s && p && p.text) M.notify(s, { kind: 'wildlife', text: p.text }); });
    on('gator:campus', function () { alertAt = -1e9; });
    on('weather:heat', function () { alertAt = -1e9; });
    on('power:blackout', function () { alertAt = -1e9; }); on('power:restored', function () { alertAt = -1e9; });
    on('building:flooded', function () { alertAt = -1e9; }); on('building:dried', function () { alertAt = -1e9; });
    on('coverage:changed', function () { inspDirty = true; });
    on('building:placed', function () { paletteDirty = paletteDirty || false; inspDirty = true; });
    on('building:removed', function () { if (insp && insp.kind === 'building') { const s = stateOf(); if (s && !call('buildings', 'get', s, insp.id)) M.closeInspect(); } });
    on('ui:ticker', function () { tk.lastLen = -1; if (tk.logOpen) rebuildLog(stateOf()); });
    on('save:written', function (p) { const s = stateOf(); if (s && p && p.slot && String(p.slot).indexOf('auto') !== 0 && String(p.slot)[0] !== '_') M.notify(s, { kind: 'info', text: 'Saved', ttl: 3000 }); });
    on('save:loaded', function () { if (titleOn) M.showTitle(false); });
    on('speed:changed', function () { speedKey = ''; });
    on('setpiece:start', function () { const s = stateOf(); if (s && s.ui.tool && !toolLocked) M.selectTool(s, null); });
    on('setpiece:end', function () { skipShown = false; });
    on('error', function () { errCount++; });
    on('game:kickoff', function (p) { const s = stateOf(); if (s) M.notify(s, { kind: 'sports', text: 'Kickoff vs ' + (p.opp && p.opp.name ? p.opp.name : p.opp || 'the visitors') + (p.night ? ' under the lights' : ''), ttl: 8000 }); });
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
  function extendRun(mc, ev) {
    const j = mc.cb.tileAt(ev.px, ev.py); if (j < 0 || j === mc.runTile) return;
    if (ev.mods && ev.mods.shift) mc.run = lineRun(mc.runStart, j);
    else { const path = stairRun(mc.runTile < 0 ? mc.runStart : mc.runTile, j); for (const i of path) if (mc.run.indexOf(i) < 0) mc.run.push(i); }
    mc.runTile = j;
  }
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
        if (mc.state === 'DRAGGING') { const r = mc.run; mc.run = []; mc.runTile = -1; mcSet(mc, 'PLACING'); cb.placeRun(r); cb.ghost(ev.px, ev.py); return true; }
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
      case 'cancel': { mc.down = null; if (mc.state === 'DRAGGING') { mc.run = []; mc.runTile = -1; mcSet(mc, 'PLACING'); cb.ghost(null); } else if (mc.state === 'PANNING') mcSet(mc, mc.prev === 'PANNING' ? 'IDLE' : mc.prev); return true; }
      case 'key': {
        if (ev.key === 'Escape') {
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
    setTool: function (t) { const s = stateOf(); if (s && s.ui) { s.ui.tool = t; } markToolDom(s); try { emit('ui:tool', { tool: t ? t.id : null }); } catch (e) { uerr('emit:tool', e); } },
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
      if (titleOn) return;
      if (type === 'down') { if (call('progress', 'tutorialStage', s) === 1) call('progress', 'skipSwoop', s); if (s.setPiece) call('render', 'captureCameraTouch', s); show(E.popover, false); }
      if (type === 'move' || type === 'down') { const i = tileIndexAt(px, py); M.hoverTile = i; if (BSU.render) BSU.render.hoverTile = i; }
      mcStep(live, { type: type, px: px, py: py, button: fin(button, 0) | 0, mods: mods });
    } catch (e) { uerr('pointer:' + type, e); }
  };
  /** wheel: two-finger pan (no ctrl) / ctrl+wheel = zoom at the cursor */
  M.wheel = function (px, py, dx, dy, ctrl) {
    try {
      const s = stateOf(); if (titleOn || !s) return;
      if (ctrl) { if (Math.abs(dy) < 0.5) return; call('render', 'zoomStep', dy < 0 ? 1 : -1, { x: px, y: py }); return; }
      call('render', 'panBy', clamp(fin(dx, 0), -120, 120), clamp(fin(dy, 0), -120, 120), true);
      if (live.state === 'PLACING' || live.state === 'DRAGGING') updateGhost(s, px, py);
    } catch (e) { uerr('wheel', e); }
  };

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
  function keyup(key) { const d = panDirOf(key); if (d) held[d] = false; }
  /** keydown(key, mods) → true when handled (also headless.key) */
  M.keydown = function (key, mods) {
    try {
      mods = mods || M0; const s = stateOf(); if (!s || !s.ui) return false;
      const isBackquote = mods.code === 'Backquote' || key === '`';
      // (1) decision toast
      if (toast) {
        const tkeys = (BSU.data && BSU.data.toastKeys) || { yes: ['y', 'Enter'], no: ['n', 'Escape'] };
        if (tkeys.yes.indexOf(key) >= 0) { M.answerDecision(toast.id, 'yes'); return true; }
        if (tkeys.no.indexOf(key) >= 0) { M.answerDecision(toast.id, 'no'); return true; }
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
      // (4) the map
      if (isBackquote) { toggleDebug(s); return true; }
      if (key === 'Escape') {
        if (mcStep(live, { type: 'key', key: 'Escape', px: lastPx, py: lastPy })) return true;
        if (!E.popover.classList.contains('hidden')) { show(E.popover, false); return true; }
        if (s.ui.panel) { M.openPanel(null); return true; }
        if (card) { M.closeCard(); return true; }
        return false;
      }
      let k = key;
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
      case 'budget': M.openPanel(s.ui.panel === 'budget' ? null : 'budget'); return true;
      case 'season': M.openPanel(s.ui.panel === 'season' ? null : 'season'); return true;
      case 'storm': { if (!call('weather', 'cone', s)) return true; M.openPanel(s.ui.panel === 'storm' ? null : 'storm'); return true; }
      case 'milestones': M.openPanel(s.ui.panel === 'milestones' ? null : 'milestones'); return true;
      case 'overlayFlood': case 'overlayWater': case 'overlayMosquito': case 'overlayPower': case 'overlayCoverage': case 'overlayEcology': {
        const ov = { overlayFlood: OV.FLOOD, overlayWater: OV.WATER, overlayMosquito: OV.MOSQUITO, overlayPower: OV.POWER, overlayCoverage: OV.COVERAGE, overlayEcology: OV.ECOLOGY }[action];
        M.setOverlay(s, s.ui.overlay === ov ? OV.NONE : ov); return true;
      }
      case 'zoomOut': call('render', 'zoomStep', -1, null); return true;
      case 'zoomIn': call('render', 'zoomStep', 1, null); return true;
      case 'nextTab': cycleTab(s, 1); return true;
      case 'prevTab': cycleTab(s, -1); return true;
      case 'bulldoze': { const t = s.ui.tool; if (toolLocked) return true; M.selectTool(s, t && t.id === 'bulldoze' ? null : 'bulldoze'); return true; }
      case 'rotate': return mcStep(live, { type: 'key', key: 'r', px: lastPx, py: lastPy }) || true;
      case 'home': { const f = s.plot && s.plot.founders; if (f) call('render', 'panToTile', f.tx + 1, f.ty + 1); return true; }
      case 'follow': { const cam = s.ui.camera; if (cam && cam.follow >= 0) { call('render', 'follow', -1); } else { const a = call('agents', 'follow', s); if (a && Number.isFinite(a.id)) call('render', 'follow', a.id); } return true; }
      case 'escape': return mcStep(live, { type: 'key', key: 'Escape', px: lastPx, py: lastPy });
      case 'save': call('session', 'save', 'manual.0'); return true;
      case 'undo': { const r = call('buildings', 'undo', s); if (r && !r.ok && r.reason) M.notify(s, { kind: 'info', text: r.reason, ttl: 3000 }); else if (r && r.ok) { call('audio', 'play', 'tick'); } return true; }
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
    if (tool.id === 'founders_hall' && s.plot && s.plot.founders) { const c = s.plot.cove || []; const i = BSU.inBounds(tx, ty) ? ty * W + tx : -1; cove = i >= 0 && c.indexOf(i) >= 0; tx = s.plot.founders.tx; ty = s.plot.founders.ty; }
    return { tx: clamp(tx, 0, W - 1), ty: clamp(ty, 0, HGT - 1), cove: cove };
  }
  function updateGhost(s, px, py) {
    if (!s || !s.ui || !s.ui.tool) return;
    const tool = s.ui.tool;
    if (tool.id === 'bulldoze') { const i = tileIndexAt(px, py); const b = i >= 0 ? call('buildings', 'at', s, i % W, (i / W) | 0) : null; const row = b ? rowOf(b.type) : null; call('render', 'ghost', i >= 0 ? { tiles: b ? (call('buildings', 'footprint', s, b.id) || [i]) : [i], color: b && row && !row.demolishable ? 'red' : 'red', label: '' } : null); if (dom()) ghostLabel(px, py, b ? 'Demolish ' + (b.name || (row && row.name) || b.type) : 'Demolish', b && row && !row.demolishable ? 'Landmarks stay' : (b ? 'Refund 50%' : 'Click a path, road, levee, canal or fence'), 'red'); return; }
    const row = rowOf(tool.id); if (!row) return;
    const g = ghostTarget(s, tool, px, py); if (!g) return;
    const dragging = live.state === 'DRAGGING';
    const isRing = row.id === 'levee' || row.id === 'floodwall';
    if (dragging && isRing && clock - lastRingMs < L.ringThrottleMs && lastGhost) { drawGhost(s, tool, row, lastGhost.r, g, px, py, dragging); return; }
    const opts = { rot: tool.rot }; if (dragging) opts.tiles = live.run;
    const r = call('buildings', 'canPlace', s, tool.id, g.tx, g.ty, opts); if (!r) return;
    if (dragging && isRing) lastRingMs = clock;
    lastGhost = { r: r, tx: g.tx, ty: g.ty };
    drawGhost(s, tool, row, r, g, px, py, dragging);
  }
  function drawGhost(s, tool, row, r, g, px, py, dragging) {
    const color = g.cove ? 'red' : (r.color || (r.ok ? 'green' : 'red'));
    let tiles = r.tiles && r.tiles.length ? r.tiles : [g.ty * W + g.tx];
    if (dragging && live.run.length) tiles = live.run;
    if (g.cove && s.plot && s.plot.cove) tiles = s.plot.cove;
    const spec = { tiles: tiles, color: color, ringTiles: r.ring && Array.isArray(r.ring.tiles) ? r.ring.tiles : null, label: '', radius: fin(r.radius, 0), radiusCenter: { tx: g.tx, ty: g.ty } };
    if (row.kind === 'footprint' || row.kind === 'upgrade') spec.sprite = { id: tool.id, variant: r.needsPilings ? SPR.PILINGS : 0, tx: g.tx, ty: g.ty, rot: tool.rot };
    call('render', 'ghost', spec);
    if (!dom()) return;
    let l1, l2 = '';
    if (dragging) { const n = live.run.length; const per = fin(r.cost, row.cost) || row.cost; l1 = n + (n === 1 ? ' tile' : ' tiles') + ' · ' + money(per * n); if (r.ring && r.ring.text) l2 = r.ring.text; else if (r.ring && typeof r.ring.closed === 'boolean') l2 = r.ring.closed ? 'closes the ring' : (r.ring.shortText || ('still ' + fin(r.ring.short, 0) + ' tiles short')); }
    else if (g.cove) { l1 = 'Not here'; l2 = 'The cove floods every rain. Build on the ridge.'; }
    else if (!r.ok) { l1 = r.reason || 'Cannot build here'; l2 = r.ridgeFull || r.sink || ''; }
    else {
      l1 = money(r.cost); if (row.kind === 'drag') l1 += ' / tile';
      if (r.needsGrading) l1 += ' · Grade the site +' + money(r.gradingCost || 0); else if (r.needsPilings) l1 += ' · Pilings +' + money(r.pilingsCost || 0);
      if (r.ridgeFull) l2 = r.ridgeFull; else if (r.sink) l2 = r.sink; else if (r.ring && r.ring.text) l2 = r.ring.text; else if (!r.affordable) l2 = 'Not enough cash';
      if (tool.rot) l1 += ' · rotated (R)';
    }
    ghostLabel(px, py, l1, l2, color);
  }
  function clickPlace(s, px, py, mods) {
    if (!s || !s.ui.tool) return false;
    const tool = s.ui.tool;
    if (tool.id === 'bulldoze') {
      const i = tileIndexAt(px, py); if (i < 0) return false;
      const b = call('buildings', 'at', s, i % W, (i / W) | 0);
      const r = b ? call('buildings', 'remove', s, b.id, 'demolish') : call('buildings', 'remove', s, { tile: i }, 'demolish');
      if (r && r.ok) { call('audio', 'play', 'tick'); undoAtMs = clock; if (dom()) ghostLabel(px, py, 'Removed' + (r.refund ? ' · refund ' + money(r.refund) : ''), 'Ctrl+Z to undo', 'green'); }
      else { call('audio', 'play', 'invalid'); if (dom()) { ghostLabel(px, py, r && r.reason ? r.reason : 'Nothing here', '', 'red'); shakeLabel(); } }
      return false;   // the bulldozer stays selected
    }
    const row = rowOf(tool.id); if (!row) return false;
    const g = ghostTarget(s, tool, px, py); if (!g) return false;
    if (g.cove) { call('audio', 'play', 'invalid'); if (dom()) shakeLabel(); return false; }
    const r = call('buildings', 'place', s, tool.id, g.tx, g.ty, { rot: tool.rot });
    if (r && r.ok) {
      call('audio', 'play', 'place'); undoAtMs = clock;
      if (toolLocked) toolLocked = false;
      if (dom()) ghostLabel(px, py, 'Placed · ' + money(r.cost), 'Ctrl+Z to undo', 'green');
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
  function closeInspectDom() { insp = null; renaming = null; if (focusedInput && focusedInput !== E['title-seed']) focusedInput = null; if (dom()) { show(E.inspect, false); cls(E.hud, 'inspect-open', false); } }
  function row(k, v, cls_) { const r = el('div', 'row' + (cls_ ? ' ' + cls_ : '')); r.appendChild(el('span', 'k', k)); r.appendChild(el('span', 'v', v)); return r; }
  function action(label, fn, cls_) { return btn(null, label, 'small' + (cls_ ? ' ' + cls_ : ''), function () { const s = stateOf(); const r = fn(s); if (r && r.ok === false && r.reason) M.notify(s, { kind: 'info', text: r.reason, ttl: 4000 }); inspAt = -1e9; }); }
  function stars(n) { n = clamp(fin(n, 0) | 0, 0, 5); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function ft(v, d) { return fin(v, 0).toFixed(d == null ? 1 : d) + ' ft'; }
  function refreshInspect(s) {
    if (!insp || !dom() || !s) return;
    inspAt = clock; inspDirty = false;
    const body = E['insp-body'], acts = E['insp-actions']; clear(body); clear(acts);
    const spr = E['insp-sprite']; let hasSprite = false;
    const kind = insp.kind;
    if (kind === 'building') {
      const b = call('buildings', 'get', s, insp.id); if (!b) { closeInspectDom(); return; }
      const r = rowOf(b.type) || { name: b.type, effects: {}, wr: 0, tiers: [] }, ef = r.effects || {}, i0 = b.ty * W + b.tx, tl = s.tiles;
      if (!renaming) setText(E['insp-title'], b.name || r.name);
      setText(E['insp-sub'], r.name + (b.tier > 0 && r.tiers && r.tiers[b.tier - 1] ? ' · ' + (r.tiers[b.tier - 1].name || 'Tier ' + b.tier) : '') + (b.pilings ? ' · on pilings' : ''));
      call('render', 'drawIcon', spr, b.type); hasSprite = true;
      if (b.ruin) body.appendChild(row('Status', 'Ruin', 'bad')); else if (b.built < 1) body.appendChild(row('Status', 'Under construction ' + Math.round(fin(b.built, 0) * 100) + '%')); else if (b.flooded) body.appendChild(row('Status', 'Flooded', 'bad')); else if (b.blackout) body.appendChild(row('Status', 'Blackout', 'bad')); else if (b.closedUntil >= 0 && b.closedUntil > dayOf(s)) body.appendChild(row('Status', 'Closed · reopens ' + BSU.formatDate(b.closedUntil)));
      if (ef.beds) body.appendChild(row('Beds', String(ef.beds))); if (ef.seats) body.appendChild(row('Seats', String(ef.seats))); if (ef.feeds) body.appendChild(row('Feeds', String(ef.feeds)));
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
      if (r.tiers && r.tiers.length > fin(b.tier, 0)) acts.appendChild(action('Upgrade', function (st) { return call('buildings', 'upgrade', st, b.id); }));
      if (b.type === 'generator') acts.appendChild(action('Refuel +3 days $5k', function (st) { return call('buildings', 'refuel', st, b.id); }));
      if (b.type === 'dining_hall') acts.appendChild(action((b.data && b.data.gatorProofDumpsters ? '✓ ' : '') + 'Gator-proof dumpsters $5k', function (st) { return call('buildings', 'setPolicy', st, b.id, 'gatorProofDumpsters', !(b.data && b.data.gatorProofDumpsters)); }));
      if (b.type === 'wildlife_post') acts.appendChild(action((b.data && b.data.nutriaBounty ? '✓ ' : '') + 'Nutria bounty', function (st) { return call('buildings', 'setPolicy', st, b.id, 'nutriaBounty', !(b.data && b.data.nutriaBounty)); }));
      if (b.type === 'abatement') acts.appendChild(action(b.data && b.data.active === false ? 'Abatement off → on' : 'Abatement on → off', function (st) { return call('buildings', 'setPolicy', st, b.id, 'active', !(b.data && b.data.active !== false)); }));
      if ((tl.type[i0] === T.WET || tl.type[i0] === T.DRAINED) && r.kind === 'footprint') acts.appendChild(action('Re-grade', function (st) { return call('buildings', 'regrade', st, b.id); }));
      if (r.demolishable !== false) acts.appendChild(action('Demolish', function (st) { const rr = call('buildings', 'remove', st, b.id, 'demolish'); if (rr && rr.ok) { undoAtMs = clock; closeInspectDom(); } return rr; }, 'danger'));
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
      if (Number.isFinite(g.den) && g.den >= 0) body.appendChild(row('Home den', '(' + (g.den % W) + ', ' + ((g.den / W) | 0) + ')'));
      if (Number.isFinite(g.target) && g.target >= 0) { const ob = call('buildings', 'at', s, g.target % W, (g.target / W) | 0); body.appendChild(row('Headed for', ob ? 'the ' + (ob.name || (rowOf(ob.type) || {}).name) + ' dumpster' : 'the water')); }
      if (Number.isFinite(g.lastIncidentDay) && g.lastIncidentDay >= 0) body.appendChild(row('Last seen', BSU.formatDate(g.lastIncidentDay)));
      if (legend) acts.appendChild(action('Photograph', function (st) { return call('wildlife', 'photographLeGrand', st); }, 'primary'));
      acts.appendChild(action('Pan to', function () { call('render', 'panToTile', Math.floor(fin(g.tx, 32)), Math.floor(fin(g.ty, 32))); return null; }));
    } else {
      setText(E['insp-title'], insp.kind); setText(E['insp-sub'], '');
    }
    show(spr, hasSprite);
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
  function showTooltipAt(text, px, py) {
    const t = E.tooltip; if (!t) return; if (tipShown !== text) { setText(t, text); tipShown = text; }
    const vw = fin(window.innerWidth, 1280), vh = fin(window.innerHeight, 800); const w = fin(t.offsetWidth, 160) || 160, h = fin(t.offsetHeight, 24) || 24;
    t.style.left = Math.round(clamp(px, 4, vw - w - 4)) + 'px'; t.style.top = Math.round(clamp(py, 4, vh - h - 4)) + 'px'; show(t, true);
  }
  function updateTooltip(s) {
    if (!dom()) return;
    if (itemHover && itemHover.key) {
      if (clock - itemHover.since >= L.tooltipMs) { const txt = itemTooltip(s, itemHover.id); showTooltipAt(txt, itemHover.px, itemHover.py - 8); E.tooltip.dataset.kind = 'item'; }
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
    for (const g of gatorsOf(s)) { if (g && fin(g.tag, 0) > 0) { const at = call('render', 'entityScreen', g); if (at && Number.isFinite(at.x)) { E.tooltip.dataset.kind = 'gator'; showTooltipAt('🐊 ' + (g.name || 'Gator'), at.x - 40, at.y - 44); return true; } } }
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
  /** rebuild tabs + items (on unlock:changed / tab change / reset) */
  M.refreshPalette = function (state) {
    try {
      const s = state || stateOf(); if (!dom() || !s || !s.ui) return;
      paletteDirty = false;
      const vis = visibleTabs(s), cur = currentTab(s);
      if (cur && s.ui.paletteTab !== cur.id) s.ui.paletteTab = cur.id;
      const key = vis.map(function (t) { return t.id; }).join(',') + '|' + (cur ? cur.id : '') + '|' + (cur ? cur.rows.map(function (id) { const u = unlockOf(s, id); return id + (u.ok ? '+' : '-' + u.reason); }).join(',') : '');
      if (key === paletteKey) { refreshPips(s); return; }
      paletteKey = key;
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
        const ic = el('canvas', 'icon'); ic.width = 64; ic.height = 64; it.appendChild(ic); call('render', 'drawIcon', ic, id);
        it.appendChild(el('div', 'name', r.name));
        it.appendChild(el('div', 'cost', money(r.cost) + (r.kind === 'drag' ? '/tile' : '')));
        if (!u.ok) it.appendChild(el('div', 'cond', u.reason || 'Locked'));
        it.addEventListener('click', function () { const st = stateOf(); if (!u.ok) { call('audio', 'play', 'invalid'); if (u.reason) M.notify(st, { kind: 'info', text: u.reason, ttl: 4000 }); return; } const t = st.ui.tool; M.selectTool(st, t && t.id === id ? null : id); });
        it.addEventListener('pointerenter', function (ev) { itemHover = { key: 'item:' + id, id: id, since: clock, px: fin(ev.clientX, 0), py: fin(ev.clientY, 0) }; });
        it.addEventListener('pointermove', function (ev) { if (itemHover && itemHover.id === id) { itemHover.px = fin(ev.clientX, itemHover.px); itemHover.py = fin(ev.clientY, itemHover.py); } });
        it.addEventListener('pointerleave', function () { if (itemHover && itemHover.id === id) { itemHover = null; hideTooltip(); } });
        items.appendChild(it); E.itemEls[id] = it;
      }
      refreshPips(s); markToolDom(s);
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
      const n = { spec: spec, kind: kind, el: null, born: clock, bornTick: tickOf(s), ttl: fin(spec.ttl, L.notifMs), closed: false, onClose: onClose };
      if (dom()) {
        const d = el('div', 'notif' + (spec.stamp === 'paw' || spec.milestone ? ' paw' : '')); d.dataset.kind = kind;
        d.appendChild(el('span', 'notif-text', spec.text));
        if (act) { const b = btn(null, act.label || 'Do it', 'notif-action small', function () { try { act.fn(stateOf()); } catch (e) { uerr('notif:action', e); } closeNotif(n, 'action'); }); d.appendChild(b); }
        if (spec.showMe != null) { const b = btn(null, 'Show me', 'notif-action small', function () { showMe(stateOf(), spec.showMe); }); d.appendChild(b); }
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
    toast = { id: spec.id, text: spec.text || '', ticks: ticks, startTick: t0, untilTick: Number.isFinite(spec.untilTick) && spec.untilTick > t0 ? spec.untilTick : t0 + ticks, onAnswer: typeof spec.onAnswer === 'function' ? spec.onAnswer : null, resolved: false };
    if (dom()) { setText(E['dt-text'], toast.text); setText(E['btn-dt-yes'], spec.yes || 'Yes'); E['btn-dt-yes'].appendChild(el('span', 'key', 'Y')); setText(E['btn-dt-no'], spec.no || 'No'); E['btn-dt-no'].appendChild(el('span', 'key', 'N')); E['dt-fill'].style.width = '100%'; show(E['decision-toast'], true); }
    emit('decision:open', { id: toast.id });
  }
  /** idempotent: resolves the open toast with 'yes'|'no'|'default' — emits decision:closed once */
  M.answerDecision = function (id, answer) {
    try {
      if (!toast || toast.id !== id || toast.resolved) return;
      const t = toast; t.resolved = true; toast = null;
      if (dom()) show(E['decision-toast'], false);
      emit('decision:closed', { id: id, answer: answer || 'default' });
      if (t.onAnswer) { try { t.onAnswer(answer || 'default'); } catch (e) { uerr('toast:onAnswer', e); } }
      if (toastQueue.length) { const next = toastQueue.shift(); const s = stateOf(); if (s) openToast(s, next); }
    } catch (e) { uerr('answerDecision', e); }
  };
  function updateToast(s) {
    if (!toast) return;
    const tick = tickOf(s);
    if (tick >= toast.untilTick) { M.answerDecision(toast.id, 'default'); return; }
    if (dom()) { const frac = clamp((toast.untilTick - tick) / Math.max(1, toast.untilTick - toast.startTick), 0, 1); const w = Math.round(frac * 100) + '%'; if (E['dt-fill'].style.width !== w) E['dt-fill'].style.width = w; }
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
  function updatePanels(s) { const name = s.ui.panel; if (!name) { if (E.hud && E.hud.dataset.panel) E.hud.dataset.panel = ''; return; } const p = panels[name]; if (!p) return; if (clock - p.lastRefresh >= L.refreshMs) refreshPanel(s, name); }
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
        E['btn-continue'].disabled = !can; show(E['btn-continue'], can); refreshMuteButtons();
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
  M.settings = function () { const s = stateOf(); if (s && s.ui && s.ui.settings) return s.ui.settings; return { volume: 0.5, muted: false, particles: 'high', shake: true, colorblind: false, autoSimHint: false }; };
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
      E.popover.style.left = Math.round(clamp(left, 8, fin(window.innerWidth, 1280) - 320)) + 'px';
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
    const sp = el('div', 'seg'); [0, 1, 2, 4].forEach(function (v) { const b = btn(null, v === 0 ? 'Pause' : v + '×', 'seg-btn', function () { M.setSpeed(stateOf(), v); refreshSettingsPanel(stateOf(), host); }); b.dataset.speed = String(v); sp.appendChild(b); }); rowEl('Speed', sp); host._speed = sp;
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
    if (host._speed) for (const b of host._speed.children) cls(b, 'active', String(fin(s.ui.speed, 1)) === b.dataset.speed);
    if (host._vol) host._vol.value = String(fin(M.settings().volume, 0.5));
  }
  // Debug panel (built in; hidden; Backquote). ui_panels may re-register 'debug' with the full params tree.
  function buildDebugPanel(host) {
    host.appendChild(el('div', 'panel-title', 'Debug'));
    const grid = el('div', 'dbg-grid'); host.appendChild(grid);
    const add = function (label, fn) { grid.appendChild(btn(null, label, 'small', function () { const s = stateOf(); try { fn(s); } catch (e) { uerr('debug:' + label, e); } refreshDebugPanel(s, host); })); };
    add('+$1M', function (s) { call('economy', 'post', s, 'misc', 1e6); });
    add('+500 students', function (s) { call('economy', 'addStudents', s, 500, 'debug'); });
    add('Skip 10 days', function (s) { if (has('session', 'skipToDate')) { const d = BSU.dayParts(dayOf(s) + 10); call('session', 'skipToDate', s, d.date, d.year - fin(s.calendar.year, 1)); } });
    add('Cat 3 in 6 days', function (s) { call('weather', 'spawnStorm', s, { cat: 3, coneNowTick: tickOf(s), landfallTick: tickOf(s) + 600, compressed: true }); });
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
    const gs = call('wildlife', 'onCampus', s) || [];
    if (gs.length) { const g = gs[0]; const i = clamp(Math.floor(fin(g.tx, 0)), 0, W - 1) + clamp(Math.floor(fin(g.ty, 0)), 0, HGT - 1) * W; return { icon: '🐊', text: '', gator: { name: (g.name || 'A gator') + ' at ' + nearestBuildingName(s, fin(g.tx, 0), fin(g.ty, 0)), i: i }, kind: 'wildlife' }; }
    const lg = s.wildlife && s.wildlife.leGrand; if (lg) { const left = Math.max(0, fin(s.wildlife.leGrandDay, day) + 3 - day); const i = clamp(Math.floor(fin(lg.tx, 0)), 0, W - 1) + clamp(Math.floor(fin(lg.ty, 0)), 0, HGT - 1) * W; return { icon: '🐊', text: '', gator: { name: 'Le Grand at the cypress lake · ' + left + (left === 1 ? ' day' : ' days'), i: i }, kind: 'wildlife' }; }
    return null;
  }
  function updateAlert(s) {
    if (clock - alertAt < L.refreshMs) return; alertAt = clock;
    const spec = manualAlert || autoAlert(s); currentAlert = spec;
    const key = spec ? (spec.icon || '') + '|' + (spec.text || '') + '|' + (spec.gator ? spec.gator.name : '') + '|' + (spec.action ? spec.action.label : '') : '';
    if (key === alertKey) return; alertKey = key;
    if (!spec) { show(E['alert-strip'], false); return; }
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
    const ph = clamp(fin(s.sky && s.sky.phase, SKY.DAY), 0, 4); setText(E['sky-glyph'], SKY_GLYPH[ph]); E['sky-glyph'].title = SKY_NAME[ph];
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
  function updateObjective(s) {
    const o = call('progress', 'objective', s);
    const stage = fin(call('progress', 'tutorialStage', s), 6);
    const hideAll = !!s.setPiece && s.setPiece.kind === 'landfall';
    if (!o || hideAll) {
      if (objKey !== '') { objKey = ''; show(E['objective-card'], false); show(E['speech-bubble'], false); }
      const done = stage >= 6 && !o && !hideAll;
      if (done) { show(E['milestones-card'], true); if (clock - msAt >= L.refreshMs) { msAt = clock; const rows = call('progress', 'nearestMilestones', s, 3) || []; E.msRows.forEach(function (r, k) { const m = rows[k]; show(r.row, !!m); if (m) { setText(r.name, m.name); const w = Math.round(clamp(m.goal > 0 ? m.progress / m.goal : 0, 0, 1) * 100) + '%'; if (r.fill.style.width !== w) r.fill.style.width = w; setText(r.count, m.goal > 1 ? Math.round(m.progress) + ' / ' + m.goal : ''); } }); } }
      else show(E['milestones-card'], false);
      return;
    }
    show(E['milestones-card'], false);
    const key = o.id + '|' + o.title + '|' + o.text + '|' + fin(o.progress, 0) + '/' + fin(o.goal, 0) + '|' + (o.background ? o.background.id + o.background.text + fin(o.background.progress, 0) : '') + '|' + (o.deadline >= 0 ? o.deadline : '');
    if (key !== objKey) {
      objKey = key; bubble.since = clock; bubble.key = '';
      setText(E['obj-title'], o.title || ''); setText(E['obj-text'], o.text || '');
      const goal = fin(o.goal, 0), prog = fin(o.progress, 0);
      show(E['obj-progress'], goal > 1); if (goal > 1) { const w = Math.round(clamp(prog / goal, 0, 1) * 100) + '%'; if (E['obj-fill'].style.width !== w) E['obj-fill'].style.width = w; }
      setText(E['obj-count'], goal > 1 ? Math.round(prog) + ' / ' + goal : (o.deadline >= 0 ? 'by ' + BSU.formatDate(o.deadline) : ''));
      show(E['btn-postcard-obj'], o.id === '7' && /parade|postcard/i.test(o.text || ''));
      E['obj-title'].title = o.id === '8' && /capped/i.test(o.text || '') ? 'Pilings lift a building 3 ft above the flood line' : '';
      show(E['obj-background'], !!o.background); if (o.background) setText(E['obj-background'], '◦ ' + (o.background.title || o.background.text) + (fin(o.background.goal, 0) > 1 ? ' · ' + Math.round(fin(o.background.progress, 0)) + ' / ' + o.background.goal : ''));
      E['objective-card'].dataset.kind = o.kind === BSU.OBJ.BACKGROUND ? 'background' : 'interrupt';
      show(E['objective-card'], true);
      call('render', 'drawPortrait', E['obj-portrait'], 0);
    }
    // speech bubble: idle 8 s → the last ticker line for 6 s
    const bubOn = !E['speech-bubble'].classList.contains('hidden');
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
    if (hidePalette !== paletteHidden) { paletteHidden = hidePalette; show(E.palette, !hidePalette); cls(E.hud, 'no-palette', hidePalette); }
    cls(E.hud, 'setpiece', !!sp);
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
    if (titleOn) { sec('title', function (s) { refreshMuteButtons(); if (s.ui.panel) updatePanels(s); }, state, dtMs); return; }
    sec('queue', drainQueue, state, dtMs);
    sec('pan', heldPan, state, dtMs);
    sec('topbar', updateTopbar, state, dtMs);
    sec('alert', updateAlert, state, dtMs);
    sec('objective', updateObjective, state, dtMs);
    sec('notifs', updateNotifs, state, dtMs);
    sec('toast', updateToast, state, dtMs);
    sec('cards', updateCards, state, dtMs);
    sec('inspect', function (s) { if (insp && (inspDirty || clock - inspAt >= L.refreshMs)) refreshInspect(s); }, state, dtMs);
    sec('ticker', updateTicker, state, dtMs);
    sec('palette', function (s) { if (paletteDirty) M.refreshPalette(s); else refreshPips(s); }, state, dtMs);
    sec('hint', updateHint, state, dtMs);
    sec('setpiece', updateSetPiece, state, dtMs);
    sec('panels', updatePanels, state, dtMs);
    sec('tooltip', updateTooltip, state, dtMs);
    sec('ghost', updateGhostCosmetics, state, dtMs);
    sec('perf', updatePerf, state, dtMs);
    sec('legend', function (s) { const ov = fin(s.ui.overlay, 0); const list = (BSU.data && BSU.data.overlays) || []; for (const o of list) cls(E.ovBtns[o.ov], 'active', o.ov === ov); const o = list.find(function (x) { return x.ov === ov; }); show(E.legend, !!o); if (o) setText(E.legend, o.name + ' · ' + o.legend.join(' → ')); }, state, dtMs);
  };
  /** every newGame (fresh) and load: close everything, tool null, palette refresh from the new root */
  M.reset = function (state, fresh) {
    try {
      root = state || null; void fresh;
      toolLocked = false; live.down = null; live.run = []; live.runTile = -1; mcSet(live, 'IDLE');
      if (state && state.ui) { state.ui.tool = null; state.ui.panel = null; }
      card = null; cardQueue.length = 0; toast = null; toastQueue.length = 0; insp = null; renaming = null; focusedInput = null; hint = null; manualAlert = null; itemHover = null; hoverKey = '';
      for (let k = notifs.length - 1; k >= 0; k--) { notifs[k].closed = true; } notifs.length = 0;
      odo.cash = NaN; odo.students = NaN; odo.lastStudents = NaN; odo.holdUntil = -1; odo.deltaUntil = 0;
      tk = { x: 0, line: null, seen: Math.max(0, ((state && state.ticker) || []).length - 1), w: 0, lastLen: -1, logOpen: false, cycle: 0 };
      bubble = { since: clock, until: 0, key: '' }; objKey = ''; alertKey = ''; alertAt = -1e9; msAt = -1e9; speedKey = ''; paletteKey = ''; pipKey = ''; paletteDirty = true; capacityShown = false; skipShown = false; paletteHidden = false; hudFade = false;
      M.debug.open = false; M.hoverTile = -1; lastGhost = null;
      for (const k in held) held[k] = false;
      if (dom()) {
        show(E.cards, false); clear(E.cards); show(E['decision-toast'], false); show(E.inspect, false); cls(E.hud, 'inspect-open', false); show(E['ghost-label'], false); show(E.tooltip, false); show(E.popover, false); show(E.hint, false); show(E['voice-card'], false); show(E['alert-strip'], false); show(E['ticker-log'], false); show(E['btn-skip'], false); show(E.palette, true);
        clear(E.notifications); setText(E['ticker-track'], ''); E['ticker-track'].style.transform = 'translateX(0px)';
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
      // 4. Esc layer order via the live keydown in dry mode: tool → inspect → panel → card
      s.ui.tool = { id: 'dorm', rot: 0, shift: false }; mcSet(live, 'PLACING'); insp = { kind: 'tile', i: 5 }; s.ui.panel = 'settings'; card = { spec: { id: 'x', title: 't', body: 'b', actions: [] }, born: 0, bornTick: 0 };
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
        const ids = ['hud', 'topbar', 'brand', 'stat-cash', 'stat-students', 'chip-capacity', 'stat-prestige', 'stat-happiness', 'stat-ecology', 'stat-date', 'sky-glyph', 'chip-weather', 'speed', 'btn-budget', 'btn-season', 'btn-storm', 'btn-almanac', 'btn-menu', 'btn-mute', 'chip-endowed', 'alert-strip', 'alert-icon', 'alert-text', 'alert-action', 'alert-gator', 'minimap-wrap', 'minimap', 'minimap-viewport', 'overlay-buttons', 'legend', 'objective-card', 'obj-portrait', 'obj-title', 'obj-text', 'obj-progress', 'obj-count', 'btn-showme', 'btn-obj-dismiss', 'obj-background', 'speech-bubble', 'voice-card', 'milestones-card', 'notifications', 'decision-toast', 'dt-text', 'dt-countdown', 'btn-dt-yes', 'btn-dt-no', 'inspect', 'insp-title', 'insp-sub', 'btn-insp-close', 'insp-sprite', 'insp-body', 'insp-actions', 'ghost-label', 'tooltip', 'popover', 'pop-title', 'pop-next', 'ticker', 'ticker-track', 'btn-ticker-log', 'ticker-log', 'palette', 'palette-tabs', 'palette-items', 'btn-bulldoze', 'btn-palette-info', 'cards', 'perf-chip', 'perfmode-chip', 'hint', 'panels', 'title', 'title-name', 'title-tag', 'btn-charter', 'btn-continue', 'title-seed', 'btn-title-settings', 'btn-title-mute', 'title-campus'];
        for (const id of ids) A(isEl(E[id]) && E[id].id === id, 'skeleton id through M.el: ' + id);
        A(E.msRows.length === 3 && E.popLines.length === L.popLines && Object.keys(E.speedBtns).length === 4 && Object.keys(E.ovBtns).length === 6, 'ms-rows, pop-lines, speed and overlay buttons exist');
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
