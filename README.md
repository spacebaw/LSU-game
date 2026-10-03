# Bayou State (working title)

A SimCity-style university builder set in a Louisiana swamp. One self-contained `index.html`.

- `index.html` — the game. Open it in Chrome or Safari. No install, no network.
- `src/` — source modules; `node build.mjs --check` concatenates them into `index.html`.
- `docs/GDD.md` — game design document. `docs/ARCHITECTURE.md` — module contracts.
- `test/` — headless Node smoke tests for the simulation core.
