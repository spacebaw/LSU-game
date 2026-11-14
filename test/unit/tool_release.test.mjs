// Unit test for the release pass (Josh, 2026-11-14): "once I click it once to either build or get rejected from trying to build it, go
// back to the mouse." One click ends a click-placement whether it built or was refused; the refusal reason is a snackbar (the ghost label
// goes with the tool). The tool is kept only by Shift, by a locked (tutorial) tool, after a success while a counted goal still wants more
// (keepArmed, goal pass), or after a miss by the bulldozer (a mode: its click never "places"). A run nothing of which could be paid for
// drops its tool too; a run refused for its ground keeps it (drag again elsewhere).
// Usage: node build.mjs --check && node test/unit/tool_release.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui;
const M0 = { ctrl: false, shift: false, meta: false, alt: false }, SH = { ctrl: false, shift: true, meta: false, alt: false };
const T = (x, y) => ({ px: x * 20 + 10, py: y * 11 + 5 });

// --- the machine --------------------------------------------------------------------------------------------------------------------------
console.log('--- machine: click placements ---');
{
  let tool = null, placed = true, locked = false, keep = false, miss = false, clicks = 0, hidden = 0;
  const m = U._machine({ getTool: () => tool, setTool: t => { tool = t; }, place: () => { clicks++; return placed; }, locked: () => locked, keepArmed: () => keep, stayOnMiss: () => miss, ghost: (px) => { if (px == null) hidden++; } });
  const arm = (id) => m.step({ type: 'tool', id: id || 'dorm' });
  const click = (mods) => { m.step({ type: 'down', ...T(5, 5), button: 0, mods: mods || M0 }); m.step({ type: 'up', ...T(5, 5), button: 0, mods: mods || M0 }); };

  arm(); placed = true; click();
  ok(tool === null && m.state === 'IDLE' && clicks === 1, 'a click that builds drops the tool (as before)');
  arm(); placed = false; hidden = 0; click();
  ok(tool === null && m.state === 'IDLE', 'a click that is refused drops the tool too (it used to stay armed)');
  ok(hidden >= 1, 'and the ghost goes with it');
  arm(); placed = false; click(SH);
  ok(tool && tool.id === 'dorm' && m.state === 'PLACING', 'Shift held: a refused click keeps the tool');
  placed = true; click(SH);
  ok(tool && tool.id === 'dorm', 'Shift held: a built click keeps it (place several)');
  placed = false; locked = true; click();
  ok(tool && tool.id === 'dorm', 'a locked (tutorial) tool survives a refused click');
  locked = false; miss = true; click();
  ok(tool && tool.id === 'dorm', 'stayOnMiss (the bulldozer) survives its clicks');
  miss = false; placed = true; keep = true; click();
  ok(tool && tool.id === 'dorm', 'keepArmed (a counted goal) keeps the tool after a success');
  placed = false; click();
  ok(tool === null, 'but a refused click drops it even under a counted goal');
  const bare = (() => { let t = null; const mm = U._machine({ getTool: () => t, setTool: x => { t = x; }, place: () => false }); mm.step({ type: 'tool', id: 'dorm' }); mm.step({ type: 'down', ...T(5, 5), button: 0, mods: M0 }); mm.step({ type: 'up', ...T(5, 5), button: 0, mods: M0 }); return t; })();
  ok(bare === null, 'a machine without the optional callbacks drops the tool on a refused click');
}
console.log('--- machine: runs ---');
{
  let tool = null, ret, locked = false; const runs = [];
  const m = U._machine({ getTool: () => tool, setTool: t => { tool = t; }, placeRun: r => { runs.push(r.length); return ret; }, locked: () => locked });
  const drag = () => { m.step({ type: 'down', ...T(5, 5), button: 0, mods: M0 }); m.step({ type: 'move', ...T(8, 5), button: 0, mods: M0 }); m.step({ type: 'up', ...T(8, 5), button: 0, mods: M0 }); };
  m.step({ type: 'tool', id: 'path' }); ret = undefined; drag();
  ok(tool && tool.id === 'path' && m.state === 'PLACING' && runs[0] === 4, 'a run that lays (or is refused for its ground) keeps the tool: drag again');
  ret = 'drop'; drag();
  ok(tool === null && m.state === 'IDLE', "placeRun → 'drop' (nothing laid for want of cash) drops the tool");
  m.step({ type: 'tool', id: 'path' }); locked = true; drag();
  ok(tool && tool.id === 'path', 'a locked tool survives it');
}

