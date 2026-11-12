# Bayou State

A university-building game: charter a campus on one dry ridge in a Louisiana swamp, keep it above the water, and grow it into a flagship.
Built by an LSU instructor with Claude Code for his students; the university is fictional. Play it: https://spacebaw.github.io/LSU-game/

One self-contained `index.html`.

- `index.html` — the game. Open it in Chrome or Safari. No install, no network. The interface is a light Material-style screen: an app bar of stat chips, a goal pill, a Build sheet (G), a Menu side sheet (M) and snackbars; `docs/UI_STYLE.md` is its style sheet.
- `src/` — source modules; `node build.mjs --check` concatenates them into `index.html`.
- `docs/GDD.md` — game design document. `docs/ARCHITECTURE.md` — module contracts.
- `test/` — headless Node smoke and unit tests for the simulation core and the DOM (`docs/TESTING.md`); `tools/qa/` — the headless-Chrome QA harness (play-through, screenshots, fps, contrast audit).
