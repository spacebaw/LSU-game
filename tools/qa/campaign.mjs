#!/usr/bin/env node
// tools/qa/campaign.mjs — headless (Node, no Chrome) campaign runner for the balance / pacing pass.
//
// Boots the built index.html through test/domstub.mjs, starts a game (skipTutorial) at 96 or 64 with a seed, and plays
// it one in-game day at a time for N years under a named policy that acts through BSU.headless and the module APIs
// the UI itself calls (buildings.place / placeRun / upgrade / linkBuilding / repairAll / boardUp, economy.set*, sports.hire*,
// land.buy, headless.fill). Prints a year-by-year table per run, then medians and worst cases over the seeds.
//
//   node tools/qa/campaign.mjs [--size 96|64|both] [--seed 1] [--seeds N] [--years 15] [--policy goals|greedy|passive|storm|all]
//                              [--jobs K] [--assert] [--json out.json] [--quiet]
//
// Policies: goals (does only what the coach's current goal and the Issues tray say), greedy (max students as fast as cash
// allows, loan line included), passive (the tutorial minimum, then hoard), storm (greedy plus a levee ring, pumps, generators,
// insurance, board-up and sandbags before every storm). `--assert` exits non-zero when the pacing bands are missed on the
// median of the seeds (see BANDS). Runs fan out over child processes (`--jobs`, default min(4, cpus − 1)); `--worker` is internal.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const has = (name) => argv.includes('--' + name);

const POLICIES = ['goals', 'greedy', 'passive', 'storm'];
const YEARS = Math.max(1, Number(flag('years', 15)) | 0);
const SEED0 = Number(flag('seed', 1)) >>> 0 || 1;
const NSEEDS = Math.max(1, Number(flag('seeds', has('assert') ? 5 : 1)) | 0);   // --assert judges the median of 5 seeds unless told otherwise
const SIZES = (() => { const v = flag('size', '96'); return v === 'both' ? [96, 64] : [Number(v) === 64 ? 64 : 96]; })();
const POLS = (() => { const v = flag('policy', 'all'); return v === 'all' ? POLICIES : v.split(',').filter((p) => POLICIES.includes(p)); })();
const JOBS = Math.max(1, Number(flag('jobs', Math.min(4, Math.max(1, os.cpus().length - 1)))) | 0);
const QUIET = has('quiet');

// Pacing bands (the brief): asserted on the median of the seeds per size.
const BANDS = {
  goals: { winMin: 8, winMax: 12 },     // years to Flagship under `goals`
  greedy: { winMin: 5 },                // never under 5
  passive: { noDeath: true },           // stalls but never dies (no receivership, students ≥ 100 at the end)
  storm: { recoverYears: 2 }            // a direct hit is recovered within two seasons
};

