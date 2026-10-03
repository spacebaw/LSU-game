# Brief: `src/js/ui_panels.js` → extends `BSU.ui` (Budget, Storm, Season, Milestones, Almanac, Settings, debug panel, breakdown popover, damage report, Founders' Day recap, Board/failure/Wet Feet/Objective-8 cards)

Read first: `docs/briefs/ui.md` (the chrome you plug into: `registerPanel`, `registerCard`, `card`, `openPanel`, `el`, `debug`), `docs/ARCHITECTURE.md` §1 (row 16), §3.2 (`BSU.params` is walked by the debug panel: every leaf is a number/boolean/string/number[]), §5.6 (`gaps`, `protection`, `shelter`, `boardUp`, `sandbags`, `repairAllLevees`, `upgrade`, `retrofitPilings`), §5.4 (`prepAction`, `spawnStorm`, `scheduleNearMiss`, `setPlayThrough`), §5.7 (`breakdown`, `statement`, `runway`, `previewApplicants`, `set*`, `endow`, `charterWest`), §5.9 (`hireCoach/fireCoach/setNight/setAutoSim/setPermits/setHomecomingBudget/playHome/upcoming/rating/winProb`), §5.10 (`answerBoard/answerFailure/answerVoice/fireAllToasts/debugOpen/recap/reopen`), §7.7 (this module's scope — copy it), §8.4 (slots), §9.6 (`skipToDate`, `slots`, `deleteSlot`, `setSpeed(20)`), §11.1 (Tier 1 list), §11.2 #6–7; `docs/GDD.md` §11.4 (Storm panel ASCII), §11.5 (Budget panel ASCII), §11.6 (Season, Almanac, Title settings, recap, postcard), §11.9 (debug panel: every cheat), §6.2 (prep actions, the wind exposure pick-list, the damage report contents), §5.9 (Board cards), §10.7 (failure cards), §10.5 #5 (Wet Feet card), §10.2 Objective 8 (the "Capped" card), §8 (Season panel contents: rating breakdown lines, "Underdog · 12%"), §10.8 (recap), §12.8.

---

## 1. Purpose and public surface

The panels and cards. Each panel is `{build(), refresh(state), events}` registered on `BSU.ui` at definition time; `build` runs once (lazily on first open, inside `#panels`), `refresh` on open, every 500 ms while open, and on the listed events. Cards are builders registered by id; `ui.card` shows them.

```js
BSU.ui.registerPanel('budget'|'storm'|'season'|'milestones'|'almanac'|'settings'|'debug', {build, refresh, events})
BSU.ui.registerCard('charter'|'newsflash'|'wetfeet'|'obj8'|'board'|'failure'|'damage'|'recap'|'shelter'|'hire'|'recruit'|'homecoming'|'versionMismatch', builder)   // builder(state, payload) → card spec
BSU.ui.panels.storm.testCat → number          // the Storm panel's "test at" category (defaults to the forecast)
BSU.ui.popover(state, stat) → void            // the breakdown popover (ui.breakdown delegates here)
BSU.ui.scoreBug(state) → void                 // updates #score-bug during a game (called from ui.update while state.sports.game is non-null — the state field; there is no sports.game() function)
BSU.ui.debugPanel → {open, toggle(), applyParam(path, value)}
```

## 2. State fields

Writes none directly (every control calls an action function). Reads `economy`, `ledger`, `sports`, `storms`, `progress` (milestones, recap, voiceCards, boardCards, failure), `buildings` (gaps/protection/shelter/list), `hydro`, `weather`, `session.slots()`, `BSU.params` (debug), `render.perf()`.

## 3. Events

**Emits:** none of its own (uses `ui.notify`).

**Listens (registered per panel through `events`; ui subscribes on behalf):** budget: `econ:month`, `econ:stat`; storm: `storm:*`, `ring:changed`, `coverage:changed`, `building:*`; season: `game:*`, `season:end`, `coach:changed`, `building:complete/upgraded`; milestones: `milestone:earned`, `objective:*`; almanac: `calendar:year`, `milestone:earned`, `storm:passed`; settings: `save:written`. Cards — **one opener per card (D44), and this module is it** for: `damage` on `storm:report`, `newsflash` on `storm:named`, `board` on `board:offered`, **`failure` on `econ:card` (ui_panels is the ONLY opener; progress's listener only records `failure.pendingKind`)**, `recap` on `calendar:year` when `progress.recap()` is non-null, **`wetfeet` on `milestone:earned{id:'wetFeet'}` (progress never opens it)**, `obj8` on `objective:progress{id:'8', capped:true}`, `hire` on a rivalry-loss-streak newsflash or the offseason button; `shelter` is the landfall toast (not a card); `charter` is opened by progress and `versionMismatch` by session through the same `ui.card(state, id, payload)` entry (D45). Every opener here calls `BSU.ui.card(state, '<id>', payload)`.

## 4. Rules checklist

### Tier 1

**Budget panel (`B`; GDD §11.5)**
- [ ] Header `BUDGET · {Month} Y{n}`; three columns: INCOME (last month, `ledger.last.income` in the fixed key order, non-zero lines only, `Total`), EXPENSES (`ledger.last.expense`, `Total`), RUNWAY (`economy.runway()`: `{months} months to {date} payday`, red dot when `red`; `NET` = `ledger.last.net` green/red).
- [ ] Controls: tuition slider `#sl-tuition` (3,000–15,000 step 250; live preview `Applicants next lock ≈ {economy.previewApplicants(v)}`; `input` → `economy.setTuition`; disabled while the `tuitionLock` timer exists); faculty `#seg-quality` (Basic/Good/Elite → `setQuality`); selectivity `#seg-selectivity` (Open/Selective/Elite); coaching `#sl-coaching` (0–3,000,000 step 50,000; shown only with a Practice Field: `sports.season().hasTeam`); ticket `#seg-ticket` ($25/$35/$60; shown with a home venue); auto-repair `#chk-autorepair`; `#bud-loan` (`Loan: $X of $2.0M line` where X = `max(0, −cash)`); `#bud-insurance` (`Insurance: none` / `2%/yr · pays 50%` + a Cancel button → `progress.cancelInsurance` — add to progress); `#btn-endow` (Year ≥ 5: `Endow $1M` → `economy.endow(state, 1000000)`; shows the yield line); `#btn-west` (Year ≥ 5: `Charter BSU West $20M` → `economy.charterWest`; the reason on failure).

**Storm panel (`T`, the alert strip's Prepare, `#btn-storm`; GDD §11.4)** — opens only when a cone exists (or the debug "Test ring" mode):
- [ ] Header `HURRICANE {NAME} · Cat {cat} (±1) · landfall in {n} days · surge {surge} ft`; `#seg-testcat` (Cat `forecast−1 | forecast | forecast+1`, clamped 1–5; default the forecast) sets `H = params.storm.surge[testCat]`.
- [ ] `canvas#storm-cone` 200×200: the minimap-style map with the cone (`render.cone`) and the reached tiles at `H` tinted (`buildings.protection(H)`).
- [ ] `#storm-ring`: `Ring at {H} ft: {gaps.length} gap(s) ({name}, {len} tiles) · {weak.length} weak tiles ({x}, {y}) · crossing ({x}, {y}) closes` from `buildings.gaps(H)`; `closed` → `Ring closed at {H} ft ✓`.
- [ ] `#storm-reached`: `Reached buildings: {name} ({depth} ft) ⚠ …` from `gaps(H).reachedBuildings`.
- [ ] `#storm-wind`: the **wind exposure pick-list**: every complete unboarded building with a checkbox, default order Water Tower, Substations, then WR ascending and cost descending; lines `{n} unboarded buildings WR ≤ 2 · Water Tower {braced|unbraced} · Substation outage {40|20}%`; `Board Up selected ($5k × n)` and `Board Up all ($X · 6/day)` (12/day with a post) → `weather.prepAction('boardUp', ids|'all')`; boarded/queued rows show ✓/⏳ (`storm.boardQueue`, `data.boardedUntil`).
- [ ] `#storm-shelter`: `Shelter {capacity} / {students} students ✓|✗ ({lines})` from `buildings.shelter()`.
- [ ] `#storm-actions`: `[Sandbags ${ceil(n/10)×10k}]` → `prepAction('sandbags')`; `[Repair All ${5k × tiles<100}]` → `'repairAll'`; `[Evacuate ${20k × ceil(students/1000)}]` → `'evacuate'`; `[Pre-drain]` (toggle, doubles pump cost) → `'preDrain'`; `[Play Through It]` (toggle; only when a home date falls on T−1 and forecast ≤ 1) → `weather.setPlayThrough`; `[Spillway $250k]` (Year ≥ 3 with Engineering, during a 2–3-ft window) → `'spillway'`. Each button shows the returned `reason` on failure via `ui.notify`.
- [ ] The three action lines (ring, reached, wind) come from `buildings.gaps(H)`, `buildings.protection(H)` and the roll odds; nothing in the damage report may surprise a player who read this panel.

**Season panel (`N`; GDD §11.6, §8)**
- [ ] `#sea-schedule`: the season's entries: date, opponent (name + nick), H/A, kind, result `W 28–17` / `L` / `—` / `postponed → {date}`; the bowl row when eligible. `#sea-next`: `vs {opp} ({rating}) · {word} · {P%}` (`Underdog`/`Even`/`Favored` from `sports.winProb`), night/day.
- [ ] `#sea-rating`: every term of `sports.rating().terms` as a line (`Practice Field +5`, `Coaching +10`, `Recruiting +4`, `Morale +6`, `Roux +3`, `Heat −8`, `Coach 2★ +0`, `Starters +1`, `Recruiting trip +3`) and the total.
- [ ] `#sea-coach`: `Coach {name} ★★☆☆☆ · "{rep}"` + `[Hire]` (offseason: the three `candidates` with stars, rep, signing fee and the required budget → `sports.hireCoach(idx)`) and `[Fire ($500k)]` (waived text when the streak ≥ 3) → `fireCoach`. `#sea-starters`: `QB {name} ({hometown}) {rating}` ×3.
- [ ] Toggles: `#chk-night` (Stadium II+ only; forced for homecoming/rivalry), `#chk-autosim` (offered after the first home game; `settings.autoSimHint` once), `#seg-permits` (Paid/Free → `setPermits`), `#seg-homecoming` ($0/$50k/$150k → `setHomecomingBudget`; Tier 2 #6 card semantics), `#btn-upgrade` (`Bayou Field +$600k` / `Red Stick Stadium $2M` / `The Cauldron $8M` / `Cauldron Grand $32M` with the unlock condition → `buildings.upgrade`), `[Play home game now]` only in debug.
- [ ] `#score-bug` (visible during a game/montage, also mirrored in the HUD top bar): `BSU {h} – {a} {opp} · Q{n}`, the crowd meter canvas (`render.crowd`), the "going for it" line, `[Skip to final]` when allowed (`sports.skipToFinal`).

**Milestones panel (`L`)**: every milestone from `data.milestones` in order with earned ✓ + day, or a progress bar from `progress.nearestMilestones(26)` (expose progress for all; `progress.milestoneProgress(id) → {progress, goal}` — add to progress); dismissed objectives listed with `[Reopen]` → `progress.reopen(id)`.

**Almanac panel (`#btn-almanac`; GDD §11.6)**: `#alm-achievements` grid (26 tiles, earned bright / unearned dim with the condition); `canvas#alm-sparks` 600×160: five sparklines from `ledger.history` (students, cash, prestige, happiness, ecology) — Tier 2 (draw a "Year 2+" placeholder in Tier 1); `#alm-storms`: `storms.log` lines (`Y{year} {name} Cat {cat} · {nearMiss ? 'near miss' : formatMoney(damage) + ', ' + tarps + ' tarps'} · held|breached`); `#alm-gators`: the gator log (relocations count, incidents, Le Grand sightings from `state.progress.firsts` — the state field, never `BSU.progress.firsts`); `#alm-recaps`: past recap cards' `lines`; `[Postcard]` → `render.postcard(state, caption)` → a download `<a download="bayou-state.png" href=dataURL>` clicked programmatically.

**Settings panel (`#btn-menu`, `#btn-title-settings`)**: `#chk-audio` (muted), `#sl-volume`, `#seg-particles` (Low/High), `#chk-shake`, `#chk-colorblind` (Tier 2 wiring), `#keys` table from `data.keys` (key → action), save slots: six rows (`auto.0–2`, `manual.0–2`) with `savedAt`/label from `session.slots()`, `[Save]` (manual only) → `session.save(slot)`, `[Load]` → `session.load(slot)`, `[Delete]` → `session.deleteSlot`; `#btn-newgame` + `#txt-seed` → `session.newGame({seed})` (confirm card first); every change → `ui.saveSettings()` + `audio.applySettings`.

**Breakdown popover (`ui.breakdown(stat)`)**: `economy.breakdown(state, stat)` → `#pop-title` (`Happiness 62`), up to 4 `.pop-line`s (`+8 dining coverage`, `−6 mosquitoes`), `#pop-next` (`Next: −4 no parking at 600 students`); positioned under the clicked stat; closes on any click elsewhere or `Esc`; **no formulas**.

**Cards**
- [ ] `charter`: parchment look, `data.tutorial[1].card`, `autoMs 3000`, no actions.
- [ ] `newsflash` (`storm:named`): `HURRICANE {NAME}` · `Cat {forecast} ± 1 · landfall {date}` · `[Prepare]` (opens the Storm panel) `[Later]`; Year 1 adds the "Pause to plan" hint line.
- [ ] `wetfeet` (milestone 5): "Wet Feet" — the three fixes in one line each (Pilings −25% for this building → `buildings.retrofitPilings(id)` button; a canal within 2; a levee ring) with the flooded building's name.
- [ ] `obj8` (Objective 8 capped): "Capped at {students} — beds are the bottleneck" with `[Show me]` (the empty crown) and the Pilings tooltip text.
- [ ] `board` (`board:offered{cards}`): two cards side by side (name, text, cost) `[Choose]` each → `progress.answerBoard(id)`; `[Dismiss both]` → `answerBoard(null)`; the `homecomingBudget` card shows its three amounts. **Tier 1: only `insurance` is offered by progress; the card must render any id.**
- [ ] `failure` (`econ:card{kind, options}` → `ui.card(state, 'failure', {kind, options})`, opened here and nowhere else): `data.failureCards[kind]` title + three (or one) option buttons → `progress.answerFailure(state, kind, optionId)` (idempotent per kind on progress's side; the buttons disable after the first click); `modal: true` (Esc does not close; the bankruptcy card can be dismissed with `[Not now]` = `answerFailure(state, kind, null)` = reject, which starts the 60-day receiver clock).
- [ ] `damage` (`storm:report`): `{NAME} · Cat {cat}`; bill `formatMoney(report.bill)`; `{tarps} blue tarps`; what held (`held.length` levee tiles), overtopped (`overtopped.length` at the named gaps), breached; flooded buildings by name; toast outcomes (`choices`: "Sandbag crew: held" / "Hurricane party: +2 happiness"); insurance line if paid; `[Repair All ${bill}]` → `buildings.repairAll` (+ `repairAllLevees`), `[Later]`; closing the card → `weather.closeReport(state)`.
- [ ] `recap` (Founders' Day, Jan 1 Year ≥ 2; `progress.recap()`): five sparklines (canvas; Tier 2 draws them, Tier 1 prints the numbers), `lines` ("what flooded, who won, what's sinking"), the best ticker line, `[Postcard]`, `[Close]`.
- [ ] `hire` (offseason or the streak): the three candidates.
- [ ] `versionMismatch` (session): "This save is from a newer version" `[Start fresh with the same seed]` → `session.newGame({seed})`.

**Debug panel (`` ` ``; GDD §11.9; ARCHITECTURE §7.7)** — hidden; while open `progress.debugOpen(state, true)` (no achievements):
- [ ] `#dbg-params`: walk `BSU.params` recursively into a tree of `label + input[type=range] + input[type=number]` per numeric leaf (range = `[0, max(1, leaf × 4)]`), checkboxes for booleans, text for strings, a comma list for number arrays; `input` → `applyParam(path, value)` writes the live leaf. Collapsible groups per sub-object.
- [ ] `#dbg-cheats` buttons (each calls the named function): **Skip to date** (`session.skipToDate(state, dateText, yearOffset)`), **+$1M** (`economy.post('misc', 1000000)`), **Spawn Cat N** (1–5 → `weather.spawnStorm(state, {cat, coneNowTick: T, landfallTick: T + 600, compressed: true})` — the same path as `headless.forceHurricane`; `compressed` is required, D51), **Rain 2 in now** (`hydro.forceRain(state, {cx, cy: the hover tile, inches: 2, radius: 14, steps: 60})`), **Set ecology / prestige / happiness** (number inputs → `economy.bump(state, stat, v − current, 'debug')`; ecology → `wildlife.forceEcology(state, v)` — add to wildlife), **Spawn gator here** (`wildlife.spawnGator(state, hoverTile)`), **Fill dorms** (`economy.addStudents(state, capacity − students, 'debug')` — emits `econ:stat` only; the visible agents follow at the next daily reconcile, D53), **Trigger home game** (`sports.playHome`), **Spawn near-miss** (`weather.scheduleNearMiss(state, day + 1, 'Debug')`), **Test ring at H** (input H → paints `buildings.protection(H)` on the map via `render.ghost({tiles: reached, color:'red'})` and prints `gaps(H)`), **Fire every decision toast** (`progress.fireAllToasts`), **Time-lapse 20×** (`session.setSpeed(state, 20, 'user')`, capped by `maxTicksPerFrame`), **Show hydro numbers on tiles** (`ui.debug.hydroNumbers`), **Perf HUD** (`ui.debug.perfHud`: `render.perf()` + `BSU.errors.size`).

### Tier 2

- [ ] Board cards other than Insurance (the card renders any; progress offers them — cut #7).
- [ ] Sugar Cane Bowl row, ticket tiers UI polish, coach hire/fire card, the recruiting card, Homecoming budget card, tailgate permits (cut #6) — the controls exist in Tier 1 but may be hidden behind a `Tier2` flag.
- [ ] Almanac sparklines canvas, recap sparklines, the Second Campus and Endowment UI beyond the two buttons.

## 5. Edge cases and invariants

- A panel's `refresh` never throws on missing data (no team, no storm, no history): every read guarded with defaults.
- Only one panel open (`ui.openPanel` closes others); `Esc` closes; the Storm panel refuses to open without a cone (`ui.notify('No storm in the Gulf')`).
- Every control shows the action's `reason` on failure; nothing is silently ignored.
- The debug panel's param edits are live and unsaved (they reset on reload); `applyParam` validates `Number.isFinite`.
- Cards queue; a card never opens during a set piece **except** the damage report (which is the end of one) and the halftime/landfall toasts (which are toasts).
- Headless: `build` on the stub works (createElement/appendChild); `refresh` writes `textContent`; the sparkline canvases are no-ops.

## 6. selfTest() requirements

No separate `selfTest` (part of `BSU.ui`); register via `BSU.ui._tests.push(fn)` (ui's `selfTest` runs them):

1. Every panel name in `['budget','storm','season','milestones','almanac','settings','debug']` is registered with `build` and `refresh` functions.
2. Every card id in the list above is registered.
3. The debug param walker over `BSU.params` yields only leaves that are number/boolean/string/number[] (throws → the contract violated the rule; report the path).
4. The Storm panel's ring line formatter on a synthetic `gaps` object produces `Ring at 5 ft: 1 gap (cove mouth, 4 tiles) · 2 weak tiles (44, 19) · crossing (41, 33) closes`.
5. The wind pick-list order on synthetic buildings: water tower first, substations next, then WR ascending, cost descending.
6. The Budget income/expense line order equals the fixed key order in ARCHITECTURE §2.7.

## 7. Testing in isolation

Extend `scratch/test_ui.mjs` (from `docs/briefs/ui.md` §7) by also loading `ui_panels.js` and calling `BSU.ui.openPanel('budget')`, `openPanel('season')`, `openPanel('settings')`, `openPanel('debug')` and `BSU.ui.card(s, 'damage', {report: {bill: 200000, tarps: 3, held: [1,2], overtopped: [], breached: [], flooded: [], choices: {}}})` (the string id resolves through `BSU.ui.cards.damage`); no exceptions. In Chrome: open every panel via keys (`b n t l` and the menu button) at 1280×800 and 1024×700, screenshot each, compare with the GDD §11.4/11.5 mock-ups; open the debug panel and run every cheat once (the Spawn Cat 3 → the whole landfall plays; Test ring at 5 paints the map).

## 8. Performance budget

`refresh` ≤ 2 ms per panel per 500 ms; the debug tree is built once (≈ 400 leaves); the Storm panel's `gaps(H)` is cached by buildings; the score bug updates every frame with ≤ 3 text diffs.

## 9. Done means

- `ui.selfTest().ok` with the panel tests; every panel and card renders on the stub and in Chrome; every cheat in GDD §11.9 works ("every acceptance test in this document is reachable from this panel in under a minute").
- The Budget panel matches §11.5 line by line; the Storm panel's three lines match `buildings.gaps/protection/shelter`; the Season panel prints `Underdog · 12%` style words and every rating term; the damage report contains only things the Storm panel warned about.
