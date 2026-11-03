// Shared QA helpers on top of test/browser.mjs (real Chrome over the DevTools protocol, no npm deps).
// Used by play.mjs, fps.mjs and shots.mjs; see tools/qa/README.md.
//
//   import { openGame, parseArgs, ... } from './lib.mjs';
//   const g = await openGame({ index, width: 1440, height: 900, dpr: 2, size: 96, seed: 42 });
//   g.place('dorm', x, y);  await g.waitBake();  await g.shot('name');  const s = await g.sample(150);  await g.close();
//
// Headless Chrome here is software-raster (--disable-gpu) and deviceScaleFactor is fixed at 1, so timings are
// relative (before / after), never absolute. dpr 2 is emulated by redefining window.devicePixelRatio + a resize event.
import { launch } from '../../test/browser.mjs';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const GAME_ROOT = resolve(here, '..', '..');
export const DEFAULT_INDEX = join(GAME_ROOT, 'index.html');
export const DEFAULT_OUT = join(here, 'out');
export const FIXTURE_V1 = join(GAME_ROOT, 'test', 'fixtures', 'save_v1_seed42.json');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** the dense campus: the showpieces once each (they take the ridge first), then small buildings and plants round-robin until the target */
export const CAMPUS_CORE = ['dorm', 'dining_hall', 'lecture_hall', 'library', 'engineering', 'union', 'rec_center', 'health_center', 'res_tower', 'suites', 'greek_house', 'bunkhouse', 'coastal_institute', 'bell_tower', 'tiger_habitat', 'dorm', 'dining_hall', 'lecture_hall'];
export const CAMPUS_FILL = ['poboy', 'quad', 'substation', 'water_tower', 'generator', 'parking', 'pond', 'live_oak', 'cypress', 'azalea', 'bat_house', 'preserve', 'abatement', 'live_oak', 'azalea', 'cypress'];

/** kill every stray headless Chrome this harness started (same line as the README) */
export function killStrays() { try { execSync(`pkill -f 'user-data-dir=.*bsu-chrome-'`, { stdio: 'ignore' }); } catch { /* none running */ } }

/**
 * Minimal flag parser. spec: { name: { type: 'str'|'num'|'bool'|'list', def } }; `--name value`, `--name=value`, bare `--flag` for bool.
 * Positional arguments come back in `_`. Unknown flags throw, so a typo never silently runs the wrong check.
 */
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (const k of Object.keys(spec)) out[k] = spec[k].def;
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let v; const eq = a.indexOf('='); if (eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
    const name = a.slice(2); const s = spec[name];
    if (!s) throw new Error('unknown flag --' + name + ' (known: ' + Object.keys(spec).map((k) => '--' + k).join(' ') + ')');
    if (s.type === 'bool') { out[name] = v === undefined ? true : v !== 'false'; continue; }
    if (v === undefined) v = argv[++i];
    if (v === undefined) throw new Error('--' + name + ' needs a value');
    out[name] = s.type === 'num' ? Number(v) : s.type === 'list' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
    if (s.type === 'num' && !Number.isFinite(out[name])) throw new Error('--' + name + ' needs a number, got ' + v);
  }
  return out;
}

/** "--size 96|64" → [96, 64] (default both); a single value → [n] */
export function sizesOf(v, def = [96, 64]) { if (v === undefined || v === null || v === '' || v === 'both') return def; const n = Number(v); if (n !== 64 && n !== 96) throw new Error('--size must be 64 or 96'); return [n]; }

const KEYCODES = { ' ': 'Space', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '+': 'Equal', '.': 'Period', Shift: 'ShiftLeft', Alt: 'AltLeft', Control: 'ControlLeft', Meta: 'MetaLeft' };
function codeOf(key) { if (KEYCODES[key]) return KEYCODES[key]; if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase(); if (/^[0-9]$/.test(key)) return 'Digit' + key; return key; }

/**
 * Launch Chrome, open the page (default: the repo index.html; pass `index` for an A/B against another copy), set dpr and optionally start a
 * game with the title hidden and the coach marks marked as seen. Returns the game handle `g` (see the methods below).
 *
 * opts: { index, width=1280, height=800, dpr=1, newGame=true, size=96, seed=42, skipTutorial=true, noGuard=false, bootWait=1500 }
 */
