# Balance and pacing pass

Every feature pass since the v2 plan was tuned in isolation; nobody had played a whole campaign. This pass measured
15-year campaigns headlessly with `tools/qa/campaign.mjs` (four policies × 96 and 64 worlds × seeds 1–5, one in-game
day at a time, every action through the module APIs the UI calls), judged the tables, and changed the smallest numbers
and goal orderings that fix what they showed. Outputs are in `tools/qa/out/campaign-before*.txt` / `.json` (the
pre-pass build) and `campaign-after.txt` / `.json` (this build). `node tools/qa/campaign.mjs --assert` at both sizes is
the regression gate; `test/unit/balance.test.mjs` pins each change.

The win is what `progress.js` says: the `flagship` milestone, 10,000 students **and** prestige 60 at once
(`params.progress.milestoneGoals.flagship`; Objective 22 shows the same pair). The title's How to play matches.

## The policies (what "a player" means below)

- **goals** — does only what the coach's card (the objective and its Build it button, `data.guide`), the Issues tray
  (its Fix actions) and the HUD needs strip (`Needed` / `Next` at 85 %) say; keeps a month of expenses in hand; answers
  the Board / failure cards the way a new player would (hike tuition).
- **greedy** — maximum students as fast as cash and the loan line allow: bunkhouses, lecture halls, cheap-menu dining
  halls, sewage, tuition cut to fill the beds; once it is applicant-bound it buys prestige (academics, landmarks,
  football, faculty, coaching).
- **passive** — the tutorial minimum (a dorm, a dining hall, a lecture hall, the canal, power and water), then hoards.
- **storm** — greedy plus the cove levee, a ring at 8 ft, pumps inside, generators by every substation, pilings,
  insurance, board-up and sandbags whenever a storm is named.

## Before (pre-pass build, medians over 5 seeds; "end" = Year 15)

| policy / size | years to Flagship | Y5 students / prestige / cash | end students / prestige / cash | worst end | notes |
|---|---|---|---|---|---|
| goals 96 | none in 15 | 4,490 / 43.8 / $34M | 1,323 / 1.5 / $89M | 487 students, prestige 1.2 | collapse from ~Y8 |
| goals 64 | none in 15 | 4,949 / 55.2 / $40M | 1,903 / 2.3 / $146M | 1,398 / 1.6 | collapse from ~Y8 |
| greedy 96 | **5** (5,5,5,5,6) | 9,741 / 81.9 / $5.7M | 10,871 / 62.1 / $12M | 10,605 / 55.8 | 1 bankruptcy card |
| greedy 64 | **5** (5,6,5,5,5) | 9,514 / 81.9 / $5.4M | 10,622 / 59 / $12M | 8,947 / 45.2 | 3 bankruptcy cards |
| passive 96 | none | 320 / 32.3 / $12.7M | 320 / 32.5 / $37M | — | stable, never dies |
| passive 64 | none | 320 / 32.3 / $12.9M | 320 / 32.4 / $38M | — | stable, never dies |
| storm 96 | 6 (6,5,none,5,8) | 9,118 / 73.5 / $3.7M | 1,490 / 3.5 / −$3.2M | 501 / 1.7 | 22 bankruptcy cards, 32 of 69 hits unrecovered |
| storm 64 | 5 (5,5,7,6,5) | 9,759 / 79.4 / $5.1M | 10,883 / 59.9 / $7.4M | 1,808 / 7.4 | 12 bankruptcy cards |

## Flagged and changed

### 1. Dead end: the sprawl sinks and never dries (every active policy, both sizes)

**Symptom.** From about Year 7 every campus that grew past the ridge went into a spiral: 15–60 halls flooded each
year with no surge at all, repairs never stuck (`dmgPerDay.flood` kept re-damaging them), blight took the prestige
target to 0, happiness to 0–30, applicants to 10–400, students fell 20–30 % a year, and the Issues tray's only answer
(a pump beside every flooded hall) made it worse. goals@64 seed 1 ended Year 15 with $49M in the bank, prestige 1.9
and 1,493 students; storm@96 seed 3 with −$4.6M, 501 students and 22 bankruptcy cards.

**Cause** (`--diag` on goals@64 seed 1, Jan 1 Y12, river and bayou stage 0): 37 of 110 halls had sunk ≥ 1 ft, 16
stood in 0.5–2 ft of water at −0.7 … −2.0 ft elevation — all on drained or wet marsh **without pilings** (pilings are
auto-applied on Marsh tiles only; Wet and Drained tiles place at full rate). `params.subsidence` gave a built drained
tile 0.35 ft/yr plus 0.06 for a pump within 8 tiles: a 2.5-ft tile reached the water line in six years. 21 pumps
beside dorms read −30 happiness (`noisePump` 2 each, uncapped) and 13 unrepaired halls plus a flooded core read −56
blight (uncapped) — the terms that turned a wet campus into zero applicants. Nothing in the goals pointed at the two
counter-moves the game has (`buildings.retrofitPilings`, `buildings.regrade`): the Sinking Feeling milestone is a toast.

