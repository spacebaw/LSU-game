# Brief: `src/js/economy.js` → `BSU.economy`

Read first: `docs/ARCHITECTURE.md` §1 (row 7), §2.7 (`economy`, `ledger`, the fixed income/expense keys), §2.9 (`progress.timers` — you read them), §3.2 `params.econ` (every constant), §3.4 events, §5.1 step 7 and step 10 (the ecology mirror), §5.7 (API + the happiness/prestige paragraph), §5.6 `stats()` (what buildings gives you), §5.8 `agents.sample()`, §8.4 (autosave after the monthly step is session's), §10.3 (no `Infinity` anywhere in state), §10.5–10.6, D23, D24, D28, D37, D46, D49, D53; `docs/GDD.md` §5 (all: 5.1–5.9), §4.11 (coverage penalty inputs), §6.2 Recovery (disaster grant, boil water dining), §6.4 Threat (illness, biblical), §6.6 (heat penalty), §6.8 (state funding −15% below 30), §7.1 (voice payoffs that are money/applicants), §8 (athletics revenue is posted by sports; you only book it), §9.2 (dates), §10.7 (failure states), §10.8 (Endowment, Second Campus), §11.5 (Budget panel lines), §14.4 lines 5, 23, 36, 52, 55.

---

## 1. Purpose and public surface

All money and the five displayed stats. Books every income/expense into the ledger, runs rolling admissions, the prestige target and its monthly lerp, the happiness formula (abstract + sampled + the timer table) and its per-tick EMA, capacity, applicants, runway, salaries/utilities/upkeep/interest, donations/research/parking/pelts/endowment, state funding, tuition installments, attrition/graduation, the failure-state checks, Board/failure card money effects, Endowment and the Second Campus. Copy the API from ARCHITECTURE §5.7 verbatim. Additions:

```js
BSU.economy.addAttrition(state, frac) → void      // weather (hurricane party +.02, unsheltered +.02): adds to economy.attritionBonus for the current semester (add `attritionBonus: 0` to the branch lazily in reset if contract lacks it — it must save, so it lives in state.economy)
BSU.economy.buildingValue(state) → number         // Σ row.cost of complete buildings (insurance premium base)
BSU.economy.happyTerms(state) → Object            // = state.economy.happyTerms (popover)
BSU.economy.timerValue(state, id) → number        // 0 if absent, else the timer's value (helper over progress.timer)
BSU.economy.consumeTimer(state, id) → number      // returns the value and removes it (one-shot timers: lobby, biblicalApplicants, voiceApplicants)
BSU.economy.setSuspendCapPenalties(state, on) → void   // progress (Objective 3) / session (skipTutorial → false)
BSU.economy.setSuppressCoverage(state, on) → void      // progress (Objective 5) / session (skipTutorial → false)
```

## 2. State fields

**Writes (owner):** `state.economy.*` (all of §2.7), `state.ledger.*`. Never writes `wildlife.ecology` (session mirrors it into `economy.ecology`, D24 — you may read `economy.ecology` as the HUD value; for formulas read `wildlife.ecology(state)` directly to avoid one-tick lag). Timers: added/removed only through `progress.addTimer/removeTimer` (the branch is progress's).

**Reads:** `buildings.stats/upkeepTotal/list/count/has/effective/buildingValue inputs`, `agents.sample/classAttendance`, `wildlife.mosqIndex/ecology/sickToday/gatorPenalty` (queries) and **`state.wildlife.biblicalDays` / `state.wildlife.sick`** (state fields — never `BSU.wildlife.biblicalDays`, D46), `sports.season()` (`record`, `lastSeason`, `venue`, `coach`), `weather.date/isDate/heat/storm`, `progress.timers/timer/offered/tutorialStage`, `state.storms.log/lastLandfallDay`, `state.setPiece`, `state.tick`.

Every emit goes through `M._deps.emit` (default `BSU.events.emit`) so `selfTest` can record instead of broadcasting (§10.6).

## 3. Events

**Emits:** `econ:income{key, amount, i?, note?}` / `econ:expense` on every ledger post; `econ:month{statement}` after the monthly step; `econ:stat{stat, value, delta}` whenever a displayed stat changes (cash on every post; students on every change; prestige/happiness/ecology on the daily/monthly writes — for happiness, emit at most once per 10 ticks when the rounded display value changes); `econ:card{kind, options}` (failure cards; progress shows/resolves); `enroll:round{day, admitted, students, capacity, applicants, kind}` / `enroll:lock`; `enroll:attrition{count, students}` / `enroll:graduation`.

**Listens (owner `'economy'`):** `storm:report{report}` → insurance payout (post income `insurance` = `.5 × report.bill` if the `insurance` timer exists) and schedule the disaster grant (`disasterGrantDay = lastLandfallDay + 20`, `disasterBill = report.bill` — store in `economy` as `pendingDisaster: {day, bill}` lazily initialized); `game:final` → nothing (sports posts revenue itself via `post`); `festival:start` → festival revenue: `mardiGras` (Feb 6): `50000 + 5 × students` (×2 with a complete Union) → income `festivals`; `crawfish` boil is on **Apr 5** (not the festival start): use `isDate('Apr 5')` in the daily step: `20000 (+10000 with Union)`; `homecoming` (Oct 7): `30000`; `milestone:earned{reward}` → cash/prestige rewards are applied by **progress** through `post`/`bump` (do not double-apply here); `building:complete{type:'poboy'}` nothing (monthly loop reads).

Listeners record; work happens in `tick`.

## 4. Rules checklist

### Tier 1

**Start (§5.1)**: `newState` seeds `cash 4000000, students 0, prestige 10, happiness 60, happinessRaw 60, tuition 6500, quality 'basic', selectivity 'open', coaching 0, ticket 35, autoRepair true, loanLimit 2000000, pool 0, suspendCapPenalties true, suppressCoverage true`. `reset(state, fresh)`: when `fresh === true` compute `applicants = applicants()` once, `capacity` and `runway`; when `fresh === false` (load) recompute nothing that is saved — only lazily initialize the saved keys contract.js lacks (`attritionBonus ??= 0`, `pendingDisaster ??= null`, `admittedSinceLock ??= 0`, `cancelledSemester ??= false`, in both cases). Economy never draws `rng.sim`. skipTutorial: session sets both suppression flags false and calls `addStudents(120,'founding')`.

**Ledger mechanics (§2.7)**
- [ ] `post(state, key, amount, meta)`: `amount > 0`, `key` ∈ the income list; `cash += amount`; `ledger.month.income[key] += amount`; `ledger.year.income += amount`; emit `econ:income` and `econ:stat{cash}`. `charge(state, amount, key, meta)`: `canAfford` unless `meta.force` (upkeep, salaries, utilities, interest, coaching always post); `cash −= amount`; `ledger.month.expense[key] += amount` (`construction` also `ledger.year.construction`); emit `econ:expense`, `econ:stat{cash}`; return true/false. `refund(amount, meta)`: income key `misc` with `note:'refund'`? Use `demolition` as a **negative expense**? Keep it simple: refunds post to expense `demolition` as a negative number? No — decision: `refund` posts income `misc` with `note: 'refund'`. All amounts are integers (`Math.round`).
- [ ] `canAfford(cost)`: `cash − cost ≥ −loanLimit`.
- [ ] Monthly (1st, in `tick` when `flags.newMonth`, **before** anything else that month): close the statement: `ledger.last = {income: {...month.income}, expense: {...month.expense}, net}`; reset `month` to zeros for every key (every key present, in the fixed order); then the monthly charges/incomes below; then emit `econ:month`. (Session autosaves after `economy.tick`.)
- [ ] Jan 1: push `ledger.history` row `{year: year−1, students, cash, prestige, happiness, ecology, wins, losses, tarps}` (wins/losses from `sports.lastSeason`, tarps from the year's `storms.log`) then reset `ledger.year`. Skip on Year 1's Jan 1 (tick 0).

**Money sources (§5.2)**
- [ ] Tuition installments on `Aug 5, Oct 5, Jan 5, Mar 5`: `post('tuition', round(students × tuition × 0.5))`; skipped for the semester if `progress.failure` says "Semester Cancelled" (`economy.cancelledSemester` day range — see failure). Year 1 Jan 5 charges the 120 (they arrive at tick ~350 in the tutorial, day 3; if `students === 0` on Jan 5 nothing posts — accept). With `summerSession` timer: May 6 → `post('tuition', round(students × tuition × .15))`.
- [ ] State funding Jul 1: `students × 2500 × (0.6 + 0.8 × prestige/100) × (ecology < 30 ? .85 : 1) × (1 + consumeTimer('lobby'))` → `state`.
- [ ] Donations monthly: `alumni × 8 × (0.5 + prestige/100) × min(2, 1 + 0.1 × sports.lastSeason.wins) × (month === 10 ? 3 : 1) × timerValue('undefeatedDonations') || 1 × timerValue('rivalryDonations') || 1` → `donations` (post only if ≥ 1).
- [ ] Research monthly: Engineering (complete, `effective > 0`): `12000 × (0.5 + prestige/100) × effective`; Coastal: `10000 × (ecology/50) × (0.5 + prestige/100) × effective × (has('marsh_restoration') complete ? 1.25 : 1)`; total × `(1 + timerValue('researchBonus'))` × `(timerValue('researchPush') || 1)`; brownout or blackout (`stats().brownout` or the hall's `blackout`) → 0 → `research`.
- [ ] Parking monthly: `min(lots, ceil(students/600)) × 4000` → `parking`; ticker line 5 occasionally (progress).
- [ ] Po'boy monthly: `2000 × effective` per shack (+3000 with `voicePoboy` meta.building) → `misc`? Use key `misc` with `note:'poboy'` — the Budget panel shows "Po'boy" as its own line in the GDD mock; **decision:** post under `misc` with `note: "Po'boy"`; the panel groups `misc` notes.
- [ ] Pelts monthly: `500 × posts with data.policies.nutriaBounty` → `pelts`.
- [ ] Endowment monthly (Year ≥ 5): `endowment × 0.004` → `endowment`. `endow(state, amount)`: Year ≥ 5, amount a multiple of 1,000,000, `cash ≥ amount` → `cash −= amount`, `endowment += amount` (expense key `misc`, note 'Endowment'); irreversible.
- [ ] Disaster grant: on `pendingDisaster.day`: `min(800000, .4 × bill) × (ecology ≥ 50 ? 1.25 : 1)` → `disaster`; ticker line 55 (progress listens to `econ:income{key:'disaster'}`).
- [ ] Tutorial grants ($50k × 10) and milestone cash: **progress** posts them (`post('grants', 50000)`); economy does nothing special.
- [ ] Athletics/tailgate: sports posts `athletics` / `tailgate`; club games `$20k` → `athletics`.

**Costs (§5.3)** — monthly on the 1st (all `force: true`):
- [ ] Upkeep: `buildings.upkeepTotal() × (1 − timerValue('austerityUpkeep'))` → `upkeep`; pump running `3000 × pumpsRunningDays/… ` — simpler: daily accumulate `runningCost += 3000/10 per running pump per day` (× 2 while `storm.preDrain`) and `2000 per running generator per day`; post the accumulated total on the 1st as `utilities`? Keep `upkeep` for pumps and `utilities` for generators? **Decision:** both go to `upkeep` with notes.
- [ ] Salaries: `students × 450 × qualityMult[quality]` → `salaries`.
- [ ] Utilities: `(300 × completeBuildings + 8 × students) × (month ∈ 6..9 ? 1.5 : 1)` → `utilities`.
- [ ] Coaching: `coaching / 12` → `coaching`.
- [ ] Interest: if `cash < 0`: `round(−cash × .01)` → `interest`, `interestPaid +=`.
- [ ] Insurance premium: `buildingValue × .02 / 12` while the `insurance` timer exists → `boardCards`.
- [ ] Repair (auto-repair): buildings charges `repair` as it goes; nothing monthly.
- [ ] Bankruptcy counter: after the monthly charges, `negMonths = cash < −loanLimit ? negMonths + 1 : 0`.

**Enrollment (§5.4)** — the formulas, verbatim:
- [ ] `applicants = (60 + 28 × prestige + 6 × happiness) × tuitionFactor × footballBuzz × applicantsMult + applicantsAdd`, recomputed on the 1st (and at `reset`, and by `previewApplicants(tuition)` with the slider value); `tuitionFactor = clamp(1.65 − tuition/10000, 0.3, 1.5)`; `footballBuzz = 1 + 0.03 × lastSeason.wins + (lastSeason.bowlWon ? 0.10 : 0)`; `applicantsMult = (1 + timerValue('tuitionFreezeApplicants')) × (1 + timerValue('tuitionHike')) × (1 + timerValue('probation')) × (1 + timerValue('biblicalApplicants'))` (values −.4, −.5, −.1 are negative); `applicantsAdd = timerValue('voiceApplicants')` (consumed at the next lock) + `(westCampus ? .25 × base : 0)` (BSU West ×1.25). Round to an integer.
- [ ] `capacity = min(beds × 1.15, seats × 1.4, dining × 1.6, wastewaterCap)` with `beds/seats/dining` from `stats()` (already `× effective`, so 50% buildings count half); `wastewaterCap = plants === 0 ? 1500 : 6000 × plants`; while `suspendCapPenalties` the wastewater cap still applies (it is the "1,500 without a plant" brake). `capacityTerms` stored. Recomputed daily.
- [ ] `accepted = applicants × selectivity[open 1, selective .6, elite .35]`; `pool` = `accepted − admitted since the last Aug 5` → maintain `pool` as a counter: on Aug 5 (after the lock) `pool = accepted − (students admitted at the lock)`; on the 1st recompute `pool = max(0, accepted − admittedSinceLock)` (keep `admittedSinceLock` in `economy` lazily).
- [ ] Rolling round on the 5th of every month except Aug and Jan (`dom === 5 && month ∉ {1, 8}`): `n = min(pool, round(0.20 × max(0, capacity − students)))` → `addStudents(n, 'pirogue')`, `pool −= n`, emit `enroll:round{kind:'rolling'}`.
- [ ] Spring lock Jan 10: `n = min(pool, round(0.25 × gap))` → `enroll:lock{kind:'spring'}` (also a pirogue arrival). Fall lock Aug 5: `n = min(accepted, gap)` (the whole pool: `pool = accepted` first) → `enroll:lock{kind:'fall'}` (buses + pirogues: agents decides the mix by count). Also Aug 5 and Jan 10: ask progress for the Board offer (`progress.offerBoard(state)` — Tier 2 except Insurance; Tier 1: call it, progress decides).
- [ ] `addStudents(state, n, source: 'pirogue'|'bus'|'founding'|'debug')` (D53, ARCHITECTURE §5.7): **only** `students += n` (the lock formula already caps; `founding` 120 ignores capacity), `admittedSinceLock += n`, emit `econ:stat{students}`. **It emits NO `enroll:*` event and spawns nothing**: `enroll:round{kind:'rolling'}` / `enroll:lock{kind:'spring'|'fall'}` are emitted by the rolling-round and lock steps themselves *after* they called `addStudents` (agents listens to those and calls `spawnArrival`); the founding cohort is `spawnArrival`ed by progress (browser) or pre-spawned by session via `regenerate` (skipTutorial) and `addStudents(…, 'founding')` is called by progress on `agent:arrive` (browser) or by session before `regenerate` (skipTutorial); `'debug'` (Fill dorms) relies on agents' daily reconcile. Year 1's founding cohort is outside any round.
- [ ] Attrition on Dec 10 and May 5: `n = round(students × (0.02 + (100 − happiness)/100 × 0.08 + attritionBonus))`, floor `students − n ≥ 60` (`minStudents`); `students −= n`; `attritionBonus = 0`; emit `enroll:attrition`. `×2` while "Semester Cancelled" is in force. Graduation May 5 from Year 2: `g = round(0.22 × students)` **before** attrition: `students −= g`, `alumni += g`, emit `enroll:graduation`. Order on May 5: graduation → attrition → the rolling round (May 5 is a 5th) → then progress starts the Graduation set piece (progress listens to `enroll:graduation`).
- [ ] Students never fall below 60 (any subtraction clamps).

**Prestige (§5.5)** — target on the 1st, then `prestige += 0.06 × (target − prestige)`; instant bumps (`bump(state, 'prestige', d)`) add directly and clamp 0–100:
- [ ] `academicQuality = clamp(40 × min(1, seats/(1.2 × max(1, students))) + 20 × library + 20 × engineering + 20 × coastal, 0, 100) × (0.9 + 0.2 × classAttendanceMean)` where the three flags are complete buildings with `effective > 0` and `classAttendanceMean` = mean of `attendanceCycles` since the last 1st (`agents.classAttendance()` pushed at each Dusk by economy's tick: on `sky:phase{DUSK}` — economy subscribes and pushes; default 1 if empty).
- [ ] `facultyScore = 70 × qualityMult` (70 / 87.5 / 100 cap → `min(100, …)`).
- [ ] `football = hasTeam ? min(100, 40 × winPct + 20 × stadiumTier) : 0` (`winPct` = last season's, or the current season's if games were played; `stadiumTier` = 0 none/bayou field? Bayou Field is tier 1 of the practice field, **not** a stadium tier → 0; Stadium I–III = 1–3).
- [ ] `landmarks = clamp(2 × stats().landmarks, 0, 100)`.
- [ ] `ecologyBonus = ecology × (coastalInstitute ? 1 : 0.4)`.
- [ ] `selectivityScore = {open: 0, selective: 40, elite: 100}`.
- [ ] `blight = 3 × unrepaired + (floodedCore ? 8 : 0) + (mosqIndex > .6 ? 5 : 0) + (state.wildlife.biblicalDays > 0 ? 5 : 0)` — GDD §6.4 says biblical (> .5) is −5 blight; §5.5 says index > .6 is −5; use **one** term: `(mosqIndex > 0.5 ? 5 : 0)` (decision, matches "while it lasts") — plus `(blackoutDays > 3 ? 1 : 0)` (§6.2 Power).
- [ ] `target = 0.22 × academicQuality + 0.14 × facultyScore + 0.16 × happiness + 0.16 × football + 0.12 × landmarks + 0.10 × ecologyBonus + 0.10 × selectivityScore − blight + (rookery ? 1 : 0)`; store `targets.prestige` and `targets.terms`.
- [ ] Probation: `prestige < 5` for a year, or `seats < students/2` for two consecutive semester ends → `econ:card{kind:'probation'}` once; while `progress.failure.probation`: `applicants × .5` (the `probation` timer); exits when `prestige > 15` (progress removes the timer).

**Happiness (§5.6)** — daily raw, per-tick EMA:
- [ ] Abstract: `housing = min(12, quality × 4) − (beds < students && !suspendCapPenalties ? 10 : 0)`; `dining = 8 × diningCovered − (feeds === 0 && !suspendCapPenalties ? 10 : 0)`; `spirit = 2 × homeWinsThisSeason + (rivalryTimer ? 6 : 0) + festivalSpirit` where festival spirit is +5 during Mardi Gras (Feb 6–8) and Crawfish (Mar 1–Apr 10) and Homecoming (Oct 7–8; +5 with a bonfire = a complete Quad Lawn, else +2) + Dec 9 `min(10, 2 × floor(leveeTiles/10))`; `flood = min(20, 4 × floodedBuildings) + (anyDormFlooded ? 10 : 0)`; `gator = wildlife.gatorPenalty(state)` (3 per incident in the last 10 days, cap 15); `heat` = sampled (below); `tuition = max(0, (tuition − 7000)/400)`; `crowd = 10 × max(0, students/max(1, seats) − 1)`; `noise = roadAdjacentDorms × 1 + pumpsNearDorms × 2 + barriersNearDorms × 2` (from `stats()`).
- [ ] Sampled (yesterday's completed day from `agents.sample()`): `life = min(12, sample.life)`, `green = min(10, sample.green)`, `mosquito = 25 × sample.mosq` (or `25 × mosqIndex` when no agents), `heat = sample.heat` (0–10; the per-tile penalty is `(index − 92)/2` capped 10 on advisory days × shade/pool multipliers, computed by agents from `weather.heat` and `buildings.auras().shade/heat`).
- [ ] `events = Σ value` of active timers whose id ∈ `HAPPY_IDS` (below); the flat ones are maintained by economy **daily**: `bellTower` (+3 while a complete Bell Tower with `effective > 0`), `wastewater` (−8 while `students > 1500 && plants === 0`), `brownout` (−5 while `stats().brownout`), `floodwallView` (−1 per dorm within 3 of a floodwall with no adjacent oak, cap −5), `noParking` (−4 while `lots < ceil(students/600)` and `students > 0`), `nutriaBounty` (+1 while any post's bounty is on), `freePermits` (+3 while `sports.permits === 'free'`), `surgeBarrier` (−2 per dorm within 4) — add with **`days = -1`** (open-ended; the live timer holds `untilDay: -1`, never `Infinity` — D23, §10.3) when the condition holds and `progress.removeTimer` when it stops. Readers: a timer is active while `untilDay === -1 || untilDay > day`.
- [ ] `raw = 50 + housing + dining + life + green + spirit + events − mosquito − flood − gator − heat − tuition − crowd − noise`, clamped 0–100 → `happinessRaw`; `happyTerms` = every term by name (+ each timer by id).
- [ ] Per tick: `happiness += (happinessRaw − happiness) / 100` (1-day EMA), seeded 60. The HUD never jitters; `econ:stat{happiness}` when the rounded value changes.
- [ ] While `suspendCapPenalties` (until Objective 3) the two −10 terms are off → ~58–62 in the first minute.

**Timer registry (canonical; `progress.md` repeats it verbatim).** `HAPPY_IDS = [bellTower, wastewater, brownout, floodwallView, evacuation, unsheltered, boilWater, playThroughIt, austerity, sunbather, tuitionFreeze, homecomingBudget, bigBoil, noParking, nutriaBounty, freePermits, surgeBarrier, gatorPool, beads, hurricaneParty, goForIt, studentVoice]` with the §5.6 values/durations, **plus `rivalrySpirit` (+6, 7 days; added by sports on beating Magnolia) which economy folds into the `spirit` term rather than `events`** (it is a §5.6 spirit component expressed as a timer so it expires by itself). Effect timers (value semantics; adder → reader): `insurance` (.02, days −1 = open-ended; progress → economy premium/payout) · `lobby` (.10, until consumed Jul 1; progress → economy) · `researchPush` (1.5 multiplier, 120 d; progress → economy) · `recruitingTrip` (3, until Dec 9; progress → sports) · `summerSession` (1, 120 d; progress → economy/agents/heat ×1.5 in agents' heat term) · `tuitionLock` (1, 120 d; progress → economy.setTuition refuses, ui disables) · `tuitionFreezeApplicants` (.10, 120 d) · `tuitionHike` (−.40, 120 d; progress also sets tuition += 3000) · `austerityUpkeep` (.30, 120 d) · `noConstruction` (1, 30 d; buildings.canPlace refuses `'Austerity'`) · `probation` (−.5, days −1 = open-ended until prestige > 15; progress) · `biblicalApplicants` (−.10, until the next lock; wildlife's `biblicalDays ≥ 20` → **economy adds it** (allowed: economy calls `progress.addTimer`)) · `voiceApplicants` (+40/+60 additive, until the next lock; progress) · `pilingsDiscount` (.25, days −1 = open-ended, meta {building}) · `pilingsDiscountYear` (.25, 120 d) · `postUpkeepHalf` (.5, days −1 = open-ended) · `researchBonus` (.10, days −1 = open-ended) · `undefeatedDonations` (1.5, 120 d) · `rivalryDonations` (1.3, 10 d) · `cajunNavy` (1, 3 d) · `voiceTeamRating` (2, until Dec 9) · `voiceTailgate` (.25, until Dec 9) · `voicePoboy` (3000, days −1 = open-ended, meta {building}) · `voiceHeatIllness` (.2, until Aug 4) · `voiceFoggerWaiver` (1, 30 d) · `voiceCypressLine` (1, days −1 = open-ended, meta {tiles}) · `zydecoFriday` (1, days −1 = open-ended) · `voiceParking` (2000, days −1 = open-ended; added to the monthly `parking` income). Open-ended timers are added with `days = -1` and hold `untilDay: -1` in the live state and in the save alike (no translation anywhere); `Infinity` never appears in `BSU.state` (D23, §10.3). The `football` prestige term is capped at 20 while `sports.season().clubOnly` (away-only club schedule).

**Capacity chip, runway, breakdowns**
- [ ] `runway()`: `monthlyBurn = last month's expense total (or the projection: salaries + utilities + upkeep + coaching/12)`; `nextPayDay` = the next tuition installment day; `months = cash ≤ 0 ? 0 : floor(cash / max(1, monthlyBurn))`; `red = cash − monthlyBurn × (daysUntilPay/10) < 0`. Stored in `economy.runway` daily.
- [ ] `breakdown(state, stat)`: `cash` → last month's top-3 income and expense lines + `next: 'Next: tuition {date}'`; `students` → capacity terms and the next round; `prestige` → `targets.terms` sorted by contribution, `next` = the largest missing term; `happiness` → `happyTerms` top 3 positive and negative, `next` = the nearest threshold ("Next: −4 no parking at 600 students"); `ecology` → `wildlife.ecologyTerms`; `applicants` → the four factors; `capacity` → the four terms with the binding one flagged. Plain words, no formulas.
- [ ] Sliders: `setTuition(v)` (clamped 3000–15000, step 250; refused under `tuitionLock`), `setQuality`, `setSelectivity`, `setCoaching` (0–3,000,000; sports reads), `setTicket`, `setAutoRepair`; each emits `econ:stat` for the affected preview? No — just write; ui refreshes. Ticker line 23 on a tuition **increase** (progress listens to a new event? none exists → economy calls `progress.ticker(state, 23)` directly; allowed: it is progress's action function).
- [ ] `charterWest(state)` (Year ≥ 5, `cash ≥ 20000000`, a Road bridge across the bayou exists (`buildings.stats().bridges > 0` — add to stats), ≥ 12 complete buildings with `tx < bayouX(ty)`): charge `20000000` (`construction`), `westCampus = true`, `buildings.placeWestHall(state)` (Tier 2), applicants ×1.25, landmark +10 via `stats()`.
- [ ] `applyCard(state, cardId, option)`: money/tuition effects: `lobby` −100000 (`boardCards`), `researchPush` −200000, `recruitingTrip` −150000, `marshGrant` +300000 (`grants`), `tuitionFreeze` (nothing here), `summerSession` (nothing), `insurance` (nothing; premium monthly), `homecomingBudget` −0/50000/150000 (`boardCards`) + `bump('prestige', 0/1/3)`; failure: `austerity` (nothing here; timers), `hike` → `tuition += 3000` (clamp 15000), `naming` → `post('donations', 1000000)`, `bump('prestige', −3)`, rename a random complete hall to `'Boudreaux Petroleum Hall'` via `buildings.rename` (ticker 52 with `{hall, family}` by progress), `receiver` → nothing until exit: `cash = 0` and `bump('prestige', −20)` at exit; `underwater` → `cancelledSemester = true` until the next installment date passes (no tuition, attrition ×2), `bump('prestige', −15)`, `post('grants', 3000000)`, a free pump: `buildings.place('pump', …, {ignoreCash:true, instant:true})` at a ridge tile touching a canal or water (search near the plot; skip if none). Timers themselves are added by progress.

**Failure checks (§10.7, monthly)**
- [ ] `negMonths ≥ 3` and no bankruptcy card pending → `econ:card{kind:'bankruptcy', options:[austerity, hike, naming]}`; progress shows it and calls `answerFailure`; if unanswered/rejected for 60 more days (progress tracks `failure.receiverUntilDay`), the receiver year: economy runs normally; `progress` drives autopilot.
- [ ] Underwater: `> 50% of complete buildings flooded for 15 consecutive days` (`progress.failure.underwaterDays` is progress's — economy computes the daily share and calls `progress.reportUnderwater(state, share)`; decision: economy keeps `underwaterDays` in `progress.failure` via progress API) → `econ:card{kind:'underwater'}`.
- [ ] Probation as above.

**Stat events**: `bump(state, stat, delta, why)`: `prestige` → direct add (clamp), `econ:stat`; `happiness` → `progress.addTimer('bump:' + why, delta, 10)`? The ARCHITECTURE says "happiness bumps go through timers": milestone happiness effects are already named timers (`sunbather`, `bigBoil`); `bump('happiness')` is therefore only for debug "Set happiness": write `happiness = happinessRaw = v` directly when `why === 'debug'`. Decision recorded.

### Tier 2

- [ ] Board cards other than Insurance (`applyCard` branches above exist in Tier 1 as cheap code; the offer UI is Tier 2).
- [ ] Second Campus UI; Endowment UI beyond the button.
- [ ] Voice-card money payoffs (`voicePoboy`, `voiceApplicants`) — trivial reads; do in Tier 1.

## 5. Edge cases and invariants

- All money integers; never NaN: guard `students === 0` divisions (`max(1, students)`), `seats === 0`.
- `prestige`, `happiness`, `happinessRaw` ∈ [0,100]; `students ≥ 60` once founded (before the founding cohort `students === 0` is legal); `alumni ≥ 0`; `pool ≥ 0`.
- `cash` may go negative to `−loanLimit − (forced charges)`: forced charges can push below the line (that is what triggers bankruptcy); construction cannot.
- The monthly step runs **once** per month boundary even if several ticks are skipped (use `flags.newMonth`, not date equality).
- Dated steps use `weather.isDate` on `flags.newDay` only (a date fires once).
- Set pieces: calendar frozen → no daily/monthly work; the EMA still moves each tick (fine).
- Load (`reset(state, false)`): nothing to rebuild (`attendanceCycles`, `pendingDisaster`, `admittedSinceLock`, `attritionBonus`, `cancelledSemester` must live in `state.economy` so the structural save writes them — initialize lazily in `reset` with `??=` for both `fresh` values). No state on the module object (D46).
- Never `Infinity`: `pendingDisaster.day`, `runway.nextPayDay` and every `*Day` use `-1` for "none" (§10.3).
- Headless: identical; the smoke test asserts `cash` finite and `students ≥ 0` after a year and a hurricane.
- Determinism: no randomness in economy at all (nothing here needs `rng`).

## 6. selfTest() requirements

Private `BSU.newState(3)`; inject `M._deps` stubs for `buildings.stats/upkeepTotal/has/list`, `agents.sample/classAttendance`, `wildlife.*`, `sports.season`, `progress.timers/timer/addTimer/removeTimer` (an in-memory array), and replace `M._deps.emit` with a recorder for the duration (restored in `finally`) — `econ:*`/`enroll:*` must never reach the live bus (§10.6). Assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`).

1. §5.4 worked numbers: prestige 10, happiness 60, tuition 6500, no wins → `applicants === 700` (60 + 280 + 360 = 700 × 1.0); one dorm (beds 300), seats 300 (Founders'), feeds 1200, no plant → `capacity === 345` (min(345, 420, 1920, 1500)); Jan 10 spring lock from 120 → `+56 → 176`; Feb 5 rolling → `+34 → 210`; Mar 5 → `+27 → 237` (run the round functions directly with the stubbed capacity).
2. `tuitionFactor`: 6500 → 1.0; 3000 → 1.35; 12000 → 0.45 (±1e-9).
3. Prestige target with the worked inputs (seats 300, students 120, no halls, quality basic, happiness 60, no team, landmarks 2 (Founders'), ecology 82 no institute, open, no blight): `academicQuality = 40 × 1 = 40`, target = `.22×40 + .14×70 + .16×60 + 0 + .12×4 + .10×32.8 + 0 = 8.8 + 9.8 + 9.6 + .48 + 3.28 = 31.96`; lerp from 10 → `11.3176`.
4. Happiness raw with the first-minute inputs (`suspendCapPenalties` true, quality 2 → housing 8, diningCovered 1 → 8, life 0, green 0, tuition 0, crowd 0) → 66; with the penalties on and beds < students → 56.
5. Attrition at happiness 60: `students 1000 → −52` (5.2%); floor at 60: `students 62 → 60`.
6. Salaries: 1000 students, elite → 720000; utilities in July with 10 buildings → `(3000 + 8000) × 1.5 = 16500`.
7. Ledger: `post('tuition', 100)` then `charge(50, 'upkeep', {force:true})` → `cash === start + 50`, `month.income.tuition === 100`, the monthly close moves them to `last` and zeroes `month` with every key present.
8. `canAfford`: cash 0, cost 2,000,000 → true; 2,000,001 → false.
9. State funding: 496 students, prestige 14, ecology 80 → `496 × 2500 × .712 = 882,880`.
10. Runway: cash 1,000,000, burn 300,000 → 3 months; `red` when cash < burn × days-to-payday/10.
11. Every id in `HAPPY_IDS` is accepted by the happiness sum (a timer with an unknown id contributes 0 and is reported in `notes`, not thrown); a timer with `untilDay: -1` is counted as active on day 10,000.
12. `addStudents(s, 30, 'pirogue')` records exactly one `econ:stat{stat:'students'}` and NO `enroll:*` event; running the Feb 5 rolling-round step records one `enroll:round{kind:'rolling'}` after the count changed.

## 7. Testing in isolation

```js
// scratch/test_economy.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  const timers = [];
  BSU.progress = { timers(){ return timers; }, timer(s,id){ return timers.find(t=>t.id===id)||null; }, addTimer(s,id,v,d,meta){ const t=timers.find(t=>t.id===id); if(t){t.value=v;t.untilDay=d;} else timers.push({id,value:v,untilDay:d,meta}); }, removeTimer(s,id){ const k=timers.findIndex(t=>t.id===id); if(k>=0) timers.splice(k,1); }, offered(){ return true; }, ticker(){}, offerBoard(){}, failure:{}, reportUnderwater(){} };
  BSU.buildings = { stats(){ return {beds:300,seats:300,feeds:1200,diningCovered:1,landmarks:2,oaks:2,cypress:0,stockedPonds:0,posts:0,quality:2,lots:0,unrepaired:0,floodedCore:false,brownout:false,pumpsRunning:0,generatorsRunning:0,roadAdjacentDorms:0,pumpsNearDorms:0,barriersNearDorms:0,floodwallDormsNoOak:0,wastewaterPlants:0,parkingLots:0,bridges:0}; }, upkeepTotal(){ return 17000; }, has(){ return false; }, list(){ return []; }, count(){ return 0; }, effective(){ return 1; }, rename(){}, place(){ return {ok:false}; } };
  BSU.agents = { sample(){ return {life:0,green:0,mosq:0,heat:0,n:0}; }, classAttendance(){ return 1; } };
  BSU.wildlife = { mosqIndex(){ return 0; }, ecology(){ return 82; }, ecologyTerms(){ return {}; }, sickToday(){ return 0; }, gatorPenalty(){ return 0; } };   // biblicalDays is read from s.wildlife.biblicalDays (state)
  BSU.sports = { season(){ return {hasTeam:false, record:{wins:0,losses:0}, lastSeason:{wins:0,losses:0,bowlWon:false}, venue:'none', permits:'paid'}; } };
  BSU.weather = { date(s){ const d=s.calendar.day; return {day:d, year:Math.floor(d/120)+1, month:Math.floor(d/10)%12+1, dom:d%10+1}; }, isDate(s,str){ return BSU.dateToDay(str, Math.floor(s.calendar.day/120)+1)===s.calendar.day; }, heat(){ return {index:80,advisory:false,wave:false}; }, storm(){ return null; } };
`, ctx);
load('economy.js');
const BSU = win.BSU; const s = BSU.newState(3); s.economy.suspendCapPenalties = false; s.economy.suppressCoverage = false;
BSU.economy.init(s); BSU.economy.reset(s, true); BSU.economy.addStudents(s, 120, 'founding');
BSU.events.on(BSU.EV.ENROLL_ROUND, p => console.log('round', p)); BSU.events.on(BSU.EV.ENROLL_LOCK, p => console.log('lock', p)); BSU.events.on(BSU.EV.ECON_MONTH, p => console.log('month net', p.statement.net));
for (let t = 0; t < 12000; t++) { const newDay = t % 100 === 0 && t > 0; if (newDay) s.calendar.day++; const d = s.calendar.day; BSU.economy.tick(s, { newDay, newMonth: newDay && d % 10 === 0, newYear: newDay && d % 120 === 0, day: d }); }
console.log('after a year', s.economy.cash, s.economy.students, s.economy.prestige.toFixed(2), s.economy.happiness.toFixed(1));
console.log(BSU.economy.selfTest());
```
Expect rounds on the 5th, the Jan 10 and Aug 5 locks, the Jul 1 funding, installments on the four dates, and `students` capped at 345 with one dorm.

## 8. Performance budget

`tick` per-tick path ≤ 0.05 ms (the EMA and a `flags.newDay` check); daily ≤ 1 ms (one `stats()` call — buildings caches it per day); monthly ≤ 5 ms. No allocation per tick.

## 9. Done means

- `selfTest().ok`; the isolation run reproduces the §5.4 worked Year 1 (176 → 210 → 237 → capped at 345) and the four installments.
- Full build: `node test/smoke.mjs` passes; `snapshot().cash` after a year on seed 42 with the smoke placements is finite and above −2,000,000; the Budget panel shows the fixed income/expense keys in order with last month's numbers; the Runway line turns red in May when cash cannot reach Aug 5.
- GDD §5.7's Year-1 curve is within ±30% when replayed by hand with the competent build order (income ≈ $8M, operating ≈ $3.6M).
- Every stat change is accompanied by `econ:stat` (the HUD odometer and the coin burst depend on it).