// ---------------------------------------------------------------------------------------------------------------------
// Worker: one run
// ---------------------------------------------------------------------------------------------------------------------
async function runOne({ size, seed, years, policy }) {
  const { loadGame } = await import('../../test/domstub.mjs');
  const { win } = loadGame();
  const BSU = win.BSU;
  // --tune a.b.c=1,x.y=2: patch BSU.params before the game starts (balance experiments; the module closures read params by reference)
  for (const kv of String(flag('tune', '')).split(',').filter(Boolean)) {
    const [path, v] = kv.split('='); const keys = path.split('.'); let o = BSU.params;
    for (let k = 0; k < keys.length - 1; k++) o = o[keys[k]];
    if (o && keys[keys.length - 1] in o) o[keys[keys.length - 1]] = Number(v);
  }
  const H = BSU.headless, B = BSU.buildings, E = BSU.economy, PR = BSU.progress, SP = BSU.sports, LD = BSU.land, HY = BSU.hydro, IS = BSU.issues;
  const PT = BSU.params.time, PE = BSU.params.econ;
  const state = BSU.session.newGame({ seed, skipTutorial: true, size });
  const s = () => BSU.state;
  const W = () => BSU.MAP.W, HGT = () => BSU.MAP.H;
  const cat = (id) => BSU.data.catalog[id];
  const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
  const cash = () => fin(s().economy.cash, 0);
  const students = () => fin(s().economy.students, 0);
  const prestige = () => fin(s().economy.prestige, 0);
  const day = () => fin(s().calendar.day, 0);
  const year = () => Math.floor(day() / PT.daysPerYear) + 1;
  const dateStr = () => BSU.dayParts(day()).date;
  const list = (type) => B.list(s(), type);
  const complete = (b) => !!b && b.built >= 1 && !b.ruin;
  const founders = () => { const f = s().plot.founders; return { x: f.tx + 1, y: f.ty + 1 }; };
  const idx = (x, y) => y * W() + x;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const log = [];   // actions taken (for the table's notes)
  const note = (t) => { if (log.length < 400) log.push('Y' + year() + ' ' + dateStr() + ': ' + t); };

  // ---- monthly burn / reserve: a careful player keeps a month of expenses in hand; greedy dips into the loan line ----
  const burn = () => { const l = s().ledger.last; let t = 0; for (const k of BSU.LEDGER_EXPENSE_KEYS) if (k !== 'construction' && k !== 'demolition' && k !== 'repair') t += fin(l.expense[k], 0); return Math.max(t, 150000); };
  const reserve = () => policy === 'greedy' || policy === 'storm' ? -fin(PE.loanLimit, 2000000) * 0.75 : burn();
  const canSpend = (cost) => cash() - cost >= reserve();

  // ---- placement search: Chebyshev rings from (cx, cy) over the whole map (the charter rule lives inside canPlace) ----
  function spiralSpot(id, cx, cy, maxR, opts, pred) {
    const row = cat(id); if (!row) return null;
    const st = s(), w = W(), h = HGT(), tl = st.tiles;
    const rots = row.kind === 'footprint' && row.rotatable ? [0, 1] : [0];
    const foot = row.kind === 'footprint';
    const test = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
      const i = ty * w + tx;
      if (foot && (tl.owner[i] !== -1 || tl.type[i] <= BSU.T.BAYOU || tl.surface[i] !== 0)) return null;
      for (const rot of rots) {
        let r; try { r = B.canPlace(st, id, tx, ty, Object.assign({ rot }, opts || {})); } catch (e) { return null; }
        if (r && r.ok && (!pred || pred(r, tx, ty))) return { x: tx, y: ty, rot, r };
      }
      return null;
    };
    let p = test(cx, cy); if (p) return p;
    for (let r = 1; r <= maxR; r++) {
      for (let x = cx - r; x <= cx + r; x++) if ((p = test(x, cy - r))) return p;
      for (let y = cy - r + 1; y <= cy + r; y++) if ((p = test(cx + r, y))) return p;
      for (let x = cx + r - 1; x >= cx - r; x--) if ((p = test(x, cy + r))) return p;
      for (let y = cy + r - 1; y >= cy - r + 1; y--) if ((p = test(cx - r, y))) return p;
    }
    return null;
  }
  const providersExist = () => list('substation').some(complete) && list('water_tower').some(complete);
  /** place a footprint row near an anchor (default: the campus centroid); covered spots first for rows that need power/water */
  function build(id, anchor, maxR) {
    const row = cat(id); if (!row) return { ok: false, reason: 'unknown row' };
    if (!PR.unlocked(s(), id)) return { ok: false, reason: 'locked: ' + PR.unlockReason(s(), id) };
    const a = anchor || centroid();
    const needs = row.needsPower || row.needsWater;
    let p = null;
    if (needs && providersExist()) p = spiralSpot(id, a.x, a.y, maxR || 30, {}, (r) => (!row.needsPower || r.power) && (!row.needsWater || r.water));
    if (!p) p = spiralSpot(id, a.x, a.y, maxR || 30, {});
    if (!p) return { ok: false, reason: 'no legal spot' };
    if (!canSpend(p.r.cost + (p.r.connector ? p.r.connector.cost : 0))) return { ok: false, reason: 'reserve' };
    const r = B.place(s(), id, p.x, p.y, { rot: p.rot });
    if (r && r.ok) { note('built ' + id + ' at ' + p.x + ',' + p.y + ' $' + Math.round((r.cost || p.r.cost) / 1000) + 'k'); utilitiesFor(r.id); }
    return r;
  }
  function centroid() {
    const bs = list().filter((b) => b && !b.ruin); if (!bs.length) return founders();
    let x = 0, y = 0; for (const b of bs) { x += b.tx + b.w / 2; y += b.ty + b.h / 2; }
    return { x: Math.round(x / bs.length), y: Math.round(y / bs.length) };
  }
  /** a provider within reach of building `id` when it is not covered (and no provider under construction covers it) */
  function utilitiesFor(id) {
    const b = B.get(s(), id); if (!b) return;
    const row = cat(b.type);
    if (row.needsPower && !b.powered && !nearProvider(b, 'substation', cat('substation').effects.power.radius)) placeProvider('substation', b, cat('substation').effects.power.radius);
    if (row.needsWater && !b.watered && !nearProvider(b, 'water_tower', cat('water_tower').effects.water.radius)) placeProvider('water_tower', b, cat('water_tower').effects.water.radius);
  }
  function footDist(a, b) { // Chebyshev gap between two footprints
    const dx = Math.max(0, Math.max(a.tx - (b.tx + b.w - 1), b.tx - (a.tx + a.w - 1)));
    const dy = Math.max(0, Math.max(a.ty - (b.ty + b.h - 1), b.ty - (a.ty + a.h - 1)));
    return Math.max(dx, dy);
  }
  function nearProvider(b, type, radius) { return list(type).some((p) => p && !p.ruin && footDist(p, b) <= radius && (!complete(p) || (p.type === 'substation' ? spare(p) : spare(p)))); }
  function spare(p) { // provider with spare capacity (count assigned consumers)
    const cap = p.type === 'substation' ? cat('substation').effects.power.capacity : cat('water_tower').effects.water.capacity;
    let n = 0; for (const c of list()) if (c && c.provider && ((p.type === 'substation' && c.provider.power === p.id) || (p.type === 'water_tower' && c.provider.water === p.id))) n++;
    return n < cap;
  }
  function placeProvider(type, b, radius) {
    const a = { x: b.tx + (b.w >> 1), y: b.ty + (b.h >> 1) };
    const row = cat(type);
    const p = spiralSpot(type, a.x, a.y, radius - 1, {}, (r, tx, ty) => footDist({ tx, ty, w: row.w, h: row.h }, b) <= radius - 1 && (!row.needsPower || r.power || !providersExist()));
    if (!p) return false;
    if (!canSpend(p.r.cost)) return false;
    const r = B.place(s(), type, p.x, p.y, { rot: p.rot });
    if (r && r.ok) { note('built ' + type + ' for #' + b.id); if (type === 'water_tower') utilitiesFor(r.id); }
    return !!(r && r.ok);
  }
  /** lay a straight run of `len` tiles of a drag row starting near the campus (first legal run wins) */
  function layRun(id, len, from, maxR) {
    const st = s(), w = W(), h = HGT();
    const a = from || founders();
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const tryRun = (x0, y0) => {
      for (const [dx, dy] of dirs) {
        const tiles = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const x = x0 + dx * k, y = y0 + dy * k;
          if (x < 0 || y < 0 || x >= w || y >= h) { ok = false; break; }
          tiles.push(idx(x, y));
        }
        if (!ok) continue;
        let good = true;
        for (const t of tiles) { let r; try { r = B.canPlace(st, id, t % w, (t / w) | 0, { tiles, ignoreCash: true }); } catch (e) { r = null; } if (!r || !r.ok) { good = false; break; } }
        if (good) return tiles;
      }
      return null;
    };
    for (let r = 2; r <= (maxR || 14); r++) {
      for (let x = a.x - r; x <= a.x + r; x++) for (const y of [a.y - r, a.y + r]) { const t = tryRun(x, y); if (t) return commitRun(id, t); }
      for (let y = a.y - r + 1; y <= a.y + r - 1; y++) for (const x of [a.x - r, a.x + r]) { const t = tryRun(x, y); if (t) return commitRun(id, t); }
    }
    return { ok: false, placed: 0, reason: 'no run' };
  }
  function commitRun(id, tiles) {
    const unit = cat(id).cost;
    if (!canSpend(unit * tiles.length)) return { ok: false, placed: 0, reason: 'reserve' };
    const r = B.placeRun(s(), id, tiles, {});
    if (r && r.placed > 0) note('laid ' + r.placed + ' ' + id + ' tiles $' + Math.round((r.cost || 0) / 1000) + 'k');
    return r;
  }
  /** a footprint row that needs a road within 4: search beside every connected road tile; lay a road first when there is none */
  function buildNearRoad(id) {
    const st = s(), w = W();
    const roads = []; for (let i = 0; i < st.tiles.surface.length; i++) if (st.tiles.surface[i] === BSU.SURF.ROAD) roads.push(i);
    if (roads.length < 4) { const r = layRun('road', 10); if (!r || !r.placed) return { ok: false, reason: 'no road' }; return buildNearRoad(id); }
    const row = cat(id);
    for (const t of roads) {
      const p = spiralSpot(id, t % w, (t / w) | 0, 5, {}, (r) => (!row.needsPower || !providersExist() || r.power) && (!row.needsWater || !providersExist() || r.water)) || spiralSpot(id, t % w, (t / w) | 0, 5, {});
      if (p) {
        if (!canSpend(p.r.cost + (p.r.connector ? p.r.connector.cost : 0))) return { ok: false, reason: 'reserve' };
        const r = B.place(st, id, p.x, p.y, { rot: p.rot });
        if (r && r.ok) { note('built ' + id + ' by the road'); utilitiesFor(r.id); }
        return r;
      }
    }
    const r2 = layRun('road', 10, centroid(), 24);
    if (r2 && r2.placed) return buildNearRoad(id);
    return { ok: false, reason: 'no spot near a road' };
  }
  /** dig a canal from the cove's lowest tile to the bayou (the tutorial's Objective 4) */
  function digCoveCanal() {
    const st = s(), w = W(), h = HGT(), tl = st.tiles;
    const cove = st.plot.cove || []; if (!cove.length) return false;
    let low = cove[0]; for (const i of cove) if (tl.elev[i] < tl.elev[low]) low = i;
    const isWater = (i) => tl.type[i] === BSU.T.OPEN_WATER || tl.type[i] === BSU.T.BAYOU;
    const okCanal = (i) => { try { const r = B.canPlace(st, 'canal', i % w, (i / w) | 0, { ignoreCash: true }); return !!(r && r.ok); } catch (e) { return false; } };
    const prev = new Int32Array(w * h).fill(-2); const q = [low]; prev[low] = -1;
    let end = -1;
    while (q.length && end < 0) {
      const i = q.shift();
      for (const n of BSU.nbr4(i)) {
        if (n < 0 || prev[n] !== -2) continue;
        if (isWater(n)) { end = i; break; }
        if (!okCanal(n)) { prev[n] = -3; continue; }
        prev[n] = i; q.push(n);
      }
    }
    if (end < 0) return false;
    const path = []; for (let i = end; i >= 0; i = prev[i]) path.push(i);
    path.reverse();
    const r = B.placeRun(st, 'canal', path, {});
    note('dug a ' + (r ? r.placed : 0) + '-tile canal to the bayou');
    return !!(r && r.placed);
  }
  /** close the levee ring at H ft: lay levee on every gap the gap detector names (a few passes) */
  function closeRing(Hft, rowId) {
    let passes = 0, laid = 0;
    while (passes++ < 4) {
      const g = B.gaps(s(), Hft); if (!g || !g.gaps || !g.gaps.length) break;
      let any = 0;
      for (const gap of g.gaps) {
        const tiles = (gap.tiles || []).filter((i) => s().tiles.crest[i] === 0);
        if (!tiles.length) continue;
        if (!canSpend(cat(rowId || 'levee').cost * tiles.length)) return laid;
        const r = B.placeRun(s(), rowId || 'levee', tiles, {});
        if (r && r.placed) { any += r.placed; laid += r.placed; }
      }
      if (!any) break;
    }
    if (laid) note('levee ' + laid + ' tiles toward a ring at ' + Hft + ' ft');
    return laid;
  }
  /** Objective 11's levee: wall the cove's own perimeter (every land tile beside a cove tile below H; 13–15 tiles on the template plot) */
  function sealCove(Hft) {
    const st = s(), tl = st.tiles, w = W(), cove = new Set(st.plot.cove || []);
    if (!cove.size || B.coveTilesUnreached(st, Hft)) return 0;
    const per = new Set();
    for (const i of cove) for (const n of BSU.nbr4(i)) if (n >= 0 && !cove.has(n) && tl.crest[n] === 0 && tl.elev[n] < Hft + 0.01) per.add(n);
    const tiles = Array.from(per).filter((i) => { try { const r = B.canPlace(st, 'levee', i % w, (i / w) | 0, { ignoreCash: true }); return !!(r && r.ok); } catch (e) { return false; } });
    if (!tiles.length || !canSpend(cat('levee').cost * tiles.length)) return 0;
    const r = B.placeRun(st, 'levee', tiles, {});
    if (r && r.placed) note('levee ' + r.placed + ' tiles around the cove (unreached ' + B.coveTilesUnreached(st, Hft) + ')');
    return r ? r.placed : 0;
  }
  /** a pump inside the ring touching a canal (Objective 11's second half): every footprint tile unreached at H */
  function pumpInside(Hft) {
    const st = s(), w = W(), tl = st.tiles;
    const prot = B.protection(st, Hft);
    const inside = (r) => r.tiles.every((i) => !prot[i]);
    for (let i = 0; i < tl.flags.length; i++) {
      if (!(tl.flags[i] & BSU.FLAG.CANAL) || (prot && prot[i])) continue;
      const p = spiralSpot('pump', i % w, (i / w) | 0, 3, {}, inside);
      if (p) { if (!canSpend(p.r.cost)) return false; const r = B.place(st, 'pump', p.x, p.y, { rot: p.rot }); if (r && r.ok) { note('pump inside the ring'); utilitiesFor(r.id); return true; } }
    }
    return false;
  }
  function plantOaks(n) {
    const st = s(), w = W(), tl = st.tiles; let done = 0;
    for (let i = 0; i < tl.surface.length && done < n; i++) {
      if (tl.surface[i] !== BSU.SURF.PATH) continue;
      for (const nb of BSU.nbr8(i)) {
        if (nb < 0 || done >= n) continue;
        let r; try { r = B.canPlace(st, 'live_oak', nb % w, (nb / w) | 0, {}); } catch (e) { r = null; }
        if (r && r.ok && canSpend(r.cost)) { const pl = B.place(st, 'live_oak', nb % w, (nb / w) | 0, { rot: 0 }); if (pl && pl.ok) done++; }
      }
    }
    if (done) note('planted ' + done + ' oaks');
    return done;
  }
  function paintPreserve(n) {
    const st = s(), w = W(), tl = st.tiles, y1 = st.plot.rect.y1; const tiles = [];
    for (let i = 0; i < tl.type.length && tiles.length < n; i++) {
      if (((i / w) | 0) <= y1 || tl.type[i] !== BSU.T.MARSH || (tl.flags[i] & BSU.FLAG.PRESERVE)) continue;
      let r; try { r = B.canPlace(st, 'preserve', i % w, (i / w) | 0, { ignoreCash: true }); } catch (e) { r = null; }
      if (r && r.ok) tiles.push(i);
    }
    if (!tiles.length) return 0;
    const r = B.placeRun(st, 'preserve', tiles, {});
    if (r && r.placed) note('preserve ' + r.placed + ' tiles');
    return r ? r.placed : 0;
  }
  function abatementNear(tile) {
    const w = W(); const p = spiralSpot('abatement', tile % w, (tile / w) | 0, 6, {});
    if (!p || !canSpend(p.r.cost)) return false;
    const r = B.place(s(), 'abatement', p.x, p.y, { rot: p.rot }); if (r && r.ok) note('abatement at a hotspot');
    return !!(r && r.ok);
  }
  function upgradeAll(type) {
    for (const b of list(type)) { if (!complete(b)) continue; const row = cat(type); const next = row.tiers.find((t) => t.tier === (b.tier || 0) + 1); if (!next) continue; if (!PR.unlockOk(s(), next.unlock)) continue; if (!canSpend(next.cost)) continue; const r = B.upgrade(s(), b.id); if (r && r.ok) note('upgraded ' + type + ' to tier ' + r.tier); }
  }
  function buySection(minDry) {
    const secs = LD.sections(s()) || [];
    const cands = secs.filter((x) => x.forSale && !x.owned && !x.locked && x.counts && (x.counts.dry + x.counts.high) >= (minDry || 40)).sort((a, b) => a.price - b.price);
    for (const sec of cands) { if (!canSpend(sec.price)) return false; const r = LD.buy(s(), sec.id, {}); if (r && r.ok) { note('chartered section ' + sec.id + ' $' + Math.round(sec.price / 1e6 * 10) / 10 + 'M'); return true; } }
    return false;
  }
  /** fill a block of marsh beside the campus (Dredge & Fill) when nothing else is left */
  function dredgeBlock(n) {
    const st = s(), w = W(), tl = st.tiles, c = centroid(); const tiles = [];
    for (let r = 2; r <= 30 && tiles.length < n; r++) for (let y = c.y - r; y <= c.y + r && tiles.length < n; y++) for (let x = c.x - r; x <= c.x + r && tiles.length < n; x++) {
      if (cheb(x, y, c.x, c.y) !== r || x < 0 || y < 0 || x >= w || y >= HGT()) continue;
      const i = idx(x, y); if (tl.type[i] !== BSU.T.MARSH || tl.owner[i] !== -1) continue;
      let q; try { q = B.canPlace(st, 'dredge_fill', x, y, { ignoreCash: true }); } catch (e) { q = null; }
      if (q && q.ok) tiles.push(i);
    }
    if (!tiles.length || !canSpend(cat('dredge_fill').cost * tiles.length)) return 0;
    const r = H.fill(tiles, {}); if (r && r.placed) note('dredged ' + r.placed + ' tiles');
    return r ? r.placed : 0;
  }
  // ---- issues tray: act on what it shows (the way its Fix buttons do) ----
  function actOnIssues(opts) {
    const st = s();
    let acted = 0;
    for (const it of IS.list(st)) {
      if (acted >= (opts.max || 4)) break;
      const a = it.action || {};
      switch (it.kind) {
        case 'damaged': if (it.resolvable && canSpend(it.cost || 0)) { const r = B.repair(st, a.repair); if (r && r.ok) { acted++; note('repaired #' + a.repair); } } break;
        case 'unpowered': case 'pumpOff': case 'brownout': { const b = B.get(st, a.near); if (b && placeProvider('substation', b, cat('substation').effects.power.radius)) acted++; break; }
        case 'unwatered': { const b = B.get(st, a.near); if (b && placeProvider('water_tower', b, cat('water_tower').effects.water.radius)) acted++; break; }
        case 'unlinkedPath': if (it.resolvable && canSpend(it.cost || 0)) { const r = B.linkBuilding(st, a.link); if (r && r.ok) { acted++; note('linked #' + a.link); } } break;
        case 'overCapacity': if (opts.capacity !== false) { const row = opts.rowFor ? opts.rowFor(a.arm) : a.arm; const r = row === 'wastewater' ? buildNearRoad('wastewater') : build(row); if (r && r.ok) { acted++; if (row === 'dining_hall' && opts.menu) B.applyMenuPreset(st, r.id, opts.menu); } } break;
        case 'mosquitoHotspot': if (opts.mosquito !== false && Number.isFinite(a.nearTile) && abatementNear(a.nearTile)) acted++; break;
        case 'weakLevee': if (it.resolvable && canSpend(it.cost || 0)) { const r = B.repairLevee(st, a.repairLevee); if (r && r.ok) acted++; } break;
        case 'flooded': if (opts.flooded) { const b = B.get(st, a.near); if (b) { const p = spiralSpot('pump', b.tx, b.ty, 6, {}, (r, tx, ty) => footDist({ tx, ty, w: 2, h: 2 }, b) <= 6); if (p && canSpend(p.r.cost)) { const r = B.place(st, 'pump', p.x, p.y, { rot: p.rot }); if (r && r.ok) { acted++; note('pump by flooded #' + b.id); utilitiesFor(r.id); } } } } break;
        default: break;
      }
    }
    return acted;
  }
  // ---- capacity: build the binding term's row ----
  /** the binding capacity term, counting what is still under construction (stats only count complete buildings) */
  function capacityTerm() {
    const c = E.capacity(s()), C = PE.capacity;
    let beds = 0, seats = 0, feeds = 0, plants = 0;
    for (const b of list()) { if (!b || b.ruin || b.built >= 1) continue; const e = cat(b.type).effects; beds += e.beds; seats += e.seats; feeds += e.feeds * (policy === 'goals' ? 1 : 2); if (b.type === 'wastewater') plants++; }
    const built = list('wastewater').filter(complete).length;
    const ww = (built + plants) === 0 ? C.wastewaterBase : C.wastewaterPer * (built + plants);
    const terms = [['beds', c.beds + Math.round(beds * C.beds)], ['seats', c.seats + Math.round(seats * C.seats)], ['dining', c.dining + Math.round(feeds * C.dining)], ['wastewater', ww]];
    terms.sort((a, b) => a[1] - b[1]);
    return { key: terms[0][0], value: terms[0][1], all: c };
  }
  function buildCapacity(rows, menu) {
    const t = capacityTerm();
    const row = rows[t.key];
    if (!row) return { ok: false, reason: 'no row for ' + t.key };
    if (row === 'wastewater') { if (!PR.unlocked(s(), 'wastewater')) return { ok: false, reason: 'wastewater locked' }; return buildNearRoad('wastewater'); }
    const r = build(row);
    if (r && r.ok && row === 'dining_hall' && menu) B.applyMenuPreset(s(), r.id, menu);
    return r;
  }
  // ---- cards: a player answers what the Board / the failure card asks ----
  function answerCards(choice) {
    const p = s().progress;
    if (p.failure && p.failure.pendingKind) {
      const kind = p.failure.pendingKind;
      const opt = kind === 'bankruptcy' ? choice : 'ok';
      PR.answerFailure(s(), kind, opt);
      flagsOut.cards.push({ year: year(), kind, opt });
      note('failure card ' + kind + ' → ' + opt);
      try { BSU.ui.closeCard && BSU.ui.closeCard(s()); } catch (e) { /* headless */ }
    }
    const pending = (p.boardCards || []).find((b) => b.pending);
    if (pending) PR.answerBoard(s(), policy === 'storm' && pending.cards.includes('insurance') ? 'insurance' : null);
  }
  // ---- storm prep (the Storm panel's buttons) ----
  function stormPrep(deep) {
    const st = s(), cur = st.storms && st.storms.current;
    if (!cur || cur.nearMiss) return;
    if (cur.phase >= BSU.STORM.NAMED && cur.phase <= BSU.STORM.BANDS) {
      if (!prepDone.has(cur.name)) {
        prepDone.add(cur.name);
        const Hf = fin(BSU.weather.forecastSurge(st), 5);
        if (deep) { closeRing(Hf, 'levee'); if (!B.protection(st, Hf) || !B.ringClosed(st, Hf)) closeRing(Hf, 'levee'); }
        const bu = B.boardUp(st, 'all'); if (bu && bu.ok) note('boarded up ' + (bu.queued || bu.boarded) + ' for ' + cur.name + ' (cat ' + cur.cat + ')');
        if (deep) { const sb = B.sandbags(st, Hf, {}); if (sb && sb.ok) note('sandbags on ' + sb.tiles.length + ' tiles'); }
        if (deep) for (const sub of list('substation')) if (complete(sub) && !list('generator').some((g) => cheb(g.tx, g.ty, sub.tx, sub.ty) <= 6)) { const p = spiralSpot('generator', sub.tx, sub.ty, 5, {}); if (p && canSpend(p.r.cost)) B.place(st, 'generator', p.x, p.y, { rot: 0 }); }
      }
    }
  }
  const prepDone = new Set();

  // ---- the policies ----
  const GOALS_ROWS = { beds: 'dorm', seats: 'lecture_hall', dining: 'dining_hall', wastewater: 'wastewater' };
  const GREEDY_ROWS = { beds: 'bunkhouse', seats: 'lecture_hall', dining: 'dining_hall', wastewater: 'wastewater' };
  const flagsOut = { cards: [], sectionsBought: 0, filled: 0 };

  function prologue() {
    // what the tutorial leaves every player with: a dorm, a dining hall, the canal, a substation and a water tower (build() adds the providers)
    for (const id of ['dorm', 'dining_hall']) build(id, founders(), 14);
    digCoveCanal();
    for (const b of list()) if (b) utilitiesFor(b.id);
    if (policy === 'greedy' || policy === 'storm') { E.setQuality(s(), 'basic'); for (const d of list('dining_hall')) B.applyMenuPreset(s(), d.id, 'cheap'); }
    if (policy === 'passive') build('lecture_hall');
  }

  const GOAL_STUDENT_TARGETS = { '8': 500, '17': 1500, '19': 2000, '21': 5000, '22': 10000 };
  /** the HUD needs strip (ui.js needsOf): the tightest of beds / seats / dining / sewage; 'bad' when full, 'warn' from 85 %, plus the parking nudge past 600 students */
  function needsStrip() {
    const st = s(), e = st.economy, n = students(), cp = E.capacity(st);
    const terms = [{ key: 'beds', cap: cp.beds }, { key: 'seats', cap: cp.seats }, { key: 'dining', cap: cp.dining }, { key: 'wastewater', cap: cp.wastewater }];
    let m = terms[0]; for (const t of terms) if (t.cap - n < m.cap - n) m = t;
    if (m.cap <= n) return { key: m.key, level: 'bad' };
    if (n >= 0.85 * m.cap) return { key: m.key, level: 'warn' };
    const lots = list('parking').filter(complete).length, need = E.lotsNeeded(st);
    if (n > 600 && lots < need) return { key: 'parking', level: 'warn' };
    void e;
    return { key: m.key, level: 'ok' };
  }
  /** the needs strip's "Needed" / "Next" badge: build that row (the Dorm becomes the Bunkhouse when cash is short, as ui.recommend does) */
  function actOnNeeds(max) {
    let built = 0;
    for (let k = 0; k < (max || 2); k++) {
      const b = needsStrip(); if (b.level === 'ok') break;
      if (b.key === 'parking') { const r = buildNearRoad('parking'); if (r && r.ok) built++; break; }
      // the pending-inclusive term: a hall already under construction answers the badge until it completes
      const t = capacityTerm(); if (t.value - students() >= Math.max(60, students() * 0.15)) break;
      let row = GOALS_ROWS[t.key];
      if (row === 'dorm' && cash() < 1.5 * cat('dorm').cost && PR.unlocked(s(), 'bunkhouse')) row = 'bunkhouse';
      const r = row === 'wastewater' ? (PR.unlocked(s(), 'wastewater') ? buildNearRoad('wastewater') : { ok: false }) : build(row);
      if (!r || !r.ok) break;
      built++;
    }
    return built;
  }
  function goalsMonthly() {
    const st = s();
    answerCards('hike');
    actOnIssues({ max: 3, rowFor: (arm) => GOALS_ROWS[{ dorm: 'beds', lecture_hall: 'seats', dining_hall: 'dining' }[arm]] || arm, flooded: true });
    actOnNeeds(2);
    const o = PR.objective(st);
    const ids = []; if (o) { ids.push(o.id); if (o.background) ids.push(o.background.id); }
    for (const id of ids) {
      switch (id) {
        case '6': plantOaks(5 - Math.min(5, o.progress || 0)); break;
        case '7': layRun('road', 10); break;
        case '10': { const hot = IS.ofKinds(st, ['mosquitoHotspot'])[0]; if (hot && Number.isFinite(hot.action.nearTile)) abatementNear(hot.action.nearTile); else { const c = st.plot.cove && st.plot.cove[0]; if (Number.isFinite(c)) abatementNear(c); } break; }
        case '11': sealCove(5); if (!list('pump').length) pumpInside(5); break;
        case '12': stormPrep(false); break;
        case '14': if (canSpend(E.repairBill(st))) { const r = B.repairAll(st); if (r && r.ok) note('repaired all'); } break;
        case '15': if (!list('practice_field').length) build('practice_field'); else upgradeAll('practice_field'); break;
        case '16': paintPreserve(20); break;
        case '17': if (!list('wastewater').length && PR.unlocked(st, 'wastewater')) buildNearRoad('wastewater'); break;
        case '18a': case '18b': case '18': footballPush(); break;
        case '19': if (!list('bell_tower').length) build('bell_tower'); academicPush(); break;
        case '20': if (!list('stadium').length) { if (PR.unlocked(st, 'stadium')) buildNearRoad('stadium'); } else { upgradeAll('stadium'); if (B.has(st, 'stadium', 2)) SP.setNight(st, true); } break;
        case '21': bayouChoice(); break;
        case '22': academicPush(); break;
        case 'land1': buySection(30); break;
        case 'sink1': {   // the sinking goal: pilings under the sunk halls, cheapest retrofit first, while the cash allows
          const lim = fin(BSU.params.progress.milestoneGoals.sinkingFeeling, 1);
          const sunk = list().filter((b) => b && complete(b) && !b.pilings && fin(b.sunk, 0) >= lim).map((b) => ({ b, cost: Math.round(0.4 * cat(b.type).cost * (1 + fin(b.sunk, 0))) })).sort((a, b) => a.cost - b.cost);
          let n = 0; for (const x of sunk) { if (n >= 3 || !canSpend(x.cost)) break; const r = B.retrofitPilings(st, x.b.id, {}); if (r && r.ok) n++; }
          if (n) note('pilings under ' + n + ' sunk halls');
          break;
        }
        default: break;
      }
      // the goal card's "Build it" button: the first unlocked, not-yet-built footprint row the objective's guide lists (data.guide)
      const g = BSU.data.guide && BSU.data.guide[id];
      if (g && g.build) for (const rowId of g.build) {
        const row = cat(rowId); if (!row || row.kind !== 'footprint' || !PR.unlocked(st, rowId) || list(rowId).length) continue;
        const r = row.roadWithin > 0 ? buildNearRoad(rowId) : build(rowId);
        if (r && r.ok) note('Build it: ' + rowId + ' (goal ' + id + ')');
        break;
      }
      // a student-count goal: build ahead when the campus is nearly full (a dorm or two, the way the card's "beds are the bottleneck" suggests)
      const target = GOAL_STUDENT_TARGETS[id];
      if (target && students() < target) for (let k = 0; k < 2; k++) { const c = capacityTerm(); if (c.value - students() >= Math.max(60, students() * 0.25)) break; const r = buildCapacity(GOALS_ROWS); if (!r || !r.ok) break; }
    }
  }
  function footballPush() {
    const st = s();
    if (!list('practice_field').length) { build('practice_field'); return; }
    upgradeAll('practice_field');
    if (cash() > 2500000 && fin(st.economy.coaching, 0) < 500000) { E.setCoaching(st, 500000); note('coaching $500k'); }
    const view = SP.staff(st); if (!view || !view.hasTeam) return;
    const curStars = view.hc ? view.hc.stars : 0;
    const cands = (view.candidates.hc || []).filter((c) => c.stars > curStars).sort((a, b) => b.stars - a.stars);
    for (const c of cands) { if (!canSpend(c.fee)) continue; const r = SP.hireStaff(st, 'hc', c.idx); if (r && r.ok) { note('hired ' + c.name + ' ' + c.stars + '★'); break; } else if (r && /headroom|budget/i.test(r.reason || '')) { SP.setTopUp(st, 0.5); const r2 = SP.hireStaff(st, 'hc', c.idx); if (r2 && r2.ok) { note('hired ' + c.name + ' with a top-up'); break; } } }
  }
  function academicPush() {
    const st = s();
    if (cash() > 3 * burn() + 2000000) {
      if (st.economy.quality === 'basic') { E.setQuality(st, 'good'); note('faculty: good'); }
      else if (st.economy.quality === 'good' && cash() > 3 * burn() + 6000000) { E.setQuality(st, 'elite'); note('faculty: elite'); }
    }
  }
  function bayouChoice() {
    // Living With Water: ecology ≥ 75 with ≤ 10 floodwalls (paint preserve, plant cypress, keep levees); the Marsh Restoration unlock follows the milestone
    const st = s();
    if (PR.earned(st, 'livingWithWater')) { if (!list('marsh_restoration').length) build('marsh_restoration'); return; }
    if (PR.earned(st, 'fortressBayou')) { if (!list('surge_barrier').length) layRun('surge_barrier', 4); return; }
    if (BSU.wildlife.ecology(st) < 75) { paintPreserve(10); for (let k = 0; k < 4; k++) { const p = spiralSpot('cypress', centroid().x, centroid().y, 20, {}); if (p && canSpend(p.r.cost)) B.place(st, 'cypress', p.x, p.y, { rot: 0 }); } for (let k = 0; k < 2; k++) { const p = spiralSpot('bat_house', centroid().x, centroid().y, 16, {}); if (p && canSpend(p.r.cost)) B.place(st, 'bat_house', p.x, p.y, { rot: 0 }); } }
  }

  function greedyMonthly(deep) {
    const st = s();
    answerCards('hike');
    actOnIssues({ max: 4, rowFor: (arm) => GREEDY_ROWS[{ dorm: 'beds', lecture_hall: 'seats', dining_hall: 'dining' }[arm]] || arm, menu: 'cheap', flooded: deep });
    // tuition: push applicants when capacity outruns the pool, back off when the cash runway is short
    const e = st.economy;
    const pool = fin(e.applicants, 0) * fin(PE.selectivity[e.selectivity], 1);
    const c = capacityTerm();
    if (cash() < burn() && e.tuition < PE.tuition.max) E.setTuition(st, e.tuition + 500);
    else if (c.value > pool * 0.9 && e.tuition > PE.tuition.min) E.setTuition(st, e.tuition - 500);
    // build the binding term until the campus holds 30 % more than the pool can fill, several per month when cash allows
    let applicantBound = true;
    for (let k = 0; k < 6; k++) {
      const t = capacityTerm();
      if (t.value > Math.max(students() * 1.25, pool * 1.1) + 100) break;
      applicantBound = false;
      let r = buildCapacity(GREEDY_ROWS, 'cheap');
      if (!r || !r.ok) {
        if (/no legal spot|no spot|no road/.test(r && r.reason || '')) { if (!buySection(40)) { if (!dredgeBlock(12)) break; } else flagsOut.sectionsBought++; r = buildCapacity(GREEDY_ROWS, 'cheap'); if (!r || !r.ok) break; }
        else break;
      }
    }
    // applicant-bound with cash in hand: buy prestige (applicants are 28 a point), the way a max-students player would
    if (applicantBound && cash() > 2 * burn()) prestigePush();
    if (deep) {
      // the storm policy: a ring at 8 ft before June, pumps inside, generators by every substation, pilings on the substations
      if (dateStr() === 'May 1' || dateStr() === 'Jun 1') {
        sealCove(5); if (!list('pump').length) pumpInside(5); closeRing(8, 'levee');
        for (const sub of list('substation')) if (complete(sub) && !list('generator').some((g) => cheb(g.tx, g.ty, sub.tx, sub.ty) <= 6)) { const p = spiralSpot('generator', sub.tx, sub.ty, 5, {}); if (p && canSpend(p.r.cost)) { const r = B.place(st, 'generator', p.x, p.y, { rot: 0 }); if (r && r.ok) note('generator by substation #' + sub.id); } }
        // pilings: utilities first (the substation cascade), then housing, while the cash allows
        const order = list().filter((b) => b && complete(b) && !b.pilings && ['substation', 'water_tower', 'pump', 'wastewater', 'dorm', 'bunkhouse', 'suites', 'res_tower', 'dining_hall', 'lecture_hall'].includes(b.type)).sort((a, b) => ['substation', 'water_tower', 'pump', 'wastewater'].includes(a.type) ? -1 : 1);
        let n = 0; for (const b of order) { if (n >= 4) break; const cost = Math.round(cat(b.type).cost * 0.4); if (!canSpend(cost)) break; const r = B.retrofitPilings(st, b.id, {}); if (r && r.ok) { n++; } }
        if (n) note('pilings under ' + n + ' buildings');
      }
      if (canSpend(E.repairBill(st))) B.repairAll(st);
    }
  }
  /** greedy's prestige ladder: the first unlocked, affordable item each month (academics, landmarks, football, happiness, faculty) */
  function prestigePush() {
    const st = s();
    const ladder = ['practice_field', 'library', 'union', 'coastal_institute', 'engineering', 'tiger_habitat', 'bell_tower', 'rec_center', 'res_tower'];
    upgradeAll('practice_field'); upgradeAll('stadium');
    if (list('practice_field').some((b) => complete(b) && b.tier >= 1) && !list('stadium').length && PR.unlocked(st, 'stadium')) { const r = buildNearRoad('stadium'); if (r && r.ok) return; }
    for (const id of ladder) {
      if (!PR.unlocked(st, id)) continue;
      if (list(id).length >= (id === 'res_tower' ? 99 : 1)) continue;
      const r = build(id); if (r && r.ok) { if (id === 'practice_field') SP.setAutoSim(st, true); return; }
      if (r && r.reason === 'reserve') return;
    }
    if (st.economy.quality === 'basic' && cash() > 4 * burn()) { E.setQuality(st, 'good'); note('faculty: good'); }
    else if (st.economy.quality === 'good' && cash() > 8 * burn()) { E.setQuality(st, 'elite'); note('faculty: elite'); }
    if (st.sports.hasTeam && fin(st.economy.coaching, 0) < 1000000 && cash() > 6 * burn()) { E.setCoaching(st, 1000000); note('coaching $1M'); }
    if (st.sports.hasTeam) footballPush();
  }
  function passiveMonthly() {
    answerCards('austerity');
    actOnIssues({ max: 2, capacity: false, mosquito: false });
    if (canSpend(E.repairBill(s()) + burn())) { const r = B.repairAll(s()); void r; }
  }
  function daily() {
    if (policy === 'storm') stormPrep(true);
    else if (policy === 'goals') { const o = PR.objective(s()); if (o && o.id === '12') stormPrep(false); }
  }
  const monthly = policy === 'goals' ? goalsMonthly : policy === 'greedy' ? () => greedyMonthly(false) : policy === 'storm' ? () => greedyMonthly(true) : passiveMonthly;

  // ---- bookkeeping ----
  let yearIncome = 0, yearExpense = 0, yearUpkeep = 0, yearConstruction = 0;
  BSU.events.on('econ:month', (p) => { const st = p && p.statement; if (!st) return; for (const k of BSU.LEDGER_INCOME_KEYS) yearIncome += fin(st.income[k], 0); for (const k of BSU.LEDGER_EXPENSE_KEYS) { const v = fin(st.expense[k], 0); if (k === 'construction') yearConstruction += v; else yearExpense += v; if (k === 'upkeep') yearUpkeep += v; } }, 'campaign');
  const rows = [];
  let maxFlooded = 0, stormsThisYear = [], minCash = cash(), minStudents = students(), maxPrestige = 0;
  const earnedBefore = new Set();
  let winYear = -1, receiverships = 0, lastReceiver = false;
  function record() {
    const st = s(), e = st.economy, cp = E.capacity(st), stt = B.stats(st);
    const earned = BSU.MILESTONES.filter((id) => PR.earned(st, id));
    const fresh = earned.filter((id) => !earnedBefore.has(id)); for (const id of earned) earnedBefore.add(id);
    const o = PR.objective(st);
    const ls = st.sports.lastSeason || { wins: 0, losses: 0 };
    const row = {
      year: year() - 1, cash: Math.round(cash()), income: Math.round(yearIncome), expense: Math.round(yearExpense), upkeep: Math.round(yearUpkeep), construction: Math.round(yearConstruction),
      students: students(), applicants: Math.round(fin(e.applicants, 0)), beds: cp.beds, seats: cp.seats, dining: cp.dining, wastewater: cp.wastewater, capacity: cp.capacity,
      prestige: Math.round(prestige() * 10) / 10, target: Math.round(fin(e.targets && e.targets.prestige, 0) * 10) / 10, happiness: Math.round(fin(e.happiness, 0) * 10) / 10, ecology: Math.round(BSU.wildlife.ecology(st) * 10) / 10,
      record: st.sports.hasTeam ? ls.wins + '-' + ls.losses : '-', sections: LD.count(st), buildings: list().filter((b) => b && !b.ruin).length,
      milestones: earned.length, newMilestones: fresh, flooded: maxFlooded, damaged: fin(stt.unrepaired, 0), storms: stormsThisYear.slice(),
      goal: o ? o.id + (o.background && o.background.id !== o.id ? '+' + o.background.id : '') : '-', goalTitle: o ? o.title : 'Milestones', tuition: e.tuition, quality: e.quality, coaching: fin(e.coaching, 0), minCash: Math.round(minCash), minStudents
    };
    rows.push(row);
    yearIncome = yearExpense = yearUpkeep = yearConstruction = 0; maxFlooded = 0; stormsThisYear = []; minCash = cash(); minStudents = students();
  }
  // ---- the run ----
  prologue();
  const totalDays = years * PT.daysPerYear;
  let lastDay = day(), lastMonth = -1, lastYear = year(), seenStorms = 0, guard = 0;
  monthly();
  while (day() < totalDays && guard++ < totalDays * 4) {
    H.tick(PT.ticksPerDay);
    const d = day(); if (d === lastDay) continue;
    lastDay = d;
    daily();
    const log2 = s().storms.log || [];
    while (seenStorms < log2.length) { const x = log2[seenStorms++]; if (!x.nearMiss) stormsThisYear.push('C' + x.cat + (x.held ? '' : '!') + (x.damage > 0 ? ' $' + Math.round(x.damage / 1e3) + 'k' : '')); }
    maxFlooded = Math.max(maxFlooded, HY.floodedBuildings(s()).length);
    minCash = Math.min(minCash, cash()); minStudents = Math.min(minStudents, students()); maxPrestige = Math.max(maxPrestige, prestige());
    const rec = PR.receiverActive(s()); if (rec && !lastReceiver) receiverships++; lastReceiver = rec;
    if (winYear < 0 && PR.earned(s(), 'flagship')) winYear = year();
    const m = BSU.dayParts(d).month;
    if (m !== lastMonth) { lastMonth = m; try { monthly(); } catch (e) { note('policy error: ' + (e && e.message)); } }
    if (year() !== lastYear) { lastYear = year(); record(); }
  }
  if (rows.length < years) record();
  const errors = BSU.errors ? Array.from(BSU.errors.entries()).map(([k, v]) => k + ' ×' + v) : [];
  let diag = null;
  if (has('diag')) {
    // end-of-run diagnosis: what is flooded and why, the ring, the prestige / happiness / ecology terms
    const st = s(), tl = st.tiles, w = W();
    const typeName = ['water', 'bayou', 'marsh', 'wet', 'dry', 'high', 'drained', 'pond'];
    const byType = {}, byTypeFlooded = {}; let pilings = 0, sunk = 0, flooded = [];
    for (const b of list()) {
      if (!b) continue;
      const foot = BSU.footprintTiles(b.tx, b.ty, b.w, b.h); let lo = 99, t0 = 0; for (const i of foot) { if (tl.elev[i] < lo) { lo = tl.elev[i]; t0 = tl.type[i]; } }
      const key = typeName[t0] || t0; byType[key] = (byType[key] || 0) + 1;
      if (b.pilings) pilings++; if (fin(b.sunk, 0) >= 1) sunk++;
      if (b.flooded) { byTypeFlooded[key] = (byTypeFlooded[key] || 0) + 1; if (flooded.length < 12) flooded.push({ id: b.id, type: b.type, depth: Math.round(HY.footprintDepth(st, b.id) * 10) / 10, elev: Math.round(lo * 10) / 10, terrain: key, pilings: !!b.pilings, sunk: Math.round(fin(b.sunk, 0) * 10) / 10, hp: Math.round(fin(b.hp, 1) * 100) / 100, ruin: !!b.ruin }); }
    }
    let crest = 0, integ = 0, drained = 0, marsh = 0, preserve = 0, wetFlood = 0;
    for (let i = 0; i < tl.crest.length; i++) { if (tl.crest[i] > 0) { crest++; integ += tl.integrity[i]; } if (tl.flags[i] & BSU.FLAG.DRAINED) drained++; if (tl.type[i] === BSU.T.MARSH) marsh++; if (tl.flags[i] & BSU.FLAG.PRESERVE) preserve++; if (tl.depth[i] >= 0.5 && tl.type[i] >= BSU.T.WET) wetFlood++; }
    const bd = (k) => { try { const b = E.breakdown(st, k); return b && b.lines ? b.lines.map((l) => l.label + ':' + Math.round(l.value * 10) / 10).join(' ') : ''; } catch (e) { return 'n/a'; } };
    diag = {
      date: BSU.formatDate(day()), hydro: { riverStage: st.hydro.riverStage, bayouStage: st.hydro.bayouStage, surge: st.hydro.surge ? 'yes' : 'no', floodedTiles: HY.floodedTiles(st), floodedLand: wetFlood },
      buildings: { total: list().length, byTerrain: byType, floodedByTerrain: byTypeFlooded, pilings, sunk, floodedNow: HY.floodedBuildings(st).length, unrepaired: fin(B.stats(st).unrepaired, 0), sample: flooded },
      levees: { crestTiles: crest, meanIntegrity: crest ? Math.round(integ / crest) : 0, ringClosed5: B.ringClosed(st, 5), ringClosed8: B.ringClosed(st, 8), gaps5: (B.gaps(st, 5).gaps || []).length, pumps: list('pump').length, pumpsRunning: fin(B.stats(st).pumpsRunning, 0) },
      land: { drained, marsh, preserve, filled: fin(st.fill && st.fill.done, 0) },
      prestigeTerms: st.economy.targets && st.economy.targets.terms, happiness: bd('happiness'), ecology: bd('ecology'), applicants: bd('applicants'),
      sports: { venue: st.sports.venue, rating: st.sports.rating, coach: st.sports.coach && st.sports.coach.stars }, wildlife: { mosq: st.wildlife && st.wildlife.mosqIndex, sick: st.wildlife && st.wildlife.sick }
    };
  }
  return { size, seed, policy, years, rows, winYear, receiverships, cards: flagsOut.cards, sectionsBought: flagsOut.sectionsBought, log, errors, diag };
}