**Changes.**
- `params.subsidence`: drainedBuilt 0.35 → 0.20, drainedBare 0.25 → 0.15, wetBuilt 0.12 → 0.08, pumpAdd 0.06 → 0.04
  (`contract.js`). A drained, pumped hall now sinks 0.24 ft/yr: the Sinking Feeling line (1 ft) still arrives around
  Year 5, the water line around Year 10 instead of Year 6.
- `params.econ.happiness.noiseCap` 10 (new leaf, applied in `economy.happinessRaw` like `floodCap`).
- `params.econ.prestige.blight.cap` 30 (new leaf, applied in `economy.prestigeTarget`): a battered campus keeps
  ~15–25 prestige and ~700 applicants instead of 0 and 60.
- A background goal **"Halls are sinking"** (`progress.js` `EXTRA_OBJ.sink1`, no contract change): offered when any
  complete hall without pilings has sunk past the Sinking Feeling line, done when none is left, re-armed 120 days later
  if another drops a foot; Show me pans to the worst hall; the Build it button arms the Pilings tool (`data.guide.sink1`).
  It outranks every other background goal, the flagship goal included (the first after-sweep showed it queued behind
  Objective 22 for the whole game: `progress.js` `bgPriority`).

### 2. Dead end for new players: the sewage cap behind the football chain

**Symptom.** goals@96 seeds 2–5 sat at 960–1,600 students from Year 2 to Year 5–7 with $11–35M unspent. The card
showed "Win four games in a season" for five seasons (0-7, 1-6, 2-5, 3-4 with a 1★ coach and prestige 33).

**Cause.** The single background slot is first-come: the football chain (15 → 18a → 18b → 18) took it in Year 1 and
Objective 17 ("Reach 1,500 students and build a Wastewater Plant", offered at 1,000) queued behind it for years while
`capacity.wastewaterBase` (1,500) capped enrollment — and sewage is not an Issues-tray term (only the HUD needs strip
shows it). With no growth goal on the card the player built nothing.

**Change.** `progress.js` `GROWTH` = {17, 19, 20, 21, 22} with `bgPriority` (sinking 2 > growth 1 > the rest 0): a
higher-priority goal jumps the background queue and displaces the active lower one (which goes back to the front and
is re-offered after), the same way storm interrupts preempt. (`test/unit/balance.test.mjs` §3–4.)

### 3. Pacing: the card goes silent from ~2,000 to 5,000 students

**Symptom.** Under goals, once 19 and 20 were done (Year 5–7) the card showed the Milestones panel until 5,000
students; growth fell to one hall per lock and cash piled up ($68M → $103M in two years at 5,000 students).

**Change.** `params.progress.goals.students21` 5,000 → 3,000: the bayou choice (21) and then the flagship goal (22) are
on the card from 3,000 students on. (The Issues tray and needs strip still carry the day-to-day growth.)

### 4. Pacing: the pool only just covers the churn of a flagship

**Symptom.** With items 1–3 in, goals campaigns climbed to 9,000–9,500 students by Year 8–9 at prestige 65–76 and
hung there (three of five seeds at 64, two of five at 96 never crossed 10,000); greedy crossed in Year 5–6 only by
cutting tuition to $3,000 (applicants × 1.35).

**Cause.** Students lose ~30 % a year (22 % graduate, 2 % + 8 % × (1 − happiness/100) leave each semester end), so
10,000 students need ~3,100 admits a year. The pool was 60 + 28 × prestige + 6 × happiness (× football buzz): at
prestige 70 and happiness 72 that is ≈ 3,100 — the steady state sat exactly on the finish line and the approach is
asymptotic.

**Change.** `params.econ.applicants.prestige` 28 → 31 (`contract.js`): the same campus draws ≈ 3,400 (steady state
≈ 11,300). 34 was tried first and put every goals seed at Year 7, under the band; 31 lands the median at 8. The Year-1
pool moves 700 → 730; `economy.selfTest` and `economy.test` compute the pin from the params.

### 5. Runner (not the game): tools/qa/campaign.mjs

New. `--policy goals|greedy|passive|storm|all --size 96|64|both --seeds N --years 15 --assert --tune --diag`; see
`tools/qa/README.md`. Its `goals` policy models the three guidance surfaces a new player sees (card, tray, needs strip);
anything it cannot do through a public API it does not do.

## After (this build, medians over 5 seeds)