export async function openGame(opts = {}) {
  const o = Object.assign({ index: DEFAULT_INDEX, width: 1280, height: 800, dpr: 1, newGame: true, size: 96, seed: 42, skipTutorial: true, noGuard: false, bootWait: 1500, evalTimeoutMs: 60000 }, opts);
  if (!o.index.startsWith('http') && !existsSync(resolve(o.index))) throw new Error('index not found: ' + o.index);
  const b = await launch({ width: o.width, height: o.height });
  const g = { b, opts: o, width: o.width, height: o.height, outDir: o.outDir || DEFAULT_OUT, notes: [] };
  // every page evaluation has a timeout: a page stuck in a loop must fail the check, not hang the run (the caller then relaunches)
  /** where is a stuck page? A second DevTools client pauses the debugger and reads the top frames (index.html line numbers: sed -n Np index.html) */
  const pageStack = async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${b.port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
      const page = list.find((t) => t.type === 'page'); if (!page) return '';
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await Promise.race([new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), new Promise((_, rej) => setTimeout(() => rej(new Error('devtools connect timed out')), 3000))]);
      return await new Promise((res) => {
        let n = 0; const done = (v) => { try { ws.close(); } catch { /* closed */ } res(v); };
        const t = setTimeout(() => done('(no stack: the debugger did not pause in 4 s)'), 4000);
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Debugger.paused') { clearTimeout(t); ws.send(JSON.stringify({ id: ++n + 10, method: 'Debugger.resume' })); done(d.params.callFrames.slice(0, 9).map((f) => `${f.functionName || '(anon)'} index.html:${f.location.lineNumber + 1}`).join(' < ')); } };
        ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' })); ws.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }));
      });
    } catch (e) { return '(stack capture failed: ' + e.message + ')'; }
  };
  // every page evaluation has a timeout: a page stuck in a loop must fail the check (with its stack), not hang the run (the caller then relaunches)
  const ev = (expr) => new Promise((res, rej) => {
    const t0 = Date.now();
    if (process.env.QA_TRACE === '2') console.error(`[qa eval ${new Date().toISOString().slice(14, 23)}] ${String(expr).slice(0, 110).replace(/\s+/g, ' ')}`);
    const t = setTimeout(async () => { const stack = await pageStack(); rej(new Error('page evaluation timed out after ' + (o.evalTimeoutMs / 1000) + 's (the page is stuck in a loop or very slow): ' + String(expr).slice(0, 80).replace(/\s+/g, ' ') + (stack ? ' | stack: ' + stack : ''))); }, o.evalTimeoutMs);
    b.eval(expr).then((v) => { clearTimeout(t); if (process.env.QA_TRACE && Date.now() - t0 > 2500) console.error(`[qa trace] ${((Date.now() - t0) / 1000).toFixed(1)}s ${String(expr).slice(0, 90).replace(/\s+/g, ' ')}`); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
  g.eval = ev;
  g.sleep = sleep;
  g.close = async () => { await b.close(); };

  // ---- errors: console.error / uncaught exceptions (b.errors) plus the game's own BSU.error log (BSU.errors: signature → count) ----
  g.bsuErrors = async () => (await ev(`(window.BSU && BSU.errors) ? Array.from(BSU.errors.entries()).map(function (e) { return e[0] + (e[1] > 1 ? ' x' + e[1] : ''); }) : []`)) || [];
  /** warnings logged via console.warn (not failures by themselves; play.mjs reports and counts them) */
  g.warnings = () => b.logs.filter((l) => /^(warning|warn):/.test(l));
  /** a marker for "errors since here": { c: console count, w: warning count, e: BSU.error signatures already seen } */
  g.mark = async () => ({ c: b.errors.length, w: g.warnings().length, e: new Set(await g.bsuErrors()) });
  /** every error since `mark` (console errors, exceptions, new BSU.error signatures) as an array of strings */
  g.errorsSince = async (mark = { c: 0, e: new Set() }) => {
    const out = b.errors.slice(mark.c).map((s) => s.slice(0, 300));
    for (const e of await g.bsuErrors()) if (!mark.e.has(e)) out.push('BSU.error ' + e.slice(0, 300));
    return out;
  };
  g.warningsSince = (mark) => g.warnings().slice(mark ? mark.w : 0);

  // ---- display ----
  /** emulate devicePixelRatio (CDP deviceScaleFactor is fixed at 1 here): redefine it and fire a resize so render.resize() re-reads it */
  g.setDpr = async (dpr) => {
    await ev(`(function () { Object.defineProperty(window, 'devicePixelRatio', { get: function () { return ${Number(dpr)}; }, configurable: true }); window.dispatchEvent(new Event('resize')); })()`);
    await sleep(150);
    g.dpr = Number(dpr);
  };
  /** turn the 60-frames-over-25-ms performance-mode guardrail off (software raster would trip it at dpr 2 and change what is drawn) */
  g.noGuard = async () => ev(`(function () { try { BSU.params.render.perfFrameMs = 1e9; if (BSU.state && BSU.state.ui) BSU.state.ui.perfMode = false; return BSU.params.render.perfFrameMs === 1e9; } catch (e) { return false; } })()`);

  // ---- game lifecycle ----
  g.hasBSU = async () => ev(`!!(window.BSU && BSU.session && BSU.headless && BSU.render)`);
  /** start a game, hide the title, mark the coach tour seen. Returns the first snapshot. */
  g.newGame = async ({ seed = o.seed, skipTutorial = o.skipTutorial, size = o.size, hideTitle = true, coachSeen = true } = {}) => {
    const r = await ev(`(function () { try {
      BSU.ui.settings().coachSeen = ${coachSeen ? 'true' : 'false'}; BSU.ui.saveSettings();
      BSU.session.newGame({ seed: ${seed}, skipTutorial: ${!!skipTutorial}, size: ${size} });
      ${hideTitle ? 'BSU.ui.showTitle(false);' : ''}
      BSU.ui.settings().coachSeen = ${coachSeen ? 'true' : 'false'}; BSU.ui.saveSettings();
      return JSON.stringify(BSU.headless.snapshot());
    } catch (e) { return 'ERR ' + (e && e.stack || e); } })()`);
    if (typeof r === 'string' && r.startsWith('ERR ')) throw new Error('newGame failed: ' + r);
    g.size = size; await sleep(150);
    return JSON.parse(r);
  };
  g.title = async (on = true) => ev(`(BSU.ui.showTitle(${!!on}), true)`);
  g.snapshot = async () => ev(`BSU.headless.snapshot()`);
  g.tick = async (n) => ev(`(BSU.headless.tick(${n | 0}), BSU.headless.snapshot())`);
  g.days = async (n) => ev(`(BSU.headless.fastForwardDays(${n | 0}), BSU.headless.snapshot())`);
  /** let every catalog row place regardless of students / prestige / milestones (QA scaffolding: patches progress.unlocked in the page; g.restoreUnlock() undoes it) */
  g.unlockAll = async () => ev(`(function () { if (!window.__qaUnlock) window.__qaUnlock = { u: BSU.progress.unlocked, o: BSU.progress.unlockOk }; BSU.progress.unlocked = function () { return true; }; BSU.progress.unlockOk = function () { return true; }; return true; })()`);
  g.restoreUnlock = async () => ev(`(function () { if (window.__qaUnlock) { BSU.progress.unlocked = window.__qaUnlock.u; BSU.progress.unlockOk = window.__qaUnlock.o; window.__qaUnlock = null; } return true; })()`);
  /**
   * find a tile near the founders plot where `id` places with a given access outcome (all other placement rules pass):
   *  want 'tie' (an auto-tie of minTie..maxTie tiles), 'touch' (already on the network), 'unlinked' (placeable, no tie reachable or noTie), 'refuse' (the "draw a path first" refusal).
   * Returns { tx, ty, tie } or null. Scans rings outward from the plot (rMin..rMax).
   */
  g.scan = async (id, { want = 'tie', minTie = 1, maxTie = 12, rMin = 3, rMax = 45, noTie = false, skip = [] } = {}) => ev(`(function () {
    var s = BSU.state, f = s.plot.founders, B = BSU.buildings, id = ${JSON.stringify(id)}, want = ${JSON.stringify(want)}, skip = ${JSON.stringify(skip)};
    for (var r = ${rMin | 0}; r <= ${rMax | 0}; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      var tx = f.tx + dx, ty = f.ty + dy; if (tx < 1 || ty < 1 || tx > BSU.MAP.W - 5 || ty > BSU.MAP.H - 5) continue;
      var near = false; for (var k = 0; k < skip.length; k++) if (Math.abs(skip[k][0] - tx) < 5 && Math.abs(skip[k][1] - ty) < 5) near = true; if (near) continue;
      var q = B.canPlace(s, id, tx, ty, { rot: 0, noTie: ${!!noTie}, ignoreCash: true });
      var n = q.connector && q.connector.tiles ? q.connector.tiles.length : 0;
      if (want === 'tie' && q.ok && n >= ${minTie | 0} && n <= ${maxTie | 0}) return { tx: tx, ty: ty, tie: n };
      if (want === 'touch' && q.ok && !n && !q.unlinked) return { tx: tx, ty: ty, tie: 0 };
      if (want === 'unlinked' && q.ok && q.unlinked) return { tx: tx, ty: ty, tie: n };
      if (want === 'refuse' && !q.ok && q.reason === B.TIE_REASON) return { tx: tx, ty: ty, tie: 0 };
    }
    return null;
  })()`);
  g.cash = async (v) => ev(`(BSU.state.economy.cash = ${Number(v)}, BSU.state.economy.cash)`);

  // ---- placing (the same validation / cost path as the UI) ----
  g.findSpot = async (id) => ev(`BSU.headless.findSpot(${JSON.stringify(id)})`);
  g.place = async (id, x, y) => ev(`(function () { var r = BSU.headless.place(${JSON.stringify(id)}, ${x | 0}, ${y | 0}); return { ok: !!r.ok, reason: r.reason || null, cost: r.cost || 0, connector: r.connector ? { tiles: r.connector.tiles.length, cost: r.connector.cost } : null }; })()`);
  /** findSpot + place in one go: { ok, x, y, reason } */
  g.placeAnywhere = async (id) => { const p = await g.findSpot(id); if (!p) return { ok: false, reason: 'no legal spot' }; const r = await g.place(id, p.x, p.y); return Object.assign({ x: p.x, y: p.y }, r); };
  /** ring-scan from the founders plot for any legal spot (not limited to the start charter like findSpot) and place there: { ok, x, y, reason } */
  g.placeScan = async (id, { rMin = 2, rMax = 40 } = {}) => ev(`(function () {
    var s = BSU.state, f = s.plot.founders, B = BSU.buildings, id = ${JSON.stringify(id)};
    for (var r = ${rMin | 0}; r <= ${rMax | 0}; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      var tx = f.tx + dx, ty = f.ty + dy; if (tx < 1 || ty < 1 || tx > BSU.MAP.W - 3 || ty > BSU.MAP.H - 3) continue;
      var q = B.canPlace(s, id, tx, ty, { rot: 0, ignoreCash: true });
      if (q.ok) { var p = BSU.headless.place(id, tx, ty); return { ok: !!p.ok, x: tx, y: ty, reason: p.reason || null }; }
    }
    return { ok: false, reason: 'no legal spot' };
  })()`);
  g.buildingCount = async () => ev(`BSU.state.buildings.filter(Boolean).length`);

  // ---- camera / geometry ----
  g.setZoom = async (z) => ev(`(BSU.render.setZoom(${Number(z)}), BSU.render.perf().zoom)`);
  g.panToTile = async (tx, ty) => ev(`(BSU.render.panToTile(${tx}, ${ty}, false), true)`);
  /** screen pixel of a tile (CSS px, canvas space) */
  g.tilePx = async (tx, ty) => ev(`BSU.render.tileToScreen(${tx}, ${ty})`);
  /** centre the camera on the founders plot (the campus) */
  g.centerCampus = async () => ev(`(function () { var f = BSU.state.plot && BSU.state.plot.founders; if (f) BSU.render.panToTile(f.tx + 1, f.ty + 1, false); return !!f; })()`);
  /** centre the camera on the middle of the map */
  g.centerMap = async () => ev(`(BSU.render.panToTile(BSU.MAP.W >> 1, BSU.MAP.H >> 1, false), true)`);

  // ---- input ----
  /** a synthetic KeyboardEvent on window (what the game listens to). opts: { shift, alt, ctrl, meta, holdMs, repeat, code, up:false for keydown only } */
  g.keyDown = async (key, { shift = false, alt = false, ctrl = false, meta = false, repeat = false, code } = {}) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code || codeOf(key))}, shiftKey: ${shift}, altKey: ${alt}, ctrlKey: ${ctrl}, metaKey: ${meta}, repeat: ${repeat}, bubbles: true, cancelable: true })), true`);
  g.keyUp = async (key, { shift = false, alt = false, ctrl = false, meta = false, code } = {}) => ev(`window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code || codeOf(key))}, shiftKey: ${shift}, altKey: ${alt}, ctrlKey: ${ctrl}, metaKey: ${meta}, bubbles: true, cancelable: true })), true`);
  g.key = async (key, o2 = {}) => {
    const holdMs = o2.holdMs || 0;
    // a modified key is preceded by its modifier's own keydown, as a real keyboard does (the game tracks Shift / Alt held)
    if (o2.shift) await g.keyDown('Shift', { shift: true });
    if (o2.alt) await g.keyDown('Alt', { alt: true });
    await g.keyDown(key, o2);
    if (holdMs) await sleep(holdMs);
    await g.keyUp(key, o2);
    if (o2.alt) await g.keyUp('Alt');
    if (o2.shift) await g.keyUp('Shift');
    await sleep(o2.settleMs ?? 60);
  };
  /** a real mouse click at canvas pixels through CDP (pointer events → offsetX / offsetY) */
  g.click = async (x, y, o2 = {}) => { await b.click(x, y, o2); await sleep(o2.settleMs ?? 60); };
  /**
   * a click with modifier keys held, as DOM pointer events on the world canvas (CDP mouse events here carry no modifiers, and the game
   * re-reads Alt / Shift from every pointer event). Used for Alt = "no tie" and Shift = flush placement.
   */
  g.clickMods = async (x, y, { alt = false, shift = false, ctrl = false } = {}) => {
    await ev(`(function () {
      var c = BSU.ui.el.world, r = c.getBoundingClientRect(), o = { clientX: r.left + ${x}, clientY: r.top + ${y}, button: 0, buttons: 1, altKey: ${alt}, shiftKey: ${shift}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true };
      c.dispatchEvent(new PointerEvent('pointermove', o)); c.dispatchEvent(new PointerEvent('pointerdown', o)); o.buttons = 0; c.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()`);
    await sleep(80);
  };
  g.clickTile = async (tx, ty, o2 = {}) => { const p = await g.tilePx(tx, ty); await g.click(p.x, p.y, o2); return p; };
  /** click a DOM element by CSS selector (its centre); false when missing or hidden */
  g.clickEl = async (sel) => {
    const r = await ev(`(function () { var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; var q = e.getBoundingClientRect(); if (!q.width || !q.height || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
    if (!r) return false; await g.click(r.x, r.y); return true;
  };
  g.elVisible = async (sel) => ev(`(function () { var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; var q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.classList.contains('hidden'); })()`);
  g.elText = async (sel) => ev(`(function () { var e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || e.textContent || '') : null; })()`);
  /** let the game run: wait `ms` of wall time (the rAF loop and HUD keep updating) */
  g.wait = sleep;
  /** wait for `cond` (a JS expression, truthy) up to timeoutMs; returns the last value */
  g.until = async (cond, timeoutMs = 4000, step = 100) => { const t0 = Date.now(); let v; do { v = await ev(cond); if (v) return v; await sleep(step); } while (Date.now() - t0 < timeoutMs); return v; };

  // ---- UI helpers (real clicks on real DOM) ----
  /** close whatever can block a click: open cards, the notification stack, optionally the open panel (never the armed tool) */
  g.clearUi = async ({ panel = true } = {}) => {
    await ev(`(function () { try { BSU.ui.closeCard(); } catch (e) {} try { BSU.ui.dismissNotifs(); } catch (e) {} ${panel ? 'try { if (BSU.state.ui.panel) BSU.ui.openPanel(null); } catch (e) {}' : ''} return true; })()`);
    await sleep(60);
  };
  /** wait until the camera stops moving (pan eases, zoom steps): two identical readings 70 ms apart */
  g.settleCamera = async (maxMs = 2500) => {
    const t0 = Date.now(); let prev = '';
    for (;;) {
      const cur = await ev(`(function () { var c = BSU.state.ui.camera; return [c.x, c.y, c.zoom].join(','); })()`);
      if (cur === prev) return true; prev = cur;
      if (Date.now() - t0 > maxMs) return false; await sleep(70);
    }
  };
  /** centre the camera on a tile, let it settle, then click it (the centre of the screen is clear of every HUD part) */
  g.clickTileCentered = async (tx, ty, o2 = {}) => {
    await g.panToTile(tx, ty); await sleep(100); await g.settleCamera();
    const p = await g.tilePx(tx, ty); await g.click(p.x, p.y, o2); return p;
  };
  /** arm a catalog tool the way a player does: open its palette tab, click its item. Falls back to selectTool (noted) when the item is not clickable. */
  g.pickTool = async (id) => {
    const tab = await ev(`(function () { var t = BSU.data.tabs.find(function (t) { return t.rows.indexOf(${JSON.stringify(id)}) >= 0; }); return t ? t.id : null; })()`);
    if (tab && (await ev(`BSU.state.ui.paletteTab`)) !== tab) { await g.clickEl(`#palette-tabs .tab[data-tab="${tab}"]`); await sleep(100); }
    const clicked = await g.clickEl(`#palette-items [data-id="${id}"]`);
    await sleep(100);
    const armed = await ev(`(BSU.ui.tool() && BSU.ui.tool().id) || null`);
    if (armed !== id) { g.notes.push(`pickTool(${id}): palette click armed ${armed}; used selectTool`); await ev(`(BSU.ui.selectTool(BSU.state, ${JSON.stringify(id)}), true)`); await sleep(100); return (await ev(`(BSU.ui.tool() && BSU.ui.tool().id) || null`)) === id; }
    return clicked;
  };
  /** the visible buttons inside a container whose text contains `text` → click the first; false when none */
  g.clickButtonText = async (containerSel, text) => {
    const r = await ev(`(function () { var c = document.querySelector(${JSON.stringify(containerSel)}); if (!c) return null; var bs = Array.from(c.querySelectorAll('button')); for (var i = 0; i < bs.length; i++) { var e = bs[i], q = e.getBoundingClientRect(); if (q.width > 0 && q.height > 0 && (e.textContent || '').indexOf(${JSON.stringify(text)}) >= 0) return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; } return null; })()`);
    if (!r) return false; await g.click(r.x, r.y); return true;
  };
  /**
   * advance the sim by `ticks` in slices (BSU.headless.tick), pausing `frameMs` between slices so the rAF loop renders real frames
   * through whatever is happening (a hurricane, a night game). `each(i)` runs after every slice and may return true to stop early.
   */
  g.run = async (ticks, { slice = 40, frameMs = 25, each } = {}) => {
    let done = 0, i = 0;
    while (done < ticks) {
      const n = Math.min(slice, ticks - done); await ev(`(BSU.headless.tick(${n}), true)`); done += n; i++;
      await sleep(frameMs);
      if (each && (await each(i, done))) break;
    }
    return done;
  };

  // ---- a dense campus (QA scaffolding: unlocks everything, big cash, places through BSU.headless, completes construction) ----
  /**
   * Place ~`target` things (buildings and plants; plants are not in state.buildings) round-robin from `ids` via findSpot + place (the UI's validation path), then run `days` days so they finish,
   * add students and regenerate the agents so the crowd is realistic. Returns { count, placed: {id: n}, refused: {id: reason} }.
   */
  g.buildCampus = async ({ target = 46, core = CAMPUS_CORE, fill = CAMPUS_FILL, days = 40, students = 2500, stadium = false } = {}) => {
    await g.cash(1e10); await g.unlockAll();
    const placed = {}, refused = {}; let count = await g.buildingCount();
    const run = async (ids, roundRobin) => {
      const live = ids.slice(); let k = 0, misses = 0;
      while (count < target && live.length && (!roundRobin || misses < live.length * 2)) {
        const id = roundRobin ? live[k++ % live.length] : live.shift();
        let r = await g.placeAnywhere(id);
        if (!r.ok && /no legal spot/.test(r.reason || '')) r = await g.placeScan(id);   // the start charter is full: any legal tile on the map
        if (r.ok) { placed[id] = (placed[id] || 0) + 1; count++; misses = 0; if (!roundRobin) continue; }
        else { misses++; refused[id] = r.reason; if (roundRobin && /no legal spot/.test(r.reason || '')) { const at = live.indexOf(id); if (at >= 0) live.splice(at, 1); } }
      }
    };
    if (stadium) for (const id of ['practice_field', 'stadium']) { const r = await g.placeAnywhere(id); if (r.ok) { placed[id] = 1; count++; } else refused[id] = r.reason; }   // first: it needs the biggest flat piece of the ridge
    await run(core, false);
    await g.days(25);   // five complete buildings close the tutorial's tie window, so the fill below can place without a path
    await run(fill, true);
    if (count < target) {   // the start charter is full: buy neighbouring state sections (force skips cash and prestige) and fill those
      await ev(`(function () { for (var k = 0; k < 6; k++) { var s = BSU.land.sections(BSU.state).filter(function (x) { return x.forSale && !x.owned; }); if (!s.length) break; BSU.headless.charter(s[0].id, true); } return true; })()`);
      await run(fill, true);
    }
    await g.days(Math.max(15, days - 25));
    if (stadium) { await ev(`(function () { var b = BSU.state.buildings.filter(function (b) { return b && b.type === 'stadium'; })[0]; if (b) BSU.buildings.upgrade(BSU.state, b.id); return true; })()`); await g.days(40); }
    if (students) await ev(`(BSU.economy.addStudents(BSU.state, ${students | 0}, 'qa'), BSU.agents.regenerate(BSU.state), true)`);
    await g.clearUi();
    return { count: await g.buildingCount(), placements: Object.values(placed).reduce((a, b) => a + b, 1), placed, refused };
  };
  /**
   * a night home game at Stadium II (the campus needs buildCampus({ stadium: true })): run into the night, then take the camera back from
   * the set piece so the frame is the campus under the lights. Returns true when the sky is night with the game still running.
   */
  g.startNightGame = async () => {
    const r = await ev(`(function () { BSU.sports.setNight(BSU.state, true); return BSU.sports.playHome(BSU.state); })()`);
    if (!r || !r.ok) throw new Error('night game did not start: ' + (r && r.reason));
    await g.run(700, { slice: 25, frameMs: 20, each: async () => (await ev(`BSU.weather.sky(BSU.state).phase`)) === 4 });
    const night = await ev(`BSU.weather.sky(BSU.state).phase === 4 && !!BSU.state.setPiece`);
    if (!night) g.notes.push('night game: the sky was not night while the game ran; the frame is not a night frame');
    await ev(`(BSU.render.captureCameraTouch(BSU.state), true)`);
    return night;
  };
  /** pan the camera `tiles` tiles toward the middle of the map (snap, no easing); returns the camera movement in px */
  g.panTowardCentre = async (tiles = 20) => ev(`(function () {
    var R = BSU.render, c0 = { x: BSU.state.ui.camera.x, y: BSU.state.ui.camera.y }, t = R.screenToTile(window.innerWidth / 2, window.innerHeight / 2);
    var dx = BSU.MAP.W / 2 - t.tx, dy = BSU.MAP.H / 2 - t.ty, n = Math.hypot(dx, dy) || 1;
    R.panToTile(t.tx + dx / n * ${Number(tiles)}, t.ty + dy / n * ${Number(tiles)}, false);
    var c1 = BSU.state.ui.camera; return Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y));
  })()`);
  /**
   * Frame the campus: zoom, centre on the buildings' centroid, then (keepOnMap) nudge toward the map centre until the whole viewport (corners and edge
   * midpoints) lies on the map; keepOnMap:false keeps the campus dead centre (the screenshot matrix). Returns { onMap, inView, total }: how many buildings are inside the viewport.
   */
  g.frameCampus = async (zoom = 1, { keepOnMap = true } = {}) => {
    await g.setZoom(zoom);
    const r = await ev(`(function () {
      var s = BSU.state, R = BSU.render, W = BSU.MAP.W, H = BSU.MAP.H, vw = window.innerWidth, vh = window.innerHeight;
      var bs = s.buildings.filter(Boolean), cx = 0, cy = 0; bs.forEach(function (b) { cx += b.tx + b.w / 2; cy += b.ty + b.h / 2; }); cx /= Math.max(1, bs.length); cy /= Math.max(1, bs.length);
      var pts = [[0, 0], [vw, 0], [0, vh], [vw, vh], [vw / 2, 0], [vw / 2, vh], [0, vh / 2], [vw, vh / 2]];
      function onMap() { for (var i = 0; i < pts.length; i++) { var t = R.screenToTile(pts[i][0], pts[i][1]); if (!t || t.tx < 0 || t.ty < 0 || t.tx >= W || t.ty >= H) return false; } return true; }
      var mx = W / 2, my = H / 2, n = 0; R.panToTile(cx, cy, false);
      while (${keepOnMap} && !onMap() && n++ < 80) { cx += (mx - cx) * 0.06; cy += (my - cy) * 0.06; R.panToTile(cx, cy, false); }
      var inView = bs.filter(function (b) { var p = R.tileToScreen(b.tx + b.w / 2, b.ty + b.h / 2); return p && p.x > 0 && p.y > 0 && p.x < vw && p.y < vh; }).length;
      return { onMap: onMap(), inView: inView, total: bs.length, centre: [Math.round(cx), Math.round(cy)] };
    })()`);
    await g.settleCamera();
    return r;
  };

  // ---- baking / frames / shots ----
  /**
   * Wait until every VISIBLE chunk is baked at the wanted master (the HD chunk bake is time-sliced: ~1 upgrade per frame with headroom),
   * stays so for `stable` consecutive polls, then return { ok, ms, visible, polls }. `ok:false` on timeout (a warning, never an exception:
   * a machine that cannot keep up still gets its numbers, flagged). hdFallback (memory cap latch) counts as baked at master 1.
   */
  g.waitBake = async ({ timeoutMs = 45000, stable = 3, stallMs = 6000 } = {}) => {
    const t0 = Date.now(); let good = 0, polls = 0, last = null, best = Infinity, bestAt = t0;
    for (;;) {
      last = await ev(`(function () {
        // the same visibility test as render.chunkPass: a chunk is visible when its (origin - camera) * zoom box touches the viewport
        var R = BSU.render, PR = BSU.params.render, cam = BSU.state.ui.camera, z = cam.zoom, vw = window.innerWidth, vh = window.innerHeight;
        var CXN = Math.ceil(BSU.MAP.W / 8), CYN = Math.ceil(BSU.MAP.H / 8), CW = PR.chunkW || 512, CHH = PR.chunkH || 416;
        var info = R.hdInfo(), masters = R.chunkMasters(), want = info.chunkMaster | 0, vis = 0, pending = 0;
        for (var cy = 0; cy < CYN; cy++) for (var cx = 0; cx < CXN; cx++) {
          var o = R.chunkOrigin(cx, cy), hh = (cx === CXN - 1 || cy === CYN - 1) ? CHH + 80 : CHH;
          var dx = (o.ox - cam.x) * z + vw / 2, dy = (o.oy - cam.y) * z + vh / 2;
          if (dx > vw || dy > vh || dx + CW * z < 0 || dy + hh * z < 0) continue;
          var i = cx + cy * CXN; vis++;
          if (R.chunkDirty(i)) { pending++; continue; }
          if (want === 2 && masters[i] < 2 && !info.fallback && !info.atlasFallback) pending++;
        }
        return { vis: vis, pending: pending, want: want, hdChunks: info.hdChunks, mb: info.chunkMB };
      })()`);
      polls++;
      if (last.pending === 0) { if (++good >= stable) return { ok: true, ms: Date.now() - t0, visible: last.vis, polls }; } else good = 0;
      if (last.pending < best) { best = last.pending; bestAt = Date.now(); }
      // no chunk has baked for stallMs: the rest cannot (the HD chunk byte cap holds them at master 1), so the frame is as settled as it gets
      if (last.pending > 0 && Date.now() - bestAt > stallMs) { g.notes.push(`bake settled with ${last.pending}/${last.vis} visible chunks still at master 1 (HD byte cap, ${last.mb} MB)`); return { ok: true, settled: true, pending: last.pending, ms: Date.now() - t0, visible: last.vis, polls }; }
      if (Date.now() - t0 > timeoutMs) { g.notes.push(`bake timeout: ${last.pending}/${last.vis} visible chunks pending`); return { ok: false, ms: Date.now() - t0, visible: last.vis, pending: last.pending, polls }; }
      await sleep(100);
    }
  };
  /** screenshot to <outDir>/<name>.png (creates the folder); returns the path */
  g.shot = async (name) => { mkdirSync(g.outDir, { recursive: true }); const p = join(g.outDir, name.endsWith('.png') ? name : name + '.png'); await b.screenshot(p); return p; };
  g.perf = async () => ev(`BSU.render.perf()`);
  /**
   * Sample n consecutive rAF frames, then read perf(): { n, ms, fps, frameMsMean, frameMsP95, ...perf fields (drawCalls, chunks, agentsDrawn, memMB, passMs…) }.
   * frameMs is the game's own main-thread time for the frame (read once per distinct frameNo), fps is rAF intervals (includes raster in headless).
   */
  g.sample = async (n = 150, { settle = 30 } = {}) => ev(`new Promise(function (resolve) {
    var N = ${n | 0}, S = ${settle | 0}, k = 0, seen = -1, ms = [], t0 = 0, tEnd = 0, tc0 = null, f0 = 0, bk0 = null;
    function f(t) {
      var p = BSU.render.perf();
      if (k < S) { k++; return requestAnimationFrame(f); }
      if (k === S) { t0 = t; tc0 = BSU.render.terrainCacheInfo(); f0 = p.frameNo; bk0 = BSU.render.hdInfo().bake; k++; return requestAnimationFrame(f); }
      if (p.frameNo !== seen) { seen = p.frameNo; ms.push(p.frameMs); }
      if (k - S - 1 < N) { k++; return requestAnimationFrame(f); }
      tEnd = t; var p2 = BSU.render.perf(), tc1 = BSU.render.terrainCacheInfo(), bk1 = BSU.render.hdInfo().bake, nf = Math.max(1, p2.frameNo - f0); ms.sort(function (a, c) { return a - c; });
      var sum = 0; for (var i = 0; i < ms.length; i++) sum += ms[i];
      resolve(Object.assign({}, p2, { n: N, wallMs: Math.round(tEnd - t0), fps: Math.round(N * 1000 / (tEnd - t0) * 10) / 10, frameMsMean: Math.round(sum / Math.max(1, ms.length) * 100) / 100, frameMsP95: ms.length ? Math.round(ms[Math.floor(ms.length * 0.95)] * 100) / 100 : 0, frames: ms.length, tcHitPct: Math.round((tc1.hits - tc0.hits) / nf * 1000) / 10, tcBuilds: tc1.builds - tc0.builds, bakes1: bk1.n1 - bk0.n1, bakes2: bk1.n2 - bk0.n2 }));
    }
    requestAnimationFrame(f);
  })`);

  // ---- boot ----
  g.open = async () => {
    await b.open(o.index);
    await sleep(o.bootWait);
    if (!(await g.hasBSU())) throw new Error('page loaded but window.BSU is missing: ' + (b.errors[0] || 'no console errors captured'));
    if (o.dpr && o.dpr !== 1) await g.setDpr(o.dpr);
    if (o.newGame) await g.newGame();
    if (o.noGuard) await g.noGuard();
    return g;
  };
  await g.open();
  return g;
}

// ---- helpers for the scripts that run several variants ----
/** a fixed-width table row for console output */
export function row(cols, widths) { return cols.map((c, i) => String(c).padEnd(widths[i] || 10)).join(' ').trimEnd(); }
/** the index paths of a run, resolved to absolute (relative paths are taken from the cwd) */
export function resolveIndex(p) { return p ? resolve(process.cwd(), p) : DEFAULT_INDEX; }
export function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
