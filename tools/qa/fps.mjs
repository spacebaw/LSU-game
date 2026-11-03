#!/usr/bin/env node
// Frame profiler: a dense campus (~40 buildings placed through BSU.headless), the viewport fully on the map at zoom 1, dpr 2 by default,
// a 150-frame rAF sample after the HD chunk bake settles. Prints frameMsMean, fps, draw calls, chunks, agents, memMB and the per-pass
// perf().passMs table. Headless Chrome is software raster: read deltas (--compare), not absolute numbers.
//
//   node tools/qa/fps.mjs [--size 96|64] [--dpr 2] [--zoom 1] [--night] [--index path] [--frames 150] [--runs 1]
//                         [--width 1440] [--height 900] [--buildings 46]   (46 placements = about 38 buildings + 8 plants) [--shot name] [--out dir]
//   node tools/qa/fps.mjs --compare pathA pathB [same flags]     (A/B: runs both, prints the delta per row)
//
// A/B against HEAD:  git show HEAD:bayou-state/index.html > /tmp/x.html && node tools/qa/fps.mjs --compare /tmp/x.html index.html
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, row, sleep } from './lib.mjs';

// --compare takes two paths: pull them out before the generic parser sees them
const argv = process.argv.slice(2);
let compare = null;
const ci = argv.indexOf('--compare');
if (ci >= 0) { compare = argv.slice(ci + 1, ci + 3); if (compare.length < 2 || compare.some((x) => x.startsWith('--'))) { console.error('--compare needs two paths: --compare pathA pathB'); process.exit(2); } argv.splice(ci, 3); }
const args = parseArgs(argv, {
  size: { type: 'num', def: 96 }, dpr: { type: 'num', def: 2 }, zoom: { type: 'num', def: 1 }, night: { type: 'bool', def: false },
  index: { type: 'str', def: '' }, frames: { type: 'num', def: 150 }, runs: { type: 'num', def: 1 },
  width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 }, buildings: { type: 'num', def: 46 },
  shot: { type: 'str', def: '' }, out: { type: 'str', def: DEFAULT_OUT },
});
if (args.size !== 64 && args.size !== 96) { console.error('--size must be 64 or 96'); process.exit(2); }

