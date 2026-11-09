'use strict';
// ============================================================================
// BAYOU STATE — icons.js (module 14b, before ui.js) → BSU.icons
// The one inline-SVG registry for every glyph of the DOM chrome (UI refresh U5, docs/UI_STYLE.md §6). Each icon is a list of path
// strings on a 24 × 24 grid, drawn as a 2 px round-capped stroke in `currentColor` (so the state layers, the selected looks and
// the colour-blind palette recolour it with `color`); a few are filled shapes (star, play arrows, the dot). No fill colour but
// `currentColor` / `none` exists anywhere in the registry (test/unit/icons.test.mjs and the selfTest enforce it).
//   icons.get(name, cls?) → a fresh <svg class="ic …" viewBox="0 0 24 24" data-icon="name">; cls adds classes ('sm' 18 px, 's20' 20 px, 'hidden', …)
//   icons.names() → every registered name, sorted;  icons.has(name);  icons.paths(name) → the path strings (a copy);  icons.isFilled(name)
//   icons.fromGlyph(char) → the registry name for an emoji / text glyph the game's data still carries (data.js requirement glyphs, alert specs)
//   icons.requested() / icons.missing() → the names asked for / asked for but absent (tests)
// Zero game state; the only DOM it touches is document.createElementNS (stub-safe: setAttribute / classList / appendChild only).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.icons = BSU.icons || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** name → path strings (24 × 24, stroke 2). The first blocks are docs/UI_STYLE.md §6 (U0–U4); the rest is U5. */
  const PATHS = {
    // chrome
    notifications: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 21h4'],
    notifications_off: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 21h4', 'M4 4l16 16'],
    layers: ['M12 3 3 8l9 5 9-5-9-5z', 'M3 12l9 5 9-5', 'M3 16l9 5 9-5'],
    map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
    more_horiz: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    close: ['M6 6l12 12', 'M18 6 6 18'],
    check: ['M5 12l4 4L19 7'],
    arrow_back: ['M19 12H5', 'M11 6l-6 6 6 6'],
    chevron_left: ['M15 6l-6 6 6 6'],
    chevron_right: ['M9 6l6 6-6 6'],
    expand_less: ['M6 15l6-6 6 6'],
    expand_more: ['M6 9l6 6 6-6'],
    open_in_full: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
    close_fullscreen: ['M20 10h-6V4', 'M14 10l7-7', 'M4 14h6v6', 'M10 14l-7 7'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M16.5 16.5 21 21'],
    push_pin: ['M12 17v5', 'M8 3h8l-1 6 3 3v2H6v-2l3-3z'],
    pause: ['M8 5v14', 'M16 5v14'],
    play_arrow: ['M8 5v14l11-7z'],
    play_arrow_left: ['M16 5v14L5 12z'],
    skip_next: ['M6 5l9 7-9 7z', 'M19 5v14'],
    swap_horiz: ['M4 12h16', 'M8 8l-4 4 4 4', 'M16 8l4 4-4 4'],
    undo: ['M9 7 5 11l4 4', 'M5 11h9a5 5 0 0 1 0 10h-3'],
    my_location: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
    snooze: ['M4 9h5l-5 6h5', 'M13 5h7l-7 9h7'],
    dot: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
    // status and feedback
    info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'],
    help: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7', 'M12 17h.01'],
    warning: ['M12 3 2 21h20z', 'M12 10v5', 'M12 18h.01'],
    error: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5v5', 'M12 16h.01'],
    check_circle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12.5l3 3 5-6'],
    star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
    star_border: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
    hourglass: ['M7 3h10', 'M7 21h10', 'M8 3c0 5 4 5 4 9s-4 4-4 9', 'M16 3c0 5-4 5-4 9s4 4 4 9'],
    // the stat chips and the brand
    paid: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 6.5v11', 'M14.8 9.3c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2 0 2.7 5.6 1.3 5.6 4.1 0 1.3-1.3 2-2.8 2-1.4 0-2.5-.7-2.9-1.7'],
    group: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20a6 6 0 0 1 12 0', 'M16 5.5a3 3 0 0 1 0 5.5', 'M21 20a6 6 0 0 0-4.5-5.8'],
    crowd: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20a6 6 0 0 1 12 0', 'M16 5.5a3 3 0 0 1 0 5.5', 'M21 20a6 6 0 0 0-4.5-5.8'],
    mood: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 14.5a4.5 4.5 0 0 0 7 0', 'M9 10h.01', 'M15 10h.01'],
    mood_neutral: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9 15h6', 'M9 10h.01', 'M15 10h.01'],
    mood_bad: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 16.5a4.5 4.5 0 0 1 7 0', 'M9 10h.01', 'M15 10h.01'],
    eco: ['M5 19c0-8 5-13 14-13 0 9-5 13-11 13', 'M5 19l7-7'],
    construction: ['M4 20l7-7', 'M9 11l5-5 4 4-5 5z', 'M15 5l2-2 4 4-2 2'],
    delete: ['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13', 'M10 11v5', 'M14 11v5'],
    volume_up: ['M4 10v4h4l5 4V6L8 10z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a7.5 7.5 0 0 1 0 11'],
    volume_off: ['M4 10v4h4l5 4V6L8 10z', 'M16 9l5 6', 'M21 9l-5 6'],
    // the Menu list
    settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    calendar: ['M5 5h14v15H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
    flag: ['M6 21V4', 'M6 5h11l-2 4 2 4H6'],
    list: ['M5 6h14', 'M5 12h14', 'M5 18h9'],
    football: ['M4 20C4 10 10 4 20 4c0 10-6 16-16 16z', 'M9 15l6-6', 'M11 9l4 4'],
    landscape: ['M3 19l6-10 4 6 3-4 5 8z'],
    cyclone: ['M12 12h.01', 'M12 8a4 4 0 0 1 4 4 6 6 0 0 1-6 6 8 8 0 0 1-8-8 10 10 0 0 1 10-10'],
    // sky and weather (the date chip)
    sunny: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6l1.4 1.4', 'M17 17l1.4 1.4', 'M5.6 18.4 7 17', 'M17 7l1.4-1.4'],
    sunrise: ['M3 19h18', 'M7 19a5 5 0 0 1 10 0', 'M12 7v3', 'M5.6 11.6l1.4 1.4', 'M18.4 11.6 17 13'],
    sunset: ['M3 19h18', 'M7 19a5 5 0 0 1 10 0', 'M9 22h6', 'M5.6 11.6l1.4 1.4', 'M18.4 11.6 17 13'],
    moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
    cloud: ['M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1A4.5 4.5 0 0 1 17 18z'],
    rainy: ['M7 14a4 4 0 0 1-.5-7.5 5.5 5.5 0 0 1 10.6-.5A4 4 0 0 1 17 14z', 'M8 17l-1 3', 'M12 17l-1 3', 'M16 17l-1 3'],
    storm: ['M7 13a4 4 0 0 1-.5-7.5 5.5 5.5 0 0 1 10.6-.5A4 4 0 0 1 17 13', 'M12.5 11l-2.5 4h3.5L11 20'],
    thermostat: ['M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z', 'M12 9v7'],
    // alert strip kinds and issue kinds (the Alerts rows use the issue glyph names)
    bolt: ['M13 3 5 13.5h6L10 21l9-11.5h-6z'],
    drop: ['M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5z'],
    no_water: ['M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5z', 'M4 4l16 16'],
    wave: ['M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0', 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0'],
    crack: ['M13 3l-3 6 4 3-4 4 3 5'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1'],
    sandbag: ['M4 18v-1c0-2 1-3 3-3h10c2 0 3 1 3 3v1z', 'M7 14c0-2 1-4 3-4h4c2 0 3 2 3 4'],
    bug: ['M12 7c2.2 0 3.5 1.8 3.5 4.5S14.2 18 12 18s-3.5-3.8-3.5-6.5S9.8 7 12 7z', 'M10 5l2-2 2 2', 'M8.5 10H5', 'M8.5 14l-3 2', 'M15.5 10H19', 'M15.5 14l3 2'],
    mosquito: ['M12 7c2.2 0 3.5 1.8 3.5 4.5S14.2 18 12 18s-3.5-3.8-3.5-6.5S9.8 7 12 7z', 'M10 5l2-2 2 2', 'M8.5 10H5', 'M8.5 14l-3 2', 'M15.5 10H19', 'M15.5 14l3 2'],
    gator: ['M2 16c2 0 3-1 5-1h7l2-2 4 1.5v2.5l-2 1H5.5C4 18 3 17 2 16z', 'M16 14h.01'],
    pets: ['M12 20c-3 0-5-1.5-5-3.5 0-2.5 3-4.5 5-4.5s5 2 5 4.5c0 2-2 3.5-5 3.5z', 'M6 10.5h.01', 'M9.5 7h.01', 'M14.5 7h.01', 'M18 10.5h.01'],
    // build requirements (the detail NEEDS list and the card chips)
    walk: ['M13 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M12 8l-2 5 3 2v6', 'M10 13l-3 3', 'M12 8l3 2.5 2.5.5'],
    road: ['M8 3 5 21', 'M16 3l3 18', 'M12 5v2', 'M12 11v2', 'M12 17v2'],
    pilings: ['M6 4v13', 'M12 4v13', 'M18 4v13', 'M3 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0']
  };
  const FILLED = { star: true, play_arrow: true, play_arrow_left: true, dot: true };
  /** the emoji / text glyphs data.js and other modules still carry in content → their registry names */
  const GLYPH = { '⚡': 'bolt', '💧': 'drop', '🚶': 'walk', '🛣': 'road', '🪵': 'pilings', '↔': 'swap_horiz', '🌀': 'cyclone', '🦟': 'mosquito', '🌡': 'thermostat', '🌊': 'wave', '🚱': 'no_water', '🐊': 'gator', '🐾': 'pets', '⛈': 'storm', '🌧': 'rainy', '☀': 'sunny', '🌙': 'moon', '🌅': 'sunrise', '🌆': 'sunset', '★': 'star', '✓': 'check', '✕': 'close', '⚠': 'warning', '🔊': 'volume_up', '🔇': 'volume_off', '🔔': 'notifications', '🔕': 'notifications_off', '⌖': 'my_location', '↶': 'undo' };

  const asked = new Set(), absent = new Set();
  M.names = function () { return Object.keys(PATHS).sort(); };
  M.has = function (name) { return Object.prototype.hasOwnProperty.call(PATHS, name); };
  M.paths = function (name) { return M.has(name) ? PATHS[name].slice() : []; };
  M.isFilled = function (name) { return !!FILLED[name]; };
  M.fromGlyph = function (ch) { return Object.prototype.hasOwnProperty.call(GLYPH, ch) ? GLYPH[ch] : null; };
  M.requested = function () { return Array.from(asked).sort(); };
  M.missing = function () { return Array.from(absent).sort(); };
  M.get = function (name, cls_) {
    asked.add(name); if (!M.has(name)) absent.add(name);
    const s = document.createElementNS(SVG_NS, 'svg');
    s.classList.add('ic'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.dataset.icon = name;
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    if (cls_) for (const c of String(cls_).split(' ')) if (c) s.classList.add(c);
    const filled = !!FILLED[name];
    for (const d of (PATHS[name] || [])) {
      const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d);
      if (filled) { p.setAttribute('fill', 'currentColor'); p.setAttribute('stroke', 'none'); }
      s.appendChild(p);
    }
    return s;
  };

  /** a structural check of one path string: commands from the SVG alphabet, the right count of numbers after each, finite numbers */
  M.pathValid = function (d) {
    if (typeof d !== 'string' || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(d) || !/^\s*[Mm]/.test(d)) return false;
    const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
    const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g; let m, n = 0;
    while ((m = re.exec(d))) {
      n++; const k = ARGS[m[1].toLowerCase()]; const body = m[2].trim();
      const nums = body === '' ? [] : body.replace(/([0-9])-/g, '$1 -').replace(/(\.[0-9]+)(?=\.)/g, '$1 ').split(/[\s,]+/).filter(Boolean);
      if (!nums.every(function (x) { return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(x); })) return false;
      if (k === 0) { if (nums.length) return false; } else if (nums.length === 0 || nums.length % k !== 0) return false;
    }
    return n > 0;
  };

  M.selfTest = function () {
    const notes = []; let fails = 0; const n0 = Object.keys(PATHS).length;
    const A = function (c, m) { if (!c) { fails++; notes.push(m); } };
    try {
      A(n0 >= 60, 'at least 60 icons (' + n0 + ')');
      for (const n of M.names()) {
        const ps = PATHS[n]; A(Array.isArray(ps) && ps.length > 0, n + ': has paths');
        for (const d of ps) A(M.pathValid(d), n + ': path parses (' + d.slice(0, 24) + ')');
        const s = M.get(n, 'sm'); A(s.getAttribute('viewBox') === '0 0 24 24' && s.dataset.icon === n && s.classList.contains('ic') && s.classList.contains('sm'), n + ': svg shell');
      }
      A(M.get('nope').dataset.icon === 'nope' && M.missing().indexOf('nope') >= 0, 'unknown name → empty svg, recorded as missing'); absent.delete('nope'); asked.delete('nope');
      for (const ch in GLYPH) A(M.has(GLYPH[ch]), 'glyph ' + ch + ' → ' + GLYPH[ch] + ' exists');
    } catch (e) { fails++; notes.push('threw: ' + (e && e.message)); }
    return { ok: fails === 0, notes: notes.join('; ') || n0 + ' icons' };
  };
})();
