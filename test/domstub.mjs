// Headless DOM/Canvas stub so the single-file game can be loaded and ticked in Node.
// Usage: import { loadGame } from './domstub.mjs'; const { win, ctx } = loadGame();
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function makeCtx2d(canvas) {
  const data = () => ({ data: new Uint8ClampedArray(Math.max(1, canvas.width * canvas.height) * 4), width: canvas.width, height: canvas.height });
  const gradient = () => ({ addColorStop() {} });
  const special = {
    canvas,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (typeof w === 'object' ? w.width * w.height : w * h)) * 4), width: typeof w === 'object' ? w.width : w, height: typeof w === 'object' ? w.height : h }),
    measureText: (t) => ({ width: String(t ?? '').length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
    createPattern: () => ({ setTransform() {} }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false, isPointInStroke: () => false,
    getLineDash: () => [],
  };
  const store = {};
  return new Proxy({}, {
    get(_, k) { if (k in special) return special[k]; if (k in store) return store[k]; if (typeof k === 'string') return () => {}; return undefined; },
    set(_, k, v) { store[k] = v; return true; },
  });
}

class ClassList { constructor() { this.s = new Set(); } add(...a) { a.forEach(x => this.s.add(x)); } remove(...a) { a.forEach(x => this.s.delete(x)); } toggle(x, f) { if (f === undefined) f = !this.s.has(x); f ? this.s.add(x) : this.s.delete(x); return f; } contains(x) { return this.s.has(x); } }

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.style = {}; this.classList = new ClassList(); this.children = []; this.childNodes = this.children;
    this.dataset = {}; this.attributes = {}; this._listeners = {}; this.parentNode = null; this.parentElement = null;
    this.innerHTML = ''; this.textContent = ''; this.innerText = ''; this.value = ''; this.checked = false; this.id = ''; this.title = '';
    this.width = 300; this.height = 150; this.scrollTop = 0; this.scrollLeft = 0; this.hidden = false; this.disabled = false;
  }
  get className() { return [...this.classList.s].join(' '); } set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; } get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstElementChild() { return this.firstChild; } get lastElementChild() { return this.lastChild; }
  get clientWidth() { return this.width; } get clientHeight() { return this.height; } get offsetWidth() { return this.width; } get offsetHeight() { return this.height; }
  get scrollHeight() { return this.height; } get scrollWidth() { return this.width; }
  getContext(type) { if (type === '2d') return this._ctx || (this._ctx = makeCtx2d(this)); return null; }
  toDataURL() { return 'data:image/png;base64,'; } toBlob(cb) { cb && cb(null); }
  transferControlToOffscreen() { return this; }
  appendChild(c) { this.children.push(c); c.parentNode = c.parentElement = this; return c; }
  append(...cs) { cs.forEach(c => typeof c === 'object' ? this.appendChild(c) : this.children.push(c)); }
  prepend(...cs) { cs.forEach(c => { this.children.unshift(c); if (typeof c === 'object') c.parentNode = c.parentElement = this; }); }
  insertBefore(c, ref) { const i = this.children.indexOf(ref); i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); c.parentNode = c.parentElement = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = c.parentElement = null; return c; }
  remove() { this.parentNode && this.parentNode.removeChild(this); }
  replaceChildren(...cs) { this.children.length = 0; this.append(...cs); }
  insertAdjacentHTML() {} insertAdjacentElement(_, el) { this.appendChild(el); }
  contains(c) { return c === this || this.children.some(x => x === c || (x.contains && x.contains(c))); }
  closest() { return null; } matches() { return false; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); } removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach(fn => fn.call(this, ev)); return true; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = v; } getAttribute(k) { return this.attributes[k] ?? null; } removeAttribute(k) { delete this.attributes[k]; } hasAttribute(k) { return k in this.attributes; }
  querySelector() { return null; } querySelectorAll() { return []; } getElementsByClassName() { return []; } getElementsByTagName() { return []; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height }; }
  focus() {} blur() {} click() {} scrollIntoView() {} requestPointerLock() {} requestFullscreen() { return Promise.resolve(); }
  setPointerCapture() {} releasePointerCapture() {} animate() { return { cancel() {}, finished: Promise.resolve() }; }
  cloneNode() { return new Element(this.tagName.toLowerCase()); }
}