/** one measurement: fresh Chrome, dense campus, bake, sample. Returns { rows: {name: number}, passes: {name: ms}, info } */
async function measure(index) {
  const g = await openGame({ index, width: args.width, height: args.height, size: args.size, dpr: args.dpr, outDir: args.out, noGuard: true });
  try {
    const mark = await g.mark();
    const campus = await g.buildCampus({ target: args.buildings, stadium: args.night });
    if (args.night) await g.startNightGame();
    await g.noGuard();   // newGame resets state.ui.perfMode; keep the 25 ms guardrail off for the measurement
    const view = await g.frameCampus(args.zoom);
    const bake = await g.waitBake({ timeoutMs: 60000 });
    const sky = args.night ? await g.eval(`BSU.weather.sky(BSU.state).phase`) : null;
    const p = await g.sample(args.frames, { settle: 30 });
    if (args.shot) await g.shot(args.shot + (compare ? '-' + (index === compare[0] ? 'A' : 'B') : ''));
    const errors = await g.errorsSince(mark);
    const rows = {
      frameMsMean: p.frameMsMean, frameMsP95: p.frameMsP95, fps: p.fps, drawCalls: p.drawCalls, chunks: p.chunks, agentsDrawn: p.agentsDrawn,
      memMB: p.memMB, chunkMB: p.chunkMB, hdChunks: p.hdChunks, particles: p.particles, water: p.water, tcacheHitPct: p.tcHitPct, tcacheBuilds: p.tcBuilds, chunkBakesM1: p.bakes1, chunkBakesM2: p.bakes2,
    };
    const hdOk = await g.eval(`(function () { var i = BSU.render.hdInfo(); return { hd: i.on, master: i.chunkMaster, fallback: i.fallback }; })()`);
    return {
      rows, passes: p.passMs || {}, errors,
      info: { buildings: campus.count, placements: campus.placements, inView: view.inView, onMap: view.onMap, bake: bake.ok ? `ok ${(bake.ms / 1000).toFixed(1)}s${bake.settled ? `, ${bake.pending} chunk(s) held at master 1 by the HD cap` : ''}` : `TIMEOUT (${bake.pending} pending)`, perfMode: p.perfMode, dpr: p.dpr, zoom: p.zoom, hd: hdOk, nightSky: sky, tcacheMB: p.tcacheMB },
    };
  } finally { await g.close(); }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function merge(results) {
  const rows = {}, passes = {};
  for (const k of Object.keys(results[0].rows)) rows[k] = mean(results.map((r) => r.rows[k] || 0));
  for (const k of new Set(results.flatMap((r) => Object.keys(r.passes)))) passes[k] = mean(results.map((r) => r.passes[k] || 0));
  return { rows, passes, info: results[0].info, errors: results.flatMap((r) => r.errors), perRun: results.map((r) => r.rows.frameMsMean) };
}
const f2 = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
const header = (label, r) => `${label}: ${args.size}-map  dpr ${r.info.dpr}  zoom ${r.info.zoom}  ${args.width}x${args.height}  ${args.frames} frames${args.night ? `  NIGHT (sky phase ${r.info.nightSky}${r.info.nightSky === 4 ? ' = night' : ', NOT night'})` : ''}  ${r.info.buildings} buildings + ${r.info.placements - r.info.buildings} plants (${r.info.inView} buildings in view${r.info.onMap ? ', viewport on map' : ', viewport NOT fully on map'})  bake ${r.info.bake}${r.info.perfMode ? '  PERF MODE ON' : ''}${args.runs > 1 ? '  frameMs per run: ' + r.perRun.map(f2).join(' ') : ''}`;

let exitCode = 0;
if (!compare) {
  const index = resolveIndex(args.index);
  const res = []; for (let i = 0; i < args.runs; i++) res.push(await measure(index));
  const r = merge(res);
  console.log(header('fps', r));
  for (const [k, v] of Object.entries(r.rows)) console.log('  ' + row([k, f2(v)], [14, 10]));
  console.log('  passMs (smoothed CPU ms per pass; it blames the pass that flushes the raster, so read A/B, not absolutes):');
  for (const [k, v] of Object.entries(r.passes).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.005)) console.log('    ' + row([k, f2(v)], [14, 10]));
  if (r.errors.length) { console.log('  ERRORS:'); for (const e of r.errors.slice(0, 6)) console.log('    ' + e); exitCode = 1; }
} else {
  const [ia, ib] = compare.map((p) => resolveIndex(p));
  const A = [], B = [];
  for (let i = 0; i < args.runs; i++) { A.push(await measure(ia)); B.push(await measure(ib)); }   // interleaved: drift hits both alike
  const a = merge(A), b = merge(B);
  console.log(header('A ', a)); console.log(header('B ', b));
  console.log('  A = ' + compare[0] + '\n  B = ' + compare[1]);
  const W = [14, 10, 10, 10, 8];
  const line = (k, x, y) => { const d = y - x; const pct = x ? (d / x) * 100 : 0; console.log('  ' + row([k, f2(x), f2(y), (d >= 0 ? '+' : '') + f2(d), (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'], W)); };
  console.log('  ' + row(['', 'A', 'B', 'B - A', ''], W));
  for (const k of Object.keys(a.rows)) line(k, a.rows[k], b.rows[k]);
  console.log('  passMs:');
  const names = [...new Set([...Object.keys(a.passes), ...Object.keys(b.passes)])].filter((k) => Math.max(a.passes[k] || 0, b.passes[k] || 0) >= 0.005).sort((x, y) => Math.max(b.passes[y] || 0, a.passes[y] || 0) - Math.max(b.passes[x] || 0, a.passes[x] || 0));
  for (const k of names) line('  ' + k, a.passes[k] || 0, b.passes[k] || 0);
  for (const [lab, r] of [['A', a], ['B', b]]) if (r.errors.length) { console.log(`  ${lab} ERRORS:`); for (const e of r.errors.slice(0, 6)) console.log('    ' + e); exitCode = 1; }
}
killStrays();
void sleep;
process.exit(exitCode);
