# Testing (three harnesses, all dependency-free)

1. **Syntax + build**: `node build.mjs --check` — syntax-checks every module in `src/manifest.json`, joins them with `;` and syntax-checks the concatenated bundle too (a missing trailing semicolon in one file cannot break the next), refuses external references, writes `index.html`.
2. **Headless Node** (fast, no browser): `node test/smoke.mjs` boots `index.html` through `test/domstub.mjs`
   (fake DOM, no-op canvas, no AudioContext, in-memory localStorage), starts a game, ticks years, places
   buildings, forces a hurricane, renders frames, saves/loads, and scans the LIVE state for NaN/Infinity
   (no field of `BSU.state` may ever be non-finite; open-ended durations are `-1`). `node test/modules.mjs`
   runs every `BSU.<module>.selfTest()` with `BSU.SELFTEST = true` around each call (so `BSU.assert`,
   `BSU.error` and listener exceptions throw), fails a module whose `BSU.errors` count grew, and runs
   `session` last (its selfTest swaps and restores the live game). Contract: `docs/HEADLESS_API.md`.
   The stub's exact DOM/canvas surface (and the forbidden list) is the table in ARCHITECTURE.md §7.
   To test ONE module in isolation before the whole game exists, write a scratch script that loads
   `contract.js` (+ `data.js`) and your module with `vm.runInContext` using `makeWindow()` from domstub.
3. **Real Chrome** (truth for rendering/UI/perf): `node test/browser.mjs --wait 4000 --shot /tmp/x.png --fps`
   launches the installed Google Chrome headless over the DevTools protocol, loads `index.html` via
   `file://`, reports console errors and uncaught exceptions (non-zero exit), evaluates expressions
   (`--eval "BSU.headless.snapshot()"`), dispatches clicks/keys (`--click 640,400 --key Escape`), and
   screenshots. Import `launch()` from it for scripted tours. Each run uses its own Chrome instance and
   random debug port, so many can run in parallel. Look at the PNG you produced (Read the image file).

Rules for every module: no exception may escape a tick or a frame; guard optional browser features;
`node build.mjs --check && node test/smoke.mjs && node test/modules.mjs` must pass before you claim done.