export function makeWindow({ width = 1280, height = 720 } = {}) {
  const byId = new Map();
  const doc = new Element('#document');
  doc.body = new Element('body'); doc.head = new Element('head'); doc.documentElement = new Element('html');
  doc.documentElement.style = {}; doc.body.width = width; doc.body.height = height; doc.documentElement.width = width; doc.documentElement.height = height;
  doc.createElement = (tag) => { const el = new Element(tag); if (/canvas/i.test(tag)) { el.width = width; el.height = height; } return el; };
  doc.createElementNS = (_, tag) => doc.createElement(tag);
  doc.createTextNode = (t) => ({ textContent: t, nodeType: 3 });
  doc.createDocumentFragment = () => new Element('#fragment');
  doc.getElementById = (id) => byId.get(id) || null;
  doc.querySelector = (sel) => (sel && sel[0] === '#') ? (byId.get(sel.slice(1)) || null) : null;
  doc.querySelectorAll = () => [];
  doc.readyState = 'complete'; doc.visibilityState = 'visible'; doc.hidden = false; doc.title = '';
  doc.fonts = { ready: Promise.resolve(), load: () => Promise.resolve([]) };
  doc.exitPointerLock = () => {}; doc.exitFullscreen = () => Promise.resolve();
  const app = doc.createElement('div'); app.id = 'app'; app.width = width; app.height = height; byId.set('app', app); doc.body.appendChild(app);
  // track ids assigned after creation
  const origSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) { origSet.call(this, k, v); if (k === 'id') byId.set(String(v), this); };
  Object.defineProperty(Element.prototype, 'id', { get() { return this._id || ''; }, set(v) { this._id = v; if (v) byId.set(String(v), this); }, configurable: true });

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear(),
    key: (i) => [...storage.keys()][i] ?? null, get length() { return storage.size; },
  };

  let now = 0; const rafQueue = []; const timers = [];
  const win = {
    document: doc, localStorage, sessionStorage: { ...localStorage }, innerWidth: width, innerHeight: height, devicePixelRatio: 1, screen: { width, height },
    navigator: { userAgent: 'node-headless', language: 'en-US', maxTouchPoints: 0, platform: 'node', clipboard: { writeText: () => Promise.resolve() } },
    location: { href: 'file:///index.html', protocol: 'file:', search: '', hash: '', reload() {} }, history: { pushState() {}, replaceState() {} },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; }, cancelAnimationFrame: () => {},
    setTimeout: (fn, ms = 0, ...a) => { timers.push({ fn, at: now + ms, a }); return timers.length; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo() {}, alert() {}, confirm: () => true, prompt: () => null, open() {}, focus() {}, blur() {},
    console, Math, JSON, Date, Map, Set, WeakMap, WeakSet, Promise, Symbol, Proxy, Reflect, Array, Object, Number, String, Boolean, RegExp, Error, TypeError, RangeError,
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, structuredClone, queueMicrotask,
    Image: class { constructor() { this.onload = null; this.width = 1; this.height = 1; } set src(v) { this._src = v; } get src() { return this._src; } },
    OffscreenCanvas: class extends Element { constructor(w, h) { super('canvas'); this.width = w; this.height = h; } },
    HTMLCanvasElement: Element, HTMLElement: Element, Element, Event: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } preventDefault() {} stopPropagation() {} },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } preventDefault() {} stopPropagation() {} },
    KeyboardEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } preventDefault() {} stopPropagation() {} },
    MouseEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } preventDefault() {} stopPropagation() {} },
    PointerEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } preventDefault() {} stopPropagation() {} },
    Blob: class { constructor(parts) { this.parts = parts; } }, URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 2654435761) >>> 0; return a; }, randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    // no AudioContext on purpose: audio code must guard for its absence
    __headless: {
      advance(ms) { now += ms; const due = timers.filter(t => t.at <= now); timers.splice(0, timers.length, ...timers.filter(t => t.at > now)); due.forEach(t => t.fn(...t.a)); },
      frame(dtMs = 16.67) { now += dtMs; const q = rafQueue.splice(0); q.forEach(fn => fn(now)); return q.length; },
      get now() { return now; }, storage, byId,
    },
  };
  win.window = win; win.self = win; win.globalThis = win; win.top = win; win.parent = win;
  return win;
}

export function loadGame({ file = join(here, '..', 'index.html'), width, height } = {}) {
  const html = readFileSync(file, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no inline <script> in ' + file);
  const win = makeWindow({ width, height });
  const ctx = vm.createContext(win);
  vm.runInContext(m[1], ctx, { filename: 'index.html' });
  return { win, ctx };
}
