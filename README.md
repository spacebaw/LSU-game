# Bayou State

A university-building game: charter a campus on one dry ridge in a Louisiana swamp, keep it above the water, and grow it into a flagship.
Built by an LSU instructor with Claude Code for his students; the university is fictional. Play it: https://spacebaw.github.io/LSU-game/

One self-contained `index.html`.

- `index.html` — the game. Open it in Chrome or Safari. No install, no network.
- `src/` — source modules; `node build.mjs --check` concatenates them into `index.html`.
- `docs/GDD.md` — game design document. `docs/ARCHITECTURE.md` — module contracts.
- `test/` — headless Node smoke tests for the simulation core.
