'use strict';
// ============================================================================
// BAYOU STATE — ui_panels.js (module 16) → extends BSU.ui
// Owns: the Budget, Storm, Season (football pass D: playbook/aggression/watch-full/coaching controls, starters,
// prospects, schedule), Milestones (replaces the built-in fallback) and Almanac (with a Football section) panels,
// the game-day HUD (UI.scoreBug: score bug + down & distance + play-by-play strip), the post-game summary card
// (gamesummary) and the cards ui.js's notes leave to this module:
// newsflash, wetfeet, failure, damage (the storm damage report), hire, and the
// openers (one per card, D44) that call them: storm:report → damage,
// storm:named → newsflash, board:offered → board, econ:card → failure,
// milestone:earned{wetFeet} → wetfeet, objective:progress{id:'8',capped} → obj8.
// Zero DOM at definition time: registerPanel/registerCard are plain map writes
// (identical contract to ui.js); BSU.events.on subscriptions below are also
// plain closures until a real event fires. Loads and no-ops in Node through
// test/domstub.mjs.
// Implements: ARCHITECTURE §7.7, GDD §11.4/11.5/11.6/11.9, §6.2, §10.5, §10.7,
// §10.2 Objective 8, §10.8.
// Decisions recorded in docs/INTEGRATION_NOTES.md '## ui_panels.js'.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const UI = BSU.ui;
  if (!UI || typeof UI.registerPanel !== 'function') return; // ui.js must load first
  const P = BSU.params || {}, PE = P.econ || {}, PS = P.storm || {}, PSP = P.sports || {};
  const fin = function (v, d) { return Number.isFinite(v) ? v : d; };
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  const int = function (v, d) { return Math.round(fin(v, d)); };

  // ---------------------------------------------------------------------------
  // Local helpers (mirrors ui.js's own conventions; private to this module)
  // ---------------------------------------------------------------------------
  function call(name, fn) {
    const m = BSU[name]; if (!m || typeof m[fn] !== 'function') return undefined;
    try { return m[fn].apply(m, Array.prototype.slice.call(arguments, 2)); } catch (e) { BSU.error('ui_panels', name + '.' + fn, e); return undefined; }
  }
  function has(name, fn) { const m = BSU[name]; return !!(m && typeof m[fn] === 'function'); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function setText(e, s) { if (!e) return; s = s == null ? '' : String(s); if (e.textContent !== s) e.textContent = s; }
  function show(e, on) { if (!e) return; const hid = e.classList.contains('hidden'); if (on && hid) e.classList.remove('hidden'); else if (!on && !hid) e.classList.add('hidden'); }
  function cls(e, c, on) { if (!e) return; const h = e.classList.contains(c); if (on && !h) e.classList.add(c); else if (!on && h) e.classList.remove(c); }
  function clear(e) { if (!e) return; while (e.firstChild) e.removeChild(e.firstChild); }
  function btn(id, label, cls_, onClick) { const b = el('button', 'btn' + (cls_ ? ' ' + cls_ : ''), label); if (id) b.id = id; b.type = 'button'; if (onClick) b.addEventListener('click', function (ev) { try { onClick(ev); } catch (e) { BSU.error('ui_panels', 'click:' + (id || label), e); } }); return b; }
  function money(n) { return BSU.formatMoney(fin(n, 0)); }
  function catalog() { return (BSU.data && BSU.data.catalog) || {}; }
  function rowOf(type) { return type ? catalog()[type] || null : null; }
  function nameOf(s, id) { const b = call('buildings', 'get', s, id); if (!b) return ''; return b.name || (rowOf(b.type) || {}).name || b.type || ''; }
  function todayOf(s) { return fin(s && s.calendar && s.calendar.day, 0); }
  function yearOf(s) { return fin(s && s.calendar && s.calendar.year, 1); }
  function notify(s, text, kind) { try { UI.notify(s, { text: text, kind: kind || 'info', ttl: 6000 }); } catch (e) { /* notify itself never throws in practice */ } }
  function reasonLine(host, key, result) {
    // shows a 1-line "reason" chip under a control after a failed action, cleared on success
    if (!host) return;
    const id = '_reason_' + key;
    let r = host[id];
    if (!r) { r = el('div', 'row bad'); const k = el('span', 'k', ''); const v = el('span', 'v', ''); r.appendChild(k); r.appendChild(v); host[id] = r; }
    if (result && result.ok === false && result.reason) { setText(r.firstChild, ''); setText(r.lastChild, result.reason); if (!r.parentNode) host.appendChild(r); show(r, true); }
    else show(r, false);
  }
  function capitalize(k) { return String(k).replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function cap(n) { return Math.round(clamp(n, 0, 100) * 10) / 10; }
  function titleOf(i) { return { tx: i % BSU.MAP.W, ty: (i / BSU.MAP.W) | 0 }; }

  UI.panels = UI.panels || {};
  UI.panels.storm = UI.panels.storm || { testCat: 0 };

  // ===========================================================================
  // BUDGET panel
  // ===========================================================================
  function buildBudget(host) {
    host.appendChild(el('div', 'panel-title', 'Budget'));
    const grid = el('div', 'bud-grid');
    const col = function (title) { const c = el('div', 'bud-col'); c.appendChild(el('div', 'card-kicker', title)); const body = el('div'); c.appendChild(body); grid.appendChild(c); return body; };
    host._income = col('Income'); host._expense = col('Expenses'); host._runway = col('Runway');
    host.appendChild(grid);

    host.appendChild(el('div', 'card-kicker', 'Policy'));
    const rowEl = function (label, control) { const r = el('div', 'row'); r.appendChild(el('span', 'k', label)); r.appendChild(control); host.appendChild(r); return r; };

    const tuition = el('input'); tuition.type = 'range'; tuition.id = 'sl-tuition';
    tuition.min = String(fin(PE.tuition && PE.tuition.min, 3000)); tuition.max = String(fin(PE.tuition && PE.tuition.max, 15000)); tuition.step = String(fin(PE.tuition && PE.tuition.step, 250));
    tuition.addEventListener('input', function () { const v = parseInt(tuition.value, 10); setText(host._tuitionPreview, 'Applicants next lock ≈ ' + int(call('economy', 'previewApplicants', stateFor(host), v), 0)); });
    tuition.addEventListener('change', function () { const r = call('economy', 'setTuition', stateFor(host), parseInt(tuition.value, 10)); if (r === false) notify(stateFor(host), 'Tuition is locked', 'money'); });
    host._tuition = tuition;
    const tuitionWrap = el('div', 'bud-apps'); tuitionWrap.appendChild(tuition);
    host._tuitionPreview = el('div', 'bud-apps'); tuitionWrap.appendChild(host._tuitionPreview);
    tuitionWrap.id = 'bud-apps';
    rowEl('Tuition', tuitionWrap);

    const seg = function (id, labels, values, onPick) { const s = el('div', 'seg'); s.id = id; const bs = []; labels.forEach(function (lab, k) { const b = btn(null, lab, 'seg-btn', function () { onPick(values[k]); }); b.dataset.v = String(values[k]); s.appendChild(b); bs.push(b); }); s._btns = bs; return s; };
    host._quality = seg('seg-quality', ['Basic', 'Good', 'Elite'], ['basic', 'good', 'elite'], function (v) { call('economy', 'setQuality', stateFor(host), v); });
    rowEl('Faculty', host._quality);
    host._selectivity = seg('seg-selectivity', ['Open', 'Selective', 'Elite'], ['open', 'selective', 'elite'], function (v) { call('economy', 'setSelectivity', stateFor(host), v); });
    rowEl('Selectivity', host._selectivity);

    const coaching = el('input'); coaching.type = 'range'; coaching.id = 'sl-coaching';
    coaching.min = '0'; coaching.max = String(fin(PE.sliders && PE.sliders.coachingMax, 3000000)); coaching.step = String(fin(PE.sliders && PE.sliders.coachingStep, 100000));
    coaching.addEventListener('input', function () { call('economy', 'setCoaching', stateFor(host), parseInt(coaching.value, 10)); });
    host._coaching = coaching; host._coachingRow = rowEl('Coaching budget', coaching);

    host._ticket = seg('seg-ticket', ['$25', '$35', '$60'], [25, 35, 60], function (v) { call('economy', 'setTicket', stateFor(host), v); });
    host._ticketRow = rowEl('Ticket price', host._ticket);

    const autorepair = btn('chk-autorepair', 'Off', 'toggle', function () { const s = stateFor(host); const on = !(s.economy && s.economy.autoRepair); call('economy', 'setAutoRepair', s, on); refreshBudget(s, host); });
    host._autorepair = autorepair; rowEl('Auto-repair', autorepair);

    host._loan = el('div', 'row'); host._loan.appendChild(el('span', 'k', 'Loan')); host._loan.appendChild(el('span', 'v', '')); host._loan.id = 'bud-loan'; host.appendChild(host._loan);

    const insWrap = el('div', 'row'); insWrap.id = 'bud-insurance'; insWrap.appendChild(el('span', 'k', 'Insurance')); const insV = el('span', 'v', ''); insWrap.appendChild(insV);
    const insCancel = btn(null, 'Cancel', 'small', function () { call('progress', 'cancelInsurance', stateFor(host)); }); show(insCancel, false); insWrap.appendChild(insCancel);
    host._insV = insV; host._insCancel = insCancel; host.appendChild(insWrap);

    const acts = el('div', 'card-actions');
    host._endow = btn('btn-endow', 'Endow $1M', 'small', function () { const r = call('economy', 'endow', stateFor(host), 1000000); if (r && !r.ok) notify(stateFor(host), r.reason, 'money'); });
    host._west = btn('btn-west', 'Charter BSU West $20M', 'small', function () { const r = call('economy', 'charterWest', stateFor(host)); if (r && !r.ok) notify(stateFor(host), r.reason, 'money'); });
    acts.appendChild(host._endow); acts.appendChild(host._west); host.appendChild(acts);
  }
  function stateFor(host) { void host; return BSU.state || null; }
  const LEDGER_INC = BSU.LEDGER_INCOME_KEYS || ['tuition', 'state', 'donations', 'research', 'athletics', 'tailgate', 'parking', 'festivals', 'pelts', 'grants', 'endowment', 'disaster', 'insurance', 'misc'];
  const LEDGER_EXP = BSU.LEDGER_EXPENSE_KEYS || ['salaries', 'upkeep', 'utilities', 'coaching', 'interest', 'repair', 'prep', 'construction', 'demolition', 'boardCards', 'misc'];
  function fillLedgerCol(host, map, keys) {
    clear(host);
    let total = 0, any = false;
    for (const k of keys) { const v = fin(map && map[k], 0); if (Math.round(v) === 0) continue; any = true; total += v; const r = el('div', 'row'); r.appendChild(el('span', 'k', capitalize(k))); r.appendChild(el('span', 'v', money(v))); host.appendChild(r); }
    if (!any) host.appendChild(el('div', 'row', 'None'));
    const tr = el('div', 'row'); tr.appendChild(el('span', 'k', 'Total')); tr.appendChild(el('span', 'v', money(total))); host.appendChild(tr);
    return total;
  }
  function refreshBudget(s, host) {
    if (!host) return;
    const pr = (BSU.dayParts ? BSU.dayParts(todayOf(s)) : { month: '', date: '' });
    const titleEl = host.parentNode ? host.parentNode : null; void titleEl;
    const stm = call('economy', 'statement', s) || { income: {}, expense: {} };
    const inc = fillLedgerCol(host._income, stm.income, LEDGER_INC);
    const exp = fillLedgerCol(host._expense, stm.expense, LEDGER_EXP);
    const net = inc - exp;
    const rw = call('economy', 'runway', s) || { months: 0, nextPayDay: -1, red: false };
    clear(host._runway);
    const rRow = el('div', 'row' + (rw.red ? ' bad' : ''));
    rRow.appendChild(el('span', 'k', rw.red ? '● Runway' : 'Runway'));
    rRow.appendChild(el('span', 'v', rw.nextPayDay >= 0 ? (int(rw.months, 0) + ' months to ' + BSU.formatDate(rw.nextPayDay) + ' payday') : (int(rw.months, 0) + ' months')));
    host._runway.appendChild(rRow);
    const netRow = el('div', 'row' + (net < 0 ? ' bad' : '')); netRow.appendChild(el('span', 'k', 'NET')); netRow.appendChild(el('span', 'v', (net >= 0 ? '+' : '') + money(net))); host._runway.appendChild(netRow);
    void pr;

    const locked = !!call('progress', 'timer', s, 'tuitionLock');
    host._tuition.value = String(fin(s.economy && s.economy.tuition, 6500)); host._tuition.disabled = locked;
    setText(host._tuitionPreview, 'Applicants next lock ≈ ' + int(call('economy', 'previewApplicants', s, fin(s.economy && s.economy.tuition, 6500)), 0));
    const q = (s.economy && s.economy.quality) || 'basic'; (host._quality._btns || []).forEach(function (b) { cls(b, 'active', b.dataset.v === q); });
    const sel = (s.economy && s.economy.selectivity) || 'open'; (host._selectivity._btns || []).forEach(function (b) { cls(b, 'active', b.dataset.v === sel); });

    const hasTeam = !!call('sports', 'season', s) && call('sports', 'season', s).hasTeam;
    show(host._coachingRow, !!hasTeam); if (hasTeam) host._coaching.value = String(fin(s.economy && s.economy.coaching, 0));
    const hasVenue = hasTeam && !!(call('sports', 'season', s) && call('sports', 'season', s).venue && call('sports', 'season', s).venue !== 'none');
    show(host._ticketRow, !!hasVenue); if (hasVenue) { const t = fin(s.economy && s.economy.ticket, 35); (host._ticket._btns || []).forEach(function (b) { cls(b, 'active', Number(b.dataset.v) === t); }); }

    const auto = !!(s.economy && s.economy.autoRepair); setText(host._autorepair, auto ? 'On' : 'Off'); host._autorepair.setAttribute('aria-pressed', auto ? 'true' : 'false');

    const loanAmt = Math.max(0, -fin(s.economy && s.economy.cash, 0));
    setText(host._loan.lastChild, 'Loan: ' + money(loanAmt) + ' of $2.0M line');

    const insured = !!call('progress', 'timer', s, 'insurance');
    setText(host._insV, insured ? '2%/yr · pays 50%' : 'none');
    show(host._insCancel, insured);

    const yr = yearOf(s);
    show(host._endow, yr >= 5); show(host._west, yr >= 5);
    if (yr >= 5) { host._endow.disabled = fin(s.economy && s.economy.cash, 0) < 1000000; }
  }

  UI.registerPanel('budget', { build: buildBudget, refresh: refreshBudget, events: ['econ:month', 'econ:stat'] });

  // ===========================================================================
  // STORM panel
  // ===========================================================================
  function formatRingLine(H, gapsRes) {
    const gaps = (gapsRes && gapsRes.gaps) || [], weak = (gapsRes && gapsRes.weak) || [], gates = (gapsRes && gapsRes.gates) || [];
    const parts = [];
    if (gaps.length) { const g = gaps[0]; parts.push(gaps.length + ' gap' + (gaps.length === 1 ? '' : 's') + ' (' + g.name + ', ' + g.len + ' tiles)'); }
    else parts.push('0 gaps');
    if (weak.length) { const w0 = weak[0]; const t = titleOf(w0.i); parts.push(weak.length + ' weak tiles (' + t.tx + ', ' + t.ty + ')'); }
    if (gates.length) { const g0 = gates[0]; const t = titleOf(g0.i); parts.push('crossing (' + t.tx + ', ' + t.ty + ') ' + (g0.jammed ? 'jams' : 'closes')); }
    return 'Ring at ' + int(H, 0) + ' ft: ' + parts.join(' · ');
  }
  function windOrderCompare(a, b) {
    const rank = function (x) { return x.type === 'water_tower' ? 0 : (x.type === 'substation' ? 1 : 2); };
    const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb;
    const wa = fin(a.wr, 0), wb = fin(b.wr, 0); if (wa !== wb) return wa - wb;
    const ca = fin(a.cost, 0), cb = fin(b.cost, 0); if (ca !== cb) return cb - ca;
    return 0;
  }
  function buildStorm(host) {
    const title = el('div', 'panel-title', 'Storm'); title.id = 'storm-title'; host.appendChild(title);
    host._status = el('div', 'panel-status'); host._status.id = 'storm-status'; host.appendChild(host._status);   // status line (the panel's firstChild is the chrome head with the ✕ — never write into it)
    const seg = el('div', 'seg'); seg.id = 'seg-testcat'; host.appendChild(seg); host._testcat = seg;
    const cv = el('canvas'); cv.id = 'storm-cone'; cv.width = 200; cv.height = 200; cv.className = 'card-canvas'; host.appendChild(cv); host._cone = cv;
    host._ring = el('div', 'row'); host._ring.id = 'storm-ring'; host.appendChild(host._ring);
    host._reached = el('div', 'row'); host._reached.id = 'storm-reached'; host.appendChild(host._reached);

    host.appendChild(el('div', 'card-kicker', 'Wind exposure'));
    const windSummary = el('div', 'row'); host.appendChild(windSummary); host._windSummary = windSummary;
    const windList = el('div', 'pick-list'); windList.id = 'storm-wind'; host.appendChild(windList); host._windList = windList;
    const windActs = el('div', 'card-actions');
    host._boardSel = btn(null, 'Board Up selected', 'small', function () {
      const s = stateFor(host); const ids = [];
      for (const row of (host._windList ? host._windList.children : [])) { if (row._checked && row._checked()) ids.push(row._id); }
      if (!ids.length) { notify(s, 'Select at least one building'); return; }
      const r = call('weather', 'prepAction', s, 'boardUp', ids); if (r && !r.ok) notify(s, r.reason, 'event');
    });
    host._boardAll = btn('btn-boardall', 'Board Up all', 'small', function () { const s = stateFor(host); const r = call('weather', 'prepAction', s, 'boardUp', 'all'); if (r && !r.ok) notify(s, r.reason, 'event'); });
    windActs.appendChild(host._boardSel); windActs.appendChild(host._boardAll); host.appendChild(windActs);

    host._shelter = el('div', 'row'); host._shelter.id = 'storm-shelter'; host.appendChild(host._shelter);

    const acts = el('div', 'card-actions'); acts.id = 'storm-actions';
    const mkAction = function (id, label, action) {
      const b = btn(id, label, 'small', function () { const s = stateFor(host); const r = call('weather', 'prepAction', s, action); if (r) { if (!r.ok) notify(s, r.reason, 'event'); else notify(s, label + ': ' + money(r.cost), 'money'); } refreshStorm(s, host); });
      acts.appendChild(b); return b;
    };
    host._sandbags = mkAction('btn-sandbags', 'Sandbags', 'sandbags');
    host._repairall = mkAction('btn-repairall', 'Repair All', 'repairAll');
    host._evacuate = mkAction('btn-evacuate', 'Evacuate', 'evacuate');
    host._predrain = btn('btn-predrain', 'Pre-drain', 'small toggle', function () { const s = stateFor(host); const r = call('weather', 'prepAction', s, 'preDrain'); if (r && !r.ok) notify(s, r.reason); refreshStorm(s, host); }); acts.appendChild(host._predrain);
    host._playthrough = btn('btn-playthrough', 'Play Through It', 'small toggle', function () { const s = stateFor(host); const on = !(s.storms && s.storms.playThroughIt); call('weather', 'setPlayThrough', s, on); refreshStorm(s, host); }); acts.appendChild(host._playthrough);
    host._spillway = btn('btn-spillway', 'Spillway $250k', 'small', function () { const s = stateFor(host); const r = call('weather', 'prepAction', s, 'spillway'); if (r && !r.ok) notify(s, r.reason, 'water'); }); acts.appendChild(host._spillway);
    host.appendChild(acts);

    host.appendChild(el('div', 'card-kicker', 'Storm log'));
    host._log = el('div'); host.appendChild(host._log);
  }
  // Base tile colors for the minimap-style read (T enum: OPEN_WATER, BAYOU, MARSH, WET, DRY, HIGH, DRAINED, POND).
  const TILE_COLORS = ['#2A5C82', '#3A7099', '#3E6B55', '#4C7A4A', '#5C8A4C', '#6E9F55', '#5A6E42', '#2A5C82'];
  function drawCone(s, cv, H) {
    const ctx = cv.getContext && cv.getContext('2d'); if (!ctx || typeof ctx.fillRect !== 'function') return;
    try {
      const W = BSU.MAP.W, HH = BSU.MAP.H, sx = cv.width / W, sy = cv.height / HH;
      ctx.fillStyle = '#1A1230'; ctx.fillRect(0, 0, cv.width, cv.height);
      const type = s.tiles && s.tiles.type;
      if (type) { for (let i = 0; i < type.length; i++) { const tx = i % W, ty = (i / W) | 0; ctx.fillStyle = TILE_COLORS[type[i]] || '#3E6B55'; ctx.fillRect(tx * sx, ty * sy, Math.max(1, sx + 0.5), Math.max(1, sy + 0.5)); } }
      const prot = call('buildings', 'protection', s, H);
      if (prot && prot.length) {
        ctx.fillStyle = 'rgba(224,68,62,0.4)';
        for (let i = 0; i < prot.length; i++) { if (prot[i]) { const tx = i % W, ty = (i / W) | 0; ctx.fillRect(tx * sx, ty * sy, Math.max(1, sx + 0.5), Math.max(1, sy + 0.5)); } }
      }
      const cone = call('weather', 'cone', s);
      if (cone && Array.isArray(cone.track) && cone.track.length) {
        ctx.strokeStyle = '#FFE680'; ctx.lineWidth = 2; ctx.beginPath();
        cone.track.forEach(function (p, k) { const x = fin(p.tx, 0) * sx, y = fin(p.ty, 0) * sy; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      }
      const f = s.plot && s.plot.founders;
      if (f) { ctx.fillStyle = '#FDD023'; ctx.fillRect(f.tx * sx, f.ty * sy, Math.max(2, sx * 3), Math.max(2, sy * 3)); }
    } catch (e) { BSU.error('ui_panels', 'drawCone', e); }
  }
  function windPickList(s) {
    const ids = call('buildings', 'boardOrder', s) || [];
    const day = todayOf(s);
    return ids.map(function (id) {
      const b = call('buildings', 'get', s, id); if (!b) return null;
      const row = rowOf(b.type) || {};
      return { id: id, name: b.name || row.name || b.type, wr: fin(row.wr, 0), cost: fin(row.cost, 0), type: b.type, boarded: fin(b.data && b.data.boardedUntil, -1) >= day };
    }).filter(Boolean);
  }
  function refreshStorm(s, host) {
    if (!host) return;
    const storm = call('weather', 'storm', s);
    if (!storm) { setText(host._status, 'STORM · no storm in the Gulf'); show(host._cone, false); setText(host._ring, ''); setText(host._reached, ''); clear(host._windList); clear(host._log); show(host._testcat, false); return; }
    show(host._testcat, true); show(host._cone, true);
    const fc = int(storm.forecastCat, 1);
    const opts = [clamp(fc - 1, 1, 5), clamp(fc, 1, 5), clamp(fc + 1, 1, 5)];
    if (!host._testcat._opts || host._testcat._opts.join(',') !== opts.join(',')) {
      clear(host._testcat); host._testcat._opts = opts;
      opts.forEach(function (c) { const b = btn(null, 'Cat ' + c, 'seg-btn', function () { UI.panels.storm.testCat = c; refreshStorm(stateFor(host), host); }); b.dataset.c = String(c); host._testcat.appendChild(b); });
      if (!Number.isFinite(UI.panels.storm.testCat) || opts.indexOf(UI.panels.storm.testCat) < 0) UI.panels.storm.testCat = fc;
    }
    for (const b of host._testcat.children) cls(b, 'active', Number(b.dataset.c) === UI.panels.storm.testCat);
    const H = fin(call('weather', 'forecastSurge', s, UI.panels.storm.testCat), fin(PS.surge && PS.surge[fc], 5));
    const days = Math.max(0, fin(storm.landfallDay, todayOf(s)) - todayOf(s));
    setText(host._status, 'HURRICANE ' + (storm.name || '').toUpperCase() + ' · Cat ' + fc + ' (±1) · landfall in ' + days + ' days · surge ' + H + ' ft');
    drawCone(s, host._cone, H);

    const ringClosed = !!call('buildings', 'ringClosed', s, H);
    if (ringClosed) setText(host._ring, 'Ring closed at ' + H + ' ft ✓');
    else { const g = call('buildings', 'gaps', s, H) || { gaps: [], weak: [], gates: [], reachedBuildings: [] }; setText(host._ring, formatRingLine(H, g)); host._lastGaps = g; }
    const g2 = host._lastGaps || call('buildings', 'gaps', s, H) || { reachedBuildings: [] };
    const rb = g2.reachedBuildings || [];
    setText(host._reached, rb.length ? ('Reached buildings: ' + rb.map(function (r) { return nameOf(s, r.id) + ' (' + Math.round(r.depth * 10) / 10 + ' ft) ⚠'; }).join(' · ')) : 'Reached buildings: none');

    const list = windPickList(s).filter(function (r) { return !r.boarded; });
    const unboardedLowWr = list.filter(function (r) { return r.wr <= 2; }).length;
    const wt = list.find(function (r) { return r.type === 'water_tower'; });
    setText(host._windSummary, unboardedLowWr + ' unboarded buildings WR ≤ 2' + (wt ? ' · Water Tower ' + ((s.plot && true) ? 'unbraced' : 'unbraced') : ''));
    clear(host._windList);
    list.forEach(function (r) {
      const row = el('div', 'row'); const cb = el('input'); cb.type = 'checkbox';
      row._checked = function () { return !!cb.checked; }; row._id = r.id;
      const lab = el('span', 'k', r.name + ' (WR ' + r.wr + ')');
      row.appendChild(cb); row.appendChild(lab); host._windList.appendChild(row);
    });
    const queued = call('buildings', 'get', s, -1); void queued;
    const boardedCount = windPickList(s).filter(function (r) { return r.boarded; }).length;
    if (boardedCount) { const d = el('div', 'row'); d.appendChild(el('span', 'k', boardedCount + ' boarded ✓')); host._windList.appendChild(d); }

    const shelter = call('buildings', 'shelter', s) || { capacity: 0, students: 0, ok: false, lines: [] };
    setText(host._shelter, 'Shelter ' + shelter.capacity.toLocaleString('en-US') + ' / ' + shelter.students.toLocaleString('en-US') + ' students ' + (shelter.ok ? '✓' : '✗') + (shelter.lines.length ? ' (' + shelter.lines.join(', ') + ')' : ''));

    cls(host._predrain, 'active', !!storm.preDrain);
    cls(host._playthrough, 'active', !!(s.storms && s.storms.playThroughIt));
    const nextHome = call('sports', 'upcoming', s);
    const canPlayThrough = !!nextHome && fin(nextHome.day, -1) - todayOf(s) <= 1 && fc <= 1;
    show(host._playthrough, canPlayThrough);
    show(host._evacuate, true); host._evacuate.disabled = !!storm.evacuated;
    host._sandbags.disabled = !!storm.sandbagged;
    show(host._spillway, yearOf(s) >= 3 && !!call('buildings', 'has', s, 'engineering'));

    clear(host._log);
    const log = (s.storms && s.storms.log) || [];
    if (!log.length) host._log.appendChild(el('div', 'row', 'No storms yet.'));
    else log.slice(-10).reverse().forEach(function (e) {
      const r = el('div', 'row'); r.appendChild(el('span', 'k', 'Y' + e.year + ' ' + e.name + ' Cat ' + e.cat));
      r.appendChild(el('span', 'v', (e.nearMiss ? 'near miss' : (money(e.damage) + ', ' + e.tarps + ' tarps')) + ' · ' + (e.held ? 'held' : 'breached')));
      host._log.appendChild(r);
    });
  }
  UI.registerPanel('storm', { build: buildStorm, refresh: refreshStorm, events: ['storm:wave', 'storm:named', 'storm:watch', 'storm:bands', 'storm:landfall', 'storm:passed', 'ring:changed', 'coverage:changed', 'building:complete', 'building:removed'] });

  // ===========================================================================
  // SEASON panel (PLAN_FOOTBALL pass D). Every control calls an engine setter (sports.setPlaybook / setAggression /
  // setWatchFull / setAutoSim / setNight / setPermits / setHomecomingBudget, economy.setCoaching, sports.hireCoach /
  // fireCoach / signProspect, buildings.upgrade) and prints a one-line effect read from params.sports.engine.
  // Lists rebuild only when their content key changes (a 500 ms refresh must not eat a half-finished click).
  // ===========================================================================
  const PEN = PSP.engine || {};
  const STYLE_NAME = { ground: 'Ground', balanced: 'Balanced', air: 'Air Raid' };
  const AGGR_NAME = { conservative: 'Conservative', normal: 'Normal', aggressive: 'Aggressive' };
  const POS_FALLBACK = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'K'];
  const HL_TICKS = 750, FULL_TICKS = 2240, TICKS_PER_SEC = 10;   // the highlights / full set-piece lengths (INTEGRATION_NOTES '## football pass B')
  const pct0 = function (v) { return Math.round(fin(v, 0) * 100); };
  const signed = function (v, d) { d = d || 1; const x = Math.round(fin(v, 0) * d) / d; return (x > 0 ? '+' : '') + x; };
  function positions() { const f = BSU.data && BSU.data.football; return (f && f.positions) || PEN.positions || POS_FALLBACK; }
  function oppAbbr(key) { return String(key || 'OPP').slice(0, 3).toUpperCase(); }
  function oppOf(key) { return (BSU.data && BSU.data.opponents && BSU.data.opponents[key]) || { name: key || 'Opponent', nick: '', rating: 50, style: 'balanced' }; }
  function styleOfCoach(name) { const cs = (BSU.data && BSU.data.coaches) || []; for (let i = 0; i < cs.length; i++) if (cs[i] && cs[i].name === name) return cs[i].style || 'balanced'; return null; }

  // --- one-line effects (pure; numbers come from params so the panel never lies) -------------------------------
  function playbookFx(style) {
    const pbs = PEN.playbook || {}, pb = pbs[style]; if (!pb) return '';
    const bal = pbs.balanced || pb, nm = STYLE_NAME[style] || style;
    if (style === 'ground') return nm + ': run ' + pct0(pb.runShare) + '% of plays, ' + signed(pb.runYdsAdd, 10) + ' yd per carry, slower clock, fumbles x' + pb.fumbleMult;
    if (style === 'air') return nm + ': pass ' + pct0(pb.passShare) + '% of plays (' + signed((pb.passShare / bal.passShare - 1) * 100) + '%), big plays x' + pb.passVar + ', turnovers x' + pb.intMult + ', completions ' + signed(pb.compAdj * 100) + ' pts';
    return nm + ': run ' + pct0(pb.runShare) + '% / pass ' + pct0(pb.passShare) + '%, no multipliers, no extra risk';
  }
  function aggressionFx(level) {
    const a = (PEN.aggression || {})[level]; if (!a) return '';
    const nm = AGGR_NAME[level] || level;
    if (!(a.goDist > 0)) return nm + ': kicks on every 4th down' + (a.trailLateGo ? ' unless trailing late' : '');
    return nm + ': goes for it on 4th & ' + a.goDist + ' or less ' + (a.goSpot <= 50 ? 'past midfield' : 'inside the opponent ' + (100 - a.goSpot)) + (a.trailLateGo ? ', or when trailing late' : '');
  }
  function watchFx(on) { return on ? 'Full game: every snap animates (about ' + Math.round(FULL_TICKS / TICKS_PER_SEC / 60) + ' min at 1x), Skip finishes it. From the next home game' : 'Highlights: about 24 key plays in ' + Math.round(HL_TICKS / TICKS_PER_SEC) + ' s with the big decisions. Flip it to watch every snap'; }
  function autoSimFx(on) { return on ? 'Home games resolve in about 5 s with your coach and aggression defaults (no toasts)' : 'Home games play out as a set piece you can watch and steer'; }
  function nightFx(avail, on, tier) {
    const hf = PEN.homeField || {}, day = fin((hf.day || [])[tier], 6), night = fin((hf.night || [])[tier], day);
    if (!avail) return 'Needs Stadium II (the Cauldron) for night games';
    return on ? 'Night: home field +' + night + ' (day +' + day + '), bigger crowds, under the lights' : 'Day games: home field +' + day + '. Night adds +' + (night - day) + ' and a bigger crowd';
  }
  function permitsFx(v) { return v === 'free' ? 'Free: no tailgate income, but students remember the goodwill' : 'Paid: $' + fin(PSP.tailgatePer, 3) + ' of tailgate income per fan on game day'; }
  function homecomingFx(v) {
    const tiers = [0, 50000, 150000], tier = Math.max(0, tiers.indexOf(v)), hr = ((PEN.homeField || {}).homecomingRating || [])[tier];
    return v === 0 ? 'No budget: Homecoming runs on school spirit alone' : 'Spend ' + money(v) + ': a spirit boost for 10 days and +' + fin(hr, tier) + ' team rating on Homecoming day';
  }
  function coachingFx() { return '+' + fin(PSP.coachingPer100k, 1) + ' rating per $100k (max +' + fin(PSP.coachingCap, 30) + '), and a bigger budget signs better coaches'; }
  function coachFitFx(coachStyle, playbook) {
    if (!coachStyle) return 'Interim staff: no scheme, so no fit bonus either way';
    const cf = PEN.coachFit || {};
    if (coachStyle === playbook) return 'Scheme fit: ' + (STYLE_NAME[coachStyle] || coachStyle) + ' coach runs your ' + (STYLE_NAME[playbook] || playbook) + ' playbook (+' + Math.round(fin(cf.completion, 0.02) * 100) + ' pts completion, +' + fin(cf.runYds, 0.3) + ' yd per carry)';
    return 'No fit: coach runs ' + (STYLE_NAME[coachStyle] || coachStyle) + ', your playbook is ' + (STYLE_NAME[playbook] || playbook) + ' (no bonus)';
  }

  // --- small builders --------------------------------------------------------------------------------------------
  function seg(id, items, onPick) {
    const g = el('div', 'seg'); g.id = id;
    items.forEach(function (it) { const b = btn(null, it[1], 'seg-btn', function () { onPick(it[0]); }); b.dataset.v = String(it[0]); g.appendChild(b); });
    return g;
  }
  function segSet(g, v) { for (const b of g.children) { const on = b.dataset.v === String(v); cls(b, 'active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  /** a labelled control row with its one-line effect underneath; returns the effect element */
  function ctl(parent, label, control, fxId) {
    const wrap = el('div', 'fb-ctl'); const r = el('div', 'row'); r.appendChild(el('span', 'k', label));
    const v = el('span', 'v'); v.appendChild(control); r.appendChild(v); wrap.appendChild(r);
    const fx = el('div', 'fb-fx'); if (fxId) fx.id = fxId; wrap.appendChild(fx); parent.appendChild(wrap); return fx;
  }
  function stars(n) { n = clamp(int(n, 0), 0, 5); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  /** rebuild a region only when its content key changed */
  function region(host, name, key, box, fill) {
    if (host._keys[name] === key) return;
    host._keys[name] = key; clear(box); fill(box);
  }
  function cell(cls_, text) { return el('span', cls_, text); }
  /** the prospect board {list[{index?, name, pos, rating, cost, hometown, title?, blurb?, signed?}], signed?, maxSignings?, answered?, open?} from sports.prospects (pass C), else state.sports.prospects; null outside the off-season */
  function prospectBoard(s) {
    let b = has('sports', 'prospects') ? call('sports', 'prospects', s) : null;
    if (!b && s && s.sports && s.sports.prospects) b = s.sports.prospects;
    if (Array.isArray(b)) b = { list: b };
    return b && Array.isArray(b.list) && b.list.length ? b : null;
  }

  function buildSeason(host) {
    host._keys = {};
    host.appendChild(el('div', 'panel-title', 'Season'));
    host._record = el('div', 'fb-record'); host._record.id = 'sea-record'; host.appendChild(host._record);
    const cols = el('div', 'fb-cols'); host.appendChild(cols);
    const Lc = el('div', 'fb-col'), Rc = el('div', 'fb-col'); cols.appendChild(Lc); cols.appendChild(Rc);

    // ---- left: the next game, the game plan, the program ----
    Lc.appendChild(el('div', 'card-kicker', 'Next game'));
    host._next = el('div', 'fb-next'); host._next.id = 'sea-next';
    host._nextLine = el('div', 'fb-next-line'); host._nextBar = el('div', 'bar'); host._nextFill = el('div', 'fill'); host._nextBar.appendChild(host._nextFill); host._nextFx = el('div', 'fb-fx');
    host._next.appendChild(host._nextLine); host._next.appendChild(host._nextBar); host._next.appendChild(host._nextFx); Lc.appendChild(host._next);

    Lc.appendChild(el('div', 'card-kicker', 'Game plan'));
    host._playbook = seg('seg-playbook', [['ground', 'Ground'], ['balanced', 'Balanced'], ['air', 'Air Raid']], function (v) { call('sports', 'setPlaybook', stateFor(host), v); refreshSeason(stateFor(host), host); });
    host._fxPlaybook = ctl(Lc, 'Playbook', host._playbook, 'fx-playbook');
    host._aggr = seg('seg-aggression', [['conservative', 'Conservative'], ['normal', 'Normal'], ['aggressive', 'Aggressive']], function (v) { call('sports', 'setAggression', stateFor(host), v); refreshSeason(stateFor(host), host); });
    host._fxAggr = ctl(Lc, 'Aggression', host._aggr, 'fx-aggression');
    host._watch = btn('chk-watchfull', 'Off', 'toggle', function () { const s = stateFor(host); call('sports', 'setWatchFull', s, !(s.sports && s.sports.watchFull)); refreshSeason(s, host); });
    host._fxWatch = ctl(Lc, 'Watch full games', host._watch, 'fx-watch');
    host._autosim = btn('chk-autosim', 'Off', 'toggle', function () { const s = stateFor(host); call('sports', 'setAutoSim', s, !(s.sports && s.sports.autoSim)); refreshSeason(s, host); });
    host._fxAuto = ctl(Lc, 'Auto-sim home games', host._autosim, 'fx-autosim');
    host._night = btn('chk-night', 'Off', 'toggle', function () { const s = stateFor(host); call('sports', 'setNight', s, !(s.sports && s.sports.nightToggle)); refreshSeason(s, host); });
    host._fxNight = ctl(Lc, 'Night games', host._night, 'fx-night');

    Lc.appendChild(el('div', 'card-kicker', 'Program'));
    const sl = el('input'); sl.type = 'range'; sl.id = 'sl-coaching-sea'; sl.className = 'fb-slider';
    sl.min = '0'; sl.max = String(fin(PE.sliders && PE.sliders.coachingMax, 3000000)); sl.step = String(fin(PE.sliders && PE.sliders.coachingStep, 100000));
    sl.addEventListener('input', function () { const s = stateFor(host); call('economy', 'setCoaching', s, parseInt(sl.value, 10)); refreshSeason(s, host); });
    host._slider = sl; host._sliderVal = el('span', 'fb-sl-val', ''); const slw = el('span', 'fb-slw'); slw.appendChild(sl); slw.appendChild(host._sliderVal);
    host._fxCoaching = ctl(Lc, 'Coaching budget', slw, 'fx-coaching');
    host._ratingLine = el('div', 'fb-ratingline'); host._ratingLine.id = 'sea-ratingline'; Lc.appendChild(host._ratingLine);
    host._rating = el('div', 'fb-chips'); host._rating.id = 'sea-rating'; Lc.appendChild(host._rating);
    host._permits = seg('seg-permits', [['paid', 'Paid'], ['free', 'Free']], function (v) { call('sports', 'setPermits', stateFor(host), v); refreshSeason(stateFor(host), host); });
    host._fxPermits = ctl(Lc, 'Tailgate permits', host._permits, 'fx-permits');
    host._homecoming = seg('seg-homecoming', [[0, '$0'], [50000, money(50000)], [150000, money(150000)]], function (v) { const r = call('sports', 'setHomecomingBudget', stateFor(host), v); if (r && r.ok === false) notify(stateFor(host), r.reason); refreshSeason(stateFor(host), host); });
    host._fxHome = ctl(Lc, 'Homecoming budget', host._homecoming, 'fx-homecoming');
    // the venue row: the Upgrade button is the panel's one build action
    host._upgrade = btn('btn-upgrade', 'Upgrade', 'small', function () { doUpgrade(host); });
    const venue = el('div', 'row'); venue.id = 'sea-venue'; host._venue = el('span', 'k', 'Venue'); venue.appendChild(host._venue); const vv = el('span', 'v'); vv.appendChild(host._upgrade); venue.appendChild(vv); Lc.appendChild(venue);

    // ---- right: coach, starters, recruiting, schedule, history ----
    Rc.appendChild(el('div', 'card-kicker', 'Coach'));
    host._coach = el('div', 'row fb-coach'); host._coach.id = 'sea-coach'; Rc.appendChild(host._coach);
    host._coachFx = el('div', 'fb-fx'); host._coachFx.id = 'fx-coachfit'; Rc.appendChild(host._coachFx);
    host._candidates = el('div'); Rc.appendChild(host._candidates);
    const coachActs = el('div', 'card-actions');
    // #btn-hire stands in only when no candidates are drawn yet; once they are (offseason, or a 3-game rivalry
    // losing streak) the per-candidate buttons are the real hire action and this one hides.
    host._hire = btn('btn-hire', 'Hire', 'small', function () { notify(stateFor(host), 'No candidates yet', 'sports'); });
    host._fire = btn('btn-fire', 'Fire ($500k)', 'small danger', function () { const r = call('sports', 'fireCoach', stateFor(host)); if (r && !r.ok) notify(stateFor(host), r.reason, 'sports'); });
    coachActs.appendChild(host._hire); coachActs.appendChild(host._fire); Rc.appendChild(coachActs);

    Rc.appendChild(el('div', 'card-kicker', 'Starters'));
    host._starters = el('div', 'fb-table'); host._starters.id = 'sea-starters'; Rc.appendChild(host._starters);
    host._recruit = el('div', 'row'); host._recruit.id = 'sea-recruit'; Rc.appendChild(host._recruit);
    host._prospectsK = el('div', 'card-kicker', 'Recruiting board'); Rc.appendChild(host._prospectsK);
    host._prospects = el('div', 'fb-table'); host._prospects.id = 'sea-prospects'; Rc.appendChild(host._prospects);
    Rc.appendChild(el('div', 'card-kicker', 'Schedule'));
    host._schedule = el('div', 'fb-table'); host._schedule.id = 'sea-schedule'; Rc.appendChild(host._schedule);
    host._historyK = el('div', 'card-kicker', 'History'); Rc.appendChild(host._historyK);
    host._history = el('div'); host._history.id = 'sea-history'; Rc.appendChild(host._history);

    const bug = el('div', 'row'); bug.id = 'score-bug'; show(bug, false); host.appendChild(bug); host._bug = bug;
  }
  function doUpgrade(host) {
    const s = stateFor(host);
    const st = call('buildings', 'list', s, 'stadium') || [];
    const pf = call('buildings', 'list', s, 'practice_field') || [];
    let id = null;
    if (st.length) id = st[0].id;
    else if (pf.length && fin(pf[0].tier, 0) < 1) id = pf[0].id;
    if (id == null) { notify(s, 'Place a Stadium from the palette first', 'sports'); return; }
    const r = call('buildings', 'upgrade', s, id);
    if (r && !r.ok) notify(s, r.reason, 'sports'); else notify(s, 'Upgrading… ' + money((r && r.cost) || 0), 'sports');
  }
  function upgradeLabel(s) {
    const st = call('buildings', 'list', s, 'stadium') || [];
    const pf = call('buildings', 'list', s, 'practice_field') || [];
    const stadiumRow = rowOf('stadium') || {}, pfRow = rowOf('practice_field') || {};
    if (!pf.length) return { label: 'Needs a Practice Field', disabled: true };
    if (fin(pf[0].tier, 0) < 1) { const t = (pfRow.tiers || [])[0]; return { label: t ? (t.name + ' ' + money(t.cost)) : 'Bayou Field', disabled: !call('buildings', 'has', s, 'practice_field') }; }
    if (!st.length) return { label: 'Place a Stadium', disabled: true };
    const tier = fin(st[0].tier, 0);
    const next = (stadiumRow.tiers || []).find(function (t) { return t.tier === tier + 1; });
    if (!next) return { label: 'Top tier', disabled: true };
    return { label: next.name + ' ' + money(next.cost), disabled: false };
  }
  /** venue tier index into params.sports.engine.homeField (0 Bayou Field, 1-3 the stadium) */
  function venueTier(s) { const v = String((s.sports && s.sports.venue) || ''); if (v.indexOf('stadium') === 0) return clamp(parseInt(v.slice(7), 10) || 1, 1, 3); return 0; }
  /** the compact season-log row (pass C: state.sports.seasonLog) for a schedule entry, or null */
  function logOf(sp, e) { const lg = sp && sp.seasonLog; if (!Array.isArray(lg)) return null; for (let i = lg.length - 1; i >= 0; i--) if (lg[i] && lg[i].opp === e.opp && lg[i].day === e.day) return lg[i]; return null; }
  function resultText(e) {
    if (e.cancelled) return { t: 'cancelled', c: '' };
    if (e.postponed && e.postponedTo >= 0) return { t: 'postponed → ' + BSU.formatDate(e.postponedTo), c: '' };
    if (e.played && e.result) return { t: (e.result.won ? 'W ' : 'L ') + Math.max(e.result.bsu, e.result.opp) + '–' + Math.min(e.result.bsu, e.result.opp) + (e.result.ot ? ' OT' : ''), c: e.result.won ? 'win' : 'loss' };
    return { t: '—', c: '' };
  }
  function refreshSeason(s, host) {
    if (!host || !host._keys) return;
    const sp = call('sports', 'season', s) || { hasTeam: false, schedule: [], record: { wins: 0, losses: 0 }, coach: {}, starters: [] };
    const hasTeam = !!sp.hasTeam, up = call('sports', 'upcoming', s);
    const rec = sp.record || { wins: 0, losses: 0 };
    const playbook = sp.playbook || 'balanced', aggr = sp.aggression || 'normal';

    // record + rating headline
    const rt = call('sports', 'rating', s) || { rating: 0, terms: {} };
    setText(host._record, hasTeam ? ('Record ' + rec.wins + '–' + rec.losses + ' · Team rating ' + Math.round(fin(rt.rating, 0))) : 'No team yet: build a Practice Field to field one.');

    // next game: opponent rating/style, your live win probability (the slider moves it at once)
    if (up) {
      const o = oppOf(up.opp), orat = fin(up.oppRating, fin(o.rating, 50));
      const p = has('sports', '_probFor') ? call('sports', '_probFor', s, fin(rt.rating, 0), orat, !!up.night, !!up.home) : call('sports', 'winProb', s, up.opp, !!up.night, !!up.home);
      setText(host._nextLine, BSU.formatDate(up.day) + ' · ' + (up.home ? 'vs ' : 'at ') + o.name + ' (rating ' + Math.round(orat) + ', ' + (STYLE_NAME[o.style] || 'Balanced') + ') · ' + (up.night ? 'night' : 'day'));
      host._nextFill.style.width = Math.round(clamp(fin(p, 0.5), 0, 1) * 100) + '%';
      const live = s.sports && s.sports.game && !s.sports.game.finalized && has('sports', '_liveProb') ? call('sports', '_liveProb', s, 0) : null;
      setText(host._nextFx, 'Your win chance: ' + Math.round(fin(p, 0.5) * 100) + '% (' + call('sports', 'probWord', p) + ')' + (live !== null && live !== undefined ? ' · live now ' + Math.round(fin(live, 0.5) * 100) + '%' : ''));
    } else { setText(host._nextLine, 'No upcoming game'); host._nextFill.style.width = '0%'; setText(host._nextFx, hasTeam ? 'The season is over: recruit, retool, repeat.' : 'Build a Practice Field and the schedule appears.'); }
    const spr = has('sports', 'spring') ? call('sports', 'spring', s) : null;   // pass C: the Purple & Gold Spring Game on the calendar
    if (spr && fin(spr.scheduledDay, -1) >= 0 && fin(spr.daysUntil, -1) >= 0) setText(host._nextFx, host._nextFx.textContent + ' · ' + (spr.title || 'Spring Game') + ' ' + BSU.formatDate(spr.scheduledDay) + ' (' + spr.daysUntil + ' d)');

    // controls and their effects
    segSet(host._playbook, playbook); setText(host._fxPlaybook, playbookFx(playbook));
    segSet(host._aggr, aggr); setText(host._fxAggr, aggressionFx(aggr));
    const watchOn = !!sp.watchFull; setText(host._watch, watchOn ? 'Full' : 'Highlights'); host._watch.setAttribute('aria-pressed', watchOn ? 'true' : 'false'); setText(host._fxWatch, watchFx(watchOn));
    const autoOn = !!sp.autoSim; setText(host._autosim, autoOn ? 'On' : 'Off'); host._autosim.setAttribute('aria-pressed', autoOn ? 'true' : 'false'); setText(host._fxAuto, autoSimFx(autoOn));
    const hasStadium2 = call('buildings', 'has', s, 'stadium', 2) === true, nightOn = !!sp.nightToggle;
    setText(host._night, nightOn && hasStadium2 ? 'On' : 'Off'); host._night.setAttribute('aria-pressed', nightOn && hasStadium2 ? 'true' : 'false'); host._night.disabled = !hasStadium2; setText(host._fxNight, nightFx(hasStadium2, nightOn, venueTier(s)));
    const permits = sp.permits || 'paid'; segSet(host._permits, permits); setText(host._fxPermits, permitsFx(permits));
    const hb = fin(sp.homecomingBudget, 0); segSet(host._homecoming, hb); setText(host._fxHome, homecomingFx(hb));

    // coaching slider + the rating it produces, live
    const coaching = fin(s.economy && s.economy.coaching, 0);
    const dragging = typeof document !== 'undefined' && document.activeElement === host._slider;
    if (!dragging && host._slider.value !== String(coaching)) host._slider.value = String(coaching);
    setText(host._sliderVal, money(coaching) + '/yr');
    setText(host._fxCoaching, coachingFx());
    const cterm = fin(rt.terms && rt.terms.coaching, 0);
    if (hasTeam) {
      const pNow = up && has('sports', '_probFor') ? call('sports', '_probFor', s, fin(rt.rating, 0), fin(up.oppRating, 50), !!up.night, !!up.home) : null;
      setText(host._ratingLine, 'Team rating ' + Math.round(fin(rt.rating, 0)) + ' (coaching ' + signed(cterm, 1) + ')' + (pNow !== null && pNow !== undefined ? ' · ' + Math.round(pNow * 100) + '% to win next' : ''));
    } else setText(host._ratingLine, 'Team rating starts when the Practice Field opens');
    region(host, 'rating', JSON.stringify(rt.terms || {}), host._rating, function (box) {
      for (const k of Object.keys(rt.terms || {})) { const v = fin(rt.terms[k], 0); if (Math.abs(v) < 0.05) continue; const c = el('span', 'fb-chip' + (v < 0 ? ' neg' : '')); c.appendChild(el('span', 'k', capitalize(k))); c.appendChild(el('span', 'v', signed(v, 10))); box.appendChild(c); }
    });
    const up2 = upgradeLabel(s); setText(host._upgrade, up2.label); host._upgrade.disabled = !!up2.disabled;
    setText(host._venue, 'Venue · ' + venueName(s));

    // coach card
    const coach = sp.coach || { name: '', stars: 0, rep: '' }, cstyle = styleOfCoach(coach.name);
    setText(host._coach, (coach.name ? coach.name : 'No head coach') + ' ' + stars(coach.stars) + (cstyle ? ' · ' + (STYLE_NAME[cstyle] || cstyle) : '') + (coach.rep ? ' · "' + coach.rep + '"' : ''));
    setText(host._coachFx, coach.name ? coachFitFx(cstyle, playbook) : 'Hire a coach in the offseason.');
    const candidates = sp.candidates || [];
    const coachFee = fin(PSP.coachFee, 100000), coachSign = fin(PSP.coachSign, 300000);
    region(host, 'candidates', JSON.stringify(candidates.map(function (c) { return [c.name, c.stars]; })), host._candidates, function (box) {
      candidates.forEach(function (c, i) {
        const r = el('div', 'row'); const st = fin(c.stars, 0), cs = styleOfCoach(c.name);
        r.appendChild(el('span', 'k', c.name + ' ' + '★'.repeat(st) + (cs ? ' · ' + (STYLE_NAME[cs] || cs) : '') + ' · needs ' + money(coachSign * st) + '/yr budget'));
        const b = btn(null, 'Hire ' + money(coachFee * st), 'small', function () { const res = call('sports', 'hireCoach', stateFor(host), i); if (res && !res.ok) notify(stateFor(host), res.reason, 'sports'); refreshSeason(stateFor(host), host); });
        r.appendChild(b); box.appendChild(r);
      });
    });
    show(host._hire, candidates.length === 0); show(host._fire, !!(coach && coach.name));

    // the eight starters: pos · name · hometown · class · rating · star bar
    const order = positions(), byPos = {}; (sp.starters || []).forEach(function (st) { if (st && st.pos) byPos[st.pos] = st; });
    region(host, 'starters', JSON.stringify(order.map(function (p) { const st = byPos[p]; return st ? [st.name, st.hometown, st.rating, st.class] : null; })), host._starters, function (box) {
      if (!hasTeam) { box.appendChild(el('div', 'fb-empty', 'Starters arrive with the team.')); return; }
      const head = el('div', 'fb-tr fb-th'); ['Pos', 'Player', 'Hometown', 'Cl', 'Ovr', ''].forEach(function (h) { head.appendChild(cell('', h)); }); box.appendChild(head);
      order.forEach(function (p) {
        const st = byPos[p]; const r = el('div', 'fb-tr'); r.dataset.pos = p;
        r.appendChild(cell('pos', p)); r.appendChild(cell('nm', st ? st.name : '—')); r.appendChild(cell('ht', st ? st.hometown : ''));
        r.appendChild(cell('cl', st && st.class ? st.class : '')); r.appendChild(cell('ovr' + (st && fin(st.rating, 0) >= 90 ? ' elite' : ''), st ? String(fin(st.rating, 0)) : '—'));
        const bar = el('div', 'bar'); const f = el('div', 'fill'); f.style.width = Math.round(clamp((fin(st && st.rating, 0) - 50) / 50, 0, 1) * 100) + '%'; bar.appendChild(f); r.appendChild(bar);
        box.appendChild(r);
      });
    });

    // the building-priced recruit (legacy single card) and the prospects board (pass C)
    const rc = sp.recruit;
    if (rc && !rc.answered) {
      region(host, 'recruit', rc.name + rc.pos + rc.price, host._recruit, function (box) {
        box.appendChild(el('span', 'k', 'Recruit: ' + rc.pos + ' ' + rc.name + ' (' + rc.hometown + ') − ' + money(rc.price)));
        const signB = btn(null, 'Sign', 'small', function () { call('sports', 'answerRecruit', stateFor(host), true); refreshSeason(stateFor(host), host); });
        const passB = btn(null, 'Pass', 'small', function () { call('sports', 'answerRecruit', stateFor(host), false); refreshSeason(stateFor(host), host); });
        const v = el('span', 'v'); v.appendChild(signB); v.appendChild(passB); box.appendChild(v);
      });
      show(host._recruit, true);
    } else { host._keys.recruit = ''; show(host._recruit, false); }
    const pb = prospectBoard(s), board = pb ? pb.list : [], maxSign = fin(pb && pb.maxSignings, 2), nSigned = board.filter(function (p) { return p && p.signed; }).length;
    show(host._prospectsK, board.length > 0); show(host._prospects, board.length > 0);
    region(host, 'prospects', JSON.stringify([board.map(function (p) { return [p.name, p.pos, p.rating, p.cost, !!p.signed]; }), !!(pb && pb.answered)]), host._prospects, function (box) {
      if (!board.length) return;
      const head = el('div', 'fb-tr fb-th fb-pr'); ['Pos', 'Prospect', 'Ovr', 'Cost', ''].forEach(function (h) { head.appendChild(cell('', h)); }); box.appendChild(head);
      board.forEach(function (p, i) {
        const idx = p.index !== undefined ? p.index : i; const r = el('div', 'fb-tr fb-pr'); if (p.blurb) r.title = p.blurb;
        r.appendChild(cell('pos', p.pos || ''));
        const nm = cell('nm', (p.name || '') + (p.hometown ? ' (' + p.hometown + ')' : '')); if (p.title) nm.appendChild(el('span', 'dim', ' ' + p.title)); r.appendChild(nm);
        r.appendChild(cell('ovr' + (fin(p.rating, 0) >= 90 ? ' elite' : ''), String(fin(p.rating, 0)))); r.appendChild(cell('cost', money(p.cost)));
        const acts = el('span', 'fb-acts');
        if (p.signed) acts.appendChild(el('span', 'fb-tag', 'signed · arrives Aug 5'));
        else acts.appendChild(btn(null, 'Sign', 'small', function () { const res = call('sports', 'signProspect', stateFor(host), idx); if (res && res.ok === false) notify(stateFor(host), res.reason, 'sports'); else if (res && res.ok) notify(stateFor(host), 'Signed ' + (res.pos || p.pos) + ' ' + (res.name || p.name) + ' · arrives Aug 5', 'sports'); refreshSeason(stateFor(host), host); }));
        r.appendChild(acts); box.appendChild(r);
      });
      const foot = el('div', 'row'); foot.appendChild(el('span', 'k', 'Signed ' + nSigned + ' of ' + maxSign + (pb && pb.answered ? ' · board passed' : '') + ' · arrivals lock Aug 5'));
      if (!(pb && pb.answered) && nSigned < board.length) { const v = el('span', 'v'); v.appendChild(btn('btn-pass-board', 'Pass on the rest', 'small', function () { call('sports', 'passProspects', stateFor(host)); host._keys.prospects = ''; refreshSeason(stateFor(host), host); })); foot.appendChild(v); }
      box.appendChild(foot);
    });

    // schedule with results; the next game and each unplayed opponent's rating/style
    region(host, 'schedule', JSON.stringify([(sp.schedule || []).map(function (e) { return [e.day, e.opp, e.home, e.kind, e.played, e.cancelled, e.postponedTo, e.result && e.result.bsu, e.result && e.result.opp, e.oppRating]; }), up && up.day, up && up.opp, hasTeam]), host._schedule, function (box) {
      if (!hasTeam) { box.appendChild(el('div', 'fb-empty', 'No team yet: build a Practice Field.')); return; }
      (sp.schedule || []).forEach(function (e) {
        const o = oppOf(e.opp), res = resultText(e);
        const isNext = !!(up && e.day === up.day && e.opp === up.opp && !e.played);
        const r = el('div', 'fb-tr fb-sc' + (isNext ? ' next' : ''));
        r.appendChild(cell('dt', BSU.formatDate(e.day)));
        r.appendChild(cell('nm', o.name + (e.kind && e.kind !== 'regular' ? ' · ' + e.kind : '')));
        r.appendChild(cell('rs', e.played ? '' : Math.round(fin(e.oppRating, fin(o.rating, 50))) + ' ' + String(STYLE_NAME[o.style] || 'Balanced').slice(0, 3).toUpperCase()));
        r.appendChild(cell('ha', e.home ? 'H' : 'A'));
        r.appendChild(cell('res ' + res.c, res.t)); const lg = logOf(sp, e); if (lg && lg.mvp) r.title = 'MVP ' + lg.mvp.pos + ' ' + lg.mvp.name + ': ' + lg.mvp.line; box.appendChild(r);
      });
    });

    // season history from the record book (pass C fills seasons[]; all-time is always there)
    const R = (sp.records && typeof sp.records === 'object') ? sp.records : null;
    const seasons = R && Array.isArray(R.seasons) ? R.seasons : [];
    const at = R && R.allTime ? R.allTime : null;
    show(host._historyK, !!(at && (at.wins + at.losses > 0)) || seasons.length > 0); show(host._history, !!(at && (at.wins + at.losses > 0)) || seasons.length > 0);
    region(host, 'history', JSON.stringify([at, seasons.slice(-5)]), host._history, function (box) {
      if (at && at.wins + at.losses > 0) { const r = el('div', 'row'); r.appendChild(el('span', 'k', 'All-time')); r.appendChild(el('span', 'v', at.wins + '–' + at.losses)); box.appendChild(r); }
      seasons.slice(-5).reverse().forEach(function (x) { const t = seasonLine(x); const r = el('div', 'row'); r.appendChild(el('span', 'k', t.left)); r.appendChild(el('span', 'v', t.right)); if (t.sub) r.title = t.sub; box.appendChild(r); });
    });

    const g = s.sports && s.sports.game;
    if (g) {
      show(host._bug, true);
      const opp = oppOf(g.opp), pts = gamePoints(g);
      setText(host._bug, 'BSU ' + pts[0] + ' – ' + pts[1] + ' ' + opp.name + ' · ' + clockText(s, g, null));
    } else show(host._bug, false);
  }
  /** one season-history entry → {left, right, sub}; pass C rows are {year, wins, losses, pf, pa, bowl {oppName, won}|null, bowlWon, undefeated, coach, mvp {name, pos, line}} */
  function seasonLine(x) {
    x = x || {};
    const w = x.wins !== undefined ? x.wins : (x.w !== undefined ? x.w : 0), l = x.losses !== undefined ? x.losses : (x.l !== undefined ? x.l : 0);
    let bowl = '';
    if (x.bowl && typeof x.bowl === 'object') bowl = x.bowl.won ? 'bowl W' : 'bowl L'; else if (x.bowl === true) bowl = x.bowlWon ? 'bowl W' : 'bowl'; else if (typeof x.bowl === 'string' && x.bowl) bowl = x.bowl; else if (x.bowlWon === true) bowl = 'bowl W';
    const bits = [w + '–' + l]; if (x.pf !== undefined && x.pa !== undefined) bits.push(fin(x.pf, 0) + '–' + fin(x.pa, 0) + ' pts'); if (bowl) bits.push(bowl); if (x.undefeated) bits.push('undefeated');
    return { left: 'Year ' + fin(x.year, 0) + (x.coach ? ' · ' + (typeof x.coach === 'object' ? x.coach.name : x.coach) : ''), right: bits.join(' · '), sub: x.mvp && x.mvp.name ? 'MVP ' + x.mvp.pos + ' ' + x.mvp.name + (x.mvp.line ? ': ' + x.mvp.line : '') : '' };
  }
  /** the current venue's tier name (Stadium over Practice Field) */
  function venueName(s) {
    const st = call('buildings', 'list', s, 'stadium') || [], pf = call('buildings', 'list', s, 'practice_field') || [];
    const pick = function (list, id) { const b = list[0]; if (!b) return ''; const row = rowOf(id) || {}; const t = (row.tiers || []).find(function (q) { return q.tier === fin(b.tier, 0); }); return t ? t.name : (row.name || id); };
    return pick(st, 'stadium') || pick(pf, 'practice_field') || 'none yet';
  }
  /** [BSU points, opponent points] for a game struct (sports keeps homePts/awayPts by venue side) */
  function gamePoints(g) { const h = fin(g.homePts, 0), a = fin(g.awayPts, 0); return g.home ? [h, a] : [a, h]; }
  /** legacy clock from the set-piece tick (only when sports.live is unavailable) */
  function gameClock(s, g) {
    if (g.finalized) return 'Final';
    if (!g.kickedOff || fin(g.quarter, 0) < 1) return 'Kickoff';
    if (fin(g.halftimeOpenedTick, -1) >= 0 && !g.halftimeAnswered) return 'Halftime';
    const sp = s.setPiece, t = (sp && sp.kind === 'game') ? fin(sp.tick, 0) : 0;
    const k0 = fin(PSP.kickoffTick, 200), qt = Math.max(1, fin(PSP.quarterTicks, 100));
    const frac = t > k0 ? ((t - k0) % qt) / qt : 0;
    const secs = Math.max(0, Math.round(900 * (1 - frac)));
    return 'Q' + clamp(int(g.quarter, 1), 1, 4) + ' · ' + Math.floor(secs / 60) + ':' + (secs % 60 < 10 ? '0' : '') + (secs % 60);
  }
  /** the score bug's clock from the engine's live view: Q2 · 7:42, OT, Halftime, Final, Kickoff */
  function clockText(s, g, lv) {
    if (g.finalized || (lv && lv.phase === 'final')) return 'Final';
    if (lv && lv.active) {
      if (lv.phase === 'halftime') return 'Halftime';
      if (lv.phase === 'pregame' || !g.kickedOff) return 'Kickoff';
      if (lv.mode === 'montage') return 'Q' + clamp(int(g.quarter, 1), 1, 4);
      return (lv.quarter > 4 ? '' : 'Q' + clamp(int(lv.quarter, 1), 1, 4) + ' · ') + String(lv.clockText || '');
    }
    return gameClock(s, g);
  }
  function ordinal(n) { return ['', '1st', '2nd', '3rd', '4th'][clamp(int(n, 1), 1, 4)]; }
  /** "2nd & 7" / "1st & Goal" for a down, a distance and the ball spot (0 = BSU goal line, 100 = the opponent's) */
  function downText(down, dist, spot) { return ordinal(down) + ' & ' + (fin(dist, 10) >= 100 - fin(spot, 0) ? 'Goal' : Math.round(fin(dist, 10))); }
  /** "BSU 35" / "MAG 38" / "midfield" */
  function spotText(spot, oppKey) { const sp = Math.round(fin(spot, 50)); if (sp === 50) return 'midfield'; return sp < 50 ? 'BSU ' + sp : oppAbbr(oppKey) + ' ' + (100 - sp); }
  UI.registerPanel('season', { build: buildSeason, refresh: refreshSeason, events: ['game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed', 'building:complete', 'building:upgraded', 'game:decision'] });

  // ===========================================================================
  // GAME DAY HUD: the score bug (two rows: score + clock, down & distance + possession), the play-by-play strip
  // above the palette (last 3 game:play lines, newest highlighted), crowd/weather chips, the Watch full / Highlights
  // toggle. ui.update calls UI.scoreBug every frame; it only recomputes when state.tick moved (or an event forced it).
  // ===========================================================================
  const HUD = { bug: null, game: null, p: null, g: null, pbp: [], tick: -1, on: false, prestige0: 0, spirit0: 0, campus: null };
  function ensureHudBug() {
    if (HUD.bug) return HUD.bug;
    const hud = UI.el && UI.el.hud; if (!hud) return null;
    const bug = el('div', 'hidden'); bug.id = 'score-bug-hud';
    const main = el('div', 'sb-main'); const home = el('span', 'sb-team', 'BSU'), sc = el('span', 'sb-score', ''), away = el('span', 'sb-team', ''), clk = el('span', 'sb-clock', '');
    main.appendChild(home); main.appendChild(sc); main.appendChild(away); main.appendChild(clk);
    const dd = el('div', 'sb-dd hidden'); dd.id = 'sb-dd';
    const poss = el('span', 'sb-poss', ''), down = el('span', 'sb-down', ''), spot = el('span', 'sb-spot', ''), to = el('span', 'sb-to', ''), wp = el('span', 'sb-wp', '');
    dd.appendChild(poss); dd.appendChild(down); dd.appendChild(spot); dd.appendChild(to); dd.appendChild(wp);
    bug.appendChild(main); bug.appendChild(dd);
    bug._p = { home: home, sc: sc, away: away, clk: clk, dd: dd, poss: poss, down: down, spot: spot, to: to, wp: wp };
    hud.appendChild(bug); UI.el['score-bug-hud'] = bug; HUD.bug = bug;
    return bug;
  }
  function ensureGameHud() {
    if (HUD.game) return HUD.game;
    const hud = UI.el && UI.el.hud; if (!hud) return null;
    const g = el('div', 'hidden'); g.id = 'game-hud';
    const chips = el('div', 'gh-chips');
    const crowd = el('span', 'chip', ''), wx = el('span', 'chip', ''), mode = el('span', 'chip gold', '');
    const tog = btn('btn-gh-watch', 'Next: Highlights', 'small toggle', function () { const s = BSU.state; if (!s) return; call('sports', 'setWatchFull', s, !(s.sports && s.sports.watchFull)); UI.scoreBug(s, true); });
    tog.title = 'Takes effect from the next home game';
    chips.appendChild(mode); chips.appendChild(crowd); chips.appendChild(wx); chips.appendChild(tog); g.appendChild(chips);
    const box = el('div', 'gh-pbp'); box.id = 'pbp'; const lines = [];
    for (let i = 0; i < 3; i++) { const l = el('div', 'pb-line empty', ''); box.appendChild(l); lines.push(l); }
    g.appendChild(box); hud.appendChild(g); UI.el['game-hud'] = g; UI.el.pbp = box;
    HUD.game = g; HUD.g = { crowd: crowd, wx: wx, mode: mode, tog: tog, lines: lines };
    return g;
  }
  function fmtInt(n) { return String(Math.round(fin(n, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function hideHud() {
    HUD.on = false; HUD.tick = -1;
    if (HUD.bug) show(HUD.bug, false); if (HUD.game) show(HUD.game, false);
    if (UI.el && UI.el.hud) { cls(UI.el.hud, 'scorebug', false); cls(UI.el.hud, 'gamehud', false); }
  }
  function pbpLines(s) {
    if (HUD.pbp.length) return HUD.pbp;
    const rp = has('sports', 'recentPlays') ? call('sports', 'recentPlays', s, 3) : null;   // after a load: the engine remembers
    return Array.isArray(rp) ? rp.map(function (x) { return { text: x.text, key: !!x.key, poss: x.poss, fourth: !!x.fourth }; }) : [];
  }
  function weatherChip(g) {
    const eng = g.eng || {}; const bits = [];
    bits.push(eng.rain ? 'Rain' : 'Clear'); if (eng.wind) bits.push('windy');
    bits.push(g.night ? 'night' : 'day');
    return { text: bits.join(' · '), title: (eng.rain ? 'Rain: fewer completions, more fumbles, shorter kicks. ' : '') + (eng.wind ? 'Wind: shorter field goals and punts. ' : '') + (g.night ? 'Under the lights: bigger home-field edge.' : '') };
  }
  /** (re)draw the game HUD from sports.live(state); cheap when nothing moved */
  UI.scoreBug = function (state, force) {
    try {
      campusLine(state);   // the open summary card's prestige/spirit line keeps moving after the game struct is gone
      const g = state && state.sports && state.sports.game;
      if (!g || !g.home) { if (HUD.on) hideHud(); return; }
      const tk = fin(state.tick, 0);
      if (!force && HUD.on && tk === HUD.tick) return;
      const bug = ensureHudBug(); if (!bug) return;
      HUD.tick = tk;
      const lv = has('sports', 'live') ? call('sports', 'live', state) : null, active = !!(lv && lv.active);
      const watched = active && lv.mode !== 'montage' && lv.mode !== 'silent';
      const opp = oppOf(g.opp), pts = (active && lv.score && lv.mode !== 'montage') ? [lv.score[0], lv.score[1]] : gamePoints(g), P = bug._p;
      if (!HUD.on) { HUD.on = true; show(bug, true); cls(UI.el.hud, 'scorebug', true); }
      setText(P.home, 'BSU'); setText(P.sc, pts[0] + ' – ' + pts[1]); setText(P.away, String(opp.name || g.opp || '').toUpperCase()); setText(P.clk, clockText(state, g, lv));
      const poss = watched ? lv.possession : -1; cls(P.home, 'ball', poss === 0); cls(P.away, 'ball', poss === 1);
      // row 2: possession arrow · down & distance · ball spot · timeouts · live win probability
      const dd = P.dd;
      if (watched && lv.phase !== 'final') {
        show(dd, true);
        const ph = lv.phase, kick = g.phase === 'kickoff', tryPt = g.phase === 'try';
        setText(P.poss, ph === 'halftime' || ph === 'pregame' ? '' : (poss === 0 ? '▶' : (poss === 1 ? '◀' : '')));
        setText(P.down, ph === 'halftime' ? 'Halftime' : (ph === 'pregame' ? 'Pre-game' : (kick ? 'Kickoff' : (tryPt ? 'Try' : downText(lv.down, lv.distance, lv.spot)))));
        setText(P.spot, ph === 'halftime' || ph === 'pregame' ? '' : 'ball on ' + spotText(lv.spot, g.opp));
        setText(P.to, lv.timeouts ? 'TO ' + lv.timeouts[0] + '–' + lv.timeouts[1] : '');
        const wp = has('sports', '_liveProb') ? call('sports', '_liveProb', state, 0) : NaN;
        setText(P.wp, Number.isFinite(wp) ? 'Win ' + Math.round(wp * 100) + '%' : '');
      } else show(dd, false);
      // the strip above the palette: chips + last 3 plays
      const gh = ensureGameHud();
      if (gh) {
        const G = HUD.g; const showStrip = watched;
        cls(UI.el.hud, 'gamehud', showStrip); show(gh, showStrip);
        if (showStrip) {
          const seats = has('sports', 'venueSeats') ? fin(call('sports', 'venueSeats', state), 0) : 0, att = fin(g.attendance, 0);
          setText(G.crowd, 'Crowd ' + fmtInt(att) + (seats > 0 ? ' (' + Math.round(clamp(att / seats, 0, 1) * 100) + '%)' : ''));
          const w = weatherChip(g); setText(G.wx, w.text); G.wx.title = w.title;
          setText(G.mode, lv.mode === 'full' ? 'Full game' : 'Highlights');
          const full = !!(state.sports && state.sports.watchFull); setText(G.tog, 'Next game: ' + (full ? 'Full' : 'Highlights')); G.tog.setAttribute('aria-pressed', full ? 'true' : 'false');
          const lines = pbpLines(state), n = lines.length;
          for (let i = 0; i < 3; i++) {
            const it = lines[n - 3 + i], row = G.lines[i];
            setText(row, it ? it.text : ''); cls(row, 'empty', !it); cls(row, 'key', !!(it && it.key)); cls(row, 'opp', !!(it && it.poss === 1)); cls(row, 'new', !!it && i === 2);
          }
        }
      }
    } catch (e) { BSU.error('ui_panels', 'scoreBug', e); }
  };
  on('game:kickoff', function () { const s = BSU.state; HUD.pbp.length = 0; if (s) { HUD.prestige0 = fin(s.economy && s.economy.prestige, 0); HUD.spirit0 = fin(s.economy && s.economy.happiness, 0); UI.scoreBug(s, true); } });
  on('game:play', function (p) {
    const s = BSU.state; if (!p || !p.text) return;
    HUD.pbp.push({ text: String(p.text), key: !!p.key, poss: p.poss, fourth: !!p.fourth }); while (HUD.pbp.length > 3) HUD.pbp.shift();
    if (s) UI.scoreBug(s, true);
  });
  ['game:score', 'game:halftime', 'game:final', 'game:decision', 'setpiece:end', 'setpiece:start', 'save:loaded'].forEach(function (name) { on(name, function () { const s = BSU.state; if (s) UI.scoreBug(s, true); }); });

  // ===========================================================================
  // POST-GAME SUMMARY CARD (game:final.summary): score, line score, team stats, MVP, gate, campus change, 'Geaux' flavor
  // ===========================================================================
  const FLAVOR_W = ['Geaux Tigers! The whole bayou heard that one.', 'Cher, that was a ballgame. Geaux Tigers!', 'Purple and gold, all the way down the bayou.', 'Somebody hand that team a po-boy. Geaux Tigers!'];
  const FLAVOR_L = ['Geaux Tigers anyway: next game, cher.', 'Dust off, tighten up, and geaux again.', 'The gators have seen worse. Geaux Tigers.', 'A loss is just a crawfish boil you have not finished yet.'];
  function flavorLine(sum) { const pool = sum.won ? FLAVOR_W : FLAVOR_L; return pool[Math.abs(int(sum.day, 0) * 7 + int(sum.score && sum.score[0], 0)) % pool.length]; }
  function sumRow(label, a, b) { const r = el('div', 'sum-row'); r.appendChild(el('span', 'a', a)); r.appendChild(el('span', 'l', label)); r.appendChild(el('span', 'b', b)); return r; }
  /** the card body for a summary payload (pure over its argument; a DOM element) */
  function summaryBody(s, sum) {
    const root = el('div', 'sum');
    const o = oppOf(sum.opp), tag = String(o.nick || o.name || sum.opp || 'Opp');
    const banner = el('div', 'sum-banner' + (sum.won ? ' win' : ' loss'));
    banner.appendChild(el('span', 'sum-team', 'BSU')); banner.appendChild(el('span', 'sum-pts', fin(sum.score && sum.score[0], 0) + ' – ' + fin(sum.score && sum.score[1], 0)));
    banner.appendChild(el('span', 'sum-team', String(tag).toUpperCase())); banner.appendChild(el('span', 'sum-tag', (sum.won ? 'WIN' : 'LOSS') + (sum.ot ? ' · OT' : '')));
    root.appendChild(banner);
    root.appendChild(el('div', 'sum-flavor', flavorLine(sum)));
    // line score
    const q = Array.isArray(sum.quarters) ? sum.quarters : null;
    if (q && q[0] && q[1]) {
      const ncols = sum.ot ? 5 : 4, ls = el('div', 'sum-ls');
      const row = function (name, arr, total) { const r = el('div', 'sum-lr'); r.appendChild(el('span', 'n', name)); for (let i = 0; i < ncols; i++) r.appendChild(el('span', 'c', String(fin(arr[i], 0)))); r.appendChild(el('span', 'c t', String(total))); return r; };
      const hd = el('div', 'sum-lr h'); hd.appendChild(el('span', 'n', '')); for (let i = 0; i < ncols; i++) hd.appendChild(el('span', 'c', i < 4 ? 'Q' + (i + 1) : 'OT')); hd.appendChild(el('span', 'c t', 'T'));
      ls.appendChild(hd); ls.appendChild(row('BSU', q[0], fin(sum.score && sum.score[0], 0))); ls.appendChild(row(oppAbbr(sum.opp), q[1], fin(sum.score && sum.score[1], 0))); root.appendChild(ls);
    }
    // team stats
    const y = sum.yards || {}, pair = function (a) { return Array.isArray(a) ? [String(fin(a[0], 0)), String(fin(a[1], 0))] : ['0', '0']; };
    const st = el('div', 'sum-stats');
    const add = function (label, a) { const p = pair(a); st.appendChild(sumRow(label, p[0], p[1])); };
    add('Rush yards', y.rush); add('Pass yards', y.pass); add('Turnovers', sum.turnovers); add('Sacks', sum.sacks); add('First downs', sum.firstDowns);
    st.appendChild(sumRow('Time of possession', (sum.topText && sum.topText[0]) || '0:00', (sum.topText && sum.topText[1]) || '0:00'));
    root.appendChild(st);
    // MVP + the big play
    if (sum.mvp) root.appendChild(el('div', 'sum-mvp', 'MVP · ' + sum.mvp.pos + ' ' + sum.mvp.name + (sum.mvp.hometown ? ' (' + sum.mvp.hometown + ')' : '') + ': ' + sum.mvp.line));
    if (sum.bigPlay && sum.bigPlay.text) root.appendChild(el('div', 'sum-big', 'Big play · ' + sum.bigPlay.text));
    // gate (home games only)
    if (sum.home && fin(sum.attendance, 0) > 0) {
      const rv = sum.revenue || {};
      root.appendChild(el('div', 'sum-gate', 'Gate · ' + fmtInt(sum.attendance) + ' fans · ' + money(rv.total) + ' (tickets ' + money(rv.tickets) + ', concessions ' + money(rv.concessions) + (fin(rv.tailgate, 0) > 0 ? ', tailgate ' + money(rv.tailgate) : '') + ')'));
    }
    // campus change since kickoff (filled live while the card is open: happiness settles a few ticks after the whistle)
    const campus = el('div', 'sum-campus'); campus.id = 'sum-campus'; root.appendChild(campus);
    HUD.campus = campus; campusLine(s);
    return root;
  }
  /** "Prestige +2 · Campus spirit −1 since kickoff" for the open summary card */
  function campusLine(s) {
    const c = HUD.campus; if (!c || !s) return;
    const e = s.economy || {}, dp = fin(e.prestige, 0) - HUD.prestige0, dh = fin(e.happiness, 0) - HUD.spirit0;
    const f = function (v) { const r = Math.round(v * 10) / 10; return r === 0 ? 'steady' : (r > 0 ? '+' + r : String(r)); };
    setText(c, 'Since kickoff · Prestige ' + f(dp) + ' · Campus spirit ' + f(dh));
  }
  function openSeasonPanel() { UI.openPanel('season'); }
  UI.registerCard('gamesummary', function (s, p) {
    p = p || {};
    const sum = p.summary || (s && s.sports && s.sports.lastSummary) || null;
    if (!sum) return { id: 'gamesummary', kicker: 'Final', title: 'Game over', body: 'No summary was recorded for this game.', actions: [{ label: 'Season', fn: openSeasonPanel }, { label: 'Geaux', primary: true }] };
    const o = oppOf(sum.opp), score = sum.score || [0, 0];
    const title = (sum.won ? 'Geaux Tigers! ' : 'Final: ') + score[0] + '–' + score[1] + (sum.won ? ' over ' : ' to ') + (o.name || sum.opp);
    const kicker = 'Final · ' + (sum.kind && sum.kind !== 'regular' ? sum.kind + ' · ' : '') + (sum.home ? 'home' : 'away') + (sum.night ? ' · night game' : '') + (sum.ot ? ' · overtime' : '');
    return {
      id: 'gamesummary', kicker: kicker, title: title, body: summaryBody(s, sum), modal: false,
      actions: [{ label: 'Season', fn: openSeasonPanel }, { label: 'Geaux Tigers', primary: true }],
      onClose: function () { HUD.campus = null; }
    };
  });
  // watched games get the card (held until the set piece ends); montage and off-screen games get a one-line notify
  on('game:final', function (p) {
    const s = BSU.state; if (!s || !p || !p.summary) return;
    const sum = p.summary;
    if (p.mode === 'highlights' || p.mode === 'full') UI.card(s, 'gamesummary', { summary: sum });
    else {
      const o = oppOf(sum.opp);
      notify(s, (sum.won ? 'W ' : 'L ') + fin(sum.score && sum.score[0], 0) + '–' + fin(sum.score && sum.score[1], 0) + (sum.home ? ' vs ' : ' at ') + (o.name || sum.opp) + (sum.mvp ? ' · MVP ' + sum.mvp.name + ': ' + sum.mvp.line : ''), 'sports');
    }
  });
  UI.fb = { hofLine: hofLine, refreshFootball: refreshFootball, playbookFx: playbookFx, aggressionFx: aggressionFx, watchFx: watchFx, downText: downText, spotText: spotText, clockText: clockText, summaryBody: summaryBody, flavorLine: flavorLine, seasonLine: seasonLine, coachFitFx: coachFitFx };

  // ===========================================================================
  // MILESTONES panel (replaces the built-in fallback)
  // ===========================================================================
  function buildMilestones(host) {
    host.appendChild(el('div', 'panel-title', 'Milestones'));
    host._list = el('div'); host.appendChild(host._list);
    host.appendChild(el('div', 'card-kicker', 'Dismissed'));
    host._dismissed = el('div'); host.appendChild(host._dismissed);
  }
  function refreshMilestones(s, host) {
    if (!host || !host._list) return;
    clear(host._list);
    const rows = (BSU.data && BSU.data.milestones) || [];
    rows.forEach(function (m) {
      const earned = call('progress', 'earned', s, m.id);
      const reward = m.reward || {};
      let rt = '';
      if (reward.cash) rt = '+' + money(reward.cash); else if (reward.prestige) rt = '+' + reward.prestige + ' prestige'; else if (reward.effect) rt = capitalize(reward.effect);
      const wrap = el('div');
      const top = el('div', 'row');
      top.appendChild(el('span', 'k ms-name', (earned ? '✓ ' : '') + m.name));
      const day = earned && s.progress && s.progress.milestones && s.progress.milestones[m.id] ? s.progress.milestones[m.id].day : -1;
      top.appendChild(el('span', 'v ms-count', earned ? (day >= 0 ? BSU.formatDate(day) : '') : rt));
      wrap.appendChild(top);
      if (!earned) {
        const pr = call('progress', 'milestoneProgress', s, m.id) || { progress: 0, goal: 1 };
        const line2 = el('div', 'row');
        const b = el('div', 'bar'); b.style.flex = '1 1 auto'; b.style.marginTop = '3px'; const f = el('div', 'fill'); f.style.width = Math.round(clamp(pr.goal > 0 ? pr.progress / pr.goal : 0, 0, 1) * 100) + '%'; b.appendChild(f);
        line2.appendChild(b);
        line2.appendChild(el('span', 'ms-count', pr.goal > 1 ? (Math.round(pr.progress) + ' / ' + pr.goal) : ''));
        wrap.appendChild(line2);
      }
      host._list.appendChild(wrap);
    });
    clear(host._dismissed);
    const objs = (s.progress && s.progress.objectives) || {};
    let any = false;
    for (const id of Object.keys(objs)) {
      const o = objs[id]; if (!o || o.state !== 'dismissed') continue;
      any = true;
      const r = el('div', 'row'); r.appendChild(el('span', 'k', o.text || id));
      r.appendChild(btn(null, 'Reopen', 'small', function () { call('progress', 'reopen', s, id); refreshMilestones(s, host); }));
      host._dismissed.appendChild(r);
    }
    if (!any) host._dismissed.appendChild(el('div', 'row', 'None.'));
  }
  UI.registerPanel('milestones', { build: buildMilestones, refresh: refreshMilestones, events: ['milestone:earned', 'objective:dismissed'] });

  // ===========================================================================
  // ALMANAC panel
  // ===========================================================================
  function buildAlmanac(host) {
    host.appendChild(el('div', 'panel-title', 'Almanac'));
    host._achievements = el('div', 'bud-grid'); host._achievements.id = 'alm-achievements'; host.appendChild(host._achievements);
    const cv = el('canvas'); cv.id = 'alm-sparks'; cv.width = 600; cv.height = 160; cv.className = 'card-canvas'; host.appendChild(cv); host._sparks = cv;
    host.appendChild(el('div', 'card-kicker', 'Storms'));
    host._storms = el('div'); host._storms.id = 'alm-storms'; host.appendChild(host._storms);
    host.appendChild(el('div', 'card-kicker', 'Wildlife'));
    host._gators = el('div'); host._gators.id = 'alm-gators'; host.appendChild(host._gators);
    host.appendChild(el('div', 'card-kicker', 'Football'));
    host._football = el('div'); host._football.id = 'alm-football'; host.appendChild(host._football);
    host.appendChild(el('div', 'card-kicker', "Founders' Day"));
    host._recaps = el('div'); host._recaps.id = 'alm-recaps'; host.appendChild(host._recaps);
    host._postcard = btn('btn-postcard', 'Postcard', 'small', function () { postcard(stateFor(host)); }); host.appendChild(host._postcard);
  }
  function postcard(s) {
    try {
      const url = call('render', 'postcard', s, 'Bayou State');
      if (!url) return;
      const a = el('a'); a.href = url; a.download = 'bayou-state.png';
      if (typeof a.click === 'function') a.click();
    } catch (e) { BSU.error('ui_panels', 'postcard', e); }
  }
  function drawSparklines(s, cv) {
    const ctx = cv.getContext && cv.getContext('2d'); if (!ctx || typeof ctx.fillRect !== 'function') return;
    try {
      ctx.fillStyle = '#1A1230'; ctx.fillRect(0, 0, cv.width, cv.height);
      const hist = (s.ledger && s.ledger.history) || [];
      if (hist.length < 2) return;
      const keys = ['students', 'cash', 'prestige', 'happiness', 'ecology'];
      const colors = ['#FDD023', '#3FBF7F', '#7F5BC5', '#4FA3D6', '#5E2CA5'];
      keys.forEach(function (k, ki) {
        const vals = hist.map(function (h) { return fin(h[k], 0); });
        const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals) || 1;
        ctx.strokeStyle = colors[ki]; ctx.lineWidth = 2; ctx.beginPath();
        vals.forEach(function (v, i) {
          const x = (i / (vals.length - 1)) * cv.width;
          const y = (ki + 0.5) * (cv.height / keys.length) - ((v - lo) / (hi - lo || 1) - 0.5) * (cv.height / keys.length) * 0.8;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    } catch (e) { BSU.error('ui_panels', 'sparklines', e); }
  }
  // ---- Almanac "Football": all-time record, season history, the record book, Hall of Fame (state.sports.records; pass C fills seasons/hof) ----
  const BOOK_LABEL = { passYds: 'Passing yards, one game', rushYds: 'Rushing yards, one game', recYds: 'Receiving yards, one game', sacks: 'Sacks, one game', ints: 'Interceptions, one game', pts: 'Points scored', margin: 'Biggest margin' };
  function bookWho(e) { return (e.name ? e.name + (e.pos ? ' (' + e.pos + ')' : '') : 'the team') + (e.opp ? ' vs ' + ((BSU.data && BSU.data.opponents && BSU.data.opponents[e.opp] && BSU.data.opponents[e.opp].name) || e.opp) : '') + (e.year ? ', year ' + e.year : ''); }
  function hofLine(h) {
    h = h || {};
    const name = typeof h === 'string' ? h : (h.name || 'Unknown');
    const sub = typeof h === 'string' ? '' : [h.pos, h.hometown, h.year ? 'year ' + h.year : (h.inducted ? 'inducted year ' + h.inducted : '')].filter(Boolean).join(' · ');
    const why = typeof h === 'string' ? '' : (h.why || h.note || h.reason || ''), line = typeof h === 'string' ? '' : (h.line || '');
    return { left: name + (sub ? ' · ' + sub : ''), right: why || line, sub: why && line ? line : '' };
  }
  function refreshFootball(s, host) {
    const box = host._football; if (!box) return;
    const sp = s.sports || {}, R = (sp.records && typeof sp.records === 'object') ? sp.records : {};
    const key = JSON.stringify([sp.hasTeam, sp.record, R, sp.lastSummary && [sp.lastSummary.day, sp.lastSummary.opp]]);
    if (host._fbKey === key) return; host._fbKey = key; clear(box);
    const row = function (k, v, cls_) { const r = el('div', 'row' + (cls_ ? ' ' + cls_ : '')); r.appendChild(el('span', 'k', k)); r.appendChild(el('span', 'v', v)); box.appendChild(r); return r; };
    const sub = function (t) { box.appendChild(el('div', 'alm-sub', t)); };
    const at = R.allTime || { wins: 0, losses: 0 }, played = fin(at.wins, 0) + fin(at.losses, 0);
    if (!sp.hasTeam && !played) { box.appendChild(el('div', 'row', 'No football yet: build a Practice Field.')); return; }
    row('All-time record', at.wins + '–' + at.losses + (played ? ' (' + Math.round(100 * at.wins / played) + '%)' : ''));
    if (sp.hasTeam) row('This season', fin(sp.record && sp.record.wins, 0) + '–' + fin(sp.record && sp.record.losses, 0));
    const seasons = Array.isArray(R.seasons) ? R.seasons : [];
    sub('Season history');
    if (!seasons.length) box.appendChild(el('div', 'row dim', 'No completed seasons yet.'));
    else seasons.slice(-8).reverse().forEach(function (x) { const t = seasonLine(x); row(t.left, t.right); if (t.sub) box.appendChild(el('div', 'alm-note', t.sub)); });
    sub('Record book');
    const bw = R.bestWin; row('Best win', bw ? ('vs ' + (bw.oppName || bw.opp) + ' ' + fin(bw.score && bw.score[0], 0) + '–' + fin(bw.score && bw.score[1], 0) + ' (+' + fin(bw.margin, 0) + '), year ' + fin(bw.year, 0)) : '—');
    const lp = R.longestPlay; row('Longest play', lp ? (lp.yds + ' yd ' + (lp.type || '') + (lp.name ? ' · ' + lp.name + (lp.pos ? ' (' + lp.pos + ')' : '') : '') + (lp.year ? ', year ' + lp.year : '')) : '—');
    const book = R.book || {};
    Object.keys(BOOK_LABEL).forEach(function (k) { const e = book[k]; if (e && fin(e.v, 0) > 0) row(BOOK_LABEL[k], fin(e.v, 0) + ' · ' + bookWho(e)); });
    const sb = R.seasonBests; if (sb && fin(sb.year, 0) > 0 && fin(sb.pts, 0) > 0) row('This season\'s best', fin(sb.pts, 0) + ' pts · ' + fin(sb.totalYds, 0) + ' total yds · margin ' + signed(sb.margin, 1));
    sub('Hall of Fame');
    const hof = Array.isArray(R.hof) ? R.hof : [];
    if (!hof.length) box.appendChild(el('div', 'row dim', 'No one enshrined yet.'));
    else hof.slice(-8).reverse().forEach(function (h) { const t = hofLine(h); row(t.left, t.right); if (t.sub) box.appendChild(el('div', 'alm-note', t.sub)); });
    const ls = sp.lastSummary;
    if (ls) { sub('Last game'); row((ls.won ? 'W ' : 'L ') + fin(ls.score && ls.score[0], 0) + '–' + fin(ls.score && ls.score[1], 0) + ' ' + (ls.home ? 'vs ' : 'at ') + (ls.oppName || ls.opp), ls.mvp ? 'MVP ' + ls.mvp.name + ': ' + ls.mvp.line : ''); }
  }
  function refreshAlmanac(s, host) {
    if (!host) return;
    clear(host._achievements);
    const rows = (BSU.data && BSU.data.milestones) || [];
    rows.forEach(function (m) {
      const earned = call('progress', 'earned', s, m.id);
      const t = el('div', 'bud-col' + (earned ? '' : ' locked'));
      t.appendChild(el('div', 'k', m.name)); t.appendChild(el('div', 'v', earned ? 'Earned' : m.text));
      host._achievements.appendChild(t);
    });
    if (yearOf(s) < 2) { clear(host._sparks); const ctx = host._sparks.getContext && host._sparks.getContext('2d'); if (ctx && typeof ctx.fillRect === 'function') { ctx.fillStyle = '#1A1230'; ctx.fillRect(0, 0, host._sparks.width, host._sparks.height); } }
    else drawSparklines(s, host._sparks);

    clear(host._storms);
    const log = (s.storms && s.storms.log) || [];
    if (!log.length) host._storms.appendChild(el('div', 'row', 'No storms yet.'));
    else log.forEach(function (e) {
      const r = el('div', 'row'); r.appendChild(el('span', 'k', 'Y' + e.year + ' ' + e.name + ' Cat ' + e.cat));
      r.appendChild(el('span', 'v', (e.nearMiss ? 'near miss' : (money(e.damage) + ', ' + e.tarps + ' tarps')) + ' · ' + (e.held ? 'held' : 'breached')));
      host._storms.appendChild(r);
    });

    clear(host._gators);
    const wl = s.wildlife || {};
    const relocations = fin(wl.relocations, 0);
    const incidents = Array.isArray(wl.incidents) ? wl.incidents.length : fin(wl.incidents, 0);
    const photos = fin(wl.leGrandPhotoYear, 0);
    host._gators.appendChild(el('div', 'row')); host._gators.lastChild.appendChild(el('span', 'k', 'Relocations')); host._gators.lastChild.appendChild(el('span', 'v', String(relocations)));
    const r2 = el('div', 'row'); r2.appendChild(el('span', 'k', 'Incidents')); r2.appendChild(el('span', 'v', String(incidents))); host._gators.appendChild(r2);
    const r3 = el('div', 'row'); r3.appendChild(el('span', 'k', 'Le Grand')); r3.appendChild(el('span', 'v', photos > 0 ? ('photographed (Y' + photos + ')') : 'not yet sighted')); host._gators.appendChild(r3);

    refreshFootball(s, host);

    clear(host._recaps);
    const rec = call('progress', 'recap', s);
    if (!rec) host._recaps.appendChild(el('div', 'row', "No Founders' Day recap yet."));
    else {
      const lines = Array.isArray(rec.lines) ? rec.lines : [];
      if (!lines.length) host._recaps.appendChild(el('div', 'row', 'Another year on the ridge.'));
      else lines.forEach(function (l) { host._recaps.appendChild(el('div', 'row', String(l))); });
    }
  }
  UI.registerPanel('almanac', { build: buildAlmanac, refresh: refreshAlmanac, events: ['calendar:year', 'milestone:earned', 'storm:passed'] });

  // ===========================================================================
  // Cards this module owns
  // ===========================================================================
  UI.registerCard('newsflash', function (s, p) {
    p = p || {};
    const year1Hint = yearOf(s) === 1 ? ' Pause to plan.' : '';
    return {
      id: 'newsflash', kicker: 'Breaking', title: 'HURRICANE ' + String(p.name || '').toUpperCase(),
      body: 'Cat ' + fin(p.forecastCat, p.cat) + ' ± 1 · landfall ' + (p.landfallDay >= 0 ? BSU.formatDate(p.landfallDay) : 'soon') + '.' + year1Hint,
      actions: [{ label: 'Prepare', primary: true, fn: function () { UI.openPanel('storm'); } }, { label: 'Later' }]
    };
  });
  UI.registerCard('wetfeet', function (s, p) {
    p = p || {};
    let bId = fin(p.building, -1);
    if (bId < 0) { const fl = call('hydro', 'floodedBuildings', s) || []; if (fl.length) bId = fl[0]; }
    const bName = bId >= 0 ? nameOf(s, bId) : 'a building';
    return {
      id: 'wetfeet', kicker: 'Wet Feet', title: bName + ' took on water',
      body: ['Pilings − 25% on this building, from now on.', 'A canal within 2 tiles drains it faster.', 'A levee ring keeps the next storm out.'],
      actions: [{ label: 'Add Pilings', primary: true, fn: function () { if (bId >= 0) { const r = call('buildings', 'retrofitPilings', s, bId); if (r && !r.ok) notify(s, r.reason); } } }, { label: 'Later' }]
    };
  });
  UI.registerCard('failure', function (s, p) {
    p = p || {};
    const def = (BSU.data && BSU.data.failureCards && BSU.data.failureCards[p.kind]) || { title: 'The Board has concerns', options: [] };
    const opts = Array.isArray(p.options) && p.options.length ? def.options.filter(function (o) { return p.options.indexOf(o.id) >= 0; }) : def.options;
    let answered = false;
    const actions = opts.map(function (o) {
      return { label: o.text.length > 60 ? o.text.slice(0, 57) + '…' : o.text, fn: function (st) { if (answered) return true; answered = true; call('progress', 'answerFailure', st, p.kind, o.id); } };
    });
    if (p.kind === 'bankruptcy') actions.push({ label: 'Not now', fn: function (st) { if (answered) return true; answered = true; call('progress', 'answerFailure', st, p.kind, null); } });
    return { id: 'failure', kicker: 'Failure', title: def.title, body: opts.map(function (o) { return o.text; }), actions: actions, modal: true };
  });
  UI.registerCard('damage', function (s, p) {
    const report = (p && p.report) || { bill: 0, tarps: 0, held: [], overtopped: [], breached: [], flooded: [], choices: {}, name: '', cat: 0 };
    const lines = [];
    lines.push((report.held || []).length + ' levee tiles held, ' + (report.overtopped || []).length + ' overtopped, ' + (report.breached || []).length + ' breached.');
    const floodedNames = (report.flooded || []).map(function (id) { return nameOf(s, id); }).filter(Boolean);
    lines.push(floodedNames.length ? ('Flooded: ' + floodedNames.join(', ')) : 'Nothing flooded.');
    const choiceKeys = Object.keys(report.choices || {});
    if (choiceKeys.length) lines.push(choiceKeys.map(function (k) { return capitalize(k) + ': ' + String(report.choices[k]); }).join(' · '));
    if (call('progress', 'timer', s, 'insurance')) lines.push('Insurance paid 50% of repairs.');
    return {
      id: 'damage', kicker: (report.name || 'Storm') + ' · Cat ' + fin(report.cat, 0), title: 'Damage report: ' + money(report.bill),
      body: [report.tarps + ' blue tarps.'].concat(lines),
      actions: [{ label: 'Repair All ' + money(report.bill), primary: true, fn: function (st) { call('buildings', 'repairAll', st); call('buildings', 'repairAllLevees', st); } }, { label: 'Later' }],
      onClose: function (st) { call('weather', 'closeReport', st); }
    };
  });
  UI.registerCard('hire', function (s, p) {
    p = p || {};
    const candidates = (s.sports && s.sports.candidates) || [];
    const coachFee = fin(PSP.coachFee, 100000);
    const body = candidates.map(function (c) { return c.name + ' ' + '★'.repeat(fin(c.stars, 0)) + ' · ' + (c.rep || '') + ' · ' + money(coachFee * fin(c.stars, 0)); });
    const actions = candidates.map(function (c, i) { return { label: 'Hire ' + c.name, fn: function (st) { const r = call('sports', 'hireCoach', st, i); if (r && !r.ok) notify(st, r.reason, 'sports'); } }; });
    actions.push({ label: 'Decide later', primary: true });
    return { id: 'hire', kicker: 'Coaching search', title: 'Three candidates', body: body.length ? body : ['No candidates yet.'], actions: actions };
  });

  // ===========================================================================
  // Card openers (D44: one opener per card). ui.js leaves these subscriptions to
  // this module (see '## ui.js' in INTEGRATION_NOTES: the econ:card listener
  // there is a deliberate no-op comment).
  // ===========================================================================
  function on(name, fn) { try { BSU.events.on(name, function (p) { try { fn(p || {}); } catch (e) { BSU.error('ui_panels', 'on:' + name, e); } }, 'ui_panels'); } catch (e) { BSU.error('ui_panels', 'subscribe:' + name, e); } }
  on('storm:report', function (p) { const s = BSU.state; if (s) UI.card(s, 'damage', { report: p.report }); });
  on('storm:named', function (p) { const s = BSU.state; if (s) UI.card(s, 'newsflash', p); });
  on('board:offered', function (p) { const s = BSU.state; if (s) UI.card(s, 'board', { cards: p.cards }); });
  on('econ:card', function (p) { const s = BSU.state; if (s) UI.card(s, 'failure', { kind: p.kind, options: p.options }); });
  on('milestone:earned', function (p) { const s = BSU.state; if (s && p.id === 'wetFeet') UI.card(s, 'wetfeet', {}); });
  on('objective:progress', function (p) { const s = BSU.state; if (s && String(p.id) === '8' && p.capped) UI.card(s, 'obj8', { students: fin(s.economy && s.economy.students, 0) }); });

  // ===========================================================================
  // Pure, DOM-free self-tests (BSU.ui.selfTest() runs these; no document access)
  // ===========================================================================
  UI._tests = UI._tests || [];
  UI._tests.push(function (s, A) {
    void s;
    for (const name of ['budget', 'storm', 'season', 'milestones', 'almanac']) {
      A(typeof UI.registerPanel === 'function', 'registerPanel exists');
    }
    for (const id of ['newsflash', 'wetfeet', 'failure', 'damage', 'hire', 'obj8', 'board', 'recap', 'charter', 'versionMismatch']) {
      A(typeof UI.cards[id] === 'function', 'card registered: ' + id);
    }
    const synGaps = { gaps: [{ name: 'cove mouth', len: 4, tiles: [], cx: 0, cy: 0 }], weak: [{ i: 19 * 64 + 44, integrity: 60 }, { i: 10 * 64 + 10, integrity: 65 }], gates: [{ i: 33 * 64 + 41, jammed: false }] };
    A(formatRingLine(5, synGaps) === 'Ring at 5 ft: 1 gap (cove mouth, 4 tiles) · 2 weak tiles (44, 19) · crossing (41, 33) closes', 'ring line formatter');
    const synBuildings = [{ type: 'dorm', wr: 3, cost: 700000 }, { type: 'water_tower', wr: 2, cost: 220000 }, { type: 'substation', wr: 2, cost: 250000 }, { type: 'poboy', wr: 1, cost: 60000 }, { type: 'dining_hall', wr: 3, cost: 500000 }];
    const ordered = synBuildings.slice().sort(windOrderCompare);
    A(ordered[0].type === 'water_tower' && ordered[1].type === 'substation', 'water tower then substation first');
    A(ordered[2].type === 'poboy' && ordered[2].wr === 1, 'then WR ascending');
    A(ordered[3].wr === 3 && ordered[4].wr === 3 && ordered[3].cost >= ordered[4].cost, 'equal WR sorts by cost descending');
    A(LEDGER_INC[0] === 'tuition' && LEDGER_EXP[0] === 'salaries', 'budget key order matches ARCHITECTURE §2.7');
  });
})();