// ---------------------------------------------------------------------------------------------------------------------
// Parent: fan out, tables, medians, asserts
// ---------------------------------------------------------------------------------------------------------------------
function fmtMoney(n) { const a = Math.abs(n); const sgn = n < 0 ? '-' : ''; if (a >= 1e6) return sgn + (a / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return sgn + Math.round(a / 1e3) + 'k'; return sgn + String(Math.round(a)); }
function table(run) {
  const head = ['yr', 'cash', 'income', 'expense', 'upkeep', 'build', 'stud', 'appl', 'beds', 'seats', 'dining', 'ww', 'prest', 'tgt', 'happy', 'eco', 'rec', 'sec', 'bld', 'ms', 'flood', 'dmg', 'storms', 'goal', 'tuit', 'qual'];
  const lines = [head.join('\t')];
  for (const r of run.rows) lines.push([r.year, fmtMoney(r.cash), fmtMoney(r.income), fmtMoney(r.expense), fmtMoney(r.upkeep), fmtMoney(r.construction), r.students, r.applicants, r.beds, r.seats, r.dining, r.wastewater, r.prestige, r.target, r.happiness, r.ecology, r.record, r.sections, r.buildings, r.milestones + (r.newMilestones.length ? '(' + r.newMilestones.join(',') + ')' : ''), r.flooded, r.damaged, r.storms.join(' ') || '-', r.goal, r.tuition, r.quality[0]].join('\t'));
  return lines.join('\n');
}
function median(a) { const b = a.slice().sort((x, y) => x - y); if (!b.length) return NaN; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function summarize(runs, years) {
  const out = [];
  const by = new Map();
  for (const r of runs) { const k = r.size + '/' + r.policy; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const summary = {};
  for (const [k, rs] of by) {
    const wins = rs.map((r) => r.winYear > 0 ? r.winYear : years + 1);
    const endRows = rs.map((r) => r.rows[r.rows.length - 1]);
    const stat = (f) => { const v = rs.map(f); return { median: median(v), worst: Math.min(...v), best: Math.max(...v) }; };
    const st = {
      runs: rs.length, winMedian: median(wins), winWorst: Math.max(...wins), winBest: Math.min(...wins), wins: rs.map((r) => r.winYear),
      students: stat((r) => r.rows[r.rows.length - 1].students), prestige: stat((r) => r.rows[r.rows.length - 1].prestige), cash: stat((r) => r.rows[r.rows.length - 1].cash),
      minCash: stat((r) => Math.min(...r.rows.map((x) => x.minCash))), minStudents: stat((r) => Math.min(...r.rows.map((x) => x.minStudents))),
      receiverships: rs.reduce((a, r) => a + r.receiverships, 0), bankruptcyCards: rs.reduce((a, r) => a + r.cards.filter((c) => c.kind === 'bankruptcy').length, 0), underwater: rs.reduce((a, r) => a + r.cards.filter((c) => c.kind === 'underwater').length, 0),
      y5students: stat((r) => (r.rows[4] || endRows[0]).students), y5prestige: stat((r) => (r.rows[4] || endRows[0]).prestige), y5cash: stat((r) => (r.rows[4] || endRows[0]).cash),
      y10students: stat((r) => (r.rows[9] || endRows[0]).students), y10prestige: stat((r) => (r.rows[9] || endRows[0]).prestige),
      recovery: recovery(rs), errors: rs.reduce((a, r) => a + r.errors.length, 0)
    };
    summary[k] = st;
    out.push(`${k}: runs ${st.runs} | win yr median ${st.winMedian}${st.winMedian > years ? ' (none within ' + years + ')' : ''} best ${st.winBest} worst ${st.winWorst} [${st.wins.join(',')}] | Y5 students ${st.y5students.median} prestige ${st.y5prestige.median} cash ${fmtMoney(st.y5cash.median)} | Y10 students ${st.y10students.median} prestige ${st.y10prestige.median} | end students ${st.students.median} (worst ${st.students.worst}) prestige ${st.prestige.median} (worst ${st.prestige.worst}) cash ${fmtMoney(st.cash.median)} (worst ${fmtMoney(st.cash.worst)}) | min cash ${fmtMoney(st.minCash.worst)} min students ${st.minStudents.worst} | bankruptcy cards ${st.bankruptcyCards} receiverships ${st.receiverships} underwater ${st.underwater} | hits ${st.recovery.hits} recovered≤2y ${st.recovery.recovered} unrecovered ${st.recovery.unrecovered} | BSU.errors ${st.errors}`);
  }
  return { text: out.join('\n'), summary };
}
/** direct hits (a non-near-miss landfall with damage) and whether students and prestige were back to the pre-storm year's level within two seasons */
function recovery(rs) {
  let hits = 0, recovered = 0, unrecovered = 0;
  for (const r of rs) for (let i = 0; i < r.rows.length; i++) {
    const row = r.rows[i];
    // a hit = a landfall that breached or overtopped, billed ≥ $200k, or flooded a building
    const hit = row.flooded > 0 || row.storms.some((x) => x.includes('!') || (x.includes('$') && parseInt(x.split('$')[1], 10) >= 200));
    if (!hit) continue;
    hits++;
    const base = i > 0 ? r.rows[i - 1] : row;
    const later = r.rows.slice(i + 1, i + 3);
    if (!later.length) continue;   // the last year: not judged
    // shrugged off: the hit year itself did not dent students (−3 %) or prestige (−3) against the year before
    const shrugged = row.students >= base.students * 0.97 && row.prestige >= base.prestige - 3;
    const ok = shrugged || later.some((x) => x.students >= Math.min(base.students, row.students) * 0.95 && x.prestige >= Math.min(base.prestige, row.prestige) - 3);
    if (ok) recovered++; else unrecovered++;
  }
  return { hits, recovered, unrecovered };
}
function assertBands(summary, years) {
  const fails = [];
  for (const [k, st] of Object.entries(summary)) {
    const pol = k.split('/')[1], b = BANDS[pol]; if (!b) continue;
    if (b.winMin !== undefined && !(st.winMedian >= b.winMin)) fails.push(`${k}: median years to win ${st.winMedian} < ${b.winMin}`);
    if (b.winMax !== undefined && !(st.winMedian <= b.winMax)) fails.push(`${k}: median years to win ${st.winMedian} > ${b.winMax}` + (st.winMedian > years ? ' (no win within ' + years + ' years)' : ''));
    if (b.noDeath && (st.receiverships > 0 || st.minStudents.worst < 100)) fails.push(`${k}: passive died (receiverships ${st.receiverships}, min students ${st.minStudents.worst})`);
    if (b.recoverYears && st.recovery.unrecovered > Math.floor(st.recovery.hits * 0.25)) fails.push(`${k}: ${st.recovery.unrecovered} of ${st.recovery.hits} direct hits not recovered within ${b.recoverYears} seasons`);
    if (st.errors > 0) fails.push(`${k}: ${st.errors} BSU.error signatures`);
  }
  return fails;
}

async function main() {
  if (has('worker')) {
    const r = await runOne({ size: Number(flag('size', 96)) === 64 ? 64 : 96, seed: Number(flag('seed', 1)) >>> 0, years: YEARS, policy: flag('policy', 'goals') });
    process.stdout.write(JSON.stringify(r) + '\n');
    return;
  }
  // --from out.json: re-judge a saved sweep (the tables, medians and --assert) without running it again
  if (flag('from', null)) {
    const saved = JSON.parse(readFileSync(flag('from', null), 'utf8'));
    const picked = saved.results.filter((r) => SIZES.includes(r.size) && POLS.includes(r.policy));
    const { text, summary } = summarize(picked, saved.years);
    console.log(`=== summary of ${flag('from', null)} (${picked.length} runs, ${saved.years} years) ===\n` + text);
    if (has('assert')) { const fails = assertBands(summary, saved.years); if (fails.length) { console.error('\nASSERT FAILED:\n' + fails.join('\n')); process.exit(1); } console.log('\nASSERT OK: every pacing band holds'); }
    return;
  }
  const jobs = [];
  for (const size of SIZES) for (const policy of POLS) for (let k = 0; k < NSEEDS; k++) jobs.push({ size, policy, seed: (SEED0 + k) >>> 0 });
  const results = [];
  let next = 0, active = 0;
  await new Promise((resolve) => {
    const launch = () => {
      while (active < JOBS && next < jobs.length) {
        const j = jobs[next++]; active++;
        const t0 = Date.now();
        const args = [fileURLToPath(import.meta.url), '--worker', '--size', String(j.size), '--seed', String(j.seed), '--years', String(YEARS), '--policy', j.policy];
        if (flag('tune', '')) args.push('--tune', flag('tune', ''));
        if (has('diag')) args.push('--diag');
        const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', (d) => { buf += d; });
        child.on('close', (code) => {
          active--;
          try { const line = buf.trim().split('\n').pop(); const r = JSON.parse(line); results.push(r); if (!QUIET) { console.log(`\n=== ${j.policy} @ ${j.size} seed ${j.seed} (${Math.round((Date.now() - t0) / 1000)} s) win year ${r.winYear > 0 ? r.winYear : 'none'} ===`); console.log(table(r)); if (r.errors.length) console.log('BSU.errors:', r.errors.join('; ')); console.log('actions:', r.log.slice(0, 60).join(' | ')); if (r.diag) console.log('diag:', JSON.stringify(r.diag)); } }
          catch (e) { console.error(`worker ${j.policy}@${j.size}#${j.seed} failed (exit ${code}): ${e.message}`); }
          if (next < jobs.length) launch(); else if (active === 0) resolve();
        });
      }
    };
    launch();
  });
  results.sort((a, b) => (a.size - b.size) || POLICIES.indexOf(a.policy) - POLICIES.indexOf(b.policy) || (a.seed - b.seed));
  const { text, summary } = summarize(results, YEARS);
  console.log('\n=== summary (medians over seeds; worst = the seed that did worst) ===');
  console.log(text);
  const out = flag('json', null); if (out) writeFileSync(out, JSON.stringify({ years: YEARS, results, summary }, null, 1));
  if (has('assert')) {
    const fails = assertBands(summary, YEARS);
    if (fails.length) { console.error('\nASSERT FAILED:\n' + fails.join('\n')); process.exit(1); }
    console.log('\nASSERT OK: every pacing band holds');
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
