#!/usr/bin/env node
// Real-Chrome harness over the DevTools protocol (no npm deps; Node 24 has fetch + WebSocket).
// Launches the installed Google Chrome headless, opens index.html via file://, collects console
// errors and uncaught exceptions, evaluates JS, dispatches clicks/keys, and captures screenshots.
//
// CLI:  node test/browser.mjs [--file index.html] [--wait 4000] [--shot out.png] [--eval "expr"]
//         [--click x,y] [--key Escape] [--size 1280x800] [--steps]  (steps: run a default scripted tour)
// API:  import { launch } from './browser.mjs'; const b = await launch(); await b.open(); ... await b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, port } = {}) {
  if (!CHROME) throw new Error('Google Chrome not found in /Applications');
  port = port || (9300 + Math.floor(Math.random() * 500));
  const profile = mkdtempSync(join(tmpdir(), 'bsu-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`, '--hide-scrollbars', '--allow-file-access-from-files', '--disable-gpu', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
  ], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 100; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (info.length) break; } catch {}
    await sleep(100);
  }
  if (!info || !info.length) { proc.kill(); throw new Error('Chrome did not start'); }
  const page = info.find(t => t.type === 'page') || info[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) listeners.forEach(fn => fn(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

  const errors = []; const logs = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`EXCEPTION: ${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`); }
    if (m.method === 'Runtime.consoleAPICalled') { const t = m.params.type; const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' '); logs.push(`${t}: ${text}`); if (t === 'error' || t === 'assert') errors.push(`console.${t}: ${text}`); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`LOG: ${m.params.entry.text}`);
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const b = {
    port, errors, logs,
    async open(file = join(here, '..', 'index.html')) {
      const url = file.startsWith('http') ? file : 'file://' + resolve(file);
      const loaded = new Promise(res => { const fn = (m) => { if (m.method === 'Page.loadEventFired') { res(); } }; listeners.push(fn); });
      await send('Page.navigate', { url }); await loaded; return b;
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async click(x, y, { button = 'left', clickCount = 1 } = {}) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
    },
    async move(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); },
    async drag(x1, y1, x2, y2, steps = 8) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, button: 'left' });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
    },
    async wheel(x, y, deltaY) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); },
    async key(key, { code, text } = {}) {
      const named = { Escape: 27, Enter: 13, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Tab: 9, Backspace: 8, Delete: 46 };
      const vk = named[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: text ?? (key.length === 1 ? key : undefined) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    },
    async screenshot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')); return path; },
    async wait(ms) { await sleep(ms); },
    async fps(ms = 2000) { return b.eval(`new Promise(r => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else r(Math.round(n * 1000 / (performance.now() - t0))); })(); })`); },
    async close() { try { ws.close(); } catch {} proc.kill(); await sleep(100); try { rmSync(profile, { recursive: true, force: true }); } catch {} },
  };
  return b;
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const [w, h] = (get('--size', '1280x800')).split('x').map(Number);
  const b = await launch({ width: w, height: h });
  let code = 0;
  try {
    await b.open(get('--file', join(here, '..', 'index.html')));
    await b.wait(Number(get('--wait', 3000)));
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--click') { const [x, y] = a[++i].split(',').map(Number); await b.click(x, y); await b.wait(300); }
      if (a[i] === '--key') { await b.key(a[++i]); await b.wait(300); }
      if (a[i] === '--eval') { console.log('eval →', JSON.stringify(await b.eval(a[++i]))); }
      if (a[i] === '--wait2') { await b.wait(Number(a[++i])); }
      if (a[i] === '--fps') { console.log('fps ≈', await b.fps(2000)); }
    }
    if (a.includes('--shot')) { console.log('screenshot →', await b.screenshot(get('--shot'))); }
    console.log(`console lines: ${b.logs.length}; errors: ${b.errors.length}`);
    for (const l of b.logs.slice(-15)) console.log('  ', l.slice(0, 300));
    for (const e of b.errors) console.error('  ', e.slice(0, 500));
    if (b.errors.length) code = 1;
  } catch (e) { console.error('harness error:', e.message); code = 2; }
  finally { await b.close(); }
  process.exit(code);
}
