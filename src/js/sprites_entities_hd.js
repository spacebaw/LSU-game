'use strict';
// ============================================================================
// BAYOU STATE — sprites_entities_hd.js (H4 characters pass): the HD character / wildlife / vehicle composer, style C "soft rendered diorama".
// Owner: nothing in state (sheets and atlas entries are derived, seed-independent, never saved).
// Implements: docs/PLAN_HD_ART.md §4 row "H4 characters"; docs/ART_STYLE.md "## Brush API" (capsule / digits / orb / plane / stroke /
// shadow), "## Style C palette" (character knots); the B4 character language (docs/INTEGRATION_NOTES.md "## art pass B4") re-expressed
// through BSU.brush: one rig for everything that walks (joints → two-bone IK → yaw → projection → depth-sorted brush parts), re-skinned per
// family; animals and vehicles on the 2:1 ground projection; nothing hand-picks a gradient (the capsule / orb / plane primitives own them).
// Registered through BSU.sprites.registerHD(<family>, …) OVER the pen painters of sprites_entities.js (manifest order: this file loads
// right after it), for every family that walks, swims, drives or sits in a stand: agent / agentfar (15 anims × 8 facings, the 112 pooled
// looks: 6 skins, 8 hair colours, 6 styles, 16 outfits, hats, carried items, builds), officer (+ wrangle), band, krewe, gator (3 sizes),
// roux (on all fours), nutria, egret, spoonbill, fogger, bus, pirogue, navy, float, the football families (fbplayer poses, fbref, fbcrew,
// fbcheer, fbband, fbstaff, fbroux, fbfan, fbball, fbdown, fbstick) and the tailgate / critter props (tent, smoker, cornhole, snoball,
// bonfire, pelican, armadillo). gate / barrierGate / nest / bubble keep the pen (not characters).
// Cells: the pen's cell sizes, feet anchors and frame tables exactly (M.entityCells / fbSizes / fbAnchor / entFrames / fbFrames), so
// render's sort keys, shadow boxes, fbFrame / agentFrame packing and the 0.5× two-pose rule are untouched. The atlas keeps serving
// sub-rects of lazily baked SHEETS (one canvas per family | anim | variant | facing | master, every frame in a row), baked here at the
// master (1 = today's art px, 2 = HD) with the brush under a per-cell clip; a frame is still one drawImage of a cached cell.
// Budget: the pen's per-frame bake window (sprites.M._bake: armed by agentFrame, 3.2 ms) is shared — over it the default student's
// sheet of that pose stands in and the real look queues (M._hdBake.queue, pumped from the wrapped agentFrame); gcSheets / clearSheets /
// clearFootball are wrapped so the pen's re-registration (which would take the families back to the pen) re-registers the HD painters.
// lod: env.lod 0 at master 2 (eyes, hair detail, glasses, outfit marks, facemask bars, scutes, stripes, window panes); lod 1 at master 1
// keeps the silhouette, the outfit colours, hats, the jersey numbers and the contact shadow. agentfar (the 0.5× two-pose sheets) bakes at
// master 1 lod 1 then box-reduces each cell to 2×2 blocks (the B4 rule: the half-size nearest blit lands on screen pixels, no sparkle).
// Public (BSU.sprites): hdEntityFamilies(), hdEntityCells (frozen), hdSheetBytes(), hdSheetCount(), hdSheetStats(), HD_SHEET_LIMIT_MB,
// _hdBake ({queue, deferred, pumped}), hdCompose (the cell painters for tools / tests), entitiesHDSelfTest.
// Conventions: brush calls only (no createLinearGradient / createRadialGradient / createPattern, no fillText, no Math.random, no rng.fx);
// every jitter from BSU.rng.hash; deterministic in (id, variant, frame, master).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  const B = BSU.brush;
  if (!M || !B || typeof M.registerHD !== 'function' || typeof M.agentFrame !== 'function' || typeof M.stuStyle !== 'function' || typeof B.capsule !== 'function') return;
  const PAL = BSU.params.palette;
  const X = M.extra || {};
  const hash = BSU.rng.hash;
  const EC = M.entityConst || {};
  const FACINGS = 8, FPI = Math.PI;
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const fin = (v, d) => (Number.isFinite(v) ? v : d);

  // ---------------------------------------------------------------------------
  // Style C character palette (docs/ART_STYLE.md "## Style C palette", character rows) — bases only; the brush ramps them
  // ---------------------------------------------------------------------------
  const P1 = PAL.purple, P2 = PAL.purple2 || '#5E2CA5', GD = PAL.gold, GD2 = PAL.gold2 || '#F5B700';
  const C = Object.freeze({
    black: X.black || '#1B1B1B', white: X.white || '#FFFFFF', offWhite: X.offWhite || '#E8E8E8', eye: '#15151B', iris: '#FFF2A0', glassy: '#9ADCFF',
    khaki: '#C2B280', khakiDark: '#8E845A', ranger: '#4A3426', gatorBack: '#4A5A3A', gatorLegend: '#3C4A33', gatorFlank: '#6A7A48', gatorBelly: '#8A9A6A',
    mouth: '#C8707A', tooth: '#F4F0E0', gatorEye: '#C9B037', moss: '#8FA074', scar: '#B9C79A', ripple: '#8FC6AB', shallows: PAL.shallows || '#6FA895',
    tiger: X.tigerOrange || '#E07020', tigerBelly: '#F4EEE2', tigerNose: '#E7869A', tigerMouth: '#C8505C', nutria: '#6B4423', nutriaMuzzle: '#B89870', nutriaTooth: '#E8892A', ratTail: '#5A4A3A',
    egret: '#F4F4F4', egretBeak: '#E8B84A', egretLeg: '#2A2A30', spoonbill: '#F4A6C0', spoonbillNeck: '#FBE4EC', spoonbillWing: '#F08CAE', spoonbillBeak: '#9AA0A8', spoonbillLeg: '#B8506A',
    steel: X.steel || '#8A8A8E', steelDark: X.steelDark || '#6A6A70', chassis: '#4A4A52', cream: '#E8E8E8', glass: '#6FA0C8', tire: '#23232B', hub: '#9AA0A8', beacon: '#FF6A5A', beaconOff: '#7A2A2A',
    headlight: '#FFF1A8', nozzle: '#5A5A62', mist: '#F4F6F8', bark: PAL.bark || '#3A2A1E', paddle: '#B08D5E', vest: '#F07830', green: X.green || '#2E8B57', knee: '#7A5A3A', floatGator: '#4A7A3A',
    dough: '#C9964F', baby: '#F4D4B0', dust: PAL.gravel || '#C9B47C', denim: '#3B5BA0', cap: '#2A2A33', fan2: '#3B4F86', jerseyWhite: '#F4F4F4', mask: '#CFD3D8', ball: '#8B4A1E', lace: '#F4F4F4',
    shoeDark: '#1E1E22', refPants: '#1E1E22', crewPants: '#2B2B33', staffDark: '#23232B', headset: '#2A2A30', jug: '#F07830', pomWhite: '#F4F4F4', bookWhite: '#E8E8E8', cup: '#E8E8E8', lid: '#4A3426',
    poboy: '#C9964F', poboyPaper: '#EDEDED', lettuce: '#4E9A3A', phone: '#2A2A33', tote: '#D9C9A1', gown: '#2A2A33', tube: '#E8E8E8', tubeRed: '#D94A4A', umbShaft: '#3A3A44', binoc: '#2A2A33',
    armadillo: '#A89F8C', pelican: '#8C7B6B', beak: '#E8B84A', flame: X.flame || '#FFCB6B', ember: X.ember || '#E07020', red: PAL.danger || '#E0443E', waterBlue: PAL.waterBlue || '#4FA3D6', azalea: PAL.azalea || '#E75480'
  });
  const SKIN6 = (X.skins || ['#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3A1E', '#FFDBAC']).slice(0, 6);
  const HAIR8 = ['#1B1B1B', '#3A2A1E', '#6B4423', '#B0723C', '#E6C27A', '#C7692B', '#5E2CA5', '#EDE3CE'];                 // the students' (B4)
  const HAIRS = X.hairs || ['#1B1B1B', '#3A2A1E', '#6B4423', '#B0723C', '#E6C27A', '#A8A8A8', '#5E2CA5', '#C7692B'];      // the football families' (pass E)
  const ACC8 = ['#2A2A33', P1, GD, '#7C828C', '#3B4F86', '#B8A27A', '#2E7D7A', '#D96B52'];
  const skinOf = (n) => SKIN6[((n % 6) + 6) % 6], hairOf = (n) => HAIRS[((n % 8) + 8) % 8];

  // ---------------------------------------------------------------------------
  // Cells, anims and frame tables — the pen's (sprites_entities.js), mirrored so the two painters never differ in geometry
  // ---------------------------------------------------------------------------
  const SA = { walk: { n: 8, c: 'a' }, idle: { n: 3, c: 'a' }, flee: { n: 4, c: 'b' }, splash: { n: 6, c: 'a', water: 4 }, slap: { n: 2, c: 'a' }, cheer: { n: 2, c: 'b' }, sit: { n: 2, c: 'a' }, wave: { n: 2, c: 'b' }, tube: { n: 4, c: 'a', water: 1 }, umbrella: { n: 4, c: 'u' }, cap: { n: 8, c: 'b' }, beads: { n: 8, c: 'a' }, foam: { n: 8, c: 'b' }, selfie: { n: 2, c: 'a' }, binoculars: { n: 2, c: 'a' } };
  const SC = { a: { cw: 14, ch: 24, gy: 22 }, b: { cw: 16, ch: 28, gy: 26 }, u: { cw: 18, ch: 30, gy: 28 } };
  const SANIMS = Object.keys(SA);
  const ANIM_IX = {}; SANIMS.forEach((k, i) => { ANIM_IX[k] = i; });
  const FBL = { cw: 18, ch: 24, gy: 22, pitch: 0.42 };
  const POSES = { stance: 1, run: 6, throw: 2, catch: 2, tackle: 2, tackled: 1, celebrate: 2, huddle: 1 };
  const ROLES = ['line', 'skill', 'qb', 'k', 'back'];
  const CHEER = { cw: 18, ch: 28, gy: 25 }, BAND = { cw: 18, ch: 30, gy: 27 }, ROUXU = { cw: 24, ch: 32, gy: 29 };
  const FAN_DIM = { seated: { cw: 14, ch: 20, gy: 17 }, standing: { cw: 14, ch: 26, gy: 22 }, wave: { cw: 14, ch: 26, gy: 22 } };
  const GATORS = [{ L: 26, rb: 1.55, cw: 36, ch: 30 }, { L: 36, rb: 2.15, cw: 48, ch: 36 }, { L: 52, rb: 3.2, cw: 66, ch: 46 }];
  const GPER = 10, RPER = 10;
  const RX = { cw: 40, ch: 34, gy: 24, L: 26, rb: 3.0 }, NU = { cw: 18, ch: 14, gy: 10 }, BD = { cw: 26, ch: 22, gy: 17 }, WR = { cw: 36, ch: 32, gy: 24 };
  const FG = { cw: 44, ch: 30, gy: 21, per: 4 }, BS = { cw: 46, ch: 30, gy: 21, per: 2 }, BT = { cw: 36, ch: 28, gy: 16, per: 4 }, FL = { cw: 80, ch: 66, gy: 48, per: 2 };
  const PROPS = { tent: [16, 12, 1], smoker: [10, 8, 2], cornhole: [12, 6, 2], snoball: [14, 12, 2], bonfire: [12, 16, 3], pelican: [12, 10, 2], armadillo: [10, 6, 2] };
  /** 1× cell [w, h, gy] of every converted directional family (anchor = (−w/2, −gy)); tests compare it to the pen's M.entityCells / fbSizes */
  const CELLS = Object.freeze({
    agent: [14, 24, 22], 'agent:idle': [14, 24, 22], 'agent:sit': [14, 24, 22], 'agent:splash': [14, 24, 22], 'agent:slap': [14, 24, 22], 'agent:tube': [14, 24, 22], 'agent:beads': [14, 24, 22], 'agent:selfie': [14, 24, 22], 'agent:binoculars': [14, 24, 22],
    'agent:flee': [16, 28, 26], 'agent:cheer': [16, 28, 26], 'agent:wave': [16, 28, 26], 'agent:cap': [16, 28, 26], 'agent:foam': [16, 28, 26], 'agent:umbrella': [18, 30, 28],
    officer: [14, 24, 22], 'officer:wrangle': [WR.cw, WR.ch, WR.gy], band: [16, 28, 26], krewe: [16, 28, 26], roux: [RX.cw, RX.ch, RX.gy], nutria: [NU.cw, NU.ch, NU.gy], egret: [BD.cw, BD.ch, BD.gy], spoonbill: [BD.cw, BD.ch, BD.gy],
    fogger: [FG.cw, FG.ch, FG.gy], bus: [BS.cw, BS.ch, BS.gy], pirogue: [BT.cw, BT.ch, BT.gy], navy: [BT.cw, BT.ch, BT.gy], float: [FL.cw, FL.ch, FL.gy],
    fbplayer: [FBL.cw, FBL.ch, FBL.gy], fbref: [FBL.cw, FBL.ch, FBL.gy], fbcrew: [FBL.cw, FBL.ch, FBL.gy], fbstaff: [FBL.cw, FBL.ch, FBL.gy], fbcheer: [CHEER.cw, CHEER.ch, CHEER.gy], fbband: [BAND.cw, BAND.ch, BAND.gy], fbroux: [ROUXU.cw, ROUXU.ch, ROUXU.gy],
    'fbfan:standing': [14, 26, 22], 'fbfan:wave': [14, 26, 22], 'fbfan:seated': [14, 20, 17]
  });
  const FAMILIES = ['agent', 'agentfar', 'officer', 'band', 'krewe', 'gator', 'roux', 'nutria', 'egret', 'spoonbill', 'fogger', 'bus', 'pirogue', 'navy', 'float',
    'fbplayer', 'fbref', 'fbcrew', 'fbcheer', 'fbband', 'fbstaff', 'fbroux', 'fbfan', 'fbball', 'fbdown', 'fbstick', 'tent', 'smoker', 'cornhole', 'snoball', 'bonfire', 'pelican', 'armadillo'];

  // ---------------------------------------------------------------------------
  // Sheets: one canvas per (family | anim | variant | facing | master), every frame in a row at the master's scale, each cell clipped.
  // The painter returns the core's {canvas, sx, sy, sw, sh} sub-rect form (the atlas entry is not `own`: bytes are counted here).
  // ---------------------------------------------------------------------------
  const sheets = new Map();
  let hdFrame = 0, hdBytes = 0;
  M.HD_SHEET_LIMIT_MB = 24;   // the GC trigger (not a cap): master-2 sheets are 4× the pen's, so 4× its 6 MB
  const envOf = (master, far) => { const e = B.env(master === 2 ? 2 : 1); if (far) e.far = true; return e; };
  /** bake a sheet: drawFrame(ctx, f, env) draws one cell at (0, 0) … (cw, ch) in art px (the context is translated and clipped per cell) */
  function bakeSheet(key, fam, cw, ch, n, master, drawFrame, far) {
    const S = master === 2 ? 2 : 1, canvas = M.newCanvas(cw * n * S, ch * S), ctx = M.ctx2d(canvas), env = envOf(S, far);
    try { ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch (e) { /* stub */ }
    for (let f = 0; f < n; f++) {
      ctx.save(); ctx.translate(f * cw, 0); ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
      try { drawFrame(ctx, f, env); } catch (e) { try { BSU.error('sprites_entities_hd', 'bake:' + key, e); } catch (e2) { /* never throw */ } }
      ctx.restore();
    }
    if (far) farReduce(ctx, canvas, cw, ch, n, S);
    const s = { key: key, fam: fam, canvas: canvas, cellW: cw, cellH: ch, n: n, master: S, S: S, used: hdFrame, bytes: cw * n * S * ch * S * 4 };
    sheets.set(key, s); hdBytes += s.bytes;
    return s;
  }
  /** the B4 0.5× rule for smooth art: every cell is reduced 2×2 (box filter, smoothing on) and re-expanded to 2×2 blocks (nearest),
   *  so the entity pass's half-size nearest blit lands exactly on screen pixels: no sparkle, the shirt colour survives */
  let farTmp = null;
  function farReduce(ctx, canvas, cw, ch, n, S) {
    const hw = Math.ceil(cw * S / 2), hh = Math.ceil(ch * S / 2);
    if (!farTmp) farTmp = M.newCanvas(hw, hh);
    const tc = M.ctx2d(farTmp);
    try {
      if (farTmp.width < hw || farTmp.height < hh) { farTmp.width = Math.max(farTmp.width, hw); farTmp.height = Math.max(farTmp.height, hh); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); tc.setTransform(1, 0, 0, 1, 0, 0); tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
      for (let f = 0; f < n; f++) {
        tc.clearRect(0, 0, hw, hh); tc.drawImage(canvas, f * cw * S, 0, cw * S, ch * S, 0, 0, hw, hh);
        ctx.clearRect(f * cw * S, 0, cw * S, ch * S); ctx.imageSmoothingEnabled = false; ctx.drawImage(farTmp, 0, 0, hw, hh, f * cw * S, 0, hw * 2, hh * 2); ctx.imageSmoothingEnabled = true;
      }
    } catch (e) { /* stub canvas */ }
  }
  function sheetRef(s, frame, ox, oy) {
    const f = ((frame % s.n) + s.n) % s.n; s.used = hdFrame;
    return { w: s.cellW, h: s.cellH, ox: ox, oy: oy, canvas: s.canvas, sx: f * s.cellW * s.S, sy: 0, sw: s.cellW * s.S, sh: s.cellH * s.S };
  }
  function dropSheet(s) { sheets.delete(s.key); hdBytes -= s.bytes; if (s.nk !== undefined) numSheets.delete(s.nk); try { s.canvas.width = 1; s.canvas.height = 1; } catch (e) { /* stub */ } }
  function getSheet(key, fam, cw, ch, n, master, drawFrame, far) { let s = sheets.get(key); if (s) { s.used = hdFrame; return s; } return bakeSheet(key, fam, cw, ch, n, master, drawFrame, far); }
  M.hdSheetBytes = () => hdBytes;
  M.hdSheetCount = () => sheets.size;
  M.hdSheetStats = function () { const o = {}; for (const s of sheets.values()) { const k = s.key.split('|').slice(0, 2).join('|') + '@hd' + s.master; o[k] = (o[k] || 0) + s.bytes; } return o; };

  // --- the bake budget: the pen's per-frame window (M._bake) is shared; the deferred queue is this module's ---------------------------
  const BAKE = M._bake || { armed: false, clock: null, budget: 3.2, win: 0, spent: 0 };
  const HDQ = { queue: [], deferred: 0, pumped: 0, placeholders: 0 };
  M._hdBake = HDQ;
  const nowMs = () => (BAKE.clock ? BAKE.clock() : ((typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : 0));
  function bakeWindow() { const t = nowMs(); if (t - BAKE.win > 14) { BAKE.win = t; BAKE.spent = 0; } return t; }
  function pump() {
    if (!HDQ.queue.length) return 0;
    let t = bakeWindow(), n = 0;
    while (HDQ.queue.length && BAKE.spent < BAKE.budget) {
      const j = HDQ.queue.shift();
      if (sheets.get(j.s.key) !== j.s || j.s.canvas.width <= 1) continue;
      j.run(); const t2 = nowMs(); BAKE.spent += t2 - t; t = t2; HDQ.pumped++; n++;
    }
    return n;
  }
  function pumpAll(all) { let n = 0; while (HDQ.queue.length) { const j = HDQ.queue.shift(); if (sheets.get(j.s.key) === j.s && j.s.canvas.width > 1) { j.run(); n++; HDQ.pumped++; } if (!all && n >= 4) break; } return n; }
  const numSheets = new Map();
  const numKey = (far, anim, look, dir, master) => (((look * 16 + (ANIM_IX[anim] | 0)) * 8 + dir) * 2 + (far ? 1 : 0)) * 2 + (master === 2 ? 1 : 0);
  const STU_DEFAULT = (1 | (1 << 3) | (1 << 21) | (1 << 23)) >>> 0;   // the pen's default student (skin 1, hair 1, build 1, accent 1)
  /** a student / officer / band / krewe sheet of one facing; over the frame's budget the default student of that pose stands in and the real look queues */
  function stuSheet(fam, anim, look, dir, master, draw) {
    const A = SA[anim], cell = SC[A.c], far = fam === 'agentfar', nF = far ? 2 : A.n, key = fam + '|' + anim + '|' + look + '|' + dir + '|' + master;
    let s = sheets.get(key); if (s) { s.used = hdFrame; return s; }
    const nk = (fam === 'agent' || far) ? numKey(far, anim, look, dir, master) : -1;
    const reg = (sh) => { if (nk >= 0) { sh.nk = nk; numSheets.set(nk, sh); } return sh; };
    if (BAKE.armed && nowMs() && (fam === 'agent' || far)) {
      const t = bakeWindow();
      if (BAKE.spent >= BAKE.budget && look !== STU_DEFAULT) {
        const def = stuSheet(fam, anim, STU_DEFAULT, dir, master, draw);
        const S = master === 2 ? 2 : 1, canvas = M.newCanvas(cell.cw * nF * S, cell.ch * S), ctx = M.ctx2d(canvas);
        try { ctx.imageSmoothingEnabled = false; ctx.drawImage(def.canvas, 0, 0); } catch (e) { /* stub */ }
        s = { key: key, fam: fam, canvas: canvas, cellW: cell.cw, cellH: cell.ch, n: nF, master: S, S: S, used: hdFrame, bytes: cell.cw * nF * S * cell.ch * S * 4 };
        sheets.set(key, s); hdBytes += s.bytes; HDQ.deferred++; HDQ.placeholders++;
        HDQ.queue.push({ s: s, run: () => {
          const g = M.ctx2d(s.canvas), env = envOf(S, far);
          try { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s.canvas.width, s.canvas.height); g.setTransform(S, 0, 0, S, 0, 0); g.imageSmoothingEnabled = true; } catch (e) { /* stub */ }
          for (let f = 0; f < nF; f++) { g.save(); g.translate(f * cell.cw, 0); g.beginPath(); g.rect(0, 0, cell.cw, cell.ch); g.clip(); try { draw(g, f, env); } catch (e) { try { BSU.error('sprites_entities_hd', 'bake:' + key, e); } catch (e2) { /* never throw */ } } g.restore(); }
          if (far) farReduce(g, s.canvas, cell.cw, cell.ch, nF, S);
        } });
        return reg(s);
      }
      s = reg(bakeSheet(key, fam, cell.cw, cell.ch, nF, master, draw, far));
      BAKE.spent += nowMs() - t;
      return s;
    }
    return reg(bakeSheet(key, fam, cell.cw, cell.ch, nF, master, draw, far));
  }

  // ---------------------------------------------------------------------------
  // The rig: joints → two-bone IK (the pen's solver, verbatim: the pose tables are shared data) → yaw → projection → depth-sorted parts.
  // Local frame: x right, y up, z forward (toward the viewer at facing S); yaw = (1 − dir) · π/4 (fbDir octants: 0 SE … 7 E).
  // Screen: sx = cx + X, sy = gy − Y + Z · pitch (a nearer point lies LOWER on screen: the 2:1 ground), depth = Z (sorted back → front).
  // ---------------------------------------------------------------------------
  const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v3mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], v3len = (a) => Math.sqrt(v3dot(a, a)), v3lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function ik2(A, T, l1, l2, pole) {
    let d = v3sub(T, A), L = v3len(d);
    const mx = (l1 + l2) * 0.998;
    if (L > mx) { d = v3mul(d, mx / L); L = mx; T = v3add(A, d); }
    if (L < 0.3) return [v3add(A, [0, -l1, 0.3]), T];
    const dir = v3mul(d, 1 / L);
    let q = v3sub(pole, v3mul(dir, v3dot(pole, dir))), ql = v3len(q);
    if (ql < 1e-4) { q = v3sub([0, 0, 1], v3mul(dir, dir[2])); ql = v3len(q) || 1; }
    q = v3mul(q, 1 / ql);
    const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    return [v3add(A, v3add(v3mul(dir, a), v3mul(q, h))), T];
  }
  function solve(Bd, p) {
    const py = p.py !== undefined ? p.py : Bd.hipY, pz = p.pz || 0, Ln = p.lean || 0, tw = p.tw || 0, TL = p.tilt || 0, sc = p.scale || 1;
    const cL = Math.cos(Ln), sL = Math.sin(Ln), cw = Math.cos(tw), sw = Math.sin(tw);
    const uT = [0, cL, sL], f0 = [0, -sL, cL];
    const lat = v3add([cw, 0, 0], v3mul(f0, sw)), fT = v3sub(v3mul(f0, cw), [sw, 0, 0]);
    const P = [0, py, pz], N = v3add(P, v3mul(uT, Bd.torso));
    const sb = v3sub(N, v3mul(uT, 0.8)), sx = Bd.sw - 0.6;
    const S2 = [v3add(sb, v3mul(lat, sx)), v3sub(sb, v3mul(lat, sx))];
    const hip = [[Bd.hw, py, pz], [-Bd.hw, py, pz]], th = (Bd.hipY + 0.8) / 2;
    const feet = [p.fr || [Bd.hw + 0.3, 0, 0], p.fl || [-Bd.hw - 0.3, 0, 0]];
    const kn = [], an = [], toe = [], elb = [], hands = [];
    for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, r = ik2(hip[s], v3add(feet[s], [0, 0.9, 0]), th, th, (s ? p.kpL : p.kpR) || [0.12 * sg, 0.2, 1]);
      kn.push(r[0]); an.push(r[1]); toe.push(v3add(r[1], [0, -0.55, 2.0]));
    }
    for (let s = 0; s < 2; s++) {
      const sg = s ? -1 : 1, rel = s ? p.hl : p.hr, ab = s ? p.hal : p.har;
      const tgt = ab || v3add(S2[s], rel || [0.5 * sg, -5.9, 0.3]);
      const r = ik2(S2[s], tgt, Bd.upper, Bd.fore, (s ? p.epL : p.epR) || [0.55 * sg, -1, -0.45]);
      elb.push(r[0]); hands.push(r[1]);
    }
    const H = v3add(N, [0, Bd.headR * 0.82 + (p.hu || 0), 0.3 + (p.hf || 0)]);
    const cT = Math.cos(TL), sT = Math.sin(TL);
    const tp = (q) => { const y = q[1] - py, z = q[2] - pz; return [q[0] * sc, (y * cT - z * sT + py) * sc, (z * cT + y * sT + pz) * sc]; };
    const tv = (v) => [v[0], v[1] * cT - v[2] * sT, v[2] * cT + v[1] * sT];
    const J = { P: tp(P), N: tp(N), lat: tv(lat), fT: tv(fT), uT: tv(uT), sh: S2.map(tp), el: elb.map(tp), ha: hands.map(tp), hip: hip.map(tp), kn: kn.map(tp), an: an.map(tp), toe: toe.map(tp), H: tp(H), sc: sc };
    if (p.ground !== undefined) {
      let lo = 1e9; for (const k of ['sh', 'el', 'ha', 'hip', 'kn', 'an', 'toe']) for (const q of J[k]) lo = Math.min(lo, q[1] - (k === 'toe' || k === 'an' ? 0.9 : 0.8)); lo = Math.min(lo, J.H[1] - Bd.headR * sc);
      const dy = p.ground - lo; for (const k of ['sh', 'el', 'ha', 'hip', 'kn', 'an', 'toe']) for (const q of J[k]) q[1] += dy; J.P[1] += dy; J.N[1] += dy; J.H[1] += dy;
    }
    return J;
  }
  const yawOf = (dir) => (1 - dir) * FPI / 4;
  /** the world rotation of a facing: W(local) → [X right, Y up, Z toward the viewer]; fwd = cos yaw (+1 facing the viewer), lat = sin yaw (+1: the right side faces the viewer) */
  function viewer(dir, extra) { const y = yawOf(dir) + (extra || 0), s = Math.sin(y), c = Math.cos(y); return { yaw: y, s: s, c: c, W: (q) => [-q[0] * c + q[2] * s, q[1], q[0] * s + q[2] * c] }; }
  /** a part list drawn back to front */
  function parts() { const L = []; return { add: (d, fn) => L.push({ d: d, fn: fn }), draw: () => { L.sort((a, b) => a.d - b.d); for (const p of L) p.fn(); L.length = 0; } }; }

  // --- builds (the pen's; hipY = pelvis height standing) --------------------------------------------------------------------------
  const SB = [
    { hipY: 7.4, torso: 5.6, hw: 1.6, sw: 2.8, sd: 1.8, legR: 1.1, armR: 0.95, headR: 3.3, pad: 0, upper: 3.0, fore: 2.8 },
    { hipY: 7.8, torso: 5.9, hw: 1.8, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 3.45, pad: 0, upper: 3.1, fore: 2.9 },
    { hipY: 8.2, torso: 6.2, hw: 2.0, sw: 3.4, sd: 2.1, legR: 1.25, armR: 1.1, headR: 3.6, pad: 0, upper: 3.2, fore: 3.0 }
  ];
  const BUILD = {
    line: { hipY: 7.2, torso: 6.0, hw: 2.5, sw: 4.3, sd: 2.7, legR: 1.7, armR: 1.45, headR: 3.3, pad: 1.9, upper: 3.3, fore: 3.2, num: 66, skin: 3 },
    skill: { hipY: 8.6, torso: 6.5, hw: 1.7, sw: 3.1, sd: 2.0, legR: 1.15, armR: 1.05, headR: 3.0, pad: 1.2, upper: 3.4, fore: 3.2, num: 84, skin: 2 },
    qb: { hipY: 8.8, torso: 6.7, hw: 1.9, sw: 3.5, sd: 2.2, legR: 1.25, armR: 1.15, headR: 3.0, pad: 1.4, upper: 3.5, fore: 3.2, num: 12, skin: 0 },
    k: { hipY: 8.4, torso: 6.2, hw: 1.7, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 2.9, pad: 0.9, upper: 3.3, fore: 3.1, num: 3, skin: 5 },
    back: { hipY: 7.9, torso: 6.3, hw: 2.0, sw: 3.6, sd: 2.3, legR: 1.4, armR: 1.2, headR: 3.1, pad: 1.5, upper: 3.3, fore: 3.2, num: 28, skin: 4 },
    civ: { hipY: 8.4, torso: 6.4, hw: 1.8, sw: 3.0, sd: 1.9, legR: 1.15, armR: 1.0, headR: 2.9, pad: 0, upper: 3.3, fore: 3.1 },
    cheer: { hipY: 8.0, torso: 6.0, hw: 1.6, sw: 2.7, sd: 1.7, legR: 1.05, armR: 0.95, headR: 2.8, pad: 0, upper: 3.1, fore: 3.0 },
    roux: { hipY: 8.6, torso: 7.0, hw: 2.5, sw: 3.8, sd: 3.0, legR: 1.7, armR: 1.5, headR: 4.5, pad: 0, upper: 3.7, fore: 3.5 }
  };

  // ---------------------------------------------------------------------------
  // The figure renderer. S (a style): { skin, hair, top, bot, shoe, acc, sleeve?, shinC?, glove?, longSleeve, kind (tee/hood/polo/jacket/long),
  //   pat (stripeG/hoopsP/block/logoP/logoG/badge/stole/sash/band/fan/ref), belt?, hairStyle 0–5, hat 0 none/1 cap/2 bucket/3 beanie/'ranger'/
  //   'shako'/'tricorn'/'cheer'/'helmet'/'cap:<c>:<bill>'/'tiger', glasses, carry 0–6, pack, head: 'bare'|'helmet'|'tiger', helmet/stripe/logo/mask,
  //   digits/numCol, extras(c) }. p: the pose (the pen's tables). o: { anim, f, pitch, off (world offset), noPack, prop: fn(c) }.
  // ---------------------------------------------------------------------------
  const dot = (ctx, x, y, r, color, t, a) => B.stroke(ctx, [[x, y], [x + 0.01, y]], r * 2, color, t, a == null ? 1 : a);
  function drawFigure(ctx, env, cx, gy, dir, Bd, S, p, o) {
    o = o || {};
    const J = solve(Bd, p), V = viewer(dir, p.yawX || 0), W = V.W, pitch = o.pitch || FBL.pitch, sc = J.sc, lod = env.lod | 0, off = o.off || [0, 0, 0];
    const pr = (w) => [cx + w[0] + off[0], gy - (w[1] + off[1]) + (w[2] + off[2]) * pitch, w[2] + off[2]];
    const Q = (q) => pr(W(q));
    const L = parts(), add = L.add, dz = (a, b, r) => (a[2] + b[2]) / 2 + 0.8 * r;
    const c = { ctx: ctx, env: env, J: J, W: W, Q: Q, pr: pr, S: S, Bd: Bd, p: p, V: V, sc: sc, lod: lod, add: add, o: o };
    // legs: thigh (bottoms), shin (skin for shorts, the sock colour for players, else the bottoms), shoe
    for (let s = 0; s < 2; s++) {
      const hip = Q(J.hip[s]), kn = Q(J.kn[s]), an = Q(J.an[s]), toe = Q(J.toe[s]), lr = Bd.legR * sc;
      const legC = S.legC ? S.legC(s) : S.bot, shinC = S.shinC || S.bot, shoeC = S.shoe || C.shoeDark;
      add(dz(hip, kn, lr), () => B.capsule(ctx, hip[0], hip[1], kn[0], kn[1], lr, lr * 0.95, legC, S.legT || 0, { amp: 0.28 }));
      add(dz(kn, an, lr * 0.9), () => { B.capsule(ctx, kn[0], kn[1], an[0], an[1], lr * 0.92, lr * 0.8, shinC, 0, { amp: 0.28 }); if (S.legStripe && lod === 0) B.stroke(ctx, [[kn[0] + (an[0] - kn[0]) * 0.4, kn[1] + (an[1] - kn[1]) * 0.4], [kn[0] + (an[0] - kn[0]) * 0.55, kn[1] + (an[1] - kn[1]) * 0.55]], lr * 1.7, C.black, 0, 0.85); });
      add(dz(an, toe, 0.9 * sc) + 0.2, () => B.capsule(ctx, an[0], an[1], toe[0], toe[1], 0.95 * sc, 0.85 * sc, shoeC, 0.05, { amp: 0.25 }));
    }
    // torso: a waisted polygon (the lateral and depth extents both project, so a side view is as wide as the chest is deep)
    const Pw = W(J.P), Nw = W(J.N), latW = W(J.lat), fW = W(J.fT);
    const wAt = (t) => { const sm = clamp01((t - 0.1) / 0.7), sm2 = sm * sm * (3 - 2 * sm); const a = (Bd.hw + 0.8 + (Bd.sw - Bd.hw - 0.8) * sm2) * sc, b = Bd.sd * (0.9 + 0.2 * sm2) * sc; return Math.max(0.45, a * Math.abs(latW[0]) + b * Math.abs(fW[0])); };
    const cP = pr(Pw), cN = pr(Nw), cM = pr(v3lerp(Pw, Nw, 0.5)), w0 = wAt(0), w1 = wAt(0.5), w2 = wAt(1);
    const tor = [[cP[0] - w0, cP[1] + 0.6], [cM[0] - w1, cM[1]], [cN[0] - w2, cN[1] - 0.4], [cN[0] + w2, cN[1] - 0.4], [cM[0] + w1, cM[1]], [cP[0] + w0, cP[1] + 0.6]];
    c.tor = tor; c.cP = cP; c.cN = cN; c.fW = fW; c.latW = latW; c.Pw = Pw; c.Nw = Nw;
    const torsoD = (Pw[2] + Nw[2]) / 2 + 0.8 * (Bd.sd * Math.abs(fW[2]) + Bd.sw * Math.abs(latW[2])) * sc;
    add(torsoD, () => drawTorso(c));
    // arms: shoulder pad (players), upper arm (sleeve), forearm (sleeve or skin), hand (skin or glove)
    for (let s = 0; s < 2; s++) {
      const sh = Q(J.sh[s]), el = Q(J.el[s]), ha = Q(J.ha[s]), ar = Bd.armR * sc, sleeve = S.sleeve || S.top, fore = S.longSleeve ? sleeve : S.skin;
      if (Bd.pad) add(sh[2] + 0.8 * Bd.pad * sc + 0.3, () => B.orb(ctx, sh[0], sh[1] - 0.2, Bd.pad * sc, Bd.pad * sc * 0.85, S.top, 0.08, { spec: lod ? 0 : 0.25 }));
      add(dz(sh, el, ar), () => { B.capsule(ctx, sh[0], sh[1], el[0], el[1], ar + 0.15, ar, sleeve, 0, { amp: 0.28 }); if (S.stripe && lod === 0) B.stroke(ctx, [[sh[0] + (el[0] - sh[0]) * 0.62, sh[1] + (el[1] - sh[1]) * 0.62], [sh[0] + (el[0] - sh[0]) * 0.86, sh[1] + (el[1] - sh[1]) * 0.86]], ar * 2.1, S.stripe, 0.1, 1); if (S.armStripe && lod === 0) B.stroke(ctx, [[sh[0] + (el[0] - sh[0]) * 0.45, sh[1] + (el[1] - sh[1]) * 0.45], [sh[0] + (el[0] - sh[0]) * 0.6, sh[1] + (el[1] - sh[1]) * 0.6]], ar * 2.2, C.black, 0, 0.85); });
      add(dz(el, ha, ar * 0.9), () => B.capsule(ctx, el[0], el[1], ha[0], ha[1], ar, ar * 0.9, fore, 0, { amp: 0.28 }));
      add(ha[2] + 0.8 * ar + 0.25, () => { if (lod) dot(ctx, ha[0], ha[1], ar + 0.3, S.glove || S.skin, 0.05); else B.orb(ctx, ha[0], ha[1], ar + 0.35, ar + 0.3, S.glove || S.skin, 0.05, { spec: 0.2 }); });
    }
    // the head
    const Hc = Q(J.H), hr = Bd.headR * sc, VH = viewer(dir, (p.yawX || 0) + (p.ht || 0));
    c.Hc = Hc; c.hr = hr; c.fwdH = VH.c; c.latH = VH.s;
    c.hp = (l, u, f) => pr(v3add(W(J.H), [-VH.c * l * hr + VH.s * f * hr, u * hr, VH.s * l * hr + VH.c * f * hr]));   // a point on the head: l lateral (−1 left … 1 right), u up, f forward
    add(Hc[2] + hr * 0.9, () => drawHead(c));
    if (S.extras) S.extras(c);
    if (o.prop) o.prop(c);
    L.draw();
    return c;
  }
  /** the torso polygon: the top's plane, then the outfit's marks clipped to it (lod 0 keeps every mark; lod 1 the colour bands) */
  function drawTorso(c) {
    const ctx = c.ctx, S = c.S, tor = c.tor, lod = c.lod, cP = c.cP, cN = c.cN, front = c.fW[2] > 0.18, back = c.fW[2] < -0.18;
    const at = (t, u) => { const w = (1 - t) * (tor[5][0] - tor[0][0]) / 2 + t * (tor[3][0] - tor[2][0]) / 2; return [cP[0] + (cN[0] - cP[0]) * t + u * w, cP[1] + (cN[1] - cP[1]) * t + 0.6 * (1 - t) - 0.4 * t]; };
    ctx.save(); B.plane(ctx, tor, S.top, S.topT || 0, { amp: 0.22, rim: 0.25, spec: lod ? 0 : 0.12 });
    B.poly(ctx, tor); ctx.clip();
    const band = (t, w, color, tone, a) => B.stroke(ctx, [at(t, -1.2), at(t, 1.2)], w, color, tone, a == null ? 1 : a);
    band(0.03, 1.3, S.bot, 0);                                                                           // the waistband
    if (S.belt) band(0.12, 0.9, S.belt, -0.1);
    switch (S.pat) {
      case 'stripeG': band(0.48, 1.4, GD, 0.1); break;
      case 'hoopsP': band(0.3, 0.9, P1, 0); band(0.55, 0.9, P1, 0); band(0.8, 0.9, P1, 0); break;
      case 'block': if (front) B.stroke(ctx, [at(0.08, 0), at(0.93, 0)], 2.2, P2, -0.05, 1); break;
      case 'logoP': if (front && lod === 0) dot(ctx, at(0.71, -0.3)[0], at(0.71, -0.3)[1], 0.9, P1, 0.1); break;
      case 'logoG': if (front && lod === 0) dot(ctx, at(0.71, -0.3)[0], at(0.71, -0.3)[1], 0.9, GD, 0.1); break;
      case 'badge': if (front && lod === 0) dot(ctx, at(0.72, -0.3)[0], at(0.72, -0.3)[1], 0.7, GD, 0.3); break;
      case 'stole': B.stroke(ctx, [at(0.3, -0.32), at(1, -0.32)], 1.2, GD, 0.05, 1); B.stroke(ctx, [at(0.3, 0.32), at(1, 0.32)], 1.2, GD, 0.05, 1); break;
      case 'sash': B.stroke(ctx, [at(0.08, 0.95), at(0.98, -0.75)], 1.3, GD, 0.05, 1); break;
      case 'band': B.stroke(ctx, [at(0.08, 0), at(0.98, 0)], 1.4, GD, 0.05, 1); break;
      case 'fan': band(0.42, 1.8, S.pat2 || GD, 0.05); break;
      case 'ref': for (let k = -1; k <= 1; k += (lod ? 2 : 1)) B.stroke(ctx, [at(0.05, k * 0.55), at(0.98, k * 0.55)], 0.9, C.black, 0, 1); break;
      case 'vest': B.stroke(ctx, [at(0.08, -0.55), at(0.98, -0.55)], 1.1, S.sleeve || C.offWhite, 0.1, 1); B.stroke(ctx, [at(0.08, 0.55), at(0.98, 0.55)], 1.1, S.sleeve || C.offWhite, 0.1, 1); break;
      case 'roux': band(0.86, 1.1, GD, 0.1); break;
    }
    if (S.kind === 'polo') { band(0.93, 0.9, S.top, 0.35); if (front && lod === 0) B.stroke(ctx, [at(0.62, 0), at(0.9, 0)], 0.6, S.top, -0.45, 1); }
    if (S.kind === 'hood' && front) { B.stroke(ctx, [at(0.12, -0.5), at(0.12, 0.5)], 1.8, S.top, -0.25, 1); if (lod === 0) { B.stroke(ctx, [at(0.62, -0.26), at(0.98, -0.22)], 0.7, S.top, 0.6, 1); B.stroke(ctx, [at(0.62, 0.26), at(0.98, 0.22)], 0.7, S.top, 0.6, 1); } }
    if (S.pack && front) { B.stroke(ctx, [at(0.98, -0.52), at(0.2, -0.58)], 0.9, S.acc, -0.35, 1); B.stroke(ctx, [at(0.98, 0.52), at(0.2, 0.58)], 0.9, S.acc, -0.35, 1); }
    if (S.toteStrap && front) B.stroke(ctx, [at(0.98, 0.2), at(0.1, 0.3)], 0.8, C.tote, -0.2, 1);
    if (front && S.kind !== 'polo' && S.kind !== 'hood' && S.head !== 'helmet' && S.head !== 'tiger') dot(ctx, at(0.96, 0)[0], at(0.96, 0)[1] + 0.2, 0.75, S.skin, -0.1);   // the neckline
    if (S.digits && !(c.p.tilt && Math.abs(c.p.tilt) > 0.5) && Math.abs(c.fW[2]) >= 0.3 && (front || back)) {
      const m = at(0.55, 0), k = Math.abs(c.fW[2]), latW = c.latW;
      const shift = -Math.sign(latW[2] || 1) * latW[0] * c.Bd.sw * 0.3 * c.sc;   // toward the visible half of the chest (the near arm covers the other)
      if (lod) B.digits(ctx, m[0] + shift, m[1], S.digits, 4.0, S.numCol || GD, 0.15, { sx: Math.max(0.6, k), w: 1.0 });   // master 1: a 3 × 5 px glyph per digit (the pen's FONT size)
      else B.digits(ctx, m[0] + shift, m[1], S.digits, Math.max(3.4, c.Bd.torso * 0.52 * c.sc), S.numCol || GD, 0.15, { sx: Math.max(0.55, k), w: 0.85 });
    }
    ctx.restore();
  }
  /** the head: hood / afro / long hair behind, the skull (skin, helmet shell or tiger fur), the hair cap, eyes + glasses (lod 0), the hat */
  function drawHead(c) {
    const ctx = c.ctx, S = c.S, Hc = c.Hc, hr = c.hr, fwd = c.fwdH, lat = c.latH, lod = c.lod, hp = c.hp, x = Hc[0], y = Hc[1];
    const cover = 0.42 + 0.3 * (1 - fwd) / 2;   // how far down the hair cap reaches: a front view shows the fringe, a back view the whole crown
    const capClip = (cv, fn) => { ctx.save(); ctx.beginPath(); ctx.rect(x - hr - 1, y - hr - 1, hr * 2 + 2, hr * 2 * cv + 1); ctx.clip(); fn(); ctx.restore(); };
    const hairCap = (cv, color, t) => capClip(cv, () => B.orb(ctx, x, y - 0.15, hr + 0.3, hr + 0.3, color, t == null ? 0.05 : t, { spec: lod ? 0 : 0.18 }));
    if (S.head === 'helmet') {
      B.orb(ctx, x, y - 0.1, hr * 1.08, hr * 1.08, S.helmet, 0.1, { spec: 0.45 });
      if (Math.abs(lat) < 0.92) B.stroke(ctx, [[x + lat * hr * 0.15, y - hr * 1.05], [x + lat * hr * 0.2, y - hr * 0.25]], hr * 0.32, S.stripe, 0.05, 1);
      if (fwd > 0.25) { B.orb(ctx, x + lat * hr * 0.45, y + hr * 0.22, hr * 0.5 * (0.6 + 0.4 * fwd), hr * 0.5, S.skin, -0.45, { noRim: true }); if (lod === 0) { const fx = x + lat * hr * 0.45; B.stroke(ctx, [[fx - hr * 0.62 * fwd, y - hr * 0.05], [fx + hr * 0.62 * fwd, y - hr * 0.05]], 0.55, C.mask, 0.3, 0.95); B.stroke(ctx, [[fx - hr * 0.42 * fwd, y + hr * 0.62], [fx + hr * 0.42 * fwd, y + hr * 0.62]], 0.55, C.mask, 0.1, 0.95); B.stroke(ctx, [[fx, y - hr * 0.05], [fx, y + hr * 0.62]], 0.5, C.mask, 0.1, 0.95); } }
      if (lod === 0 && Math.abs(lat) > 0.45) dot(ctx, x + lat * hr * 0.75, y + hr * 0.05, hr * 0.26, S.logo, 0.1);
      return;
    }
    if (S.head === 'tiger') { drawTigerHead(ctx, c, x, y, hr, fwd, lat, lod); return; }
    const hs = S.hairStyle | 0, hat = S.hat, hairC = S.hair;
    if (S.kind === 'hood') B.orb(ctx, x, y + 0.5, hr * 1.18, hr * 1.12, S.top, -0.15, { noRim: true });                                  // the hood behind the head
    if (hs === 4 && !hat) B.orb(ctx, x, y - hr * 0.3, hr * 1.3, hr * 1.22, hairC, 0.05, { spec: lod ? 0 : 0.15 });                       // afro
    if (hs === 5 && (!hat || hat === 2) && fwd > -0.2) { for (const s of [-1, 1]) B.capsule(ctx, x + s * hr * 0.85 * Math.max(0.4, Math.abs(fwd)) + lat * hr * 0.2, y + hr * 0.1, x + s * hr * 0.95 * Math.max(0.4, Math.abs(fwd)) + lat * hr * 0.1, y + hr * 1.7, 0.8, 0.7, hairC, 0, { amp: 0.25 }); }   // long hair at the sides
    if (hs === 2 && fwd > 0.1 && (!hat || hat === 1)) { B.capsule(ctx, x - lat * hr * 0.5, y - hr * 0.3, x - lat * hr * 1.05 - (c.p.sway || 0) * 0.5, y + hr * 1.2, 0.85, 0.6, hairC, 0, { amp: 0.25 }); dot(ctx, x - lat * hr * 0.6, y - hr * 0.05, 0.6, S.acc, 0.1); }   // ponytail behind
    B.orb(ctx, x, y, hr, hr, S.skin, 0.05, { spec: lod ? 0 : 0.35 });
    if (!(hs === 4 && !hat)) hairCap(hs === 0 ? cover - 0.05 : hs === 1 ? cover + 0.14 : cover, hairC);
    if (hs === 1 && lod === 0 && fwd > -0.6) for (const s of [-1, 1]) B.orb(ctx, x + s * hr * 0.9 * Math.max(0.35, Math.abs(fwd)) + lat * hr * 0.15, y + hr * 0.05, hr * 0.36, hr * 0.42, hairC, 0.05, { noRim: true });   // bob: side volume
    if (hs === 3 && !hat) B.orb(ctx, x - lat * hr * 0.55, y - hr * 0.95, hr * 0.46, hr * 0.42, hairC, 0.1, { noRim: true });                 // bun
    if (hs === 2 && fwd <= 0.1 && (!hat || hat === 1)) { B.capsule(ctx, x - lat * hr * 0.4, y - hr * 0.2, x - lat * hr * 0.9 - (c.p.sway || 0) * 0.5, y + hr * 1.25, 0.85, 0.6, hairC, 0, { amp: 0.25 }); dot(ctx, x - lat * hr * 0.5, y + hr * 0.05, 0.6, S.acc, 0.1); }
    if (hs === 5 && (!hat || hat === 2) && fwd <= -0.2) B.capsule(ctx, x, y - hr * 0.2, x - lat * hr * 0.3, y + hr * 1.8, hr * 0.9, hr * 0.7, hairC, 0, { amp: 0.25 });   // long hair down the back
    if (lod === 0 && fwd > 0.25) {   // eyes (and glasses) on the face
      const ey = y + hr * 0.06, ex = x + lat * hr * 0.38, sep = hr * 0.38 * (0.35 + 0.65 * fwd);
      dot(ctx, ex - sep, ey, hr * 0.17, C.eye, 0); dot(ctx, ex + sep, ey, hr * 0.17, C.eye, 0);
      if (S.glasses) B.stroke(ctx, [[ex - sep - hr * 0.28, ey], [ex + sep + hr * 0.28, ey]], 0.45, C.cap, 0, 0.9);
      if (c.p.mood === 'open') dot(ctx, ex, ey + hr * 0.5, hr * 0.16, C.eye, 0, 0.8);
    }
    if (hat === 1 || (typeof hat === 'string' && hat.slice(0, 4) === 'cap:')) {
      const parts = typeof hat === 'string' ? hat.split(':') : null, cc = parts ? parts[1] : S.acc, bill = parts ? parts[2] || cc : S.acc;
      const brim = () => B.capsule(ctx, x + lat * hr * 0.55, y - hr * 0.22, x + lat * hr * 1.35, y - hr * 0.18 + fwd * hr * 0.12, 0.6, 0.5, bill, 0.05, { amp: 0.2 });
      if (fwd < 0) brim(); hairCap(0.47, cc, 0.1); if (fwd >= 0) brim();
    } else if (hat === 2) { hairCap(0.52, S.acc, 0.1); ellipseStroke(ctx, x, y - hr * 0.05, hr * 1.35, hr * 0.5, 0.9, S.acc, -0.25); }
    else if (hat === 3) { hairCap(0.56, S.acc, 0.1); B.stroke(ctx, [[x - hr * 0.95, y + hr * 0.08], [x + hr * 0.95, y + hr * 0.08]], 1.0, S.acc, -0.2, 1); }
    else if (hat === 'ranger') { hairCap(0.5, C.khaki, 0.1); ellipseStroke(ctx, x, y - hr * 0.08, hr * 1.65, hr * 0.55, 1.3, C.khakiDark, 0); if (lod === 0) B.stroke(ctx, [[x - hr * 0.9, y - hr * 0.5], [x + hr * 0.9, y - hr * 0.5]], 0.6, C.ranger, 0, 1); }
    else if (hat === 'shako') { B.capsule(ctx, x, y - hr * 0.6, x, y - hr * 0.6 - 3.6, 2.0, 1.9, P1, 0, { amp: 0.3 }); B.stroke(ctx, [[x - 1.9, y - hr * 0.6 - 0.4], [x + 1.9, y - hr * 0.6 - 0.4]], 0.9, GD, 0.1, 1); B.capsule(ctx, x, y - hr * 0.6 - 3.6, x + 0.4, y - hr * 0.6 - 5.8, 0.7, 0.45, C.jerseyWhite, 0.1, { flat: true }); }
    else if (hat === 'tricorn') { hairCap(0.5, P2, 0.1); ellipseStroke(ctx, x, y - hr * 0.25, hr * 1.4, hr * 0.5, 1.0, GD, 0); B.stroke(ctx, [[x + hr * 0.7, y - hr * 0.5], [x + hr * 1.3, y - hr * 1.6]], 0.8, C.green, 0.1, 1); }
    else if (hat === 'cheer') { B.capsule(ctx, x - lat * hr * 0.5, y - hr * 0.3, x - lat * hr * 1.0, y + hr * 0.9, 0.95, 0.7, hairC, 0, { amp: 0.25 }); dot(ctx, x - lat * hr * 0.6, y - hr * 0.2, 0.75, GD, 0.2); }
    if (S.capAnim) {   // the mortarboard: a flat dark diamond over the crown with a gold tassel
      B.plane(ctx, [[x - hr * 1.25, y - hr * 0.85], [x, y - hr * 1.35], [x + hr * 1.25, y - hr * 0.85], [x, y - hr * 0.5]], C.gown, 0.05, { amp: 0.25 });
      B.stroke(ctx, [[x + hr * 1.1, y - hr * 0.85], [x + hr * 1.2, y + hr * 0.1]], 0.6, GD, 0.1, 1);
    }
  }
  function ellipseStroke(ctx, x, y, rx, ry, w, color, t) { const pts = []; for (let k = 0; k < 16; k++) { const a = k / 16 * FPI * 2; pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]); } B.stroke(ctx, pts, w, color, t, 1, { close: true }); }
  /** Roux's head (the mascot and the parade float share it): orange fur, white muzzle, pink nose, black forehead / cheek stripes, round ears */
  function drawTigerHead(ctx, c, x, y, hr, fwd, lat, lod, jaw) {
    for (const s of [-1, 1]) { const ex = x + s * hr * 0.78 * Math.max(0.35, Math.abs(fwd)) + lat * hr * 0.1, ey = y - hr * 0.86; B.orb(ctx, ex, ey, hr * 0.36, hr * 0.36, C.tiger, 0.05, { noRim: true }); if (lod === 0 && fwd > -0.3) dot(ctx, ex, ey + hr * 0.03, hr * 0.17, C.tigerNose, 0.1); }
    B.orb(ctx, x, y, hr, hr, C.tiger, 0.05, { spec: lod ? 0 : 0.3 });
    if (fwd > 0.2) {
      const mx = x + lat * hr * 0.45;
      B.orb(ctx, mx, y + hr * 0.35, hr * 0.52 * (0.5 + 0.5 * fwd), hr * 0.4, C.tigerBelly, 0.1, { noRim: true });
      dot(ctx, mx, y + hr * 0.12, hr * 0.14, C.tigerNose, 0);
      if (lod === 0) { const sep = hr * 0.38 * (0.3 + 0.7 * fwd); dot(ctx, mx - sep, y - hr * 0.15, hr * 0.17, C.iris, 0.2); dot(ctx, mx + sep, y - hr * 0.15, hr * 0.17, C.iris, 0.2); dot(ctx, mx - sep, y - hr * 0.15, hr * 0.09, C.eye, 0); dot(ctx, mx + sep, y - hr * 0.15, hr * 0.09, C.eye, 0); }
      if (jaw) { B.capsule(ctx, mx, y + hr * 0.45, mx, y + hr * 0.45 + jaw * hr * 0.8, hr * 0.42, hr * 0.36, C.tigerBelly, 0, { amp: 0.2 }); dot(ctx, mx, y + hr * 0.5 + jaw * hr * 0.3, hr * 0.3, C.tigerMouth, -0.1); }
    }
    if (lod === 0) { B.stroke(ctx, [[x, y - hr * 0.95], [x, y - hr * 0.5]], hr * 0.16, C.black, 0, 0.85); for (const s of [-1, 1]) B.stroke(ctx, [[x + s * hr * 0.42, y - hr * 0.9], [x + s * hr * 0.55, y - hr * 0.45]], hr * 0.13, C.black, 0, 0.8); if (Math.abs(lat) > 0.5) B.stroke(ctx, [[x + lat * hr * 0.75, y - hr * 0.2], [x + lat * hr * 0.9, y + hr * 0.15]], hr * 0.14, C.black, 0, 0.8); }
  }
  /** the contact shadow under a cell (the pen's shadowFb: a w-px ellipse at the feet) */
  function contact(ctx, env, cx, gy, w, a) { if (!(w > 0)) return; B.shadow(ctx, { x: cx + 0.5, y: gy + 0.4, rx: w / 2, ry: Math.max(1, w / 5), a: a == null ? (env.far ? 0.5 : 0.34) : a }, env); }
  /** splash / tube: everything of the figure below the water line takes the water's colour, with a ripple thread */
  function waterLine(ctx, env, cell, rows, f) {
    const yw = cell.gy - rows;
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = B.tone(C.shallows, 0.05, 0.62); ctx.fillRect(0, yw, cell.cw, cell.ch - yw); ctx.restore();
    const pts = []; for (let x = 1; x < cell.cw - 1; x += 1.5) pts.push([x, yw + 0.3 + 0.35 * Math.sin((x + f * 1.3) * 1.9)]);
    B.stroke(ctx, pts, 0.7, C.shallows, 0.75, 0.8);
    if (env.lod === 0) B.stroke(ctx, [[2, yw + 1.6 + (f & 1) * 0.3], [cell.cw - 2, yw + 1.9 - (f & 1) * 0.3]], 0.5, C.shallows, 0.45, 0.55);
  }

  // ---------------------------------------------------------------------------
  // Students: poses (the pen's tables), the per-look style from sprites.stuStyle (fields, varied outfit, build), carried props
  // ---------------------------------------------------------------------------
  function footPath(u, sg, hx, SL, LIFT) {
    u -= Math.floor(u);
    if (u < 0.5) return [sg * hx, 0, SL - 2 * SL * (u / 0.5)];
    const s = (u - 0.5) / 0.5; return [sg * hx, LIFT * Math.sin(FPI * s), -SL + 2 * SL * s];
  }
  function walkPose(f, Bd, o) {
    const n = o.n || 8, ph = f / n, SL = o.SL || 2.5, LIFT = o.LIFT || 1.3, AS = o.AS === undefined ? 2.0 : o.AS, hx = Bd.hw + 0.25;
    const fr = footPath(ph, 1, hx, SL, LIFT), fl = footPath(ph + 0.5, -1, hx, SL, LIFT);
    const bob = 0.5 - 0.5 * Math.cos(4 * FPI * ph);
    return { py: Bd.hipY - (o.dip === undefined ? 0.75 : o.dip) + (o.bob === undefined ? 0.65 : o.bob) * bob, lean: o.lean === undefined ? 0.07 : o.lean, tw: (o.tw === undefined ? 0.11 : o.tw) * Math.sin(2 * FPI * ph),
      fr: fr, fl: fl, hr: [0.35, -5.6 + 0.5 * Math.max(0, -fr[2] / SL), -fr[2] / SL * AS], hl: [-0.35, -5.6 + 0.5 * Math.max(0, -fl[2] / SL), -fl[2] / SL * AS], sway: Math.sin(2 * FPI * ph + 1) };
  }
  function carryPose(p, F) {
    switch (F.carry) {
      case 1: p.hr = [0.45, -3.5, 2.1]; p.epR = [0.9, -1, -0.2]; break;
      case 2: p.hl = [-0.45, -3.3, 1.9]; p.epL = [-0.9, -1, -0.2]; break;
      case 4: p.hr = [0.15, -2.0, 2.5]; p.epR = [0.9, -0.8, -0.2]; break;
      case 5: p.hr = [0.3, -1.5, 2.3]; p.epR = [0.9, -0.6, -0.2]; p.hu = -0.2; p.hf = 0.45; break;
    }
    return p;
  }
  function stuPose(anim, f, Bd, F) {
    const hw = Bd.hw;
    switch (anim) {
      case 'walk': return carryPose(walkPose(f, Bd, {}), F);
      case 'beads': return walkPose(f, Bd, { SL: 2.3, LIFT: 1.2 });
      case 'umbrella': { const p = walkPose(f, Bd, { n: 4, AS: 1.6, lean: 0.04 }); p.hr = [1.3, 4.6, 0.9]; p.epR = [1, 0.3, -0.2]; return p; }
      case 'foam': { const p = walkPose(f, Bd, { AS: 1.8 }); p.hr = [1.2, 4.9, 0.7]; p.epR = [1, 0.2, -0.3]; return p; }
      case 'cap': { const p = walkPose(f, Bd, { SL: 2.0, LIFT: 1.0, AS: 1.4, dip: 0.5, bob: 0.4 }); p.hu = 0.25; return p; }
      case 'idle': {
        let p;
        if (f === 0) p = { py: Bd.hipY - 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.45, -5.7, 0.2], hl: [-0.45, -5.7, 0.2] };
        else if (f === 1) p = { py: Bd.hipY - 0.45, tw: 0.1, fr: [hw + 0.45, 0, 0.9], fl: [-hw - 0.75, 0, -0.6], hr: [0.65, -5.5, 0.7], hl: [-0.5, -5.7, -0.1] };
        else {
          p = { py: Bd.hipY - 0.3, lean: 0.1, fr: [hw + 0.55, 0, 0.3], fl: [-hw - 0.55, 0, 0.2], hr: [0.3, -1.7, 2.4], hl: [-0.45, -5.6, 0.3], hu: -0.2, hf: 0.5, epR: [0.9, -0.6, -0.2], usePhone: true };
          if (F.carry === 1) { p.hr = [-0.35, 2.0, 2.3]; p.hu = 0.15; p.hf = 0; p.usePhone = false; }
          else if (F.carry === 4) { p.hr = [-0.25, 1.8, 2.5]; p.hu = 0.1; p.hf = 0.2; p.usePhone = false; }
          else if (F.carry === 2) { p.hr = [0.55, -2.1, 2.3]; p.hl = [-0.55, -2.1, 2.3]; p.hu = -0.3; p.usePhone = false; }
        }
        if (f < 2) carryPose(p, F);
        return p;
      }
      case 'flee': { const p = walkPose(f, Bd, { n: 4, SL: 3.2, LIFT: 2.3, lean: 0.3, dip: 1.0, bob: 1.1, tw: 0.2 }); p.hr = [1.7, 3.5 + (f & 1) * 1.1, 0.8]; p.hl = [-1.7, 3.5 + ((f + 1) & 1) * 1.1, 0.8]; p.epR = [1, 0.3, -0.2]; p.epL = [-1, 0.3, -0.2]; p.mood = 'open'; return p; }
      case 'splash': { const p = walkPose(f, Bd, { n: 6, SL: 1.9, LIFT: 2.6, AS: 0.6, dip: 0.6, bob: 0.4, lean: 0.05 }); p.hr = [2.3, -3.1, 1.2 + 0.7 * Math.sin(f)]; p.hl = [-2.3, -3.1, 1.2 - 0.7 * Math.sin(f)]; p.epR = [1, -0.3, 0]; p.epL = [-1, -0.3, 0]; return p; }
      case 'slap': return f === 0 ? { py: hw + 6.7, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [-0.6, 1.4, 1.2], hl: [-0.45, -5.7, 0.2], epR: [1, 0.3, -0.5], hu: -0.1 } : { py: hw + 6.5, tw: 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [-1.3, 0.9, 0.9], hl: [-0.45, -5.7, 0.2], epR: [1, 0.3, -0.5], hu: -0.25, mood: 'closed' };
      case 'cheer': return f === 0 ? { py: Bd.hipY - 0.6, fr: [hw + 0.8, 0, 0], fl: [-hw - 0.8, 0, 0], hr: [1.9, 5.2, 0.4], hl: [-1.9, 5.2, 0.4], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], mood: 'open' } : { py: Bd.hipY + 1.0, fr: [hw + 0.5, 1.6, -0.6], fl: [-hw - 0.5, 1.2, 0.4], hr: [1.4, 5.8, 0.4], hl: [-1.4, 5.8, 0.4], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], mood: 'open' };
      case 'wave': return f === 0 ? { py: Bd.hipY - 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.9, 4.9, 0.5], hl: [-0.45, -5.7, 0.2], epR: [1, 0.2, -0.3] } : { py: Bd.hipY - 0.2, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.7, 5.3, 0.5], hl: [-0.45, -5.7, 0.2], epR: [1, 0.2, -0.3] };
      case 'sit': { const base = { py: 2.3, lean: 0.12, fr: [hw + 0.5, 0, 3.6], fl: [-hw - 0.5, 0, 3.6], kpR: [0.1, 1, 0.5], kpL: [-0.1, 1, 0.5], hr: [0.5, -2.7, 2.7], hl: [-0.5, -2.7, 2.7], hu: -0.15 }; if (f === 1) { base.hr = [0.9, 0.8, 2.6]; base.epR = [1, 0.4, -0.2]; base.fan = true; base.hu = 0.1; } return base; }
      case 'tube': { const bob = (f & 1) ? 0.5 : 0; return { py: 6.2 + bob, lean: 0.03, fr: [hw + 0.4, 0, 0.4], fl: [-hw - 0.4, 0, -0.4], hr: [2.5, -2.4 + (f > 1 ? 1.2 : 0), 1.4], hl: [-2.5, -2.4 + (f > 1 ? 0 : 1.2), 1.4], epR: [1, -0.3, 0], epL: [-1, -0.3, 0] }; }
      case 'selfie': return f === 0 ? { py: Bd.hipY - 0.2, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.0, -0.4, 4.6], hl: [-0.45, -5.7, 0.2], epR: [0.6, 0.6, -0.2], hu: 0.1, usePhone: true } : { py: Bd.hipY - 0.4, tw: 0.1, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [1.3, 0.4, 4.4], hl: [-0.45, -5.7, 0.2], epR: [0.6, 0.6, -0.2], hu: 0.15, usePhone: true };
      case 'binoculars': return { py: Bd.hipY - 0.2 - (f & 1) * 0.15, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0.3], hr: [0.8, 1.9, 2.3], hl: [-0.8, 1.9, 2.3], epR: [1, 0.5, -0.3], epL: [-1, 0.5, -0.3], hu: 0.1 + (f & 1) * 0.1, binocs: true };
    }
    return walkPose(f, Bd, {});
  }
  /** the HD style of a look: colours from the pen's stuStyle (fields F, the varied outfit O, the build) */
  const styleCache = new Map();
  function stuStyleHD(look) {
    let S = styleCache.get(look); if (S) return S;
    const PS = M.stuStyle(look), F = PS.F, O = PS.O;
    S = { F: F, O: O, Bd: PS.B || SB[Math.min(2, F.build | 0)], skin: SKIN6[F.skin] || SKIN6[1], hair: HAIR8[F.hairC] || HAIR8[1], top: O.top, bot: O.bot, shoe: O.shoe, acc: ACC8[F.acc] || ACC8[0],
      kind: O.kind, pat: O.pat, belt: O.belt || null, longSleeve: !!PS.longSleeve || O.kind === 'hood' || O.kind === 'jacket' || O.kind === 'long', hairStyle: F.style | 0, hat: F.hat | 0, glasses: !!F.glasses, carry: F.carry | 0, head: 'bare' };
    S.shinC = O.bk === 'shorts' ? S.skin : S.bot;
    S.pack = F.carry === 0 || F.carry === 1;
    if (F.carry === 3) S.toteStrap = true;
    styleCache.set(look, S); if (styleCache.size > 400) styleCache.clear();
    return S;
  }
  function gownStyle(S0) { const S = Object.assign({}, S0); S.top = C.gown; S.kind = 'long'; S.pat = 'stole'; S.longSleeve = true; S.bot = C.gown; S.shinC = C.gown; S.pack = false; S.toteStrap = false; S.hat = 0; S.capAnim = true; return S; }
  /** carried items and the anim props, as parts (depth-sorted with the body) */
  function stuProps(c, anim, f, noPack) {
    const S = c.S, F = S.F, ctx = c.ctx, W = c.W, J = c.J, Q = c.Q, Bd = c.Bd, p = c.p, add = c.add, lod = c.lod;
    const Pw = J.P, uT = J.uT, fT = J.fT, lat = J.lat;
    const at = (up, fwd, side) => [Pw[0] + uT[0] * up + fT[0] * fwd + lat[0] * side, Pw[1] + uT[1] * up + fT[1] * fwd + lat[1] * side, Pw[2] + uT[2] * up + fT[2] * fwd + lat[2] * side];
    const hand = (s, d) => Q(v3add(J.ha[s], d));
    if (S.pack && !noPack) {   // backpack: two fat capsules behind the torso and a flap
      const g = Bd.sd + 1.25, a0 = Q(at(1.7, -g, -0.75)), a1 = Q(at(4.5, -g, -0.75)), b0 = Q(at(1.7, -g, 0.75)), b1 = Q(at(4.5, -g, 0.75)), fl = Q(at(5.0, -g, 0));
      add((a0[2] + a1[2]) / 2 + 0.9, () => { B.capsule(ctx, a0[0], a0[1], a1[0], a1[1], 1.15, 1.15, S.acc, 0, { amp: 0.3 }); B.capsule(ctx, b0[0], b0[1], b1[0], b1[1], 1.15, 1.15, S.acc, 0, { amp: 0.3 }); if (lod === 0) B.orb(ctx, fl[0], fl[1], 1.0, 0.9, S.acc, 0.15, { noRim: true }); });
    }
    if (F.carry === 3) { const a = Q(at(-0.2, -0.2, -(Bd.sw + 0.9))), b = Q(at(2.0, -0.2, -(Bd.sw + 0.9))); add((a[2] + b[2]) / 2 + 1.1, () => B.capsule(ctx, a[0], a[1], b[0], b[1], 1.4, 1.4, C.tote, 0.1, { amp: 0.25 })); }
    if (F.carry === 2) { const hL = J.ha[1]; add(Q(hL)[2] + 1.5, () => { const cols = [P1, GD, C.bookWhite]; for (let i = 0; i < 3; i++) { const a = Q(v3add(hL, [-1.5, -0.9 + i * 0.9, 0.7])), b = Q(v3add(hL, [1.5, -0.9 + i * 0.9, 0.7])); B.capsule(ctx, a[0], a[1], b[0], b[1], 0.7, 0.7, cols[i], 0.05, { flat: true }); } }); }
    if (F.carry === 1) { const a = hand(0, [0, -1.5, 0.5]), b = hand(0, [0, 0.7, 0.5]); add((a[2] + b[2]) / 2 + 1.2, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 0.95, 1.0, C.cup, 0.1, { amp: 0.25 }); B.stroke(ctx, [[b[0] - 0.9, b[1]], [b[0] + 0.9, b[1]]], 0.8, C.lid, 0, 1); if (lod === 0) B.stroke(ctx, [[a[0] - 0.8, a[1] + 1], [a[0] + 0.8, a[1] + 1]], 0.6, '#8A5A3A', 0, 1); }); }
    if (F.carry === 4) { const a = hand(0, [-1.9, 0.2, 0.9]), b = hand(0, [1.9, 0.2, 0.9]); add((a[2] + b[2]) / 2 + 1.2, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 1.1, 1.0, C.poboy, 0.1, { amp: 0.25 }); B.stroke(ctx, [[a[0], a[1]], [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4]], 2.0, C.poboyPaper, 0.1, 1); if (lod === 0) dot(ctx, b[0] - 0.3, b[1] - 0.7, 0.6, C.lettuce, 0.1); }); }
    if (F.carry === 5 || p.usePhone) { const a = hand(0, [0, 0.4, 0.5]), b = hand(0, [0, 1.9, 0.3]); add((a[2] + b[2]) / 2 + 1.0, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 0.6, 0.6, C.phone, 0, { flat: true }); if (lod === 0) dot(ctx, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.4, C.glassy, 0.3); }); }
    if (p.binocs) { const a = c.hp(-0.4, 0.05, 1.05), b = c.hp(0.4, 0.05, 1.05); add(Math.max(a[2], b[2]) + 1.2, () => { dot(ctx, a[0], a[1], 1.1, C.binoc, 0); dot(ctx, b[0], b[1], 1.1, C.binoc, 0); }); }
    if (anim === 'umbrella') {   // the shaft up from the right hand, the open canopy over the head (gores at lod 0)
      const hR = J.ha[0], second = F.acc === 2 ? C.offWhite : F.acc === 1 ? GD : P1, a = Q(v3add(hR, [0, -0.7, 0])), b = Q(v3add(hR, [-0.9, 9.0, 0])), cc = Q(v3add(hR, [-0.9, 9.4, 0.3]));
      add(cc[2] + 8, () => {
        B.capsule(ctx, a[0], a[1], b[0], b[1], 0.45, 0.45, C.umbShaft, 0, { flat: true });
        ctx.save(); ctx.beginPath(); ctx.rect(cc[0] - 8, cc[1] - 5, 16, 5.2); ctx.clip(); B.orb(ctx, cc[0], cc[1], 6.8, 4.2, S.acc, 0.1, { spec: lod ? 0 : 0.3 }); ctx.restore();
        if (lod === 0) for (let k = -2; k <= 2; k += 2) B.stroke(ctx, [[cc[0], cc[1] - 4.0], [cc[0] + k * 2.6, cc[1] - 0.2 + Math.abs(k) * 0.3]], 1.0, second, 0.1, 0.9);
        B.stroke(ctx, [[cc[0] - 6.8, cc[1]], [cc[0] - 3.4, cc[1] + 0.6], [cc[0], cc[1]], [cc[0] + 3.4, cc[1] + 0.6], [cc[0] + 6.8, cc[1]]], 0.7, S.acc, -0.5, 1);
      });
    }
    if (anim === 'foam') { const h = J.ha[0], a = Q(v3add(h, [0, 0.2, 0])), b = Q(v3add(h, [0, 3.1, 0])), t2 = Q(v3add(h, [0.1, 5.4, 0])); add(b[2] + 1.5, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 1.3, 1.3, GD, 0.05, { amp: 0.3 }); B.capsule(ctx, b[0], b[1], t2[0], t2[1], 0.62, 0.52, GD, 0.05, { amp: 0.3 }); }); }
    if (anim === 'tube') {   // the inner tube: a white ring with red segments round the waist, split into its back and front halves
      const Pl = J.P, ring = (from, to) => { const pts = []; for (let k = from; k <= to; k++) { const a = k / 12 * FPI * 2, q = Q([Pl[0] + Math.cos(a) * 3.7, Pl[1] + 0.2, Pl[2] + Math.sin(a) * 3.7]); pts.push([q[0], q[1]]); } return pts; };
      const back = [], frontH = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * FPI * 2, q = Q([Pl[0] + Math.cos(a) * 3.7, Pl[1] + 0.2, Pl[2] + Math.sin(a) * 3.7]); (q[2] < Pw[2] ? back : frontH).push([q[0], q[1], q[2]]); }
      const draw = (pts) => { if (pts.length < 2) return; pts.sort((u, v) => u[0] - v[0]); const xy = pts.map((q) => [q[0], q[1]]); B.stroke(ctx, xy, 2.3, C.tube, 0.1, 1); for (let i = 0; i + 1 < xy.length; i += 3) B.stroke(ctx, [xy[i], xy[i + 1]], 2.1, C.tubeRed, 0, 1); };
      void ring; add(Pw[2] - 3.7, () => draw(back)); add(Pw[2] + 3.7 + 1.5, () => draw(frontH));
    }
    if (anim === 'beads' && c.fW[2] > 0.3) { const s0 = c.pr(v3lerp(c.Pw, c.Nw, 0.74)); add(s0[2] + Bd.sd + 1, () => { const cols = [P2, GD, C.green]; for (let i = 0; i < 7; i++) { const a = -0.3 + i * 0.1; dot(ctx, s0[0] + Math.sin((i - 3) * 0.5) * 2.1, s0[1] + Math.cos((i - 3) * 0.5) * -1.6 + 2.6, 0.55, cols[i % 3], 0.1); void a; } }); }
    if (p.fan) { const h = Q(J.ha[0]); add(h[2] + 1.5, () => B.plane(ctx, [[h[0] - 0.3, h[1] + 0.2], [h[0] - 2.4, h[1] - 2.6], [h[0] + 0.6, h[1] - 3.1], [h[0] + 2.0, h[1] - 1.2]], GD, 0.1, { amp: 0.2 })); }
  }
  /** one student cell (pure): anim, look, facing 0–7, frame f; ov swaps the style (officer, band, krewe, paddlers, riders) */
  function studentCell(ctx, env, anim, look, dir, f, ov) {
    const A = SA[anim] || SA.walk, cell = SC[A.c]; let S = (ov && ov.style) || stuStyleHD(look); const Bd = S.Bd || SB[1];
    if (anim === 'cap') S = gownStyle(S);
    f = ((f | 0) % A.n + A.n) % A.n; dir = ((dir | 0) % 8 + 8) % 8;
    const p = stuPose(anim, f, Bd, S.F); if (ov && ov.pose) ov.pose(p, anim, f);
    if (!A.water) contact(ctx, env, cell.cw >> 1, cell.gy, 9);
    drawFigure(ctx, env, cell.cw >> 1, cell.gy, dir, Bd, S, p, { anim: anim, f: f, prop: (c) => stuProps(c, anim, f, !!(ov && ov.noPack)) });
    if (A.water) waterLine(ctx, env, cell, A.water, f);
  }
  const stuSplit = (anim, frame) => { const n = SA[anim].n, tot = n * FACINGS, fr = ((frame % tot) + tot) % tot; return { dir: (fr / n) | 0, f: fr % n }; };
  const PAINT = {};
  PAINT.agent = function (ctx, spec) {
    const anim = spec.sub || 'walk', A = SA[anim]; if (!A || anim === 'march') throw new Error('unknown agent anim "' + anim + '"');
    spec.frames = A.n * FACINGS;
    const sp = stuSplit(anim, spec.frame), cell = SC[A.c], look = spec.variant >>> 0, m = spec.master === 2 ? 2 : 1;
    return sheetRef(stuSheet('agent', anim, look, sp.dir, m, (g, f, env) => studentCell(g, env, anim, look, sp.dir, f, null)), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  PAINT.agentfar = function (ctx, spec) {
    const anim = spec.sub || 'walk', A = SA[anim]; if (!A || anim === 'march') throw new Error('unknown agentfar anim "' + anim + '"');
    spec.frames = 2 * FACINGS;
    const tot = 2 * FACINGS, fr = ((spec.frame % tot) + tot) % tot, cell = SC[A.c], look = spec.variant >>> 0, dir = fr >> 1, m = spec.master === 2 ? 2 : 1;   // render asks the far sheets at zoom 0.5 (master 1); master 2 only answers a direct get(…, 2)
    return sheetRef(stuSheet('agentfar', anim, look, dir, m, (g, k, env) => studentCell(g, env, anim, look, dir, A.n > 1 ? (k & 1) * (A.n >> 1) : 0, null)), fr & 1, -(cell.cw >> 1), -cell.gy);
  };
  // --- uniforms: the Wildlife Officer, the Bayou Brass, the krewe ----------------------------------------------------------------------
  let officerS = null;
  function officerStyle() {
    if (officerS) return officerS;
    officerS = { F: { skin: 2, hairC: 1, glasses: 1, style: 0, carry: 6, hat: 0, build: 2, acc: 0 }, Bd: SB[2], skin: SKIN6[2], hair: HAIR8[1], top: C.khaki, bot: '#4A5A3A', shoe: '#3A2A1E', acc: ACC8[0], kind: 'long', pat: 'badge', belt: C.ranger, longSleeve: true, hairStyle: 0, hat: 'ranger', glasses: true, carry: 6, head: 'bare', shinC: '#4A5A3A', pack: false };
    return officerS;
  }
  const bandS = new Map();
  function bandStyle(v) {
    const key = v & 255; let S = bandS.get(key); if (S) return S;
    const inst = (key >> 6) & 3;
    S = { F: { skin: (key & 7) % 6, hairC: (key >> 3) & 7, style: 0, carry: 6, hat: 0, build: 1, acc: 2 }, Bd: SB[1], skin: SKIN6[(key & 7) % 6], hair: HAIR8[(key >> 3) & 7], top: P1, bot: C.jerseyWhite, shoe: C.shoeDark, acc: GD, kind: 'long', pat: 'band', longSleeve: true, hairStyle: 0, hat: 'shako', carry: 6, head: 'bare', shinC: C.jerseyWhite, pack: false, inst: inst };
    S.extras = (c) => {
      const ctx = c.ctx, W = c.W, J = c.J, Q = c.Q, h = J.ha[0], py = c.p.py;
      if (inst === 0) { const a = Q(v3add(h, [-0.5, 0.2, 0.9])), b = Q(v3add(h, [-1.4, 0.2, 2.6])); c.add(b[2] + 1.6, () => { B.orb(ctx, a[0], a[1], 1.3, 1.3, GD, 0.1, { spec: 0.3 }); B.capsule(ctx, a[0], a[1], b[0], b[1], 0.6, 1.2, GD, 0.1, { amp: 0.3 }); }); }
      else if (inst === 1) { const a = Q([-1.8, py + 1.0, 2.2]), b = Q([1.8, py + 1.0, 2.2]); c.add((a[2] + b[2]) / 2 + 2.2, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 1.9, 1.9, GD, 0.05, { amp: 0.3 }); B.stroke(ctx, [[a[0] - 1.9, a[1] - 1.9], [b[0] + 1.9, b[1] - 1.9]], 0.9, C.jerseyWhite, 0.1, 1); }); }
      else { const a = Q([0, py + 2.4, 2.4]); c.add(a[2] + 2.8, () => { B.orb(ctx, a[0], a[1], 2.6, 2.6, C.jerseyWhite, 0.1, { spec: 0.2 }); ellipseStroke(ctx, a[0], a[1], 2.3, 2.3, 0.8, P1, 0); }); }
      void W;
    };
    bandS.set(key, S); return S;
  }
  const kreweS = new Map();
  function kreweStyle(v) {
    const key = v & 255; let S = kreweS.get(key); if (S) return S;
    const top = [P1, C.green, GD, P2][(key >> 5) & 3];
    S = { F: { skin: (key & 7) % 6, hairC: (key >> 3) & 7, style: (key >> 6) % 6, carry: 6, hat: 0, build: 1, acc: 2 }, Bd: SB[1], skin: SKIN6[(key & 7) % 6], hair: HAIR8[(key >> 3) & 7], top: top, bot: key & 1 ? C.staffDark : C.jerseyWhite, shoe: C.staffDark, acc: GD, kind: 'tee', pat: 'sash', longSleeve: false, hairStyle: (key >> 6) % 6, hat: 'tricorn', carry: 6, head: 'bare', shinC: key & 1 ? C.staffDark : C.jerseyWhite, pack: false };
    kreweS.set(key, S); return S;
  }
  const marchPose = (p, anim, f) => { p.fr = [p.fr[0], p.fr[1] * 1.6, p.fr[2]]; p.fl = [p.fl[0], p.fl[1] * 1.6, p.fl[2]]; void anim; void f; };
  SA.march = { n: 4, c: 'b' };
  PAINT.officer = function (ctx, spec) {
    if (spec.sub === 'wrangle') return paintWrangle(ctx, spec);
    if (spec.sub && spec.sub !== 'walk') throw new Error('unknown officer anim "' + spec.sub + '"');
    spec.frames = SA.walk.n * FACINGS;
    const sp = stuSplit('walk', spec.frame), cell = SC.a, m = spec.master === 2 ? 2 : 1;
    return sheetRef(stuSheet('officer', 'walk', 0, sp.dir, m, (g, f, env) => studentCell(g, env, 'walk', 0, sp.dir, f, { style: officerStyle(), noPack: true })), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  PAINT.band = function (ctx, spec) {
    const v = spec.variant | 0; spec.frames = SA.march.n * FACINGS;
    const sp = stuSplit('march', spec.frame), cell = SC.b, m = spec.master === 2 ? 2 : 1;
    return sheetRef(stuSheet('band', 'march', v & 255, sp.dir, m, (g, f, env) => studentCell(g, env, 'march', 0, sp.dir, f, { style: bandStyle(v), noPack: true, pose: marchPose })), sp.f, -(cell.cw >> 1), -cell.gy);
  };
  PAINT.krewe = function (ctx, spec) {
    const v = spec.variant | 0; spec.frames = SA.march.n * FACINGS;
    const sp = stuSplit('march', spec.frame), cell = SC.b, m = spec.master === 2 ? 2 : 1;
    return sheetRef(stuSheet('krewe', 'march', (v & 255) + 256, sp.dir, m, (g, f, env) => studentCell(g, env, 'march', 0, sp.dir, f, { style: kreweStyle(v), noPack: true, pose: (p, anim, f2) => { if (f2 === 1 || f2 === 3) { p.hr = [1.6, 4.6, 0.8]; p.epR = [1, 0.2, -0.3]; } } })), sp.f, -(cell.cw >> 1), -cell.gy);
  };

  // ---------------------------------------------------------------------------
  // Football (pass E ids): players (home / away jerseys, helmets, numbers, cleats), officials, chain crew, cheerleaders, the Bayou
  // Brass, staff, the upright mascot, fans on the treads, the ball, the down marker, the chain stick
  // ---------------------------------------------------------------------------
  function playerPose(kind, role, f) {
    const Bd = BUILD[role], hw = Bd.hw, Ln = role === 'line', Qb = role === 'qb';
    switch (kind) {
      case 'stance':
        if (Ln) return { py: 5.1, pz: -2.0, lean: 1.12, har: [3.0, 1.2, 4.1], hl: [-1.4, -4.6, -2.2], fr: [hw + 1.0, 0, -0.6], fl: [-hw - 1.0, 0, 0.6], ball: 'tuck' };
        if (role === 'back') return { py: 6.2, pz: -0.8, lean: 0.62, har: [hw + 0.9, 5.2, 2.3], hal: [-hw - 0.9, 5.2, 2.3], fr: [hw + 1.0, 0, -0.4], fl: [-hw - 1.0, 0, 0.4], ball: 'tuck' };
        if (Qb) return { py: 8.0, lean: 0.14, hr: [-2.8, -3.6, 2.8], hl: [2.8, -3.6, 2.8], fr: [hw + 0.6, 0, -0.4], fl: [-hw - 0.6, 0, 0.4], ball: 'both' };
        if (role === 'k') return { py: 8.2, lean: 0.1, hr: [0.7, -5.4, 0.6], hl: [-0.7, -5.4, 0.6], fr: [hw + 0.4, 0, -0.5], fl: [-hw - 0.4, 0, 0.5] };
        return { py: 7.3, pz: -0.4, lean: 0.34, hr: [0.4, -4.9, 2.2], hl: [-0.4, -4.9, 2.2], fr: [hw + 0.8, 0, -0.7], fl: [-hw - 0.8, 0, 0.6], ball: 'tuck' };
      case 'run': {
        const ph = f / 6 * FPI * 2, S3 = Ln ? 2.6 : 3.4, LF = Ln ? 2.3 : 3.0;
        const leg = (th, sg) => [sg * (hw + 0.2), Math.max(0, Math.cos(th)) * LF, Math.sin(th) * S3];
        const arm = (th, sg) => [0.3 * sg, -3.7 + 1.5 * Math.max(0, Math.cos(th)), Math.sin(th) * 3.4 + 0.6];
        return { py: Bd.hipY - 0.7 + 0.45 * Math.cos(2 * ph), lean: Ln ? 0.36 : Qb ? 0.2 : 0.3, tw: -0.17 * Math.sin(ph), fr: leg(ph, 1), fl: leg(ph + FPI, -1), hr: arm(ph + FPI, 1), hl: arm(ph, -1), ball: 'tuckRun' };
      }
      case 'throw':
        if (role === 'k') return f === 0 ? { py: 8.0, pz: -0.4, lean: 0.06, tw: 0.2, fr: [hw + 0.3, 2.4, -4.4], fl: [-hw - 0.3, 0, 0.8], hr: [3.0, -1.5, 0.5], hl: [-3.0, -3.8, 1.0], kpR: [0, 0.3, 1] } : { py: 8.0, lean: -0.22, tw: -0.2, fr: [hw + 0.4, 5.2, 7.0], fl: [-hw - 0.4, 0, -0.2], hr: [3.6, -0.8, -0.5], hl: [-2.6, -3.0, 1.4] };
        return f === 0 ? { py: Bd.hipY - 0.8, pz: -0.4, lean: -0.05, tw: -0.7, hr: [1.0, 2.4, -1.2], hl: [-1.0, -0.4, 4.6], fr: [hw + 0.6, 0, -2.4], fl: [-hw - 0.6, 0, 2.2], epR: [1, -0.3, -0.3], ball: 'ear' } : { py: Bd.hipY - 0.6, pz: 0.5, lean: 0.28, tw: 0.55, hr: [0.4, -1.0, 5.2], hl: [-1.8, -3.6, -0.2], fr: [hw + 0.4, 1.4, -3.0], fl: [-hw - 0.5, 0, 2.4] };
      case 'catch': return f === 0 ? { py: Bd.hipY + 0.1, lean: -0.08, hr: [-1.2, 4.4, 3.6], hl: [1.2, 4.4, 3.6], fr: [hw + 0.5, 0.5, -0.8], fl: [-hw - 0.5, 0, 0.9], epR: [1, 0.2, -0.2], epL: [-1, 0.2, -0.2], hu: 0.3 } : { py: Bd.hipY - 0.9, lean: 0.2, hr: [-1.6, -3.6, 2.6], hl: [1.6, -3.6, 2.6], fr: [hw + 0.5, 0, -0.6], fl: [-hw - 0.5, 0, 0.8], ball: 'both', ballAlways: true };
      case 'tackle': return f === 0 ? { py: 7.0, pz: 0.5, lean: 0.25, tilt: 0.7, hr: [-1.4, 2.0, 4.8], hl: [1.4, 2.0, 4.8], fr: [hw + 0.5, 0, -1.2], fl: [-hw - 0.5, 0, 1.0], epR: [1, 0, 0], epL: [-1, 0, 0] } : { py: 5.2, pz: 1.2, lean: 0.2, tilt: 1.15, hr: [-0.9, 2.6, 4.2], hl: [0.9, 2.6, 4.2], fr: [hw + 0.4, 1.6, -1.6], fl: [-hw - 0.4, 0.8, -0.6], epR: [1, 0, 0], epL: [-1, 0, 0] };
      case 'tackled': return { py: 3.4, lean: 0, tilt: -1.4, scale: 0.88, ground: 0.2, hr: [3.4, -2.2, 0.2], hl: [-3.4, -2.2, 0.2], fr: [hw + 0.4, 3.2, 1.0], fl: [-hw - 0.4, 2.4, 1.6], kpR: [0.2, 0.3, 1], kpL: [-0.2, 0.3, 1], epR: [0.3, -1, 0], epL: [-0.3, -1, 0] };
      case 'celebrate': return f === 0 ? { py: Bd.hipY - 0.6, lean: -0.05, hr: [2.4, 5.2, 0.6], hl: [-2.4, 5.2, 0.6], fr: [hw + 0.9, 0, 0], fl: [-hw - 0.9, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] } : { py: Bd.hipY + 0.8, lean: -0.12, hr: [1.6, 5.9, 0.5], hl: [-1.6, 5.9, 0.5], fr: [hw + 0.5, 1.2, -0.8], fl: [-hw - 0.5, 0.6, 0.3], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] };
      case 'huddle': return { py: 6.1, pz: -0.9, lean: 0.9, har: [hw + 1.6, 5.0, 2.4], hal: [-hw - 1.6, 5.0, 2.4], fr: [hw + 1.2, 0, -0.9], fl: [-hw - 1.2, 0, -0.9], hu: -0.6 };
    }
    return {};
  }
  function playerPoseCarry(kind, role, f, carry) { const p = playerPose(kind, role, f); if (kind === 'run' && carry) { p.hr = [-1.8, -3.5, 2.5]; p.epR = [1, -1, -0.2]; p.tw = (p.tw || 0) * 0.4; p.ball = 'tuck'; } return p; }
  const lookDef = (look) => (typeof M.fbLookDef === 'function' ? M.fbLookDef(look) : null) || { jersey: P1, pants: GD, helmet: GD, stripe: P1, logo: P1, num: GD, sock: C.jerseyWhite, glove: C.jerseyWhite };
  /** the ball tucked / held (a part at the hands) */
  function ballPart(c, p) {
    const J = c.J, Q = c.Q, W = c.W, ctx = c.ctx, R0 = J.ha[0], L0 = J.ha[1];
    const cen = p.ball === 'both' ? v3add(v3lerp(R0, L0, 0.5), [0, 0.3, 0.9]) : v3add(R0, p.ball === 'ear' ? [0.4, 0.9, 0] : [-0.2, 0.4, 0.5]);
    const ax = p.ball === 'both' ? [1, 0, 0] : [0, 0.15, 1], a = Q(v3sub(cen, v3mul(ax, 1.7))), b = Q(v3add(cen, v3mul(ax, 1.7)));
    void W; c.add(Math.max(a[2], b[2]) + 1.6, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 1.15, 1.15, C.ball, 0.05, { amp: 0.35, spec: c.lod ? 0 : 0.3 }); if (c.lod === 0) B.stroke(ctx, [[(a[0] + b[0]) / 2 - 0.6, (a[1] + b[1]) / 2 - 0.5], [(a[0] + b[0]) / 2 + 0.6, (a[1] + b[1]) / 2 - 0.5]], 0.5, C.lace, 0.2, 1); });
  }
  function playerStyle(v) {
    const look = v & 63, role = ROLES[(v >> 6) & 7] || 'skill', num = (v >> 9) & 127, Bd = BUILD[role], D = lookDef(look);
    const skin = SKIN6[num ? num % 6 : Bd.skin];
    return { Bd: Bd, skin: skin, hair: HAIR8[0], top: D.jersey, bot: D.pants, shoe: role === 'k' ? '#F0F0F0' : C.shoeDark, acc: D.stripe, sleeve: D.jersey, shinC: D.sock, glove: role === 'k' ? null : D.glove, longSleeve: false, kind: 'jersey', pat: null, head: 'helmet', helmet: D.helmet, stripe: D.stripe, logo: D.logo, digits: String(num || Bd.num), numCol: D.num, hairStyle: 0, hat: 0, carry: 6, pack: false, role: role,
      extras: role === 'qb' ? (c) => { const a = c.Q(v3add(c.J.P, [c.Bd.hw + 0.4, 0.4, 0.6])), b = c.Q(v3add(c.J.P, [c.Bd.hw + 0.4, -3.2, 0.6])); c.add((a[2] + b[2]) / 2 + 1, () => B.capsule(c.ctx, a[0], a[1], b[0], b[1], 0.9, 1.1, C.jerseyWhite, 0.1, { amp: 0.2 })); } : null };
  }
  function playerCell(ctx, env, pose, v, dir, f) {
    const role = ROLES[(v >> 6) & 7] || 'skill', S = playerStyle(v), p = playerPoseCarry(pose, role, f, (v >> 16) & 1);
    contact(ctx, env, FBL.cw >> 1, FBL.gy, pose === 'tackled' ? 14 : pose === 'tackle' ? 10 : 8);
    drawFigure(ctx, env, FBL.cw >> 1, FBL.gy, dir, BUILD[role], S, p, { prop: (c) => { if (p.ball && (((v >> 16) & 1) || p.ballAlways)) ballPart(c, p); } });
  }
  /** a civilian style (officials, crew, cheer, band, staff, fans): o = {top, bot, sleeve, shoe, skin, hair, cap: {c, bill}, longPants, longSleeve, pat} */
  function civStyle(o) {
    const sk = o.skin || SKIN6[1];
    return { Bd: BUILD.civ, skin: sk, hair: o.hair || HAIRS[1], top: o.top, bot: o.bot, shoe: o.shoe || C.shoeDark, acc: o.acc || GD, sleeve: o.sleeve || o.top, shinC: o.longPants ? o.bot : sk, glove: o.glove || null, longSleeve: !!o.longSleeve, kind: o.kind || 'tee', pat: o.pat || null, pat2: o.pat2, head: 'bare', hairStyle: o.hairStyle | 0, hat: o.cap ? 'cap:' + o.cap.c + ':' + (o.cap.bill || o.cap.c) : (o.hat || 0), carry: 6, pack: false, extras: o.extras || null, digits: o.digits, numCol: o.numCol };
  }
  function humanCell(ctx, env, Bd, S, p, dir, cw, ch, gy, shadow, prop) { contact(ctx, env, cw >> 1, gy, shadow || 8); drawFigure(ctx, env, cw >> 1, gy, dir, Bd, S, p, { prop: prop }); }
  function refCell(ctx, env, v, dir, f) {
    const S = civStyle({ top: '#F2F2F2', bot: C.refPants, shoe: '#101012', skin: skinOf(v), hair: hairOf(1), cap: { c: C.jerseyWhite, bill: C.black }, longPants: true, pat: 'ref' });
    const p = f === 0 ? { py: 8.4, hr: [0.7, -5.2, 0.6], hl: [-0.7, -5.2, 0.6], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] } : { py: 8.5, hr: [0.5, 6.0, 0.3], hl: [-0.5, 6.0, 0.3], fr: [2.1, 0, 0], fl: [-2.1, 0, 0], epR: [1, 0, 0], epL: [-1, 0, 0] };
    S.armStripe = true; humanCell(ctx, env, BUILD.civ, S, p, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  function crewCell(ctx, env, v, dir) {
    const S = civStyle({ top: C.vest, bot: C.crewPants, sleeve: C.offWhite, longSleeve: true, skin: skinOf(v), hair: hairOf(v >> 3), cap: { c: C.offWhite }, longPants: true, pat: 'vest' });
    humanCell(ctx, env, BUILD.civ, S, { py: 8.4, hr: [0.9, -4.6, 1.8], hl: [-0.9, -4.6, 1.8], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] }, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  function cheerCell(ctx, env, v, dir, f) {
    const S = civStyle({ top: P1, bot: C.jerseyWhite, shoe: C.jerseyWhite, skin: skinOf(v), hair: hairOf((v >> 3) + 1), hat: 'cheer' }); S.Bd = BUILD.cheer; S.shinC = S.skin;
    S.extras = (c) => {
      const ctx2 = c.ctx, Pw = c.Q(c.J.P), a = c.Q(v3add(c.J.P, [0, 0.5, 0])), b = c.Q(v3add(c.J.P, [0, -3.4, 0]));
      c.add((a[2] + b[2]) / 2 + c.Bd.sd * 0.8 + 0.4, () => { B.capsule(ctx2, a[0], a[1], b[0], b[1], 2.4, 3.4, GD, 0.05, { amp: 0.3 }); B.stroke(ctx2, [[a[0] - 2.2, a[1]], [a[0] + 2.2, a[1]]], 1.2, P1, 0, 1); });
      for (let s = 0; s < 2; s++) { const h = c.Q(v3add(c.J.ha[s], [0, 0.9, 0])); c.add(h[2] + 2.2, () => { B.orb(ctx2, h[0], h[1], 2.1, 2.0, GD, 0.15, { spec: 0.3 }); if (c.lod === 0) { dot(ctx2, h[0] - 0.8, h[1] - 0.6, 0.45, C.pomWhite, 0.2); dot(ctx2, h[0] + 0.7, h[1] + 0.5, 0.45, C.pomWhite, 0.2); dot(ctx2, h[0] + 0.3, h[1] - 1.1, 0.4, C.pomWhite, 0.2); } }); }
      void Pw;
    };
    const P4 = [
      { py: 8.0, hr: [2.4, 5.0, 0.7], hl: [-2.4, 5.0, 0.7], fr: [1.3, 0, 0], fl: [-1.3, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] },
      { py: 8.0, hr: [5.2, 0.4, 0.4], hl: [-5.2, 0.4, 0.4], fr: [2.4, 0, 0], fl: [-2.4, 0, 0], epR: [1, 0.2, 0], epL: [-1, 0.2, 0] },
      { py: 7.7, tw: 0.2, hr: [2.2, 5.2, 0.6], hl: [0.9, -3.8, 1.0], fr: [2.6, 0, 0], fl: [-1.8, 0, 0.4], epR: [1, 0, -0.3], epL: [-1, -0.2, -0.2] },
      { py: 10.0, hr: [1.5, 5.6, 0.5], hl: [-1.5, 5.6, 0.5], fr: [1.0, 2.2, -1.2], fl: [-1.0, 2.2, 1.6], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] }];
    humanCell(ctx, env, BUILD.cheer, S, P4[f & 3], dir, CHEER.cw, CHEER.ch, CHEER.gy);
  }
  function fbBandCell(ctx, env, v, dir, f) {
    const inst = (v & 3) > 2 ? 0 : (v & 3);
    const S = civStyle({ top: P1, bot: C.jerseyWhite, shoe: C.shoeDark, skin: skinOf(v >> 2), hair: hairOf(v >> 5), longPants: true, longSleeve: true, sleeve: P1, pat: 'band', kind: 'long', hat: 'shako' });
    S.extras = (c) => {
      const ctx2 = c.ctx, py = c.p.py, Q = c.Q;
      if (inst === 0) { const a = Q([0, py + 1.0, 2.5]), b = Q([0, py + 3.6, 2.5]); c.add(a[2] + 2.5, () => { B.capsule(ctx2, a[0], a[1] + 1.2, b[0], b[1] + 1.2, 2.3, 2.3, GD, 0.05, { amp: 0.3 }); B.stroke(ctx2, [[b[0] - 2.2, b[1] + 1.2], [b[0] + 2.2, b[1] + 1.2]], 1.0, C.jerseyWhite, 0.1, 1); }); }
      else if (inst === 1) { const m0 = c.hp(0, -0.5, 0.95), m1 = c.hp(0, -0.35, 2.6); c.add(m1[2] + 1.8, () => { B.capsule(ctx2, m0[0], m0[1], m1[0], m1[1], 0.7, 0.7, GD, 0.1, { amp: 0.3 }); B.orb(ctx2, m1[0], m1[1], 1.7, 1.7, GD, 0.15, { spec: 0.3 }); }); }
      else { const a = Q([0, py + 2.6, 2.1]); c.add(a[2] + 3.6, () => { B.orb(ctx2, a[0], a[1], 3.5, 3.5, C.jerseyWhite, 0.1, { spec: 0.2 }); ellipseStroke(ctx2, a[0], a[1], 3.1, 3.1, 0.9, P1, 0); }); }
    };
    const hands = inst === 1 ? { hr: [-1.6, 0.2, 3.0], hl: [1.6, 0.4, 4.4] } : { hr: [-0.6, -3.0, 3.3], hl: [0.6, -3.0, 3.3] };
    const p = f === 0 ? { py: 8.4, fr: [2.0, 2.8, 1.4], fl: [-2.0, 0, -0.6] } : { py: 8.4, fr: [2.0, 0, -0.6], fl: [-2.0, 2.8, 1.4] };
    humanCell(ctx, env, BUILD.civ, S, Object.assign(p, hands), dir, BAND.cw, BAND.ch, BAND.gy);
  }
  function staffCell(ctx, env, v, dir, f) {
    const kind = v & 3, skin = skinOf(v >> 2), hair = hairOf(v >> 5);
    const o = [{ top: P1, bot: C.staffDark, cap: { c: GD, bill: PAL.goldShadow || GD }, longSleeve: true }, { top: C.offWhite, bot: C.khakiDark, cap: { c: P1 }, longSleeve: false }, { top: C.offWhite, bot: C.staffDark, cap: null, longSleeve: false }, { top: '#9AA0A8', bot: C.khakiDark, cap: { c: '#9AA0A8' }, longSleeve: false }][kind];
    const S = civStyle({ top: o.top, bot: o.bot, skin: skin, hair: hair, cap: o.cap, longPants: true, longSleeve: o.longSleeve, sleeve: o.top, kind: o.longSleeve ? 'long' : 'polo' });
    S.extras = (c) => {
      const ctx2 = c.ctx;
      if (kind < 2) c.add(c.Hc[2] + c.hr + 0.5, () => { const hp = c.hp, a = hp(-1.0, 0.1, 0), t = hp(0, 1.04, 0), b = hp(1.0, 0.1, 0); B.stroke(ctx2, [[a[0], a[1]], [t[0], t[1]], [b[0], b[1]]], 0.7, C.headset, 0, 1, { smooth: true }); dot(ctx2, a[0], a[1], 0.85, C.headset, 0); dot(ctx2, b[0], b[1], 0.85, C.headset, 0); const m = hp(-0.3, -0.55, 0.95); B.stroke(ctx2, [[a[0], a[1] + 0.3], [m[0], m[1]]], 0.5, C.headset, 0, 1); });
      if (kind === 3) { const h = c.Q(c.J.ha[0]); c.add(h[2] + 2, () => { B.capsule(ctx2, h[0], h[1] + 0.8, h[0], h[1] - 2.8, 1.6, 1.6, C.jug, 0.1, { amp: 0.3 }); B.stroke(ctx2, [[h[0] - 1.4, h[1] - 2.6], [h[0] + 1.4, h[1] - 2.6]], 0.9, C.jerseyWhite, 0.1, 1); }); }
    };
    const p = f === 0 ? { py: 8.4, hr: [0.6, -5.4, 0.6], hl: [-0.6, -5.4, 0.6], fr: [2.1, 0, 0], fl: [-2.1, 0, 0] } : kind === 3 ? { py: 8.4, hr: [0.8, -4.8, 1.0], hl: [-0.5, -5.6, -1.2], fr: [2.0, 0, 2.0], fl: [-2.0, 0, -2.0] } : { py: 8.4, tw: -0.2, hr: [1.4, -0.9, 5.4], hl: [-0.2, -3.6, 0.8], fr: [2.2, 0, 0.4], fl: [-2.2, 0, -0.4], epL: [-1, -0.5, -0.2] };
    humanCell(ctx, env, BUILD.civ, S, p, dir, FBL.cw, FBL.ch, FBL.gy);
  }
  function fanCell(ctx, env, sub, v, dir, f) {
    const look = v & 63, D = lookDef(look), skin = skinOf((v >> 6) & 7), hair = hairOf((v >> 9) & 7), dim = FAN_DIM[sub] || FAN_DIM.standing;
    const shirt = look === 0 ? P1 : D.jersey, mid = look === 0 ? GD : D.pants;
    const S = civStyle({ top: shirt, bot: C.fan2, shoe: C.headset, skin: skin, hair: hair, cap: ((v >> 12) & 1) ? { c: mid } : null, longPants: true, pat: 'fan', pat2: mid, hairStyle: (v >> 9) & 1 ? 1 : 0 });
    const hw = BUILD.civ.hw;
    let p;
    if (sub === 'seated') p = { py: 4.6, lean: 0.05, hr: [0.3, -3.3, 1.8], hl: [-0.3, -3.3, 1.8], fr: [hw + 0.3, 0, 4.2], fl: [-hw - 0.3, 0, 4.2], kpR: [0, 1, 0.8], kpL: [0, 1, 0.8] };
    else if (sub === 'standing') p = f === 0 ? { py: 8.4, hr: [-0.8, -3.2, 3.2], hl: [0.8, -3.2, 3.2], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] } : { py: 8.4, hr: [-2.6, -3.0, 3.4], hl: [2.6, -3.0, 3.4], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] };
    else p = f === 0 ? { py: 8.7, hr: [2.2, 5.4, 0.4], hl: [-2.0, 4.2, 0.6], fr: [hw + 0.5, 0, 0], fl: [-hw - 0.5, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] } : { py: 8.2, hr: [1.8, 4.2, 0.6], hl: [-2.2, 5.4, 0.4], fr: [hw + 0.5, 0, 0], fl: [-hw - 0.5, 0, 0], epR: [1, 0, -0.3], epL: [-1, 0, -0.3] };
    humanCell(ctx, env, BUILD.civ, S, p, dir, dim.cw, dim.ch, dim.gy, 6);
  }
  function rouxUprightCell(ctx, env, v, dir, f) {
    const fur = C.tiger;
    const S = civStyle({ top: P1, bot: fur, shoe: C.headset, skin: fur, glove: fur, sleeve: P1, longPants: true, pat: 'roux' }); S.Bd = BUILD.roux; S.head = 'tiger'; S.digits = '1'; S.numCol = GD; S.legStripe = true; S.shinC = fur;
    S.extras = (c) => {
      const ctx2 = c.ctx, Q = c.Q, p = c.p, py = p.py === undefined ? BUILD.roux.hipY : p.py, pz = p.pz || 0;
      const t0 = Q([0, py + 0.2, pz - 1.4]), t1 = Q([0, py + 1.2, pz - 4.4]), t2 = Q([0.5, py + 4.6, pz - 5.2]);
      c.add((t0[2] + t2[2]) / 2 + 0.5, () => { B.capsule(ctx2, t0[0], t0[1], t1[0], t1[1], 1.0, 0.9, fur, 0, { amp: 0.3 }); B.capsule(ctx2, t1[0], t1[1], t2[0], t2[1], 0.9, 0.8, fur, 0, { amp: 0.3 }); dot(ctx2, t2[0], t2[1], 0.85, C.black, 0); if (c.lod === 0) dot(ctx2, (t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2, 0.8, C.black, 0, 0.85); });
    };
    const hw = BUILD.roux.hw;
    const P3 = [
      { py: 8.6, hr: [1.4, -5.6, 0.8], hl: [-1.4, -5.6, 0.8], fr: [hw + 0.4, 0, 0], fl: [-hw - 0.4, 0, 0] },
      { py: 8.2, tw: -0.1, hr: [2.8, 4.2, 1.0], hl: [-0.6, -3.2, 1.6], fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0], epR: [1, 0, -0.3] },
      { py: 7.4, pz: 1.0, lean: 0.5, tilt: 0.2, hr: [-0.8, 0.8, 5.6], hl: [0.8, 0.8, 5.6], fr: [hw + 0.4, 1.8, -3.2], fl: [-hw - 0.4, 0, 1.6], epR: [1, -0.2, 0], epL: [-1, -0.2, 0] }];
    void v; humanCell(ctx, env, BUILD.roux, S, P3[f % 3], dir, ROUXU.cw, ROUXU.ch, ROUXU.gy, 12);
  }
  /** a lazily baked sheet family: one canvas per (sub-pose, variant, facing, master) */
  function fbFamily(name, o) {
    PAINT[name] = function (ctx, spec) {
      const sub = spec.sub || o.def, v = spec.variant | 0, n = o.nOf(sub, v);
      if (!n) throw new Error('unknown ' + name + ' sub "' + sub + '"');
      spec.frames = n * 8;
      const fr = ((spec.frame % (n * 8)) + n * 8) % (n * 8), dir = (fr / n) | 0, d = o.dim(sub), m = spec.master === 2 ? 2 : 1;
      const s = getSheet(name + '|' + sub + '|' + v + '|' + dir + '|' + m, name, d.cw, d.ch, n, m, (g, f, env) => o.cell(g, env, sub, v, dir, f));
      return sheetRef(s, fr % n, -(d.cw >> 1), -d.gy);
    };
  }
  const dimOf = (d) => () => d;
  fbFamily('fbplayer', { dim: dimOf(FBL), def: 'stance', nOf: (sub) => POSES[sub] || 0, cell: (g, env, sub, v, dir, f) => playerCell(g, env, sub, v, dir, f) });
  fbFamily('fbref', { dim: dimOf(FBL), def: 'stand', nOf: () => 2, cell: (g, env, sub, v, dir, f) => refCell(g, env, v, dir, f) });
  fbFamily('fbcrew', { dim: dimOf(FBL), def: 'stand', nOf: () => 1, cell: (g, env, sub, v, dir) => crewCell(g, env, v, dir) });
  fbFamily('fbcheer', { dim: dimOf(CHEER), def: 'cheer', nOf: () => 4, cell: (g, env, sub, v, dir, f) => cheerCell(g, env, v, dir, f) });
  fbFamily('fbband', { dim: dimOf(BAND), def: 'march', nOf: () => 2, cell: (g, env, sub, v, dir, f) => fbBandCell(g, env, v, dir, f) });
  fbFamily('fbstaff', { dim: dimOf(FBL), def: 'stand', nOf: () => 2, cell: (g, env, sub, v, dir, f) => staffCell(g, env, v, dir, f) });
  fbFamily('fbroux', { dim: dimOf(ROUXU), def: 'idle', nOf: () => 3, cell: (g, env, sub, v, dir, f) => rouxUprightCell(g, env, v, dir, f) });
  fbFamily('fbfan', { dim: (sub) => FAN_DIM[sub] || FAN_DIM.standing, def: 'standing', nOf: (sub) => ({ seated: 1, standing: 2, wave: 2 }[sub] || 0), cell: (g, env, sub, v, dir, f) => fanCell(g, env, sub, v, dir, f) });
  /** the ball (10×10, 4 lace frames, variant = the spin axis k) — an own canvas through brush.begin */
  PAINT.fbball = function (ctx, spec) {
    spec.frames = 4;
    const g = B.begin(ctx, 10, 10, spec), env = g.env, k = spec.variant | 0, f = ((spec.frame % 4) + 4) % 4, a = k * FPI / 8;
    ctx.save(); ctx.translate(5, 5); ctx.rotate(-a);
    B.capsule(ctx, -2.2, 0, 2.2, 0, 1.85, 1.85, C.ball, 0.05, { amp: 0.35, spec: env.lod ? 0 : 0.3 });
    B.stroke(ctx, [[-1.0, -0.6 + [-0.95, 0, 0.9, 0.95][f] * 0.6], [1.0, -0.6 + [-0.95, 0, 0.9, 0.95][f] * 0.6]], 0.5, C.lace, 0.2, 1);
    if (env.lod === 0) { B.stroke(ctx, [[-2.3, 0.3], [-2.0, -0.6]], 0.4, C.lace, 0.2, 0.8); B.stroke(ctx, [[2.3, 0.3], [2.0, -0.6]], 0.4, C.lace, 0.2, 0.8); }
    ctx.restore();
    return { w: 10, h: 10, ox: -5, oy: -5 };
  };
  /** the down marker: a 3×5 digit on an orange plate over a steel pole (variant = the down 1–4); anchor = the base */
  PAINT.fbdown = function (ctx, spec) {
    const d = Math.max(1, Math.min(4, (spec.variant | 0) || 1)); spec.frames = 1;
    const g = B.begin(ctx, 11, 30, spec), env = g.env;
    contact(ctx, env, 5.5, 28, 7, 0.3);
    B.capsule(ctx, 5.5, 27, 5.5, 11, 0.75, 0.55, C.steel, 0.1, { amp: 0.3 });
    B.plane(ctx, [[0.5, 0.5], [10.5, 0.5], [10.5, 10.5], [0.5, 10.5]], C.vest, 0.05, { amp: 0.2, spec: env.lod ? 0 : 0.2 });
    B.stroke(ctx, [[0.5, 0.5], [10.5, 0.5], [10.5, 10.5], [0.5, 10.5]], 0.8, '#4A2208', 0, 1, { close: true });
    B.digits(ctx, 5.5, 5.5, String(d), 6.5, C.white, 0.2, { w: 1.1 });
    return { w: 11, h: 30, ox: -5, oy: -28 };
  };
  /** the chain stick: a white pole with orange bands and a red top */
  PAINT.fbstick = function (ctx, spec) {
    spec.frames = 1;
    const g = B.begin(ctx, 7, 28, spec), env = g.env;
    contact(ctx, env, 3.5, 26, 5, 0.3);
    B.capsule(ctx, 3, 25.5, 3, 4, 0.9, 0.75, C.jerseyWhite, 0.1, { amp: 0.3 });
    if (env.lod === 0) for (let y = 8; y < 22; y += 4) B.stroke(ctx, [[3, y], [3, y + 2]], 1.6, C.vest, 0.05, 1);
    B.capsule(ctx, 3, 4, 3, 0.8, 1.4, 1.2, '#B22222', 0.1, { amp: 0.3 });
    return { w: 7, h: 28, ox: -3, oy: -26 };
  };

  // ---------------------------------------------------------------------------
  // Creatures on the 2:1 ground projection (sy = gy − Y + Z · 0.5): gators (3 sizes × swim / walk / bask / lunge, the tail sways with the
  // frame), Roux on all fours (pace / idle / lie / yawn), the nutria, egrets and spoonbills, the officer wrangling a juvenile
  // ---------------------------------------------------------------------------
  const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const groundPr = (cx, gy) => (w) => [cx + w[0], gy - w[1] + w[2] * 0.5, w[2]];
  /** a dashed ripple ring on the ground plane (local half-axes a across × b along the body): `front` = the half nearer the viewer */
  function rippleRing(ctx, env, pr, W, a, b, ph, front) {
    const n = 24, pts = []; for (let k = 0; k <= n; k++) { const t = k / n * FPI * 2; pts.push(pr(W([Math.cos(t) * a, 0, Math.sin(t) * b]))); }
    const zc = pr(W([0, 0, 0]))[2], step = env.lod ? 2 : 1;
    for (let k = 0; k < n; k += step) { const p0 = pts[k], p1 = pts[k + step] || pts[k + 1]; if (((p0[2] + p1[2]) / 2 > zc) !== !!front) continue; if (((k + Math.round(ph * 4)) % 4) === 3) continue; B.stroke(ctx, [[p0[0], p0[1]], [p1[0], p1[1]]], 0.7, C.ripple, (k & 1) ? 0.3 : 0, 0.5); }
  }
  function gatorSpine(G, mode, f, ph, lunge) {
    const pts = [], L = G.L, rb = G.rb;
    for (let i = 0; i <= 13; i++) {
      const u = i / 13; let k;
      if (u < 0.40) k = 0.14 + 0.76 * Math.pow(u / 0.40, 0.85); else if (u < 0.70) k = 0.9 + 0.1 * Math.sin((u - 0.4) / 0.3 * FPI); else if (u < 0.78) k = 0.8; else if (u < 0.88) k = 0.82; else k = 0.5 - 0.12 * ((u - 0.88) / 0.12);
      const r = rb * k, sunk = mode === 'swim' ? 0.38 : 0.95;
      let y = r * sunk + (mode === 'walk' ? rb * 0.55 : 0), x = 0;
      if (u < 0.5) x = rb * (mode === 'walk' ? 0.9 : mode === 'swim' ? 0.7 : 0.35) * Math.sin(ph * FPI * 2 - u * 7) * (1 - u / 0.5);
      else if (mode === 'walk' || mode === 'swim') x = rb * 0.25 * Math.sin(ph * FPI * 2 - u * 7 + 1.4) * (u - 0.5);
      if (lunge) y += lunge * rb * smooth01((u - 0.38) / 0.55) * 2.6;
      pts.push({ x: x, y: y, z: -L / 2 + L * u, r: r, u: u });
    }
    return pts;
  }
  function gatorCell(ctx, env, v, dir, k, offX, offY) {
    v = Math.max(0, Math.min(2, v | 0)); const G = GATORS[v], rb = G.rb, L = G.L, lod = env.lod | 0;
    k = ((k | 0) % GPER + GPER) % GPER; dir = ((dir | 0) % 8 + 8) % 8;
    const mode = k < 2 ? 'swim' : k < 6 ? 'walk' : k < 8 ? 'bask' : 'lunge', f = mode === 'swim' ? k : mode === 'walk' ? k - 2 : mode === 'bask' ? k - 6 : k - 8;
    const gyc = (offY == null ? G.ch - 9 : offY), cx = (offX == null ? G.cw >> 1 : offX), V = viewer(dir), W = V.W, pr = groundPr(cx, gyc), Q = (q) => pr(W(q));
    const ph = mode === 'walk' ? f / 4 : mode === 'swim' ? f * 0.5 : f * 0.25, lunge = mode === 'lunge' ? (f === 0 ? 1.0 : 0.55) : 0;
    const sp = gatorSpine(G, mode, f, ph, lunge), legend = v === 2, back = legend ? C.gatorLegend : C.gatorBack, Lp = parts(), add = Lp.add;
    if (mode !== 'swim') contact(ctx, env, cx, gyc, Math.round(L * 0.6) | 1, 0.3); else rippleRing(ctx, env, pr, W, rb * 1.9 + 1.4, L * 0.5 + 2.4, f * 0.6, false);
    const P = (p, dx, dy) => Q([p.x + (dx || 0), p.y + (dy || 0), p.z]);
    for (let i = 0; i < sp.length - 1; i++) {
      const a = sp[i], b = sp[i + 1];
      if (i < 10) for (const s of [-1, 1]) { const a0 = P(a, s * rb * 0.5 * a.r / rb, -a.r * 0.3), b0 = P(b, s * rb * 0.5 * b.r / rb, -b.r * 0.3); add((a0[2] + b0[2]) / 2 + 0.4 * a.r, () => B.capsule(ctx, a0[0], a0[1], b0[0], b0[1], a.r * 0.72, b.r * 0.72, C.gatorFlank, -0.05, { amp: 0.25, flat: true })); }
      const a1 = P(a), b1 = P(b);
      add((a1[2] + b1[2]) / 2 + 0.8 * a.r + 0.1, () => { B.capsule(ctx, a1[0], a1[1], b1[0], b1[1], a.r, b.r, back, i >= 11 ? 0.05 : 0, { amp: 0.32 }); if (lod === 0 && i > 0 && i < 11) dot(ctx, a1[0], a1[1] - a.r * 0.5, Math.max(0.3, a.r * 0.2), back, -0.55, 0.85); });
    }
    if (mode !== 'swim') {
      const stride = mode === 'walk' ? 1.9 : 0, lift = mode === 'walk' ? 1.5 : 0;
      for (const leg of [[0.66, 1, 0], [0.66, -1, 1], [0.36, 1, 1], [0.36, -1, 0]]) {
        const u = leg[0], s = leg[1], sh = sp[Math.round(u * 13)], t = ((f / 4) + (leg[2] ? 0.5 : 0)) % 1;
        const fz = sh.z + (mode === 'walk' ? (t < 0.5 ? stride - 2 * stride * (t / 0.5) : -stride + 2 * stride * ((t - 0.5) / 0.5)) : (leg[0] > 0.5 ? 1.2 : -1.0)), fy = mode === 'walk' && t >= 0.5 ? lift * Math.sin(FPI * (t - 0.5) / 0.5) : 0;
        const spread = mode === 'walk' ? 1.75 : 2.05, A0 = [sh.x + s * rb * 0.85, sh.y - sh.r * 0.2, sh.z], T = [sh.x + s * (rb * spread + 0.6), fy + 0.3, fz];
        const r = ik2(A0, T, rb * 1.25 + 0.5, rb * 1.1 + 0.5, [s * 1, 1.4, 0]), lr = rb * 0.36 + 0.28, a0 = Q(A0), a1 = Q(r[0]), a2 = Q(r[1]), ft = Q([r[1][0], r[1][1] + 0.1, r[1][2] + 0.5]);
        add((a0[2] + a2[2]) / 2 + 0.8 * lr + 0.2, () => { B.capsule(ctx, a0[0], a0[1], a1[0], a1[1], lr, lr * 0.9, back, 0, { amp: 0.3 }); B.capsule(ctx, a1[0], a1[1], a2[0], a2[1], lr * 0.9, lr * 0.75, back, 0, { amp: 0.3 }); dot(ctx, ft[0], ft[1], lr * 1.1, C.gatorFlank, -0.1); });
      }
    }
    const sk = sp[11], tip = sp[13], jaw = mode === 'bask' ? (f === 0 ? 0.55 : 0.85) : mode === 'lunge' ? (f === 0 ? 1.15 : 0.35) : 0;
    const snoutUp = jaw * rb * 0.32, jawDrop = jaw * rb * 0.95;
    const up0 = [sk.x, sk.y + sk.r * 0.12, sk.z + sk.r * 0.2], up1 = [tip.x, tip.y + snoutUp, tip.z + 0.4];
    const lo0 = [sk.x, sk.y - sk.r * 0.42, sk.z + sk.r * 0.1], lo1 = [tip.x, tip.y - rb * 0.18 - jawDrop, tip.z];
    const u0 = Q(up0), u1 = Q(up1), l0 = Q(lo0), l1 = Q(lo1), skc = Q([sk.x, sk.y + sk.r * 0.1, sk.z]);
    add((l0[2] + l1[2]) / 2 + 0.6 * sk.r, () => {
      if (jaw > 0.1) { const m0 = Q([lo0[0], lo0[1] + 0.2, lo0[2]]), m1 = Q([lo1[0], lo1[1] + 0.4, lo1[2] - 0.5]); B.capsule(ctx, m0[0], m0[1], m1[0], m1[1], rb * 0.34, rb * 0.26, C.mouth, 0, { flat: true }); }
      B.capsule(ctx, l0[0], l0[1], l1[0], l1[1], sk.r * 0.7, rb * 0.3, C.gatorBelly, 0.1, { amp: 0.25 });
    });
    add((u0[2] + u1[2]) / 2 + 0.8 * sk.r + 0.2, () => {
      B.capsule(ctx, u0[0], u0[1], u1[0], u1[1], sk.r * 0.82, rb * 0.34, back, 0.05, { amp: 0.3 });
      B.orb(ctx, skc[0], skc[1], sk.r * 0.95, sk.r * 0.85, back, 0.05, { spec: lod ? 0 : 0.2 });
      if (jaw > 0.1 && lod === 0) for (let i = 0; i < 4; i++) { const tq = 0.3 + i * 0.2, tp = Q([up0[0] + (up1[0] - up0[0]) * tq, up0[1] + (up1[1] - up0[1]) * tq - rb * 0.32, up0[2] + (up1[2] - up0[2]) * tq]); dot(ctx, tp[0], tp[1], Math.max(0.3, rb * 0.13), C.tooth, 0.3); }
      for (const s of [-1, 1]) { const ep = Q([sk.x + s * sk.r * 0.55, sk.y + sk.r * 0.78 + snoutUp * 0.3, sk.z + sk.r * 0.35]), er = Math.max(0.55, rb * 0.34); dot(ctx, ep[0], ep[1], er, back, -0.2); if (ep[2] > skc[2] - sk.r * 0.2 || lod === 0) { dot(ctx, ep[0] + er * 0.15, ep[1] - er * 0.1, er * 0.62, C.gatorEye, 0.3); dot(ctx, ep[0] + er * 0.2, ep[1] - er * 0.05, er * 0.3, C.eye, 0); } }
      const no = Q([tip.x + 0.45, up1[1] + rb * 0.1, tip.z + 0.2]); dot(ctx, no[0], no[1], Math.max(0.35, rb * 0.16), C.black, 0, 0.9);
    });
    if (legend) add(100, () => { for (let i = 3; i < 9; i += 2) { const p = sp[i], a = Q([p.x + rb * 0.3, p.y + p.r * 0.85, p.z]), b = Q([p.x + rb * 0.9, p.y + p.r * 0.2, p.z - 1.2]); B.stroke(ctx, [[a[0], a[1]], [b[0], b[1]]], 0.9, C.moss, 0.1, 0.9); } const s0 = Q([sk.x - sk.r * 0.7, sk.y + sk.r * 0.3, sk.z + 1.5]), s1 = Q([sk.x - sk.r * 0.7, sk.y + sk.r * 0.3, sk.z + 4.5]); B.stroke(ctx, [[s0[0], s0[1]], [s1[0], s1[1]]], 0.6, C.scar, 0.2, 0.9); });
    Lp.draw();
    if (mode === 'swim') { rippleRing(ctx, env, pr, W, rb * 1.9 + 1.4, L * 0.5 + 2.4, f * 0.6, true); for (const s of [-1, 1]) { const pts = []; for (let i = 0; i < 9; i++) { const t = i / 9, q = Q([s * (rb * 0.8 + t * L * 0.34), 0, L * 0.34 - t * L * 0.55]); pts.push([q[0], q[1]]); } B.stroke(ctx, pts, 0.7, C.ripple, 0.3, 0.55); } }
  }
  /** gator eye offsets as the pen's gatorEyes (render_fx's night glow reads M.gatorEyes, which stays the pen's) */
  function legIK(ctx, Q, A0, T, l1, l2, pole, r, color, stripes, paw, add, lod) {
    const q = ik2(A0, T, l1, l2, pole), a0 = Q(A0), a1 = Q(q[0]), a2 = Q(q[1]), pw = Q([q[1][0], q[1][1] + 0.1, q[1][2] + 0.5]);
    add((a0[2] + a2[2]) / 2 + 0.8 * r + 0.2, () => { B.capsule(ctx, a0[0], a0[1], a1[0], a1[1], r, r * 0.9, color, 0, { amp: 0.3 }); B.capsule(ctx, a1[0], a1[1], a2[0], a2[1], r * 0.9, r * 0.75, color, 0, { amp: 0.3 }); if (stripes && lod === 0) B.stroke(ctx, [[a0[0] + (a1[0] - a0[0]) * 0.35, a0[1] + (a1[1] - a0[1]) * 0.35], [a0[0] + (a1[0] - a0[0]) * 0.5, a0[1] + (a1[1] - a0[1]) * 0.5]], r * 1.6, C.black, 0, 0.8); if (paw) dot(ctx, pw[0], pw[1], r * 1.1, paw, 0.1); });
  }
  function rouxCell(ctx, env, dir, k) {
    k = ((k | 0) % RPER + RPER) % RPER; dir = ((dir | 0) % 8 + 8) % 8; const lod = env.lod | 0;
    const mode = k < 4 ? 'pace' : k < 6 ? 'idle' : k < 8 ? 'lie' : 'yawn', f = mode === 'pace' ? k : mode === 'idle' ? k - 4 : mode === 'lie' ? k - 6 : k - 8;
    const cx = RX.cw >> 1, gy = RX.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), rb = RX.rb, L = RX.L, Lp = parts(), add = Lp.add;
    const lieDown = mode === 'lie', ph = f / 4, breath = lieDown ? 0.25 * f : 0;
    const legH = lieDown ? 0.6 : 3.6, by = legH + rb * (lieDown ? 0.85 : 0.95) + breath * 0.5;
    contact(ctx, env, cx, gy, lieDown ? 24 : 20, 0.32);
    const sp = []; for (let i = 0; i <= 5; i++) { const u = i / 5; sp.push({ x: mode === 'pace' ? 0.45 * Math.sin(ph * 6.28 + u * 2) : 0, y: by + (u - 0.5) * 0.7, z: -L * 0.32 + L * 0.64 * u, r: rb * (0.88 + 0.22 * Math.sin(u * 3.1)) }); }
    const tailSway = Math.sin(ph * 6.28 + 1) * (mode === 'idle' ? 1.6 * (f ? 1 : -1) : 1.1);
    const tl = [[sp[0].x, sp[0].y + 0.2, sp[0].z - 1.2], [tailSway * 0.4, sp[0].y + 0.4, sp[0].z - 4], [tailSway * 0.8, sp[0].y + 2.0, sp[0].z - 6.4], [tailSway, sp[0].y + 4.4, sp[0].z - 7.0], [tailSway * 1.1, sp[0].y + 6.6, sp[0].z - 6.2]];
    for (let i = 0; i < tl.length - 1; i++) { const a = Q(tl[i]), b = Q(tl[i + 1]), ring = i >= 2 && (((i * 2) % 3) === 1 || i === tl.length - 2); add((a[2] + b[2]) / 2 + 0.6, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 0.85 - i * 0.07, 0.8 - i * 0.07, ring ? C.black : C.tiger, 0, { amp: 0.3 }); if (!ring && lod === 0) B.stroke(ctx, [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2]], 1.4 - i * 0.12, C.black, 0, 0.8); }); }
    for (let i = 0; i < 5; i++) {
      const s0 = sp[i], s1 = sp[i + 1], b0 = Q([s0.x, s0.y - s0.r * 0.66, s0.z]), b1 = Q([s1.x, s1.y - s1.r * 0.66, s1.z]), t0 = Q([s0.x, s0.y + s0.r * 0.05, s0.z]), t1 = Q([s1.x, s1.y + s1.r * 0.05, s1.z]);
      add((b0[2] + b1[2]) / 2 + 0.3 * s0.r, () => B.capsule(ctx, b0[0], b0[1], b1[0], b1[1], s0.r * 0.62, s1.r * 0.62, C.tigerBelly, 0.05, { amp: 0.2, flat: true }));
      add((t0[2] + t1[2]) / 2 + 0.8 * s0.r + 0.1, () => { B.capsule(ctx, t0[0], t0[1], t1[0], t1[1], s0.r * 1.02, s1.r * 1.02, C.tiger, 0.05, { amp: 0.32, spec: lod ? 0 : 0.12 }); const ns = lod ? 1 : 2; for (let j = 0; j < ns; j++) { const u = (j + 0.5) / ns, px = t0[0] + (t1[0] - t0[0]) * u, py = t0[1] + (t1[1] - t0[1]) * u, dx = t1[1] - t0[1], dy = -(t1[0] - t0[0]), dl = Math.hypot(dx, dy) || 1; B.stroke(ctx, [[px - dx / dl * s0.r * 0.9, py - dy / dl * s0.r * 0.9], [px + dx / dl * s0.r * 0.25, py + dy / dl * s0.r * 0.25]], 0.75, C.black, 0, 0.8); } });
    }
    for (const lg of [[0.88, 1, 0], [0.88, -1, 1], [0.12, 1, 1], [0.12, -1, 0]]) {
      const sh = sp[Math.round(lg[0] * 5)], s = lg[1], t = ((ph) + (lg[2] ? 0.5 : 0)) % 1, st = 2.6, lf = 1.9;
      let fz = sh.z + 0.3, fy = 0;
      if (mode === 'pace') { fz = sh.z + (t < 0.5 ? st - 2 * st * (t / 0.5) : -st + 2 * st * ((t - 0.5) / 0.5)); fy = t >= 0.5 ? lf * Math.sin(FPI * (t - 0.5) / 0.5) : 0; }
      else if (lieDown) fz = sh.z + (lg[0] > 0.5 ? 3.0 : -1.2);
      const A0 = [sh.x + s * rb * 0.62, sh.y - sh.r * 0.1, sh.z], T = [sh.x + s * (rb * 0.72 + (lieDown ? 1.0 : 0.1)), fy + 0.4, fz];
      legIK(ctx, Q, A0, T, 2.7, 2.6, [0, 1.5, lg[0] > 0.5 ? -0.4 : 0.9], 1.15, C.tiger, true, C.tigerBelly, add, lod);
    }
    const hd = sp[5], hy = lieDown ? hd.y + 1.8 : hd.y + 1.6, hz = hd.z + 3.4, jaw = mode === 'yawn' ? (f ? 1.0 : 0.6) : 0, hr = 2.6;
    const H = [0, hy + (jaw ? 0.6 : 0), hz], n0 = Q([0, hd.y + 0.2, hd.z + 0.5]), n1 = Q([0, hy - 0.6, hz - 0.8]), Hc = Q(H);
    add((n0[2] + n1[2]) / 2 + 1.5, () => B.capsule(ctx, n0[0], n0[1], n1[0], n1[1], 1.9, 1.9, C.tiger, 0.05, { amp: 0.3 }));
    add(Hc[2] + hr, () => { const c = { ctx: ctx }; drawTigerHead(ctx, c, Hc[0], Hc[1], hr, V.c, V.s, lod, jaw); });
    Lp.draw();
  }
  function nutriaCell(ctx, env, dir, f) {
    dir = ((dir | 0) % 8 + 8) % 8; f &= 1; const lod = env.lod | 0;
    const cx = NU.cw >> 1, gy = NU.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, by = 2.0 + (f ? 0.35 : 0);
    contact(ctx, env, cx, gy, 9, 0.3);
    const b0 = Q([0, by, -3.4]), b1 = Q([0, by + 0.2, 1.2]), hd = Q([0, by + 0.5, 2.8]), mz = Q([0, by + 0.1, 4.0]), th = Q([0, by - 0.4, 4.5]), t0 = Q([0, by - 0.3, -3.4]), t1 = Q([0.4, by - 0.9, -7.2 - (f ? 0.6 : 0)]);
    add((t0[2] + t1[2]) / 2, () => B.capsule(ctx, t0[0], t0[1], t1[0], t1[1], 0.45, 0.25, C.ratTail, 0, { flat: true }));
    for (const lg of [[1.6, 1, 0], [1.6, -1, 1], [-2.4, 1, 1], [-2.4, -1, 0]]) { const sw = ((lg[2] + f) & 1) ? 1.1 : -1.1, a = Q([lg[1] * 1.0, by - 0.5, lg[0]]), b = Q([lg[1] * 1.2, 0.25, lg[0] + sw]); add((a[2] + b[2]) / 2 + 0.5, () => B.capsule(ctx, a[0], a[1], b[0], b[1], 0.6, 0.5, C.nutria, 0, { amp: 0.25 })); }
    add((b0[2] + b1[2]) / 2 + 1.5, () => B.capsule(ctx, b0[0], b0[1], b1[0], b1[1], 1.6, 1.9, C.nutria, 0.05, { amp: 0.32 }));
    add(hd[2] + 1.5, () => { B.orb(ctx, hd[0], hd[1], 1.45, 1.4, C.nutria, 0.05, { spec: lod ? 0 : 0.2 }); for (const s of [-1, 1]) { const e = Q([s * 0.9, by + 1.7, 2.1]); dot(ctx, e[0], e[1], 0.5, C.nutria, 0.15); } dot(ctx, mz[0], mz[1], 0.8, C.nutriaMuzzle, 0.1); dot(ctx, th[0], th[1], 0.4, C.nutriaTooth, 0.2); if (lod === 0 && V.c > 0.2) { dot(ctx, hd[0] - 0.5 * V.c + V.s * 0.3, hd[1] - 0.2, 0.22, C.eye, 0); dot(ctx, hd[0] + 0.5 * V.c + V.s * 0.3, hd[1] - 0.2, 0.22, C.eye, 0); } });
    Lp.draw();
  }
  const BIRDS = {
    egret: { body: C.egret, neck: C.egret, wing: C.egret, beak: C.egretBeak, leg: C.egretLeg, bl: 3.6, tip: 0.3 },
    spoonbill: { body: C.spoonbill, neck: C.spoonbillNeck, wing: C.spoonbillWing, beak: C.spoonbillBeak, leg: C.spoonbillLeg, bl: 3.2, tip: 0.9 }
  };
  function birdCell(ctx, env, kind, dir, f) {
    const K = BIRDS[kind] || BIRDS.egret; dir = ((dir | 0) % 8 + 8) % 8; f = ((f | 0) % 4 + 4) % 4; const lod = env.lod | 0;
    const cx = BD.cw >> 1, gy = BD.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, flap = f >= 2, up = f === 2, preen = f === 1;
    const by = flap ? (up ? 8.4 : 7.6) : 7.2;
    if (!flap) contact(ctx, env, cx, gy, 7, 0.28);
    for (const s of [-1, 1]) { const hip = [s * 0.7, by - 0.6, 0.2], ft = flap ? [s * 0.8, by - 3.6, -1.8] : [s * 0.8, 0.2, 0.3 + (s > 0 && preen ? 0.6 : 0)], a = Q(hip), b = Q(ft); add((a[2] + b[2]) / 2, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], 0.38, 0.3, K.leg, 0, { flat: true }); if (!flap) dot(ctx, b[0], b[1] + 0.3, 0.5, K.leg, 0); }); }
    const b0 = Q([0, by, -3.2]), b1 = Q([0, by + 0.5, 2.2]), tl0 = Q([0, by + 0.1, -2.6]), tl1 = Q([0, by - 0.6, -5.6]);
    add((b0[2] + b1[2]) / 2 + 1.2, () => { B.capsule(ctx, b0[0], b0[1], b1[0], b1[1], 1.45, 1.35, K.body, 0.05, { amp: 0.3, spec: lod ? 0 : 0.15 }); B.capsule(ctx, tl0[0], tl0[1], tl1[0], tl1[1], 0.5, 0.3, K.body, 0, { flat: true }); });
    const nk = preen ? [[0, by + 0.8, 2.1], [0, by + 2.2, 2.9], [0, by + 3.0, 3.0], [0, by + 2.4, 3.8]] : flap ? [[0, by + 0.8, 2.1], [0, by + 2.4, 3.3], [0, by + 3.6, 3.7], [0, by + 4.4, 4.9]] : [[0, by + 0.8, 2.1], [0, by + 3.0, 3.2], [0, by + 5.0, 2.0], [0, by + 6.2, 3.2]];
    const npts = nk.map(Q);
    add(npts[2][2] + 0.8, () => B.stroke(ctx, npts.map((q) => [q[0], q[1]]), 1.3, K.neck, 0.05, 1, { smooth: true }));
    const hd = nk[3], hq = Q(hd), bk0 = Q([hd[0], hd[1] - 0.2, hd[2] + 0.7]), bk1 = Q([hd[0], hd[1] - (preen ? 0.6 : 0.5), hd[2] + 0.7 + K.bl]);
    add(hq[2] + 1.2, () => { B.orb(ctx, hq[0], hq[1], 1.05, 1.0, K.neck, 0.05, { noRim: true }); B.capsule(ctx, bk0[0], bk0[1], bk1[0], bk1[1], 0.5, K.tip, K.beak, 0.05, { flat: true }); if (lod === 0 && V.c > -0.2) dot(ctx, hq[0] + V.s * 0.35, hq[1] - 0.2, 0.22, C.eye, 0); });
    for (const s of [-1, 1]) {
      const sh = [s * 1.2, by + 0.9, 0.6], shq = Q(sh);
      if (!flap) { const e = Q([s * 1.45, by - 0.4, -3.8]); add((shq[2] + e[2]) / 2 + 0.9, () => B.capsule(ctx, shq[0], shq[1], e[0], e[1], 0.95, 0.6, K.wing, 0.05, { amp: 0.28 })); continue; }
      const ang = up ? [[5.4, 6.4, -0.6], [4.8, 7.8, -2.4], [3.6, 8.6, -3.8]] : [[5.8, -1.6, -0.4], [5.2, -3.0, -2.2], [4.0, -3.8, -3.6]];
      for (let i = 0; i < (lod ? 2 : 3); i++) { const a = ang[i], e = Q([s * a[0], sh[1] + a[1], a[2] + 0.4]); add((shq[2] + e[2]) / 2 + 0.9 - i * 0.05, () => B.capsule(ctx, shq[0], shq[1], e[0], e[1], 0.9 - i * 0.12, 0.5, K.wing, 0.05 - i * 0.08, { amp: 0.25 })); }
    }
    Lp.draw();
  }
  function wrangleCell(ctx, env, dir, f) {
    dir = ((dir | 0) % 8 + 8) % 8; f &= 1;
    gatorCell(ctx, env, 0, dir, f ? 8 : 6, WR.cw >> 1, WR.gy);
    const S = officerStyle(), Bd = S.Bd, hw = Bd.hw;
    const p = { py: 4.6, lean: 0.8, fr: [hw + 1.1, 0, -0.6], fl: [-hw - 1.1, 0, 0.4], hr: [1.0, -4.4, 3.4 + f * 0.6], hl: [-1.0, -4.4, 3.0 - f * 0.6], kpR: [0.3, 1, 1], kpL: [-0.3, 1, 1], epR: [1, -0.5, 0], epL: [-1, -0.5, 0], hu: -0.5, hf: 0.5 };
    drawFigure(ctx, env, WR.cw >> 1, WR.gy - 1, dir, Bd, S, p, { anim: 'wrangle' });
    if (f) { B.softEllipse(ctx, 18, 20, 13, 7, C.dust, 0.45, 0.2); B.softEllipse(ctx, 10, 22, 6, 3.5, C.dust, 0.35, 0.2); B.softEllipse(ctx, 26, 23, 6, 3.5, C.dust, 0.35, 0.2); if (env.lod === 0) for (let i = 0; i < 6; i++) dot(ctx, 6 + (hash(0x77, i + dir * 7) % 24), 12 + (hash(0x78, i + dir * 3) % 14), 0.6, C.dust, 0.4, 0.8); }
  }
  function paintWrangle(ctx, spec) {
    const tot = 2 * FACINGS; spec.frames = tot;
    const fr = ((spec.frame % tot) + tot) % tot, dir = fr >> 1, m = spec.master === 2 ? 2 : 1;
    const s = getSheet('wrangle|' + dir + '|' + m, 'officer', WR.cw, WR.ch, 2, m, (g, f, env) => wrangleCell(g, env, dir, f));
    return sheetRef(s, fr & 1, -(WR.cw >> 1), -WR.gy);
  }
  function sheetFamily(name, dim, per, cell, variantOf) {
    PAINT[name] = function (ctx, spec) {
      const v = variantOf ? variantOf(spec.variant | 0) : 0, tot = per * FACINGS; spec.frames = tot; if (variantOf) spec.framesPerVariant = false;
      const fr = ((spec.frame % tot) + tot) % tot, dir = (fr / per) | 0, m = spec.master === 2 ? 2 : 1;
      const s = getSheet(name + '|' + v + '|' + dir + '|' + m, name, dim.cw, dim.ch, per, m, (g, f, env) => cell(g, env, v, dir, f));
      return sheetRef(s, fr % per, -(dim.cw >> 1), -dim.gy);
    };
  }
  PAINT.gator = function (ctx, spec) {
    const v = Math.max(0, Math.min(2, spec.variant | 0)), G = GATORS[v], tot = GPER * FACINGS; spec.frames = tot;
    const fr = ((spec.frame % tot) + tot) % tot, dir = (fr / GPER) | 0, m = spec.master === 2 ? 2 : 1;
    const s = getSheet('gator|' + v + '|' + dir + '|' + m, 'gator', G.cw, G.ch, GPER, m, (g, k, env) => gatorCell(g, env, v, dir, k));
    return sheetRef(s, fr % GPER, -(G.cw >> 1), -(G.ch - 9));
  };
  sheetFamily('roux', RX, RPER, (g, env, v, dir, f) => rouxCell(g, env, dir, f));
  sheetFamily('nutria', NU, 2, (g, env, v, dir, f) => nutriaCell(g, env, dir, f));
  sheetFamily('egret', BD, 4, (g, env, v, dir, f) => birdCell(g, env, 'egret', dir, f));
  sheetFamily('spoonbill', BD, 4, (g, env, v, dir, f) => birdCell(g, env, 'spoonbill', dir, f));

  // ---------------------------------------------------------------------------
  // Vehicles: lit boxes on the ground projection (face tone from the key light, hidden faces culled against the view), wheels,
  // capsule tanks and hulls; the fogger truck, the campus bus, pirogues / Cajun Navy boats with paddlers, the four parade floats
  // ---------------------------------------------------------------------------
  const VIEW_D = [0, 0.4472, 0.8944], LIGHT_D = (() => { const v = [-0.55, 0.72, 0.42], l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  /** the visible faces of a box centred at c (local) with half sizes hs, as parts; pat(face, at(a, b) → screen, lit) draws marks on a face */
  function box(add, ctx, Q, W, c, hs, color, t0, pat, bias, opts) {
    const F = [['+x', [1, 0, 0], [0, 0, 1], [0, 1, 0], hs[0], hs[2], hs[1]], ['-x', [-1, 0, 0], [0, 0, 1], [0, 1, 0], hs[0], hs[2], hs[1]], ['+y', [0, 1, 0], [1, 0, 0], [0, 0, 1], hs[1], hs[0], hs[2]], ['+z', [0, 0, 1], [1, 0, 0], [0, 1, 0], hs[2], hs[0], hs[1]], ['-z', [0, 0, -1], [1, 0, 0], [0, 1, 0], hs[2], hs[0], hs[1]]];
    for (const f of F) {
      const nw = W(f[1]); if (nw[0] * VIEW_D[0] + nw[1] * VIEW_D[1] + nw[2] * VIEW_D[2] <= 0.02) continue;
      const lit = nw[0] * LIGHT_D[0] + nw[1] * LIGHT_D[1] + nw[2] * LIGHT_D[2], t = t0 + lit * 0.45;
      const at = (a, b) => Q([c[0] + f[1][0] * f[4] + f[2][0] * a + f[3][0] * b, c[1] + f[1][1] * f[4] + f[2][1] * a + f[3][1] * b, c[2] + f[1][2] * f[4] + f[2][2] * a + f[3][2] * b]);
      const k = [at(-f[5], -f[6]), at(f[5], -f[6]), at(f[5], f[6]), at(-f[5], f[6])], d = (k[0][2] + k[1][2] + k[2][2] + k[3][2]) / 4 + (bias || 0);
      add(d, () => { B.plane(ctx, k.map((q) => [q[0], q[1]]), color, t, Object.assign({ amp: 0.1, rim: 0.2 }, opts || {})); if (pat) pat(f[0], at, lit, f[5], f[6]); });
    }
  }
  function wheel(add, ctx, Q, x, y, z, rad, f) {
    const s = x < 0 ? -1 : 1, a = Q([x - s * 0.7, y, z]), b = Q([x + s * 0.7, y, z]), h = Q([x + s * 0.9, y + (f & 1 ? rad * 0.45 : 0), z + (f & 1 ? 0 : rad * 0.45)]);
    add((a[2] + b[2]) / 2 + rad * 0.8, () => { B.capsule(ctx, a[0], a[1], b[0], b[1], rad, rad, C.tire, 0, { amp: 0.3 }); dot(ctx, h[0], h[1], 0.55, C.hub, 0.2); });
  }
  const quad = (ctx, pts, color, t, o) => B.plane(ctx, pts.map((q) => [q[0], q[1]]), color, t, o || { amp: 0.1 });
  function foggerCell(ctx, env, dir, f) {
    const cx = FG.cw >> 1, gy = FG.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, lod = env.lod | 0;
    contact(ctx, env, cx, gy, 20, 0.32);
    for (const sz of [-5.6, 5.6]) for (const sx of [-3.4, 3.4]) wheel(add, ctx, Q, sx, 1.5, sz, 1.6, f + (sz > 0 ? 1 : 0));
    box(add, ctx, Q, W, [0, 3.0, -1.0], [2.9, 0.9, 7.6], C.chassis, 0, null, 0);
    const t0 = Q([0, 6.0, -6.4]), t1 = Q([0, 6.0, 0.8]), te = Q([0, 6.0, -6.6]);
    add((t0[2] + t1[2]) / 2 + 2.4, () => {
      B.capsule(ctx, t0[0], t0[1], t1[0], t1[1], 2.7, 2.7, C.steel, 0.05, { amp: 0.3, spec: lod ? 0 : 0.3 });
      const p0 = Q([0, 6.0, -6.4 + 7.2 * 0.42]), p1 = Q([0, 6.0, -6.4 + 7.2 * 0.56]), g0 = Q([0, 6.0, -6.4 + 7.2 * 0.57]), g1 = Q([0, 6.0, -6.4 + 7.2 * 0.62]);
      B.capsule(ctx, p0[0], p0[1], p1[0], p1[1], 2.72, 2.72, P1, 0, { amp: 0.3, flat: true }); B.capsule(ctx, g0[0], g0[1], g1[0], g1[1], 2.72, 2.72, GD, 0.1, { amp: 0.3, flat: true });
    });
    add(te[2] + 2.4, () => B.orb(ctx, te[0], te[1], 2.55, 2.5, C.steel, 0.05, { spec: lod ? 0 : 0.25 }));
    box(add, ctx, Q, W, [0, 5.0, 4.6], [2.9, 2.3, 2.4], C.cream, 0, (face, at) => {
      if (face === '+z') quad(ctx, [at(-2.3, 0.2), at(2.3, 0.2), at(2.3, 2.2), at(-2.3, 2.2)], C.glass, 0.1, { amp: 0.15, spec: lod ? 0 : 0.35 });
      else if (face === '+x' || face === '-x') quad(ctx, [at(-1.6, 0.3), at(1.6, 0.3), at(1.6, 2.1), at(-1.6, 2.1)], C.glass, 0.05, { amp: 0.15 });
    }, 0.3);
    box(add, ctx, Q, W, [0, 3.6, 7.8], [2.5, 0.9, 0.8], C.steel, 0, null, 0.4);
    const h0 = Q([1.7, 4.3, 8.5]), h1 = Q([-1.7, 4.3, 8.5]), bc = Q([0, 7.8, 4.6]), n0 = Q([0, 4.4, -7.2]), n1 = Q([0, 4.2, -9.4]);
    add(h0[2] + 1, () => { dot(ctx, h0[0], h0[1], 0.45, C.headlight, 0.3); dot(ctx, h1[0], h1[1], 0.45, C.headlight, 0.3); });
    add(bc[2] + 2.5, () => dot(ctx, bc[0], bc[1], 0.8, f & 1 ? C.beacon : C.beaconOff, 0.1));
    add((n0[2] + n1[2]) / 2 + 1, () => B.capsule(ctx, n0[0], n0[1], n1[0], n1[1], 0.65, 0.65, C.nozzle, 0, { flat: true }));
    for (let i = 0; i < (lod ? 2 : 4); i++) {   // the plume's first puffs: pale mist rolling off the nozzle, growing frame by frame
      const ph = (f + i) % 4, r = 0.9 + ph * 0.7, back = 10.4 + ph * 2.2 + i * 0.6, up = 4.3 + ph * 0.5 + (i & 1 ? 0.6 : -0.2), side = ((i * 7 + f) % 3 - 1) * 0.9, q = Q([side, up, -back]);
      add(q[2] + r + 3, () => B.softEllipse(ctx, q[0], q[1], r * 1.3, r * 1.1, C.mist, 0.75 - ph * 0.14, 0.35));
    }
    Lp.draw();
  }
  function busCell(ctx, env, dir, f) {
    const cx = BS.cw >> 1, gy = BS.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, lod = env.lod | 0;
    contact(ctx, env, cx, gy, 26, 0.32);
    for (const sz of [-8.4, 8.0]) for (const sx of [-3.9, 3.9]) wheel(add, ctx, Q, sx, 1.5, sz, 1.7, f);
    box(add, ctx, Q, W, [0, 5.2, 0], [3.8, 3.4, 12.6], P1, 0, (face, at, lit, ha, hb) => {
      if (face === '+y') return;
      const b0 = at(-ha, -0.8), b1 = at(ha, -0.8), b2 = at(ha, 0.2), b3 = at(-ha, 0.2); quad(ctx, [b0, b1, b2, b3], GD, 0.1, { amp: 0.1, rim: 0 });   // the gold belt line
      if (face === '+x' || face === '-x') { if (lod) quad(ctx, [at(-11.5, 0.9), at(11.5, 0.9), at(11.5, 3.0), at(-11.5, 3.0)], C.glass, 0.05, { amp: 0.12 }); else for (let a = -11.5; a + 3.6 <= 11.6; a += 5.2) quad(ctx, [at(a, 0.9), at(a + 3.6, 0.9), at(a + 3.6, 3.0), at(a, 3.0)], C.glass, 0.05, { amp: 0.15, spec: 0.2 }); }
      if (face === '+z') { quad(ctx, [at(-3.2, 0.7), at(3.2, 0.7), at(3.2, 3.0), at(-3.2, 3.0)], C.glass, 0.1, { amp: 0.15, spec: lod ? 0 : 0.3 }); for (const s of [-1, 1]) { const h = at(s * 2.9, -2.4); dot(ctx, h[0], h[1], 0.5, C.headlight, 0.3); } }
      void hb;
    }, 0);
    box(add, ctx, Q, W, [0, 8.9, 0], [3.5, 0.5, 12.0], P2, 0, null, 0.5);
    Lp.draw();
  }
  const paddlerS = new Map();
  function paddlerStyle(vest, skin, hairC) {
    const key = 'pad' + vest + skin + hairC; let S = paddlerS.get(key); if (S) return S;
    const F = { skin: skin, hairC: hairC, style: (skin + hairC) % 6, carry: 6, hat: (skin + hairC) % 3 === 0 ? 1 : 0, build: 1, acc: vest ? 2 : 1 };
    S = { F: F, Bd: SB[1], skin: SKIN6[skin % 6], hair: HAIR8[hairC & 7], top: vest ? C.vest : P1, bot: vest ? '#2B3350' : '#B8A27A', shoe: vest ? C.staffDark : '#6B4A2E', acc: ACC8[F.acc], kind: vest ? 'long' : 'tee', pat: vest ? 'stole' : null, longSleeve: !!vest, hairStyle: F.style, hat: F.hat, carry: 6, head: 'bare', shinC: vest ? '#2B3350' : SKIN6[skin % 6], pack: false };
    paddlerS.set(key, S); return S;
  }
  function boatCell(ctx, env, navy, dir, f) {
    const cx = BT.cw >> 1, gy = BT.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, L = 12, lod = env.lod | 0;
    rippleRing(ctx, env, pr, W, 3.8, L + 2.5, f * 0.9, false);
    const prof = [[-L, 0.35, 0.3], [-L * 0.62, 1.55, 0.15], [-L * 0.2, 1.95, 0.05], [L * 0.2, 1.95, 0.05], [L * 0.62, 1.55, 0.15], [L, 0.35, 0.3]];
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i], b = prof[i + 1], f0 = Q([0, 0.55, a[0]]), f1 = Q([0, 0.55, b[0]]);
      add((f0[2] + f1[2]) / 2 + 0.5, () => B.capsule(ctx, f0[0], f0[1], f1[0], f1[1], 1.05, 1.05, C.bark, -0.3, { amp: 0.2, flat: true }));
      for (const s of [-1, 1]) { const g0 = Q([s * a[1] * 0.55, 1.0 + a[2] * 6, a[0]]), g1 = Q([s * b[1] * 0.55, 1.0 + b[2] * 6, b[0]]); add((g0[2] + g1[2]) / 2 + 0.9, () => B.capsule(ctx, g0[0], g0[1], g1[0], g1[1], 0.9, 0.9, C.bark, 0.05, { amp: 0.3 })); }
    }
    const crew = [[-4.4, 0, 'R'], [3.6, 1, 'L']];
    crew.forEach((cr, i) => {
      const S = paddlerStyle(navy ? 1 : 0, 1 + ((i * 2 + (dir & 3)) % 4), i * 3 + 1), Bd = S.Bd, hw = Bd.hw, side = cr[2] === 'R' ? 1 : -1;
      const ph = ((f + (i ? 2 : 0)) % 4) / 4, reach = Math.sin(ph * FPI * 2);
      const p = { py: 3.0, pz: cr[0], lean: 0.18, fr: [hw + 0.2, 0.3, cr[0] + 3.0], fl: [-hw - 0.2, 0.3, cr[0] + 3.0], kpR: [0.2, 1, 0.6], kpL: [-0.2, 1, 0.6], hr: [side * 1.5 + 1.0, -1.2 + 0.8 * reach, 1.6 + reach * 1.6], hl: [side * 1.5 - 0.6, 1.4 - 0.5 * reach, 1.0 + reach * 1.2], epR: [1, 0, -0.3], epL: [-1, 0, -0.3], tw: 0.25 * side * reach };
      const pc = Q([0, 3, cr[0]]);
      add(pc[2] + 2.5, () => drawFigure(ctx, env, cx, gy, dir, Bd, S, p, { pitch: 0.5, noPack: true }));
      const bx = side * 3.2, bz = cr[0] + 1.0 + reach * 3.2, h0 = Q([side * 2.0, 6.0, cr[0] + 1.2]), h1 = Q([bx, 0.9, bz]);
      add(Math.max(h0[2], h1[2]) + 2.2, () => { B.capsule(ctx, h0[0], h0[1], h1[0], h1[1], 0.32, 0.32, C.paddle, 0, { flat: true }); B.orb(ctx, h1[0], h1[1], 1.0, 0.6, C.paddle, 0.1, { noRim: true }); });
    });
    if (navy) { const p0 = Q([0, 1.5, -L + 0.6]), p1 = Q([0, 9.6, -L + 0.6]); add(p0[2] + 1, () => { B.capsule(ctx, p0[0], p0[1], p1[0], p1[1], 0.3, 0.3, C.steel, 0, { flat: true }); B.plane(ctx, [[p1[0], p1[1] - 0.2], [p1[0] + 3.2, p1[1] + 0.4], [p1[0] + 3.2, p1[1] + 2.8], [p1[0], p1[1] + 2.2]], GD, 0.1, { amp: 0.15 }); if (lod === 0) dot(ctx, p1[0] + 1.6, p1[1] + 1.3, 0.5, P1, 0); }); }
    Lp.draw();
    rippleRing(ctx, env, pr, W, 3.8, L + 2.5, f * 0.9, true);
  }
  function floatCell(ctx, env, variant, dir, f) {
    variant = ((variant | 0) % 4 + 4) % 4;
    const cx = FL.cw >> 1, gy = FL.gy, V = viewer(dir), W = V.W, pr = groundPr(cx, gy), Q = (q) => pr(W(q)), Lp = parts(), add = Lp.add, lod = env.lod | 0, crepe = [P2, GD, C.green];
    contact(ctx, env, cx, gy, 40, 0.3);
    for (const sz of [-11, 11]) for (const sx of [-6.8, 6.8]) wheel(add, ctx, Q, sx, 1.8, sz, 2.0, f);
    box(add, ctx, Q, W, [0, 3.8, 0], [6.6, 1.8, 16.0], P1, 0, (face, at, lit, ha, hb) => {
      if (face === '+y') { B.stroke(ctx, [at(-ha, -hb), at(ha, -hb), at(ha, hb), at(-ha, hb)].map((q) => [q[0], q[1]]), 1.0, GD, 0.2, 1, { close: true }); return; }
      const step = lod ? ha * 2 / 3 : 1.6; let k = f ? 1 : 0;
      for (let a = -ha; a < ha - 0.01; a += step, k++) { const b0 = at(a, -hb), b1 = at(Math.min(ha, a + step), -hb), b2 = at(Math.min(ha, a + step), hb), b3 = at(a, hb); quad(ctx, [b0, b1, b2, b3], crepe[k % 3], 0.1 + lit * 0.3, { amp: 0.08, rim: 0 }); }
    }, 0);
    const top = 5.6;
    if (variant === 0) {
      box(add, ctx, Q, W, [0, top + 1.8, -4.0], [5.0, 1.8, 6.0], P2, 0, null, 0.2);
      const h = Q([0, top + 9.6, -4.0]); add(h[2] + 8, () => drawTigerHead(ctx, { ctx: ctx }, h[0], h[1], 8.0, V.c, V.s, lod));
    } else if (variant === 1) {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const a = Q([s * 5.2, top, -11 + i * 5]), b = Q([s * 5.2, top + 8.5 + i * 2.2, -11 + i * 5]); add(a[2] + 1.2, () => B.capsule(ctx, a[0], a[1], b[0], b[1], 1.5, 0.8, C.knee, 0, { amp: 0.3 })); }
      const b0 = Q([0, top + 3.2, -9]), b1 = Q([0, top + 4.6, 3.5]), h = Q([0, top + 5.4, 5.0]), s0 = Q([0, top + 4.6, 6.5]), s1 = Q([0, top + 4.2, 14]);
      add((b0[2] + b1[2]) / 2 + 3.2, () => B.capsule(ctx, b0[0], b0[1], b1[0], b1[1], 4.0, 3.4, C.floatGator, 0.05, { amp: 0.32 }));
      add(h[2] + 3.6, () => { B.orb(ctx, h[0], h[1], 4.4, 4.2, C.floatGator, 0.05, { spec: lod ? 0 : 0.2 }); for (const s of [-1, 1]) { const e = Q([s * 2.0, top + 8.8, 5.8]); dot(ctx, e[0], e[1], 1.2, '#2E5A2A', 0); dot(ctx, e[0] + 0.3, e[1] - 0.3, 0.7, C.iris, 0.3); } });
      add((s0[2] + s1[2]) / 2 + 2.4, () => B.capsule(ctx, s0[0], s0[1], s1[0], s1[1], 2.8, 2.0, C.floatGator, 0.05, { amp: 0.3 }));
    } else if (variant === 2) {
      const st0 = Q([0, top, -2]), st1 = Q([0, top + 11, -2]), c0 = Q([0, top + 15.5, -2]), bar0 = Q([-6.0, top + 4.0, -2]), bar1 = Q([6.0, top + 4.0, -2]);
      add(st0[2] + 2.2, () => B.capsule(ctx, st0[0], st0[1], st1[0], st1[1], 2.2, 2.0, GD, 0.05, { amp: 0.3 }));
      add(c0[2] + 4.5, () => B.orb(ctx, c0[0], c0[1], 4.4, 7.8, GD, 0.1, { spec: lod ? 0 : 0.35 }));
      for (const s of [-1, 1]) { const p = Q([s * 5.2, top + 12.2, -2]), q0 = Q([s * 2.0, top + 7.0, -2]), q1 = Q([s * 6.2, top + 10.6, -2]); add(p[2] + 3.4, () => { B.capsule(ctx, q0[0], q0[1], q1[0], q1[1], 1.2, 1.2, GD, 0.05, { amp: 0.3 }); B.orb(ctx, p[0], p[1], 3.4, 5.4, GD, 0.1, { spec: lod ? 0 : 0.3 }); }); }
      add((bar0[2] + bar1[2]) / 2 + 1.3, () => B.capsule(ctx, bar0[0], bar0[1], bar1[0], bar1[1], 1.3, 1.3, P1, 0, { amp: 0.3 }));
      for (let i = 0; i < 6; i++) { const z = -14 + i * 5; for (const s of [-1, 1]) { const q = Q([s * 5.8, top + 2.0 + (i & 1) * 1.0, z]); add(q[2] + 1.9, () => B.orb(ctx, q[0], q[1], 1.9, 1.9, i & 1 ? P2 : GD, 0.1, { spec: lod ? 0 : 0.35 })); } }
    } else {
      for (let k = 0; k < 14; k++) { const a = k / 14 * FPI * 2, q = Q([Math.cos(a) * 6.6, top + 4.0, Math.sin(a) * 6.6 - 3.0]), band = crepe[k % 3]; add(q[2] + 3.2, () => B.orb(ctx, q[0], q[1], 3.2, 3.0, band, 0.05, { spec: lod ? 0 : 0.25 })); }
      for (let k = 0; k < 14; k++) { const a = (k + 0.5) / 14 * FPI * 2, q = Q([Math.cos(a) * 6.6, top + 5.8, Math.sin(a) * 6.6 - 3.0]); add(q[2] + 2.6, () => B.orb(ctx, q[0], q[1], 2.5, 2.3, C.dough, 0.05, { spec: lod ? 0 : 0.2 })); }
      const bb = Q([4.6, top + 10.2, 1.6]); add(bb[2] + 1.5, () => B.orb(ctx, bb[0], bb[1], 1.3, 1.3, C.baby, 0.15, { spec: 0.3 }));
    }
    [[-4.4, 11.8], [4.4, 11.8]].forEach((rd, i) => {   // two riders waving from the front corners (krewe costumes, a little smaller than a student)
      const S = kreweStyle((variant * 40 + i * 17 + 9) & 255), Bd = S.Bd, hw = Bd.hw, w = (f + i) & 1;
      const p = { py: Bd.hipY - 0.2, scale: 0.72, fr: [hw + 0.6, 0, 0], fl: [-hw - 0.6, 0, 0], hr: [1.9, 4.9 + w * 0.5, 0.5], hl: [-1.2, 1.0 - w * 3.0, 1.2], epR: [1, 0.2, -0.3] };
      const off = W([rd[0], 0, rd[1]]), oc = Q([rd[0], top, rd[1]]);
      add(oc[2] + 4, () => drawFigure(ctx, env, cx, gy, dir, Bd, S, p, { pitch: 0.5, off: [off[0], top + off[1], off[2]] }));
    });
    Lp.draw();
  }
  sheetFamily('fogger', FG, FG.per, (g, env, v, dir, f) => foggerCell(g, env, dir, f));
  sheetFamily('bus', BS, BS.per, (g, env, v, dir, f) => busCell(g, env, dir, f));
  sheetFamily('pirogue', BT, BT.per, (g, env, v, dir, f) => boatCell(g, env, false, dir, f));
  sheetFamily('navy', BT, BT.per, (g, env, v, dir, f) => boatCell(g, env, true, dir, f));
  sheetFamily('float', FL, FL.per, (g, env, v, dir, f) => floatCell(g, env, v, dir, f), (v) => v & 3);

  // ---------------------------------------------------------------------------
  // Tailgate / festival props and the two kept critters (own canvases through brush.begin; anchor (−w/2, −h + 2) as registerSimple)
  // ---------------------------------------------------------------------------
  function simple(family, paint) {
    const d = PROPS[family];
    PAINT[family] = function (ctx, spec) {
      spec.frames = d[2];
      const g = B.begin(ctx, d[0], d[1], spec), f = ((spec.frame % d[2]) + d[2]) % d[2];
      paint(ctx, g.env, d[0], d[1], f, hash(spec.seed | 0, 0xe7));
      return { w: d[0], h: d[1], ox: -(d[0] >> 1), oy: -d[1] + 2 };
    };
  }
  simple('tent', (ctx, env, w, h) => {
    contact(ctx, env, 8, 10.5, 12, 0.3);
    B.capsule(ctx, 3, 7, 3, 10, 0.6, 0.5, C.bark, 0, { flat: true }); B.capsule(ctx, 13, 7, 13, 10, 0.6, 0.5, C.bark, 0, { flat: true }); B.stroke(ctx, [[4, 8.3], [12, 8.3]], 1.0, C.bark, -0.3, 1);
    B.plane(ctx, [[8, 0.5], [1, 7], [8, 7.6]], P1, 0.15, { amp: 0.25, spec: env.lod ? 0 : 0.2 }); B.plane(ctx, [[8, 0.5], [15, 7], [8, 7.6]], P1, -0.3, { amp: 0.2 });
    B.stroke(ctx, [[1, 7.3], [3, 8.0], [5, 7.3], [7, 8.0], [9, 7.3], [11, 8.0], [13, 7.3], [15, 7.3]], 0.8, P2, -0.4, 1);
    dot(ctx, 8, 0.7, 0.7, GD, 0.3); void w; void h;
  });
  simple('smoker', (ctx, env, w, h, f) => {
    contact(ctx, env, 5, 7.6, 8, 0.3);
    B.capsule(ctx, 2.5, 7.5, 2.5, 5.5, 0.4, 0.4, C.steelDark, 0, { flat: true }); B.capsule(ctx, 7.5, 7.5, 7.5, 5.5, 0.4, 0.4, C.steelDark, 0, { flat: true });
    B.capsule(ctx, 1.6, 5, 8.4, 5, 2.1, 2.1, '#2E2E36', 0.05, { amp: 0.35, spec: env.lod ? 0 : 0.25 });
    B.capsule(ctx, 8.6, 1.2, 8.6, 3, 0.5, 0.5, C.steel, 0.05, { flat: true });
    const ly = f ? 0.8 : 2.6; B.stroke(ctx, [[2.2, ly], [7.8, ly]], 1.0, C.steelDark, 0.1, 1);
    if (f) { dot(ctx, 4.2, 2.6, 0.5, C.ember, 0.2); dot(ctx, 5.6, 2.3, 0.55, C.flame, 0.3); if (env.lod === 0) B.softEllipse(ctx, 8.6, 0.4, 1.6, 1.0, C.mist, 0.4, 0.3); }
  });
  simple('cornhole', (ctx, env, w, h, f) => {
    contact(ctx, env, 6, 5.5, 10, 0.25);
    B.capsule(ctx, 1.5, 4.5, 1.5, 5.6, 0.45, 0.4, C.bark, 0, { flat: true }); B.capsule(ctx, 10.5, 4.5, 10.5, 5.6, 0.45, 0.4, C.bark, 0, { flat: true });
    B.plane(ctx, [[2, 2], [10, 2], [11, 5], [1, 5]], P1, 0.05, { amp: 0.2, spec: env.lod ? 0 : 0.2 });
    dot(ctx, 8.4, 3.2, 0.7, C.black, 0); dot(ctx, 2.6, 3, 0.45, GD, 0.2);
    if (f) dot(ctx, 5, 0.6, 0.8, C.red, 0.1); else dot(ctx, 4, 3.4, 0.8, C.red, 0.1);
  });
  simple('snoball', (ctx, env, w, h, f) => {
    contact(ctx, env, 7, 10.8, 10, 0.3);
    B.plane(ctx, [[2, 5], [12, 5], [12, 10], [2, 10]], C.offWhite, 0.05, { amp: 0.15 });
    B.stroke(ctx, [[2.5, 8.2], [11.5, 8.2]], 1.0, P1, 0, 1); if (env.lod === 0) { dot(ctx, 5.2, 8.2, 0.4, GD, 0.2); dot(ctx, 8.4, 8.2, 0.4, GD, 0.2); }
    if (env.lod === 0) { dot(ctx, 4, 6.4, 0.45, C.red, 0.1); dot(ctx, 6, 6.4, 0.45, C.waterBlue, 0.1); dot(ctx, 8, 6.4, 0.45, GD, 0.1); dot(ctx, 10, 6.4, 0.45, C.azalea, 0.1); }
    for (let x = 1; x <= 12; x += 2) B.stroke(ctx, [[x, 2.2], [x + 2, 2.2]], 1.6, ((x >> 1) & 1) ? P1 : C.white, 0.05, 1);
    B.capsule(ctx, 2, 3.2, 2, 4.8, 0.3, 0.3, C.steel, 0, { flat: true }); B.capsule(ctx, 11.5, 3.2, 11.5, 4.8, 0.3, 0.3, C.steel, 0, { flat: true });
    dot(ctx, 3.5, 10.6, 0.9, C.black, 0); dot(ctx, 9.8, 10.6, 0.9, C.black, 0);
    B.capsule(ctx, 1.5, 0.5, 1.5, 5, 0.35, 0.35, C.steel, 0, { flat: true }); B.plane(ctx, [[2, 0.2], [4.6, 0.2 + (f ? 0.4 : 0)], [4.6, 2], [2, 2]], GD, 0.15, { amp: 0.2 });
  });
  simple('bonfire', (ctx, env, w, h, f, seed) => {
    contact(ctx, env, 6, 15.2, 10, 0.3);
    B.capsule(ctx, 1.2, 13.4, 10.8, 13.4, 0.8, 0.8, C.bark, 0, { amp: 0.3 }); B.capsule(ctx, 2.4, 12.2, 9.4, 14.2, 0.7, 0.7, C.bark, 0.2, { amp: 0.3 });
    const top = [3, 1, 2][f], lean = [0, 1, -1][f], hh = 12.5 - top;
    B.softEllipse(ctx, 6 + lean * 0.6, top + hh * 0.55, 5.2, hh * 0.62, C.red, 0.8, 0.25);
    B.softEllipse(ctx, 6 + lean * 0.9, top + hh * 0.6, 3.6, hh * 0.5, C.ember, 0.95, 0.3);
    B.softEllipse(ctx, 6 + lean * 1.1, top + hh * 0.7, 2.2, hh * 0.36, C.flame, 1, 0.4);
    if (top > 0) dot(ctx, 6 + lean, top - 0.5, 0.7, C.flame, 0.3);
    for (let i = 0; i < 2; i++) dot(ctx, 3 + (hash(seed, 50 + i + f * 7) % 6), (hash(seed, 60 + i + f * 7) % 3) + 0.5, 0.45, PAL.goldHi || GD, 0.4);
  });
  simple('pelican', (ctx, env, w, h, f) => {
    contact(ctx, env, 6, 8.3, 8, 0.28);
    B.capsule(ctx, 3, 5.5, 8.5, 5.5, 1.6, 1.4, C.pelican, 0.05, { amp: 0.3 });
    if (f === 0) B.capsule(ctx, 2.5, 4.2, 7.5, 4.0, 0.7, 0.6, C.pelican, -0.25, { flat: true }); else B.capsule(ctx, 0.8, 1.5, 6.2, 2.5, 0.7, 0.5, C.pelican, -0.2, { flat: true });
    B.orb(ctx, 9.8, 2.4, 1.3, 1.3, C.offWhite, 0.1, { noRim: true }); if (env.lod === 0) dot(ctx, 10.2, 2.2, 0.3, C.black, 0);
    B.capsule(ctx, 9.5, 3.6, 12.2, 4.0, 0.6, 0.35, C.beak, 0.05, { flat: true });
    dot(ctx, 5, 7.6, 0.35, C.beak, 0); dot(ctx, 7, 7.6, 0.35, C.beak, 0);
  });
  simple('armadillo', (ctx, env, w, h, f) => {
    contact(ctx, env, 5, 4.6, 8, 0.28);
    B.capsule(ctx, 2.5, 2.2, 7.5, 2.2, 1.6, 1.5, C.armadillo, 0.05, { amp: 0.3 });
    if (env.lod === 0) for (const x of [3.5, 5, 6.5]) B.stroke(ctx, [[x, 0.9], [x, 3.4]], 0.5, C.armadillo, -0.5, 0.9);
    B.capsule(ctx, 8.4, 2.6, 10.2, 2.9, 0.6, 0.35, C.armadillo, -0.2, { flat: true }); dot(ctx, 9.6, 2.6, 0.25, C.black, 0);
    B.capsule(ctx, 1.0, 2.4, 0.2, 3.4, 0.35, 0.2, C.armadillo, -0.2, { flat: true });
    for (const x of [2.5, 4.5, 6.5]) dot(ctx, x + f * 0.6, 3.8, 0.4, C.armadillo, -0.35);
  });

  // ---------------------------------------------------------------------------
  // Registration, frames, the pen hooks (gc / clear / clearFootball / budget / stats / agentFrame), the public API, the selfTest
  // ---------------------------------------------------------------------------
  const FRAME_TABLE = {};
  for (const k of SANIMS) { FRAME_TABLE[k === 'walk' ? 'agent' : 'agent:' + k] = SA[k].n * FACINGS; FRAME_TABLE['agentfar:' + k] = 2 * FACINGS; }
  FRAME_TABLE['agent:walk'] = SA.walk.n * FACINGS;
  Object.assign(FRAME_TABLE, { officer: 64, 'officer:wrangle': 16, band: 32, krewe: 32, gator: GPER * 8, roux: RPER * 8, nutria: 16, egret: 32, spoonbill: 32, fogger: 32, bus: 16, pirogue: 32, navy: 32, float: 16,
    fbplayer: 8, fbref: 16, 'fbref:signal': 16, fbcrew: 8, fbcheer: 32, fbband: 16, fbstaff: 16, fbroux: 24, fbball: 4, fbdown: 1, fbstick: 1, fbfan: 16, 'fbfan:standing': 16, 'fbfan:seated': 8, 'fbfan:wave': 16 });
  for (const pose of Object.keys(POSES)) FRAME_TABLE['fbplayer:' + pose] = POSES[pose] * 8;
  for (const k of Object.keys(PROPS)) FRAME_TABLE[k] = PROPS[k][2];
  function registerAll() { for (const fam of FAMILIES) if (PAINT[fam]) M.registerHD(fam, PAINT[fam]); for (const id of Object.keys(FRAME_TABLE)) M.setFrames(id, FRAME_TABLE[id]); }
  registerAll();
  M.hdEntityFamilies = () => FAMILIES.slice();
  M.hdEntityCells = CELLS;
  M.hdCompose = { student: studentCell, player: playerCell, fan: fanCell, gator: gatorCell, roux: rouxCell, nutria: nutriaCell, bird: birdCell, wrangle: wrangleCell, fogger: foggerCell, bus: busCell, boat: boatCell, float: floatCell, figure: drawFigure, stuStyle: stuStyleHD, officerStyle: officerStyle, bandStyle: bandStyle, kreweStyle: kreweStyle, playerStyle: playerStyle };
  /** gc: the pen's rule (over the limit, drop sheets nobody showed for GC_FRAMES) on the HD sheets; the pen's own gcSheets runs first and
   *  may re-register its painters over ours (it does so after dropping victims), so the HD families are re-registered whenever that happened */
  function hdGc() {
    if (hdBytes <= M.HD_SHEET_LIMIT_MB * 1048576) return 0;
    const keep = Number.isFinite(M.GC_FRAMES) ? M.GC_FRAMES : 600, victims = [];
    for (const s of sheets.values()) if (hdFrame - s.used >= keep) victims.push(s);
    for (const s of victims) dropSheet(s);
    if (victims.length) registerAll();
    return victims.length;
  }
  const penGc = M.gcSheets, penClear = M.clearSheets, penClearFb = M.clearFootball, penBytes = M.sheetBytes, penCount = M.sheetCount, penStats = M.sheetStats, penPump = M.pumpBakes, penFrame = M.agentFrame;
  M.gcSheets = function (frame) {
    hdFrame = Number.isFinite(frame) ? (frame | 0) : hdFrame + 1;
    let n = 0; try { n = typeof penGc === 'function' ? (penGc.call(M, frame) | 0) : 0; } catch (e) { n = 0; }
    try { n += hdGc(); if (!M.isHD('agent')) registerAll(); } catch (e) { try { BSU.error('sprites_entities_hd', 'gcSheets', e); } catch (e2) { /* never throw */ } }
    return n;
  };
  M.clearSheets = function () { if (typeof penClear === 'function') penClear.call(M); for (const s of Array.from(sheets.values())) dropSheet(s); HDQ.queue.length = 0; registerAll(); };
  M.clearFootball = function () { let n = typeof penClearFb === 'function' ? (penClearFb.call(M) | 0) : 0; for (const s of Array.from(sheets.values())) if (s.fam.slice(0, 2) === 'fb') { dropSheet(s); n++; } registerAll(); return n; };
  M.sheetBytes = function () { return (typeof penBytes === 'function' ? penBytes.call(M) : 0) + hdBytes; };
  M.sheetCount = function () { return (typeof penCount === 'function' ? penCount.call(M) : 0) + sheets.size; };
  M.sheetStats = function () { const o = typeof penStats === 'function' ? penStats.call(M) : {}; return Object.assign(o, M.hdSheetStats()); };
  M.pumpBakes = function (all) { return (typeof penPump === 'function' ? (penPump.call(M, all) | 0) : 0) + pumpAll(all); };
  M.fbSheetBytes = function () { let b = 0; for (const s of sheets.values()) if (s.fam.slice(0, 2) === 'fb') b += s.bytes; return b; };
  /** agentFrame: the pen's packing, then this module pumps its deferred sheets and stamps the sheets the agent shows (both masters: render picks hdMaster) */
  M.agentFrame = function (anim, dir, f, a, zoom, tick) {
    const fr = penFrame.call(M, anim, dir, f, a, zoom, tick);
    if (a && typeof a === 'object') {
      if (HDQ.queue.length) pump();
      const name = (typeof anim === 'string' && SA[anim] && anim !== 'march') ? anim : 'walk', far = zoom < 1, n = far ? 2 : SA[name].n, d8 = (fr / n) | 0, look = Number.isFinite(a.look) ? (a.look >>> 0) : 0;
      const sheetAnim = (a.prop === 'cap' && (name === 'walk' || name === 'idle' || name === 'cheer' || name === 'wave')) ? 'cap' : name;
      const s1 = numSheets.get(numKey(far, sheetAnim, look, d8, 1)); if (s1) s1.used = hdFrame;
      const s2 = numSheets.get(numKey(far, sheetAnim, look, d8, 2)); if (s2) s2.used = hdFrame;
    }
    return fr;
  };
  // --- selfTest (registered through BSU.sprites._tests; also callable as entitiesHDSelfTest) ---------------------------------------
  function entitiesHDSelfTest() {
    const notes = [], check = (c, m) => { if (!c) notes.push(m); };
    try {
      check(FAMILIES.every((f) => M.isHD(f)), 'every character family is HD-registered');
      const want = { agent: 64, 'agent:idle': 24, 'agent:flee': 32, 'agent:splash': 48, 'agent:umbrella': 32, 'agent:cap': 64, gator: 80, roux: 80, fogger: 32, float: 16, 'fbplayer:run': 48, fbfan: 16, 'fbfan:seated': 8 };
      for (const id of Object.keys(want)) check(M.frames(id) === want[id], 'frames(' + id + ') = ' + want[id] + ' (got ' + M.frames(id) + ')');
      for (const id of Object.keys(CELLS)) { const c = CELLS[id]; for (const z of [1, 2]) { const e = M.get(id, 0, 0, z); check(e && e.hd && e.sw === c[0] * z && e.sh === c[1] * z && e.ox === -(c[0] >> 1) * z && e.oy === -c[2] * z, id + ' at master ' + z + ' is ' + c[0] + '×' + c[1] + ' with the feet anchor' + (e ? ' (got ' + e.sw + '×' + e.sh + ' @ ' + e.ox + ',' + e.oy + ')' : ' (null)')); } }
      for (let v = 0; v < 3; v++) { const e = M.get('gator', v, 3, 1), G = GATORS[v]; check(e && e.sw === G.cw && e.sh === G.ch && e.ox === -(G.cw >> 1) && e.oy === -(G.ch - 9), 'gator v' + v + ' cell'); }
      const a0 = M.get('agent', 5, 0, 1), a1 = M.get('agent', 5, 7, 1), a2 = M.get('agent', 5, 8, 1); check(a0 && a1 && a2 && a0.canvas === a1.canvas && a0.canvas !== a2.canvas && a0.sx !== a1.sx, 'frames of one facing share a sheet, another facing is its own');
      check(M.hdSheetCount() > 0 && M.hdSheetBytes() > 0, 'HD sheet memory accounted (' + (M.hdSheetBytes() / 1048576).toFixed(2) + ' MB)');
      const far = M.get('agentfar:walk', 5, 3, 1); check(far && far.sw === 14 && far.sh === 24, 'agentfar cells keep the 1× cell');
      for (const id of ['fbball', 'fbdown', 'fbstick', 'tent', 'smoker', 'cornhole', 'snoball', 'bonfire', 'pelican', 'armadillo']) { const e = M.get(id, 1, 0, 2); check(e && e.hd && e.own, id + ' bakes HD on its own canvas'); }
      const before = HDQ.deferred; M.gcSheets(hdFrame + 1); check(M.isHD('agent') && M.isHD('fbplayer'), 'the families stay HD after gcSheets'); void before;
    } catch (e) { notes.push('threw: ' + (e && e.message)); }
    return { ok: notes.length === 0, notes: notes.length ? notes.join('; ') : 'entities HD ok: ' + FAMILIES.length + ' families' };
  }
  M.entitiesHDSelfTest = entitiesHDSelfTest;
  if (Array.isArray(M._tests)) M._tests.push(entitiesHDSelfTest);
})();
