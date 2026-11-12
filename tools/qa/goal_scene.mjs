// Goal pass scene (Josh's "Preserve it" playtest note): arms the Wetland Preserve, drags a rectangle over legal marsh, and shoots the ghost
// mid-drag and the result; then checks the tool is still armed, the tiles are painted and Objective 16's live count moved.
// Usage: node tools/qa/goal_scene.mjs [--size 96] [--out tools/qa/out] [--prefix goal-]   (one headless Chrome; exit 1 on a problem)
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';
const args = parseArgs(process.argv.slice(2), { size: 96, out: DEFAULT_OUT, prefix: 'goal-' });
killStrays();
let problems = 0; const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true });
try {
  await g.buildCampus({ target: 12, days: 10, students: 400 });
  // the largest block of legal marsh: a 5 x 4 rectangle whose every tile takes the Preserve
  const spot = await g.eval(`(function () {
    var s = BSU.state, B = BSU.buildings, W = BSU.map ? BSU.map.W : Math.round(Math.sqrt(s.tiles.type.length)), H = s.tiles.type.length / W;
    function okAt(x, y) { var r = B.canPlace(s, 'preserve', x, y, { ignoreCash: true }); return !!(r && r.ok); }
    for (var y = 2; y < H - 6; y++) for (var x = 2; x < W - 7; x++) { var all = true; for (var dy = 0; dy < 4 && all; dy++) for (var dx = 0; dx < 5 && all; dx++) if (!okAt(x + dx, y + dy)) all = false; if (all) return { x: x, y: y, W: W }; }
    return null; })()`);
  if (!spot) { bad('no 5 x 4 block of paintable marsh on this map'); }
  else {
    await g.eval(`BSU.render.panToTile(${spot.x + 2}, ${spot.y + 2}, false)`); await g.settleCamera();
    await g.eval(`BSU.ui.selectTool('preserve')`); await sleep(150);
    const a = await g.tilePx(spot.x, spot.y), b = await g.tilePx(spot.x + 4, spot.y + 3);
    const before = await g.eval(`BSU.progress.goalProgress(BSU.state, '16').progress`);
    const P = (t, p) => g.eval('BSU.ui.pointer(\'' + t + '\', ' + Math.round(p.x) + ', ' + Math.round(p.y) + ', 0, { ctrl: false, shift: false, meta: false, alt: false })');
    await P('move', a); await P('down', a); await P('move', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); await P('move', b);
    await sleep(300);
    console.log('shot', await g.shot('goal-' + '1-preserve-drag-ghost'));
    const label = await g.elText('#ghost-label'); console.log('  ghost label: ' + JSON.stringify(label));
    await P('up', b);
    await sleep(300);
    console.log('shot', await g.shot('goal-' + '2-preserve-painted'));
    const res = await g.eval(`(function () { var s = BSU.state, W = ${spot.W}, n = 0; for (var dy = 0; dy < 4; dy++) for (var dx = 0; dx < 5; dx++) if (s.tiles.flags[(${spot.y} + dy) * W + ${spot.x} + dx] & BSU.FLAG.PRESERVE) n++; return { n: n, tool: s.ui.tool ? s.ui.tool.id : null, prog: BSU.progress.goalProgress(s, '16').progress }; })()`);
    console.log('  painted ' + res.n + ' / 20 in the rectangle · tool ' + res.tool + ' · Objective 16 count ' + before + ' -> ' + res.prog);
    if (res.n !== 20) bad('the drag painted ' + res.n + ' tiles, expected 20');
    if (res.tool !== 'preserve') bad('the Preserve did not stay armed (tool ' + res.tool + ')');
    if (res.prog !== Math.min(20, before + res.n)) bad('Objective 16 did not count the tiles');
  }
  const errs = await g.bsuErrors(); if (errs && errs.length) bad('BSU errors: ' + JSON.stringify(errs).slice(0, 300));
} finally { await g.close(); }
killStrays();
console.log(problems ? problems + ' problem(s)' : 'ALL OK');
process.exit(problems ? 1 : 0);