| policy / size | years to Flagship | Y5 students / prestige / cash | Y10 students / prestige | end students / prestige / cash | worst end | hits recovered ≤ 2 seasons |
|---|---|---|---|---|---|---|
| goals 96 | **8** (7,12,7,8,8) | 6,332 / 66.9 / $23M | 10,768 / 71.2 | 11,595 / 72.5 / $575M | 9,762 / 61.7 | 55 of 63 (3 not, 5 unjudged) |
| goals 64 | **8** (7,8,8,7,8) | 6,766 / 68.1 / $28M | 11,145 / 70.7 | 8,400 / 43.2 / $505M | 5,756 / 26.9 | 48 of 66 (13 not) |
| greedy 96 | 6 (5,6,6,5,6) | 9,481 / 81.7 / $7.2M | 16,387 / 89.7 | 16,591 / 82.9 / $16M | 15,758 / 82.7 | 58 of 63 (0 not) |
| greedy 64 | 5 (5,5,5,6,5) | 10,725 / 82.2 / $7.9M | 16,369 / 86.8 | 16,043 / 81.8 / $19M | 15,255 / 81 | 50 of 55 (0 not) |
| passive 96 | none | 320 / 32.8 / $12.5M | 320 / 32.4 | 320 / 32.5 / $36M | — | 18 of 19 |
| passive 64 | none | 320 / 32.1 / $12.9M | 320 / 32.5 | 320 / 32.4 / $38M | — | 8 of 9 |
| storm 96 | 5 (5,5,6,5,5) | 10,167 / 80.2 / $7.2M | 15,389 / 80.8 | 14,889 / 71.3 / $15M | 10,437 / 53.1 | 60 of 68 (3 not) |
| storm 64 | 5 (5,6,5,5,5) | 10,791 / 80 / $7.1M | 16,520 / 86.7 | 15,679 / 72.8 / $12.5M | 11,324 / 58.2 | 60 of 71 (6 not) |

`node tools/qa/campaign.mjs --from tools/qa/out/campaign-after.json --assert --size both`: every band holds (goals
median 8 at both sizes, greedy never under 5, passive never dies, storm's direct hits recovered within two seasons
with ≤ 25 % exceptions). No bankruptcy card under goals or passive on any seed; no `BSU.error` on any run.

What is still visible in the after tables: the goals player at 64 declines after the win (11,145 at Year 10 → 8,400
at Year 15, prestige 70 → 43) as the small map runs out of dry land and ecology reaches 0, and every goals campaign
ends with $280–575M unspent (the money question below). The weight-34 sweep that overshot is kept as
`tools/qa/out/campaign-after-p34.*`.

## Judged design questions, left alone

- **Money has no late sink.** At 2,500+ students every policy nets $3–5k per student per year after construction
  (tuition is 2 × $6,500, salaries $5,400); a goals player who stops building holds $100M+ by Year 10. The endowment
  (Year 5+, 4.9 %/yr) compounds it. Raising per-student costs enough to matter makes Year 1–2 bankrupt-prone for a
  careful player (goals dips to −$1.2M in Year 2 as it is), so this is left as designed: the sinks are the Cauldron,
  Stadium III ($32M), the West Campus ($20M), sections and the endowment.
- **Football is a prestige fountain.** A $500k coaching slider, Bayou Field and a stadium give 7-1 / 8-0 seasons from
  Year 4 on every seed; the bowl (+5), the Golden Pirogue (+3) and Undefeated (+5) then add up to +13 prestige a year on
  top of a structural target of 45–50. It is why prestige 60 arrives by Year 5 while students lag; it is also most of
  what a goals player enjoys. Opponents do not scale with the years (`oppPerYear` is unused). Not changed.
- **greedy wins in Year 5.** The band says not under 5 and the median is exactly 5 with the worst seed at 5. Slowing
  it means slowing everyone (applicants, churn) and the goals player is the one who needs speed. Josh confirmed on
  2026-11-08: leave greedy alone.
- **The Issues tray's capacity family has no sewage row** and its flooded-hall Fix is always a pump; the needs strip
  covers sewage and the new goal covers sinking, so `issues.js` was left alone (it was outside this pass's files).
- **Skeeter Beater and Storm Chaser are free in Year 1** on every seed (a small campus has no standing water in August;
  Célestine is a scripted Cat 2). Harmless.
- **Ecology reaches 0 under storm/greedy at 64** (150+ halls on 1,671 original wetland tiles, levees on marsh,
  foggers) — the designed cost of paving the swamp.
- **96 vs 64.** The early game is the same (the start charter is the legacy rectangle; Year 1–3 tables match to the
  dollar on the same seed). The 96 world is slower to collapse (more dry land north) and richer only through sections,
  which no policy needed before Year 8.