// --- the live game ---------------------------------------------------------------------------------------------------------------------------
console.log('--- live: a refused click ---');
{
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const s = BSU.state; U.showTitle(false); U.update(s, 50);
  const R = BSU.render, B = BSU.buildings, W = 64;
  const snacks = () => { const sn = U._snacks(); return sn.visible.concat(sn.queued).map(n => n.text); };
  const clickAt = (px, py) => { U.pointer('move', px, py, 0, M0); U.pointer('down', px, py, 0, M0); U.pointer('up', px, py, 0, M0); };
  // a site the Dorm can take, found through the API, clicked through the pointer
  let site = null;
  for (let i = 0; i < W * W && !site; i++) { const x = i % W, y = (i / W) | 0, r = B.canPlace(s, 'dorm', x, y, {}); if (r && r.ok) { const p = R.tileToScreen(x, y); if (p && p.x > 40 && p.y > 80 && p.x < 1200 && p.y < 640) site = { x, y, px: Math.round(p.x), py: Math.round(p.y) }; } }
  ok(!!site, 'a legal Dorm site is on screen: ' + JSON.stringify(site));
  U.selectTool(s, 'dorm');
  ok(s.ui.tool && s.ui.tool.id === 'dorm', 'the Freshman Dorm is armed');
  const n0 = B.list(s, 'dorm').length; clickAt(site.px, site.py);
  ok(B.list(s, 'dorm').length === n0 + 1 && s.ui.tool === null, 'one click builds it and goes back to the mouse');
  // the same spot again: occupied → refused → back to the mouse, the reason in a snackbar, nothing charged
  U.selectTool(s, 'dorm'); const cash0 = s.economy.cash; clickAt(site.px, site.py);
  ok(B.list(s, 'dorm').length === n0 + 1 && s.economy.cash === cash0, 'a click on the occupied site builds nothing and charges nothing');
  ok(s.ui.tool === null && U.state !== 'PLACING', 'the refused click goes back to the mouse (tool ' + (s.ui.tool && s.ui.tool.id) + ', state ' + U.state + ')');
  ok(snacks().some(t => /^Freshman Dorm: /.test(t)), 'the reason is a snackbar: ' + JSON.stringify(snacks()));
  // Shift held: the refused click keeps the tool
  U.selectTool(s, 'dorm'); U.pointer('move', site.px, site.py, 0, SH); U.pointer('down', site.px, site.py, 0, SH); U.pointer('up', site.px, site.py, 0, SH);
  ok(s.ui.tool && s.ui.tool.id === 'dorm', 'Shift held: the refused click keeps the Dorm armed');
  U.selectTool(s, null);

  // no money at all (past the loan line): a legal site, refused for cash → back to the mouse
  let site2 = null;
  for (let i = 0; i < W * W && !site2; i++) { const x = i % W, y = (i / W) | 0, r = B.canPlace(s, 'dorm', x, y, { ignoreCash: true }); if (r && r.ok) { const p = R.tileToScreen(x, y); if (p && p.x > 40 && p.y > 80 && p.x < 1200 && p.y < 640) site2 = { x, y, px: Math.round(p.x), py: Math.round(p.y) }; } }
  s.economy.cash = -1e12;
  const broke = site2 ? B.canPlace(s, 'dorm', site2.x, site2.y, {}) : null;
  ok(site2 && broke && broke.ok === false && /cash/i.test(broke.reason || ''), 'with the cash gone the Dorm is refused for cash: ' + (broke && broke.reason));
  U.selectTool(s, 'dorm'); clickAt(site2.px, site2.py);
  ok(s.ui.tool === null, 'no money: one click and the tool is gone (it used to stay on the cursor)');
  ok(snacks().some(t => /^Freshman Dorm: .*cash/i.test(t)), 'and the snackbar says why: ' + JSON.stringify(snacks()));

  U.selectTool(s, 'bulldoze'); clickAt(40, 700);
  ok(s.ui.tool && s.ui.tool.id === 'bulldoze', 'the bulldozer stays selected after its click');
  U.selectTool(s, null);

  // a path run nothing of which can be paid for → the tool drops, the reason in a snackbar
  let run = null;
  for (let i = 0; i < W * W && !run; i++) { const x = i % W, y = (i / W) | 0; if (x > W - 4) continue; let all = true; for (let d = 0; d < 3 && all; d++) { const r = B.canPlace(s, 'path', x + d, y, { ignoreCash: true }); if (!(r && r.ok)) all = false; } if (all) { const p = R.tileToScreen(x, y), q = R.tileToScreen(x + 2, y); if (p && q && p.x > 40 && p.y > 80 && q.x < 1200 && q.y < 640 && q.x > 40 && q.y > 80 && p.x < 1200 && p.y < 640) run = { px: Math.round(p.x), py: Math.round(p.y), qx: Math.round(q.x), qy: Math.round(q.y) }; } }
  ok(!!run, 'a legal 3-tile path run is on screen');
  U.selectTool(s, 'path');
  U.pointer('move', run.px, run.py, 0, M0); U.pointer('down', run.px, run.py, 0, M0); U.pointer('move', run.qx, run.qy, 0, M0); U.pointer('up', run.qx, run.qy, 0, M0);
  ok(s.ui.tool === null, 'a path run with no money lays nothing and drops the tool (tool ' + (s.ui.tool && s.ui.tool.id) + ')');
  ok(snacks().some(t => /^Gravel Path: .*cash/i.test(t)), 'with its reason: ' + JSON.stringify(snacks()));
  // with money, the same run lays and the tool stays for the next drag
  s.economy.cash = 5e6; U.selectTool(s, 'path');
  U.pointer('move', run.px, run.py, 0, M0); U.pointer('down', run.px, run.py, 0, M0); U.pointer('move', run.qx, run.qy, 0, M0); U.pointer('up', run.qx, run.qy, 0, M0);
  ok(s.ui.tool && s.ui.tool.id === 'path', 'with money the run lays and the path tool stays armed for the next drag');
  U.selectTool(s, null);
  ok(BSU.errors.size === 0 || [...BSU.errors.keys()].every(k => !/^ui\|/.test(k)), 'no ui error');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
