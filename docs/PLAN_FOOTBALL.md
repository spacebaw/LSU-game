# PLAN_FOOTBALL — audit and plus-up design for the football component

Scope: `src/js/sports.js`, the Season panel (`ui_panels.js`), the HUD score bug (`ui.js`/`ui_panels.js`), the game-day drawing (`render.js`, `render_fx.js`), `progress.js` hooks, `data.js` tables. Read-only audit; nothing in `src/` was changed. Verification: grep of the modules above plus two headless runs (node + `test/domstub.mjs`, seed 42, `skipTutorial`, cheat cash/students, Practice Field → Bayou Field → Stadium I/II, a full Year-1 season). Scratch scripts: `fb_audit.mjs`, `fb_audit2.mjs` (scratchpad, not committed).

Player's ask: "actual players on the field", "let someone actually set the football game mechanics (none of those seem to be working)", "overall plus-up".

---

## Part 1 — Audit: what exists, what it changes, how a player would notice

Legend: **Real** = demonstrably changes an outcome; **Cosmetic** = visible but no outcome; **Dead** = wired to nothing or unreachable; **Hidden** = real but the player cannot see the effect.

### 1.1 Headline findings (the five that matter)

1. **Nothing is ever drawn on the field.** The 750-tick (75 s at the set piece's fixed 10 tps) home-game set piece draws: tailgate tents/smokers/cornhole on the venue's edge tiles, 3 buses, agents walking to the venue, a per-seat noise "crowd" on the stadium bowl rect, masts (Stadium II+ at night), fireworks on home scores, and the HUD score bug. No players, no ball, no referee, no band, no cheerleaders, no fans sprites. `params.sports.fanSprites 40` and `bandSize 24` are read by nobody (grep: zero consumers). The field is the static building sprite for the whole 75 s. (`render.js` 1336–1348; `render_fx.js` 389–410, 712–744.)
2. **`setPiecesSeen.game` is never set, so three controls are dead.** `progress.js` sets `parade`, `graduation`, `landfall` seen-flags but its `SETPIECE_END` handler has no `game`/`montage` branch (1592–1596). Consequences, all verified headless: (a) every home game is `skippable:false` → the **Skip ▸ button never appears** for a game (ui.js 1961; sports 697); (b) the **Auto-sim toggle does nothing** — `startHome` only picks the montage when `autoSim && setPieceSeen('game')` (sports 696) → every home game, forever, is the full 75-s unskippable watch; (c) `skipToFinal` refuses for the same reason.
3. **The halftime decision is a coin-flip with negative expectation, not a decision.** "Go for it" draws `swing = ±uniform(0, 8)` rating points, recomputes `P2`, and re-tests the *same* kickoff roll `r`. The winner changes only when `r` lands between `P` and `P2` (ΔP ≈ 0.05–0.10): ≈ 4–5 % of games flip to a win, ≈ 4–5 % flip to a loss, and a loss after going for it adds the `goForIt −2` spirit timer. Verified: `P .449, r .894` → yes → `swing −2.4, P2 .395`, nothing changed. The toast text shows the pre-game `P`, not a live estimate. Second-half scores are two more draws of the same lottery regardless of the answer.
4. **The score model is a fixed-offset lottery the player can see through.** Each quarter each side draws `{0,3,7,10}` by weights; the reveals fire at the *same* set-piece offsets every game (home at +30, away at +70 of each 100-tick quarter → the HUD clock reads "Q1 · 10:30" for every home score and "4:30" for every away score). After a timed-out halftime (tick 480) both Q3 scores fire **simultaneously** (verified, run 1). The 50-tick montage dumps Q2 scores at tick 20 together with the halftime toast and **all of Q3+Q4 at tick 40** (verified, run 2). The walk-off exists so the final never contradicts `r < P`.
5. **The first game is not reachable in the first 10 minutes — or in the first 30.** Objective 15 and the Practice Field unlock at **400 students**; the campus starts at 120 and grows only by the 5th-of-month rolling rounds (20 % of the bed/seat gap) and the Aug 5 fall lock (100 % of the gap). A passive campus never reaches 400 (headless: 120 → 60 over 3 years). A competent build hits 400 at the **Aug 5 lock**; the field takes 3 days and Bayou Field 6 more → the Aug 8 opener is missed, Sep 8 is Célestine's landfall (postponed), so the first visible home game is the Resilience Bowl makeup (~Sep 12) or Homecoming (Oct 8 = day 97 ≈ **32 min at 1×** on the current 5-tps base clock, ≈ 8 min at 4×). The GDD's "~6:00 at 1×, affordable by June" predates the base-speed halving and assumes 400 students by June. Objective 15's text promises "the Aug 8 opener is a real home game".

### 1.2 Control-by-control

| Control / system | Exists | Changes an outcome? | How a player notices | Verdict |
|---|---|---|---|---|
| **Season panel: schedule list** | Yes — 7 rows (day, opp, home/away, kind, result) | n/a | Readable; away results appear as "W 30–24" | OK |
| **Next-game line** | "vs Opp (rating) · Underdog · 26% · day · record 0-0" | n/a | The number is right (Elo-25) | OK |
| **Record** | wins/losses, `last4` | feeds `winPctLast4` → hype | Attendance moves ±16 % | Real, Hidden |
| **Coach row + Hire/Fire** | Name, ★, rep; Fire $500k → "Interim Staff 1★"; Hire | +4 rating per star (verified 45.3 → 49.3 hiring a 3★) | Rating line `coach` | Real; **Hire is a dead button in season** ("No candidates yet" until Dec 9 or 3 rivalry losses) |
| **Starters** | 3 names (QB, RB/WR, LB), hometown, rating 60–99 | `(mean − 75)/5` clamped −3…+5 rating | Only the recap ticker ("QB X: 312 yds, 2 TD") — fabricated from the final score (`60 + 9×pts`) | Cosmetic-ish; never on the field |
| **Team rating table** | 11 lines sum to `rating` | Drives `P` | Lines are legible | Real |
| **Coaching budget slider** | In the **Budget** panel (not Season), only when `hasTeam` | +1 rating per $100k, cap 30 (verified 27.3 → 42.3 at $1.5M) | Rating line `coaching` | Real, the single biggest lever, in the wrong panel |
| **Night-game toggle** | Hidden until Stadium II | homeAdv 14 vs 6 (+8 rating-equivalent), hype +.15 | Sky script Golden→Dusk→Night, masts | Real but gated behind $8M + 1,500 students; forced on for Homecoming/rivalry anyway |
| **Auto-sim toggle** | Sets `autoSim` | Montage path requires `setPieceSeen('game')` which is never true | Nothing | **Dead** (finding 2) |
| **Recruiting Sign / Pass** | Aug 5 card only when a Stadium exists; one per year; price $200k NIL or a building within range | Next Aug 5 a 95-rated starter at that position → ≈ +1.5 rating | Row disappears when answered; the payoff lands a year later as a notify | Real, Hidden, tiny |
| **Venue Upgrade button** | `buildings.upgrade` on the stadium/field | Seats, night capability, Stadium III opp −5 | Attendance/revenue, sprite tier | Real |
| **Tailgate permits Paid/Free** | Sets `permits` | Tailgate revenue `$3 × attendance × Greek bonus` or $0 (+ economy's `freePermits` happiness) | Ledger only | Real, Hidden |
| **Homecoming budget $0/$50k/$150k** | Charges; adds a `homecomingBudget` happiness timer | No football effect at all | Happiness | Real for happiness, zero for football |
| **Ticket tier $25/$35/$60** | Budget panel, when a venue exists | Attendance ×1.15/1/.85; revenue `att × (ticket + 12)` | Ledger; crowd fill | Real, Hidden (no projection shown) |
| **Halftime toast** | Tick 400, 80-tick (8 s) timer, yes/no | See finding 3 | Notify "Coach X is going for it, −2" | Cosmetic (≈ zero EV) |
| **Play Through It** | Only weather calls it: T−1 bands on a home date with forecast Cat ≤ 1 | Game in the rain, −10 happiness, +3 prestige on a win | Toast | Real, rare; Year-1 Célestine is Cat 2 so never in Y1; unverified headless (needs a Cat-1 collision) |
| **Tailgates / game-day revenue** | Posted at the final: `athletics` + `tailgate` | Cash (verified +$237.5k at 4,750 fans) | Only the Budget ledger — **no post-game summary or revenue toast** | Real, Hidden |
| **Attendance** | `min(seats, fanbase × hype) × ticketMult × (1 − damage)` at game creation | Revenue, crowd fill | Crowd shader on the stadium's `bowlRect`; **Bayou Field has no `bowlRect`** → a fallback box around the sprite, not the bleachers | Real |
| **Win probability** | Elo-25; home 6/14; Stadium III −5; Habitat +.05 | Decides `r < P` | "Underdog · 26%" | Real; a Year-1 team (rating 27–36) is an underdog to every opponent (35–86 with noise) → typical Y1 record 1–6 |
| **Quarter score model** | Finding 4 | — | Fixed clock offsets | Cosmetic lottery |
| **Home-game set piece** | 0–200 tailgate · 200 kickoff (whistle + roar) · 400 halftime · 600 final (fireworks on a win, bells, tickers 43/44/60) · 700 buses leave · 750 end | — | 75 s, unskippable every time | Finding 1 + 2 |
| **Score bug** | `#score-bug-hud` "BSU 7 – 20 GULF COAST TECH · Q3 · 10:30"; clock = `900 × (1 − frac)` | — | Fine, but the clock is decorative | OK |
| **Away games** | One tick, off-screen, ticker + record | Record, hype | Ticker line | Real, invisible |
| **Club games (no bleachers)** | Away-only, $20k each, football prestige capped at 20 | Cash | Ticker | Real |
| **Rivalry (Nov 8 home vs Magnolia)** | Win: +3 prestige, donations ×1.3, spirit +6/7 d, achievement; 3 losses: "Fire the coach" notify + buyout waived; forced night at Stadium II+ | Yes | Notify/ticker 42 | Real |
| **Homecoming** | hype +.3, forced night at Stadium II+; budget card (above) | Attendance | — | Real |
| **Sugar Cane Bowl** | Dec 8 off-screen at ≥ 5 wins vs the best unscheduled opponent; +$1.5M/+5 prestige or +$500k | Cash, prestige, coach star drift | `season:end` only | Real, invisible |
| **Prestige / happiness effects** | economy `footballBuzz` applicants term (`buzzPerWin × lastWins`, bowl), §5.5 prestige term by stadium tier, spirit from home wins, `goForIt −2`, `rivalrySpirit +6` | Yes | Slow stat drift | Real, Hidden |
| **Coach star drift / candidates** | +1 on bowl win or undefeated; −1 after 2 losing seasons; 3 candidates Dec 9 | Rating | Season panel rows | Real |
| **Bayou Field bleachers / Stadium tiers** | Field sprite: turf stripes, white lines, goalposts, bleachers decal + "BAYOU FIELD"; Stadium I/II/III: stands, masts, scoreboard/jumbotron, CAULDRON | Seats/night | Sprite | OK (art is there) |
| **Band (Bayou Brass), fan sprites, ponchos, pirogue cooler** | Promised by GDD §8; `band` sprite exists for the parade only | — | Absent on game day | **Dead params** |
| **Almanac** | Milestones, storms, gators, recaps | — | No football line anywhere | Missing |
| **First game reachability** | Finding 5 | — | — | Too late |

### 1.3 Smaller defects worth fixing in passing

- `enforceHalftime` at tick 480 reveals both Q3 plays at once (home +30 and away +70 of Q3 are both < 480).
- The montage's halftime toast gets 20 ticks (2 s) — unreadable; all second-half scores land in one tick.
- The crowd shader for Bayou Field uses the generic fallback rect (`render_fx.js` 401) because only the stadium exposes `bowlRect`.
- The Season panel's Hire button shows "No candidates yet" for 8 months of the year; the Fire button's "$500k" label does not update when the buyout is waived.
- `fanSprites`, `bandSize`, `buses` (partly), `tailgateGatorAttract` (wildlife reads `state.sports.game`, not the param) are dead params.
- Nothing summarises a game: no yards, no MVP, no attendance/revenue line; the only artefacts are two ticker lines.

---

## Part 2 — Design: the plus-up

**Target.** Football is a real, visible, decision-driven mini-game that a student reaches within the first 10 minutes and looks forward to every game day. Single file, no assets, 60 fps, deterministic through `BSU.rng.sim`, headless-testable.

**Headline.** Replace the quarter lottery with a **drive/play engine** that produces a play-by-play stream from eight position ratings, a playbook and the coach; draw **22 players, the ball, a referee and the chain crew on the real field quad** with a camera that follows the ball; put the player's hands on **playbook, aggression, starters, recruiting, 4th-down and two-point calls, halftime adjustments, ticket price, night games**; and make the first football moment a **spring scrimmage** three days after the Practice Field completes.

### 2.1 Engine (sports.js) — "one engine for every game"

**Ratings by position.** `state.sports.starters` grows from 3 to 8 named players: `QB, RB, WR, OL, DL, LB, DB, K` (each `{name, pos, hometown, rating 60–99, class}`); `ensureKeys` draws the missing five on load with the existing `drawStarter` formula, so saves migrate. `meanStarterRating` becomes the mean of 8 (the rating term is unchanged). May 5 seniors leave per slot (p .4). Composites (0–100):

```
OFF_RUN  = .35 RB + .35 OL + .15 QB + .15 WR
OFF_PASS = .45 QB + .30 WR + .25 OL
DEF_RUN  = .45 DL + .35 LB + .20 DB
DEF_PASS = .45 DB + .30 LB + .25 DL
teamMod  = (sports.rating − 50) / 5          // coaching, morale, Roux, heat, coach stars, timers keep mattering: −10…+10
unit     = clamp(composite + teamMod, 30, 110)
```

Opponents get the same four units from `oppRating` plus a style profile added to `data.opponents` (`style: 'ground'|'balanced'|'air'`, `defBias: ±4`); e.g. Magnolia `air`, Delta A&M `ground`.

**Per-play edge.** `e = (attackUnit − defendUnit + homeAdv) / 25` where `homeAdv` is the existing 6 (day) / 14 (night) scaled by crowd fill `(.6 + .4 × attendance/seats)`; Stadium III keeps its opponent −5. The Season panel still prints `winProb` (unchanged formula) as the pre-game estimate; a calibration test asserts the engine's empirical win share matches it within ±5 points at rating gaps of −30, −15, 0, +15, +30 (2,000 silent games each).

**Play resolution** (every draw via `R = BSU.rng.sim`, fixed order per play: call → outcome → yards → clock):

| Play | Numbers |
|---|---|
| Run | `yds = round(gauss(3.8 + 1.6e, 3.2))`, floor −4; breakaway p `.06 × (1 + .5e)` → `+15 + R.int(40)`; fumble p `.012 × (1 − .3e)` |
| Pass | completion `clamp(.60 + .08e, .35, .80)`; complete `yds = round(gauss(10 + 2e, 7))` floor −2, big play p `.10` → `+20 + R.int(25)`; sack p `.07 × (1 − .4e)` → −6; interception p `.028 × (1 − .35e)` per throw |
| Field goal | distance `d = (100 − spot) + 17`; `p = clamp(.98 − .016 × max(0, d − 20) × (1 − .3 × (K − 75)/25), .10, .99)`; never attempted beyond 60 |
| Punt | `42 + gauss(0, 6)` net, touchback → 20; fair catch 50 % |
| Kickoff | touchback 65 % → 25; else return `25 + gauss(0, 8)`; onside only when trailing ≤ 8 inside 2:00 (recover 12 %) |
| XP / two-point | XP `.96`; two-point `.47 + .06e` |
| Clock | 15:00 quarters (900 s); run 38 s, complete 32 s, incomplete 8 s, punt/FG/kickoff 10 s; inside 2:00 the offense trailing uses 14 s on completes; 10-minute halftime is the set piece's tick 400 |

**Play calling.** `state.sports.playbook ∈ {'ground','balanced','air'}` (default balanced) sets the base run share `.66 / .52 / .36`, with situational overrides (3rd & ≥ 7 → pass 85 %; 2-minute drill → pass 80 %; leading by ≥ 9 in Q4 → run 75 %). Style effects: `air` pass variance ×1.3, INT ×1.25, completion −.02; `ground` run yards +.6, 4 s more clock per play, fumble ×1.1. Coach fit: `data.coaches[k].style` matching the playbook gives completion +.02 / run yards +.3; a mismatch (air raid with a QB < 70) −.05 completion. `state.sports.aggression ∈ {'conservative','normal','aggressive'}` (default normal) is the 4th-down/two-point default used off-screen and when a toast times out: go on 4th & ≤ 2 inside the opponent 45 (normal), ≤ 4 anywhere past midfield (aggressive), never unless trailing late (conservative).

**Decisions during the game** (home games watched by the player only; off-screen and auto-sim use `aggression`):
- **4th down toast** — when BSU has 4th & ≤ 3 past the opponent 45, or 4th & any inside the 5, or trailing by > 3 inside 4:00 past midfield: `ui.decision({id:'fourthDown', text:'4th & 2 at the MAG 38 · Go: 58% · FG from 55: 41% · Punt', yes:'Go for it', no:'Kick it', ticks: 40})`. The engine pauses (no plays while the toast is open; the set-piece `len` is extended by the paused ticks, cap +120, via a `g.tOff` offset). Highlights mode caps decision toasts at 2 per game (one per half) so the set piece is not toast spam. Odds shown are computed from the same tables.
- **Two-point toast** — after a BSU TD in Q4 when the chart says it matters (margin after XP ∈ {−1, +1, +4, +5, −2, −5}): `'Two-point try · 49% · or kick · 96%'`, 30 ticks.
- **Halftime** — replaces the swing lottery. `ui.decision({id:'halftime', text:'Down 13–7 · live 38% · Open it up: pass +20%, big plays ×1.4, turnovers ×1.4 · Pound the rock: run +25%, clock bleeds', yes:'Open it up', no:'Pound the rock', ticks: 80})`; `'default'` = stay the course. The live estimate: `P_live = 1 / (1 + 10^(−(margin + 14 × remFrac × edge) / (6 + 8 × remFrac)))` with `edge = (team − opp)/25` and `remFrac` the fraction of game clock left (calibrated by the same test harness). A failed "open it up" that loses keeps the `goForIt −2` spirit timer (the rule still exists, now attached to a real trade-off).

**Game state per tick.** `state.sports.game.field = { down, dist, spot (0–100, BSU's own goal = 0), poss (0 BSU / 1 opp), quarter, clock, lastPlay: {n, type, yds, result, carrier, text}, drive: {plays, yds, start}, stats: {yds:[0,0], pass:[0,0], rush:[0,0], to:[0,0], plays:[0,0], firstDowns:[0,0]} }` — plain JSON, saved with the game, written by sports only. `game.anim = { phase: 'huddle'|'snap'|'live'|'whistle'|'celebrate'|'halftime', t0, dur, from, to, ballFrom, ballTo, carrier, formation, defFormation }` is derived (recomputed from `field` + tick), not saved. `BSU.sports.playState(state)` returns `field` (null when no game) for render/ui.

**Modes.**
- **Highlights (default; fits the 750-tick set piece).** The engine simulates the full game (~120–140 plays, ~1 ms) *lazily in slots*: ticks 200–600 hold 24 slots of ~16 ticks (6 per quarter); each slot runs plays until a "key" play (score, turnover, 4th down, gain ≥ 15, sack, two-minute play) or 6 plays, then animates that one play (10 ticks) and a 4-tick huddle; skipped plays post one summary line ("Three-and-out. Punt to the 31."). Scores therefore land at varying clock times and the Q3 catch-up bug disappears.
- **Watch full game.** Season-panel toggle `state.sports.watchFull`; the set piece starts with `len = 200 + plays × 14 + 150` (≈ 1,900 ticks, 3 min) and animates every play. Skip ▸ after Q1 falls back to highlights for the rest.
- **Montage (auto-sim, 50 ticks).** Kickoff 5, a score-bug ticker of the 6–10 key plays spaced 4 ticks apart, halftime toast 30 ticks at tick 20 (the final moves to 55; `montageTicks 60`), no on-field drawing beyond the formations idling.
- **Off-screen** (away, club, bowl, catch-ups): the same engine, silent, `aggression` defaults.

**Post-game summary.** `game:final` payload adds `summary: { yds:[h,a], pass, rush, turnovers, firstDowns, mvp:{name,pos,line}, attendance, revenue:{tickets, concessions, tailgate}, bigPlay:{text} }`. The MVP is the starter with the best real stat line from the play log (QB passing yds/TD, RB rush yds, WR rec yds, DL sacks, LB tackles, DB INTs, K FGs). Ticker 60's stat line comes from the log, not `60 + 9 × pts`.

**Season records.** `state.sports.records = { seasons: [{year, wins, losses, bowl, bowlWon, coach, stars}], book: {passYds, rushYds, recYds, sacks, ints, pts, margin: {name|opp, year, v}}, hof: [{name, pos, year, line}] }` written at `season:end`; HoF entry for a QB ≥ 2,500 yds, RB ≥ 1,000, WR ≥ 900, any DB ≥ 5 INT, or the starters of a rivalry win + bowl season.

**Spring Game (reachability).** When a Practice Field (tier 0 is enough) completes between Jan 1 and Jul 31, sports schedules the **Purple & Gold Spring Game** three days later (`kind:'spring'`, intrasquad: Purple = starters, Gold = starters −6 with mirrored style), a 300-tick set piece (`SET_PIECES.spring 300`): kickoff at 40, two 100-tick halves of highlights, one scripted 4th-down toast (the tutorial for the mechanic), no revenue, +1 happiness, no record. Also schedules on the first spring after a team exists in later years (skippable once seen). The idle **practice drill**: whenever a Practice Field exists and no game runs, 11 players run a two-formation drill loop on the field during the Day phase (sprites only, no sim cost beyond the formation lerp) — players appear the moment the field completes.

**API additions** (functions only, D46): `setPlaybook(state, style)`, `setAggression(state, level)`, `setWatchFull(state, on)`, `prospects(state)`, `signProspect(state, idx)`, `playState(state)`, `recentPlays(state, n)`, `startSpringGame(state)`. Removed: the `swing` lottery (`halftimeSwing` test hook goes with it). `_generate` is deleted; `simGame` runs the engine silently.

**Events** (contract.js `EV`): `game:play{n, type, yds, result, text, poss, quarter, clock, spot, down, dist}`, `game:drive{result, plays, yds}`, `game:decision{id, chosen}`, `game:spring`. Existing `game:score` keeps its payload (+ `play`).

**Params** (`params.sports.engine`): every number above lives here; `params.sports.schedule.springOffset 3`; `SET_PIECES.spring 300`; `montageTicks 60`.

**Determinism and saves.** All draws through `R` in a fixed per-play order; a save mid-game stores `field`, the play counter and the slot index; resume replays nothing (the next draw continues the stream, which is deterministic because the sim is lockstep). `selfTest` seeds a private state and asserts the stream is identical across two runs.

### 2.2 Players on the field (sprites_entities.js, render.js, render_fx.js)

**Field quad.** `BSU.sprites.fieldQuad(row, b)` → `{x0, y0, x1, y1}` in footprint units: Practice Field `{0.6, 0.3, fw − 0.6, fh − 0.3}` (the goalposts sit at 0.6 / fw − 0.6 already), Stadium `{1, 1, fw − 1, fh − 1}` (the inset `stadiumField` already draws). Field-local yards `(u ∈ [−10, 110] along the long axis incl. end zones, v ∈ [0, 53])` map to tile coords `(b.tx + x0 + (u + 10)/120 × (x1 − x0), b.ty + y0 + v/53 × (y1 − y0))` honouring `b.rot` the way `fpPt` does. BSU attacks toward +u in the first half.

**Sorting.** Buildings are pushed at their front corner (`tx + w − 1, ty + h − 1`, render.js 1216), so an entity pushed at a fractional tile inside the footprint sorts *before* the building and vanishes under the turf. On-field entities are pushed with the **venue's anchor** and `rank 1…60` (one `push` per sprite, `e.sx/e.sy` set from the fractional projection through `tileScreen` on the entity itself), so they draw immediately after the venue sprite and before anything in front of it. The near stand overlaps the near sideline by ~14 px; players are clipped to the field quad plus 1 yd, which keeps them off the stand.

**Sprites** (`sprites_entities.js`, generated through the existing `figure(b, cfg)` 12×20 cells; cached by `(id, variant, frame, zoom)`):
- `player` — cfg `{cols: {shirt: jersey, skin, hair}, trousers: pants, extras: helmet(jersey, stripe), pack: false}`; anims `idle 2`, `run 4` (walk legs at double rate), `tackle 2` (`wide0/1` + lean), `down 1` (custom 14×8 lying), `celebrate 2` (= cheer), `throw 2` (`armR headUp → out`), `kick 2`, `block 1` (`armL/armR out`). Variant packs `team (2 bits: 0 BSU purple/gold, 1 opponent, 2 Gold scrimmage) | look (6 bits)`; opponent jersey/pants from `data.opponents[k].colors[0]/[1]` via `sprites.setOpponentColors(k)` before a game (one palette slot, re-generated per opponent: 9 opponents × ~14 frames × 2 zooms, trivial).
- `referee` — black/white striped torso (custom torso painter), white cap; `idle 2`, `signal 2` (both arms up = TD, arms out = incomplete).
- `chain` — two figures in orange vests with a 6×22 pole sprite; `downMarker` with the digit 1–4 (3×5 px font).
- `ball` — 4×3 brown ellipse with a white lace pixel; drawn by render at `(x, y − z)` with a parabolic `z` for passes, punts, kicks (peak 18–40 px by distance), spinning frame 2.
- `cheer` — 6 figures in gold with pom extras (`cheer` pose already exists), on the home sideline, animated on scores.
- Band — the existing `band` sprite (24, `march 4`) in a serpentine at halftime; Roux — the existing `roux` sprite at the home bench (`idle`), `yawn` frame when ticker 20 fires.
- Bench dressing (one static sprite each): two benches, a water cooler, a sideline TV cart.

**Formations** (field-local yards relative to the line of scrimmage `s`, offense facing +u; mirrored for the away side). Templates are constant arrays; a formation is chosen by the engine per play and exposed in `anim.formation`.

| Formation | Offense | Defense |
|---|---|---|
| I-form | QB (−1, 0), FB (−4, 0), RB (−7, 0), OL ×5 (0, −4…+4 step 2), TE (0, +6), WR (0, −20), WR (0, +18) | 4-3: DL ×4 (+1, −3…+3), LB ×3 (+4, −5/0/+5), CB ×2 (+1, ±20), S ×2 (+10, ±7) |
| Shotgun | QB (−5, 0), RB (−5, +3), OL ×5, WR (0, −22), WR (0, +20), WR (0, +12), TE (0, −6) | Nickel: one LB → DB (+6, −12) |
| Punt | P (−14, 0), LS (0, 0), gunners (0, ±24), 8 line | 8 front + returner at the expected landing |
| Field goal | H (−7, 0), K (−9, −1), 9 line | 11 in a block wall |
| Kickoff | K at own 25, 10 across own 35 | 11 spread, 2 deep returners |
| Victory | QB + 10 kneel | 11 |

**Play animation** (parametric in `t = (tick − anim.t0)/anim.dur`, `dur` 10 ticks in highlights, 14 in full; nothing allocated per frame):
- Huddle → formation: players lerp from their last positions to the new template at the new spot (4 ticks); the chain crew and down marker slide to `s` and `s + dist`.
- Run: ball to the carrier at `t .15`; carrier follows a 3-point bezier (cut at `t .5`) to the gain spot; 2 nearest defenders converge; at `t .9` `tackle` + `down`, or `celebrate` on a TD.
- Pass: QB drops 3 yd (`t 0–.25`), `throw`; ball arcs to the target over `t .25–.6` (z peak by distance); catch → run-after-catch to the gain spot, or incomplete (ball drops short; receiver `wide`); interception: a DB catches and runs the return.
- Sack: DL beats the OL (`t .3`), QB `down` at −6.
- FG / XP / punt / kickoff: ball arcs from the kicker; FG good → ref `signal` + crowd pulse.
- TD: `celebrate` for 6 ticks, fireworks (exists), crowd wave (below), brass `sting` (exists).
- Halftime (ticks 400–480): teams jog off to the sidelines; the band marches a Lissajous serpentine (`u = 50 + 40 sin(2πk/24 + ωt)`, `v = 26 + 18 sin(3·…)`) with the existing `march` frames; cheerleaders `cheer`.

**Camera** (`render.js`): at kickoff, if `setPiece.cameraTouched` is false, `panToTile(field centre)` + `setZoom(2)`; during `live` phases the camera lerps (0.12/frame) toward the ball's screen position clamped to the field; on `whistle` it eases back toward the line of scrimmage; halftime/final return to the venue centre; any user pan/zoom (`captureCameraTouch`) cancels following for the rest of the game. Speed buttons stay locked during the set piece as today.

**Crowd and FX** (`render_fx.js`): `R.crowd`'s `wave` argument is advanced for 60 ticks after a home TD or a stop on 4th down (a sweep across the bowl); fireworks on home scores/wins (exists); masts (exist); rain → the existing rain pass with the crowd rect darkened (ponchos = a 2-colour tint band on the crowd field, 1 line). Bayou Field gets a `bowlRect` over the bleachers decal so the crowd shader lands on the bleachers instead of the fallback box.

**HUD** (`ui.js`/`ui_panels.js`): the score bug gains a second line `◀ BSU · 2nd & 7 · MAG 38 · Q3 10:14` (possession arrow, down & distance, spot in opponent/own terms, clock from the engine); a **play-by-play strip** (`#pbp`, last 3 lines, newest bright, 6-s fade) under the bug fed by `game:play`; each line is also pushed to the ticker log with kind `sports` (ticker lines 63–80 in `data.ticker`: 18 templates, e.g. `'{carrier} up the gut for {yds}.'`, `'{qb} finds {wr} for {yds}. First down.'`, `'Picked off. The Marsh Mob goes quiet.'`, `'{k} from {d}. Good. Bells.'`). The summary card (ui_panels `cards`) opens at the final: score, yards, turnovers, MVP line, attendance, revenue split, and a "Season 3–2 · next: at Crescent City" footer.

**Audio** (`audio.js`): whistle at kickoff and the final (exists) plus on each `whistle` phase in full mode only (not highlights — too many); `roar` on gains ≥ 20 and 4th-down stops; `sting` on TD, `groan` on turnovers/opp scores (exist); new one-shots `snare` (4th-down toast drum roll, reuses the `snareHz` roll), `thud` (tackle, 60 ms noise burst, highlights only on key plays), `trombone` on a missed FG (exists), `bells` on a win (exists). Ducking as today.

### 2.3 Mechanics the player sets and feels

| Mechanic | Where | Effect (numbers) | Feedback |
|---|---|---|---|
| **Playbook** ground / balanced / air | Season panel seg (new) | Run share .66/.52/.36; style multipliers §2.1; coach fit ±.02 completion | Play mix visible in the strip; "Coach fit ✓/✗" tag |
| **Aggression** | Season panel seg (new) | 4th-down/two-point defaults for off-screen and timed-out toasts | Summary card: "4th downs: 2/3" |
| **Coaching budget** | Moves from Budget to the Season panel (Budget keeps the ledger line) | +1 rating/$100k (cap 30) and `prospects` board size 3 (< $500k) / 4 / 5 (≥ $1M) | Rating line; board size |
| **Starters by position** | Season panel table (8 rows: pos · name · hometown · rating · class) | Composites §2.1 | Click a row → the inspect panel shows the player's season line |
| **Recruiting board** | Season panel "Prospects" (Dec 9 – Aug 4): N prospects `{name, pos, rating 70–95, cost $150k–$900k (= $12k × (rating − 60)), hometown}`; up to 2 signings; the existing building-priced recruit becomes one row with price "a Rec Center" etc. | A signed prospect replaces the starter at that position at the Aug 5 lock (`signProspect` charges `coaching`); `answerRecruit` kept as an alias | Notify at signing; "arrives Aug 5" tag; the Aug 5 notify (exists) |
| **4th-down / two-point toasts** | During watched home games | Real play outcomes | The play animates; odds were shown |
| **Halftime adjustment** | Toast (3-way) | §2.1 | Second-half play mix |
| **Ticket price** | Season panel (moved from Budget; Budget keeps the ledger) with a live projection "~5,900 fans · ~$277k + tailgate ~$18k" | Existing multipliers | Summary card revenue split |
| **Night games** | Toggle (unchanged, Stadium II+) | homeAdv 14, hype +.15 | Sky script, masts |
| **Home field** | Venue tier × crowd fill | `homeAdv × (.6 + .4 fill)`; Stadium III opp −5 | Rating breakdown shows "home field +9 (crowd 92%)" on game day |
| **Rivalry / Homecoming** | Calendar | hype +.3 (exists); new rating line `marshMob +2` for a home rivalry game; Homecoming budget tiers now also lengthen the halftime show (band 60/80/100 ticks) and give +1/+2 rating that day (so the card touches football) | Rating line; the show |
| **Bowl** | Dec 8, ≥ 5 wins | Watchable: a `'game'` set piece with `g.neutral = true` played in the home venue with a neutral crowd tint, fixed payout (exists), no attendance revenue | A game you can watch + summary card |
| **Hall of Fame / records** | Almanac "Gridiron" section: last 5 seasons (year · W–L · bowl · coach), the record book (7 lines), HoF names | §2.1 records | Almanac |
| **Achievements** (progress) | `hailMary` (win on a final-play TD), `shutout`, `fourthAndForever` (convert 4th & 10+), `springFling` (watch the spring game) | milestones | Milestones card |

### 2.4 Reachability — football in the first 10 minutes

1. **Unlock the Practice Field at 200 students** (`catalog.practice_field.unlock.students 200`, `G.students15 200`); Bayou Field's bleachers stay at 400 (home revenue unchanged). 200 is reachable by the Feb/Mar rolling rounds with two dorms placed in January; it does not move the economy curve because the field has no revenue and $3k upkeep.
2. **The Spring Game fires 3 days after the field completes** (any date Jan 1 – Jul 31), not on a fixed date: field placed by ~day 20 → scrimmage at ~day 24 ≈ **8 min at 1×, 2 min at 4×**. It uses the tier-0 field (goalposts already drawn), so no bleachers are needed. Objective 15's text becomes "Build a Practice Field; watch the Spring Game; add Bayou Field for the Aug 8 opener", with progress 3 → 4 steps.
3. **The practice drill** makes players visible the moment the field completes (no set piece).
4. **Year-1 opener.** Because the Aug 5 lock is when most campuses cross 400, the Aug 8 opener is missed by 3–9 days. Two options; recommend the first: (a) Bayou Field's upgrade takes 3 days instead of 6 (`tiers[0].buildDays 3`) and the opener moves to **Aug 10** (`schedule.opener`) — the data's 10-day months make Aug 10 the last day of the month, fine; (b) keep the dates and let the Sep 8 Resilience Bowl be the first real game (it already is for most players). Either way Objective 15's "Aug 8 opener" claim must match the data.
5. **Montage/Skip fix** (finding 2) is a one-line change in `progress.js` and must ship first; with it, later home games are a 6-s montage unless the player wants to watch.

### 2.5 Module-by-module work list

| # | Module | Work | Size |
|---|---|---|---|
| 0 | `progress.js` | Hotfix: set `setPiecesSeen.game` on `setpiece:end{kind:'game'|'montage'}`; Objective 15 at 200 students + new text; `springFling` etc. achievements; `game:play` → `sunbather`-style hooks | 60 lines |
| 1 | `contract.js` / `data.js` | `params.sports.engine` block, `SET_PIECES.spring`, `montageTicks 60`, `EV` additions, opponent `style/defBias`, coach `style`, prospect name pools (reuse §14.1), ticker lines 63–80, `practice_field.unlock 200`, `buildDays` | 150 lines |
| 2 | `sports.js` | Positions (8), composites, play tables, drive/clock engine, slot scheduler (highlights/full/montage/silent), decisions (4th/two-point/halftime) with pause offset, summary + MVP, records/HoF, playbook/aggression/watchFull setters, prospects board, spring game, practice-drill formation state, migration in `ensureKeys`, `selfTest` (below) | 900–1,100 lines (replaces ~300) |
| 3 | `ui_panels.js` / `ui.js` | Season panel: playbook/aggression segs, 8-starter table, prospects board, ticket + coaching rows moved in with projections, "Watch full game" toggle, Hire button hidden in season; HUD bug line 2 + `#pbp` strip (CSS ~40 lines); summary card; Almanac "Gridiron" | 350 lines |
| 4 | `sprites_entities.js` | `player` (+ helmet, 8 anims), `referee`, `chain`/`downMarker`, `ball`, `cheer` variant, bench dressing, `setOpponentColors`, `fieldQuad`; selfTest cell sizes | 300 lines |
| 5 | `render.js` | `onField` block in the entities pass: formation templates, play interpolation, ball arc, sideline dressing, band serpentine, practice drill, camera follow/zoom; sort-rank rule | 450 lines |
| 6 | `render_fx.js` | Crowd wave trigger, Bayou Field `bowlRect`, poncho tint, down-marker glow at night | 50 lines |
| 7 | `audio.js` | `snare`, `thud`; wiring to `game:play`/`game:decision` | 60 lines |
| 8 | `sprites_buildings.js` | Bayou Field `bowlRect` over the bleachers decal | 10 lines |
| 9 | Tests | `test/unit/sports.test.mjs` rewrite; `test/browser.mjs` game screenshots; smoke unaffected | 250 lines |

**Build order** (one module per pass, tests as the reviewer): **Pass A** — #0 hotfix + #1 params/data (Sonnet). **Pass B** — #2 engine core: positions, plays, drives, clock, silent mode, calibration test (Opus). **Pass C** — #2 scheduler/decisions/summary/records/spring game + headless season test (Opus). **Pass D** — #3 UI controls + HUD + summary card + Almanac (Sonnet). **Pass E** — #4 sprites (Sonnet). **Pass F** — #5 on-field render + camera (Opus; the sort and the field quad are the risky bits). **Pass G** — #6/#7/#8 polish: wave, band, cheer, Roux, audio, Bayou Field crowd rect (Sonnet). **Pass H** — QA: Chrome playthrough to a spring game and a Cauldron night game, screenshots, perf check, memory notes. ≈ 8 passes.

### 2.6 Test plan

Headless (`node`, `test/domstub.mjs`, `test/unit/sports.test.mjs`):
- Engine invariants over 2,000 silent games per rating gap: every play's `spot ∈ [0,100]`, `down ∈ 1–4`, `dist ≥ 1`, score non-negative; a game ends with the clock at 0:00 and 110–160 plays; no NaN; identical streams for identical seeds (determinism); off-screen and watched games with the same seed produce the same final.
- Calibration: empirical BSU win share within ±5 points of `winProb` at gaps −30/−15/0/+15/+30 (home day), and night vs day moves the share by 8–12 points at gap 0; mean total points 38–62; turnovers 1–4 per game; playbook `air` raises pass yards ≥ 25 % and INTs ≥ 20 % over `ground`.
- Decisions: a 4th-down toast opens on the designed situations and never more than twice in highlights mode; `answerDecision('fourthDown','yes')` produces a `game:play` with `type:'4th'`; a timed-out toast uses `aggression`; the halftime answer changes the second-half run share by ≥ .15; the paused ticks extend `setPiece.len` by the same amount (≤ 120).
- Timeline: a seed-42 Year-1 build (field at 200 students, spring game 3 days later, Bayou Field, Aug 10 opener) emits `game:spring`, `game:kickoff`, ≥ 20 `game:play`, `game:halftime`, `game:final{summary}`; the second home game with `autoSim` runs as a 60-tick montage (the hotfix); Skip ▸ appears at tick 200 of the second game (`setPiece.skippable === true`).
- Records: after three seasons `records.seasons.length === 3`; the book's QB line matches the max of the logged seasons; HoF thresholds.
- Migration: a save with 3 starters loads to 8 with the originals intact.
- `selfTest()` ≤ 60 ms; `tick` ≤ 0.3 ms outside set pieces; ≤ 0.6 ms during a play (profiled in the test with `performance.now`).

Chrome (`test/browser.mjs`, 1280×800): screenshots of (1) the practice drill on a tier-0 field, (2) the spring game at the snap, (3) a Bayou Field day game mid-pass with the HUD bug and strip, (4) the 4th-down toast, (5) the Cauldron night game with the band at halftime, (6) the summary card, (7) the Almanac Gridiron section; `requestAnimationFrame` frame time ≤ 16 ms over 300 frames during a play at zoom 2; zero console errors.

### 2.7 What to cut if scope must shrink (in order)

1. Watchable bowl (keep off-screen + summary card).
2. Band serpentine, cheerleaders, bench dressing, Roux yawn (keep the fireworks/wave).
3. "Watch full game" mode (keep highlights + montage).
4. Two-point toast (keep 4th down).
5. Prospects board (keep the single recruit card, but show it in the panel until Aug 5 with its status).
6. Almanac record book + HoF (keep the last-5-seasons list).
7. Camera follow (keep the kickoff pan/zoom).

**Minimum that still answers the player's ask:** hotfix #0, the engine with 8 positions and playbook/aggression, 22 players + ball + down marker on the field with huddle/run/pass/kick animation, HUD down & distance + play strip, the 4th-down and halftime toasts, the summary card, and the spring game at 200 students. That is passes A, B, C (trimmed), D (trimmed), E, F — six passes.

### 2.8 Constraints honoured

Single HTML file, procedural sprites only (new generators in `sprites_entities.js`, cached per zoom), no network. 60 fps: at most ~40 extra sprites per frame during a set piece, parametric animation (no paths allocated per frame), formation templates frozen at load, the engine's per-tick cost is one play resolution at most. Determinism: `BSU.rng.sim` only, fixed draw order, no module state (D46), saves carry `field`/counters and resume mid-play. Headless: every toast times out through sports' own tick enforcement, so `tick(n)` never stalls.
