'use strict';
// ============================================================================
// BAYOU STATE — ui_panels.js (module 16) → extends BSU.ui
// Owns: the Budget, Storm, Season, Milestones (replaces the built-in fallback)
// and Almanac panels, plus the cards ui.js's notes leave to this module:
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
    host.appendChild(el('div', 'panel-title', 'Storm')); host.firstChild.id = 'storm-title';
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
    if (!storm) { setText(host.firstChild, 'STORM · no storm in the Gulf'); show(host._cone, false); setText(host._ring, ''); setText(host._reached, ''); clear(host._windList); clear(host._log); show(host._testcat, false); return; }
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
    setText(host.firstChild, 'HURRICANE ' + (storm.name || '').toUpperCase() + ' · Cat ' + fc + ' (±1) · landfall in ' + days + ' days · surge ' + H + ' ft');
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
  // SEASON panel
  // ===========================================================================
  function buildSeason(host) {
    host.appendChild(el('div', 'panel-title', 'Season'));
    host._schedule = el('div'); host._schedule.id = 'sea-schedule'; host.appendChild(host._schedule);
    host._next = el('div', 'row'); host._next.id = 'sea-next'; host.appendChild(host._next);
    host.appendChild(el('div', 'card-kicker', 'Team rating'));
    host._rating = el('div'); host._rating.id = 'sea-rating'; host.appendChild(host._rating);

    host._coach = el('div', 'row'); host._coach.id = 'sea-coach'; host.appendChild(host._coach);
    host._candidates = el('div'); host.appendChild(host._candidates);
    const coachActs = el('div', 'card-actions');
    // #btn-hire stands in only when no candidates are drawn yet; once they are (offseason, or a
    // 3-game rivalry losing streak), the per-candidate buttons below are the real hire action and
    // this one hides (its own click would be ambiguous with three names on offer).
    host._hire = btn('btn-hire', 'Hire', 'small', function () { notify(stateFor(host), 'No candidates yet', 'sports'); });
    host._fire = btn('btn-fire', 'Fire ($500k)', 'small danger', function () { const r = call('sports', 'fireCoach', stateFor(host)); if (r && !r.ok) notify(stateFor(host), r.reason, 'sports'); });
    coachActs.appendChild(host._hire); coachActs.appendChild(host._fire); host.appendChild(coachActs);
    host._starters = el('div'); host._starters.id = 'sea-starters'; host.appendChild(host._starters);

    host._recruit = el('div', 'row'); host.appendChild(host._recruit);

    const rowEl = function (label, control) { const r = el('div', 'row'); r.appendChild(el('span', 'k', label)); r.appendChild(control); host.appendChild(r); return r; };
    host._night = btn('chk-night', 'Off', 'toggle', function () { const s = stateFor(host); call('sports', 'setNight', s, !(s.sports && s.sports.nightToggle)); refreshSeason(s, host); }); rowEl('Night games', host._night);
    host._autosim = btn('chk-autosim', 'Off', 'toggle', function () { const s = stateFor(host); call('sports', 'setAutoSim', s, !(s.sports && s.sports.autoSim)); refreshSeason(s, host); }); rowEl('Auto-sim home games', host._autosim);
    const segP = el('div', 'seg'); segP.id = 'seg-permits'; ['Paid', 'Free'].forEach(function (lab, k) { const v = k === 0 ? 'paid' : 'free'; const b = btn(null, lab, 'seg-btn', function () { call('sports', 'setPermits', stateFor(host), v); refreshSeason(stateFor(host), host); }); b.dataset.v = v; segP.appendChild(b); }); host._permits = segP; rowEl('Tailgate permits', segP);
    const segH = el('div', 'seg'); segH.id = 'seg-homecoming'; [0, 50000, 150000].forEach(function (v) { const b = btn(null, v === 0 ? '$0' : money(v), 'seg-btn', function () { const r = call('sports', 'setHomecomingBudget', stateFor(host), v); if (r && r.ok === false) notify(stateFor(host), r.reason); refreshSeason(stateFor(host), host); }); b.dataset.v = String(v); segH.appendChild(b); }); host._homecoming = segH; rowEl('Homecoming budget', segH);

    host._upgrade = btn('btn-upgrade', 'Upgrade', 'small', function () { doUpgrade(host); }); host.appendChild(host._upgrade);

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
  function refreshSeason(s, host) {
    if (!host) return;
    const sp = call('sports', 'season', s) || { hasTeam: false, schedule: [], record: { wins: 0, losses: 0 }, coach: {}, starters: [] };
    clear(host._schedule);
    if (!sp.hasTeam) host._schedule.appendChild(el('div', 'row', 'No team yet: build a Practice Field.'));
    else {
      (sp.schedule || []).forEach(function (e) {
        const opp = (BSU.data && BSU.data.opponents && BSU.data.opponents[e.opp]) || { name: e.opp, nick: '' };
        const r = el('div', 'row');
        let res = '—';
        if (e.cancelled) res = 'cancelled';
        else if (e.postponed && e.postponedTo >= 0) res = 'postponed → ' + BSU.formatDate(e.postponedTo);
        else if (e.played && e.result) res = e.result.won ? ('W ' + e.result.bsu + '–' + e.result.opp) : ('L ' + e.result.opp + '–' + e.result.bsu);
        r.appendChild(el('span', 'k', BSU.formatDate(e.day) + ' ' + opp.name + ' (' + opp.nick + ') ' + (e.home ? 'H' : 'A') + ' · ' + e.kind));
        r.appendChild(el('span', 'v', res));
        host._schedule.appendChild(r);
      });
    }
    const rec = sp.record || { wins: 0, losses: 0 };
    const up = call('sports', 'upcoming', s);
    if (up) {
      const opp = (BSU.data && BSU.data.opponents && BSU.data.opponents[up.opp]) || { name: up.opp };
      const p = call('sports', 'winProb', s, up.opp, !!up.night, !!up.home);
      setText(host._next, 'vs ' + opp.name + ' (' + fin(up.oppRating, 50) + ') · ' + call('sports', 'probWord', p) + ' · ' + Math.round(fin(p, 0.5) * 100) + '% · ' + (up.night ? 'night' : 'day') + ' · record ' + rec.wins + '-' + rec.losses);
    } else setText(host._next, 'No upcoming game · record ' + rec.wins + '-' + rec.losses);

    const rt = call('sports', 'rating', s) || { rating: 0, terms: {} };
    clear(host._rating);
    for (const k of Object.keys(rt.terms || {})) { const v = fin(rt.terms[k], 0); const r = el('div', 'row'); r.appendChild(el('span', 'k', capitalize(k))); r.appendChild(el('span', 'v', (v >= 0 ? '+' : '') + Math.round(v))); host._rating.appendChild(r); }
    const tot = el('div', 'row'); tot.appendChild(el('span', 'k', 'Total')); tot.appendChild(el('span', 'v', Math.round(fin(rt.rating, 0)))); host._rating.appendChild(tot);

    const coach = sp.coach || { name: '', stars: 0, rep: '' };
    setText(host._coach, 'Coach ' + (coach.name || '—') + ' ' + '★'.repeat(clamp(int(coach.stars, 0), 0, 5)) + '☆'.repeat(5 - clamp(int(coach.stars, 0), 0, 5)) + (coach.rep ? ' · "' + coach.rep + '"' : ''));
    const candidates = sp.candidates || [];
    clear(host._candidates);
    const coachFee = fin(PSP.coachFee, 100000), coachSign = fin(PSP.coachSign, 300000);
    if (candidates.length) candidates.forEach(function (c, i) {
      const r = el('div', 'row'); const stars = fin(c.stars, 0);
      r.appendChild(el('span', 'k', c.name + ' ' + '★'.repeat(stars) + ' · ' + (c.rep || '') + ' · needs ' + money(coachSign * stars) + '/yr budget'));
      const b = btn(null, 'Hire ' + money(coachFee * stars), 'small', function () { const res = call('sports', 'hireCoach', s, i); if (res && !res.ok) notify(s, res.reason, 'sports'); });
      r.appendChild(b); host._candidates.appendChild(r);
    });
    show(host._hire, candidates.length === 0); show(host._fire, !!(coach && coach.name));

    clear(host._starters);
    (sp.starters || []).forEach(function (st) { const r = el('div', 'row'); r.appendChild(el('span', 'k', (st.pos || '') + ' ' + (st.name || '') + ' (' + (st.hometown || '') + ')')); r.appendChild(el('span', 'v', String(fin(st.rating, 0)))); host._starters.appendChild(r); });

    const rc = s.sports && s.sports.recruit;
    if (rc && !rc.answered) {
      clear(host._recruit);
      host._recruit.appendChild(el('span', 'k', 'Recruit: ' + rc.pos + ' ' + rc.name + ' (' + rc.hometown + ') − ' + money(rc.price)));
      const signB = btn(null, 'Sign', 'small', function () { call('sports', 'answerRecruit', s, true); refreshSeason(s, host); });
      const passB = btn(null, 'Pass', 'small', function () { call('sports', 'answerRecruit', s, false); refreshSeason(s, host); });
      const v = el('span', 'v'); v.appendChild(signB); v.appendChild(passB); host._recruit.appendChild(v);
      show(host._recruit, true);
    } else show(host._recruit, false);

    const hasStadium2 = call('buildings', 'has', s, 'stadium', 2);
    show(host._night, hasStadium2 === true);
    if (hasStadium2) { const on = !!(s.sports && s.sports.nightToggle); setText(host._night, on ? 'On' : 'Off'); host._night.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const autoOn = !!(s.sports && s.sports.autoSim); setText(host._autosim, autoOn ? 'On' : 'Off'); host._autosim.setAttribute('aria-pressed', autoOn ? 'true' : 'false');
    const permits = (s.sports && s.sports.permits) || 'paid'; for (const b of host._permits.children) cls(b, 'active', b.dataset.v === permits);
    const hb = fin(s.sports && s.sports.homecomingBudget, 0); for (const b of host._homecoming.children) cls(b, 'active', Number(b.dataset.v) === hb);

    const up2 = upgradeLabel(s); setText(host._upgrade, up2.label); host._upgrade.disabled = !!up2.disabled;

    if (s.sports && s.sports.game) {
      show(host._bug, true); const g = s.sports.game;
      const opp = (BSU.data && BSU.data.opponents && BSU.data.opponents[g.opp]) || { name: g.opp };
      setText(host._bug, 'BSU ' + fin(g.scores && g.scores[0], 0) + ' – ' + fin(g.scores && g.scores[1], 0) + ' ' + opp.name + ' · Q' + fin(g.quarter, 0));
    } else show(host._bug, false);
  }
  UI.scoreBug = function (state) { const host = UI.el && UI.el['panel-season']; if (host) refreshSeason(state, host); };
  UI.registerPanel('season', { build: buildSeason, refresh: refreshSeason, events: ['game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed', 'building:complete', 'building:upgraded'] });
  // ui.js does not call scoreBug itself (left to this module, D-note below): keep the bug live
  // every frame while a game is on by piggy-backing on the same events the panel listens to.
  try {
    BSU.events.on('game:score', function () { const s = BSU.state; if (s) UI.scoreBug(s); }, 'ui_panels');
    BSU.events.on('game:kickoff', function () { const s = BSU.state; if (s) UI.scoreBug(s); }, 'ui_panels');
    BSU.events.on('game:halftime', function () { const s = BSU.state; if (s) UI.scoreBug(s); }, 'ui_panels');
    BSU.events.on('game:final', function () { const s = BSU.state; if (s) UI.scoreBug(s); }, 'ui_panels');
  } catch (e) { BSU.error('ui_panels', 'scoreBug:subscribe', e); }

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
