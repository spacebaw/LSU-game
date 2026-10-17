# Bayou State v2 plan (2026-10-17)

Josh's improvement ideas, shaped into buildable projects. Each entry: goal, player experience, mechanics
with numbers, modules, UI, verification, size. Numbers are starting points; the engine's calibration tests
decide the final tuning. Existing systems referenced: prestige composite (economy, 0–100), applicant pool
and enrollment lock (economy), the football engine (sports: 8 position ratings QB RB WR OL DL LB DB K,
coach fit, playbooks, prospects board), dining radius/capacity (buildings + economy.capacity), housing
quality (catalog rows dorm / res_tower / greek_house), prep actions (weather.prepAction), Storm panel
(ui_panels), UI scale tokens (style.css --ui-scale), Season panel (ui_panels buildSeason).

Order: P4 → P5 → P1 → P3 → P2 → P7 → P6 (fix what's broken, then the most-played systems, then content).

---

## P1. Coaching staff with star ratings (head coach, offensive coordinator, defensive coordinator)

**Goal.** Three signable coaches whose availability and asking price depend on how popular the school is.

**Player experience.** A Staff tab in the Season panel shows HC / OC / DC cards: name, stars (1–5), style,
contract (years, salary), fit with your playbook. A "Candidates" list (3 per role, refreshed each
off-season) shows who will talk to you: a 5-star coach won't return calls from a 10-prestige school.
Hire = sign a 2–4 year contract against the athletics budget; fire = pay the remaining contract's buyout.

**Mechanics.**
- Candidate stars drawn from a prestige-gated pool: max stars = 1 + floor(prestige / 20) (prestige 10 →
  1–2★, 50 → 3★, 80+ → 5★), with one "reach" candidate at +1 star who demands +60% salary.
- Salary = $150k × stars² per year (1★ $150k … 5★ $3.75M); coordinators 55% of that. Contract 2–4 years;
  buyout = 50% of remaining salary.
- Effects (engine inputs that already exist get a new term): HC stars → team-wide rating +2 per star over
  2, decision defaults (aggression), halftime adjustment bonus; OC stars → offense composite +3 per star
  over 2 and playbook fit (an OC's style matching the playbook adds +4); DC stars → defense composite +3
  per star over 2 and turnover rate +4% per star. Coach "fit" line in the engine stays as the HC's.
- Coaches age/leave: each off-season a coach above 4★ at a school with prestige < 40 has a 35% chance of
  being poached (newsflash), unless paid a 25% raise.
- Save schema: state.sports.staff {hc, oc, dc, candidates, year}; migration from the single coach.

**Modules.** sports.js (staff model, candidates, contracts, engine terms), economy.js (salary line in the
athletics ledger), data.js (coach name pools by style, 12 quotes per role), ui_panels.js (Staff tab).
Tests: sports.test (gating by prestige, salary math, poaching, engine deltas monotone in stars).

**Size.** One strong-model pass (~350k) + the Season panel layout (P3) for the tab. Depends on P3's
budget line for affordability checks (can ship first with cash-only checks).

---

## P2. Sign players by position (3–4 offensive, 3–4 defensive slots)

**Goal.** Recruiting becomes a roster you build, not one Sign/Pass card.

**Player experience.** A Roster tab: depth chart with starters and one backup per position, each with
rating, class year (Fr/So/Jr/Sr), hometown. Each off-season a recruiting board shows prospects for up to
4 offensive slots (QB, RB, WR, OL) and 4 defensive (DL, LB, DB, K counts as special teams, shown with
defense). You sign up to 4 offense and 4 defense per class within the athletics budget. Seniors graduate
in May (graduation set piece already exists), so an empty slot is a real problem.

**Mechanics.**
- Prospect quality: rating ~ N(40 + prestige × 0.35 + recruitingBudget bonus, 8), clamped 30–90;
  signing cost = $20k + $6k × (rating − 40) per year of eligibility (4 years).
- Eligibility: every player has classYear; +1 each May; seniors leave; a walk-on (rating 35–45) fills
  any empty starter slot for free so the engine never lacks a body.
- Development: +2 to +5 rating per year for underclassmen (more with a higher-star position coach).
- Depth chart: starter = highest rating per position; backup plays if the starter is "dinged" (no
  injuries per the design rules: a dinged player sits one game, 5% per game).
- Engine: unchanged signatures; starters come from the depth chart.

**Modules.** sports.js (roster, eligibility, development, board), data.js (hometown/position name pools
already exist), ui_panels.js (Roster + Recruiting tabs). Tests: roster churn over 6 seasons stays
playable, budget enforcement, walk-on fill, rating monotone in prestige.

**Size.** One strong-model pass (~400k). Depends on P1 (position coaches feed development) loosely; can
ship before it.

---

## P3. Athletics budget (salary cap) and a wide Season panel

**Goal.** One number that governs what the program can afford, growing with success; a Season panel that
uses the width of the screen.

**Mechanics (athletics budget).**
- Annual athletics budget = base $2M + 35% of last season's athletics revenue (tickets, tailgates,
  concessions, bowl) + $50k × prestige/10 + donations earmarked by boosters after winning seasons
  (+$500k per season with ≥ 7 wins). Shown as "Budget $X / committed $Y" where committed = coach salaries
  + player signings + facilities upkeep share.
- A slider lets the player set the share of university cash topping it up (0–150% of base), with the
  Budget panel showing the transfer; overspending the cap is blocked with the reason.
- Growth is the loop: win → revenue and prestige → bigger budget → better staff and players.

**Season panel, horizontal.** A 1100-px-wide panel (max 92vw) with tabs across the top: Overview
(record, next game, win odds, budget bar) · Staff (P1) · Roster (P2) · Recruiting (P2) · Schedule ·
Records. Each tab lays out in 2–3 columns at 1440+ and stacks at 1280. Controls (playbook, aggression,
watch-full, auto-sim, night) live in Overview as a single row of segmented controls.

**Modules.** sports.js (budget model), economy.js (transfer + ledger line), ui_panels.js (rebuild
buildSeason as tabbed/wide), style.css. Tests: budget monotone in revenue; cap enforcement.

**Size.** One strong-model pass (~350k). Ship before P1/P2 so they land in the new layout.

---

## P4. Storm preparations that actually work

**Goal.** Every prep option is selectable, understandable, and visibly takes effect.

**Player experience.** Storm panel rebuilt as a checklist with three groups:
1. Board up — per-building checklist (fixed 10-11) with "Select all WR ≤ 2", cost per building, "Board
   Up selected / all" with a confirm line showing total cost; boarded buildings show boards on the map
   (sprite DAMAGED/BOARDED variant exists) and a ✓ in the list.
2. Water — Sandbags (pick levee runs from a list with their lengths, or "all weak"), Pre-drain (shows
   which pumps run and expected feet lowered), Spillway (once a year).
3. People — Evacuate (which buildings, how many students, where they shelter), Repair All (after).
Each action: cost, effect in plain words, availability reason when disabled (no storm, not enough cash,
already done), and a ticker/notify confirmation. A "Prepare everything (recommended)" button totals the
cost. Available from the cone onward; Sandbags and Board Up also allowed outside a storm at full price.

**Modules.** ui_panels.js (buildStorm/refreshStorm rebuilt, selection kept across refreshes as in the
checklist fix), weather.js prepAction (return structured results: cost, affected ids, reason), buildings.js
(boarded flag → sprite variant). Tests: every action callable with a selection and without; disabled
reasons; boarded variant.

**Size.** One cheaper-model pass (~250k) with a Chrome tour of each action. First in the order.

---

## P5. Bigger, centered UI by default

**Goal.** The HUD reads large and sits in the middle of attention, not in the corners.

**Changes.**
- Default UI scale by viewport: 1280 → 100%, 1440 → 115%, 1920+ → 130% (the scale setting exists; make
  the default smart and show a "Display size" choice on the title screen: Compact / Comfortable / Large).
- Goals tracker docks top-center-left (just right of the stats) instead of the far corner; notifications
  stack bottom-center above the palette; cards and decision toasts center over the map; panels center with
  a wider max width (Season 1100, Build 1000).
- Base font 15 → 16 at Comfortable, 18 at Large; stat numbers 22; palette tiles 120 px with 72-px icons.
- Keep gutters so the map's center third stays visible during normal play; the minimap stays top-right.

**Modules.** style.css tokens + layout rules, ui.js (dock positions, title-screen size choice, default
scale), ui_panels.js widths. Tests: ui.test positions at three widths; nothing overlaps the map center.

**Size.** One cheaper-model pass (~250k) with screenshots at 1280/1440/1920. Second in the order.

---

## P6. Dining menus (up to 10 dishes per dining hall)

**Goal.** Food is a real decision: quality draws applicants and happiness; cheap food feeds more students.

**Mechanics.**
- Menu of 24 Louisiana dishes in data.js with cost per plate, prep time, appeal, and tags: gumbo,
  jambalaya, red beans & rice, crawfish étouffée, shrimp po'boy, roast beef po'boy, boudin, fried catfish,
  muffuletta, beignets, bread pudding, king cake (Jan–Mar only), snoballs (summer), pralines, grillades
  and grits, crawfish boil (festival), sweet tea, chicory coffee, cornbread, dirty rice, alligator sausage,
  pecan pie, sno-cone, plate lunch special. Tiers: cheap ($3/plate, prep 1, appeal 1), standard ($6, prep
  2, appeal 2), premium ($11, prep 3, appeal 4).
- Each dining hall (and po'boy shack, 3 dishes) selects up to 10. Hall throughput = base capacity ×
  (1 / mean prep) × 2 → a cheap menu feeds ~2× the standard capacity, a premium menu ~0.67×. Food cost
  per month = plates served × mean cost. Appeal: mean appeal feeds a +0..+6% applicant-pool bonus (new
  term in economy's applicant model) and +0..+3 happiness in the dining radius.
- Queues: students who can't be served walk to the next hall or skip (−happiness); the needs strip
  "Dining" gauge uses throughput, so a premium-only menu shows the squeeze.
- Festival specials auto-join the menu for their window (crawfish boil in spring).

**UI.** Inspect panel for a dining building gets a "Menu" section: dish grid with cost/prep/appeal
chips, 10 max, presets (Cheap & Fast / Campus Classic / Chef's Table). Build menu blurb mentions it.

**Modules.** data.js (dishes), buildings.js (per-building data.menu, throughput), economy.js (food
cost line, applicant appeal term), agents.js (served/skip logic via capacity), ui.js (inspect menu
section). Tests: throughput math, cost ledger, appeal bonus monotone, save round trip of menus.

**Size.** One strong-model pass (~400k) + a small cheaper-model UI pass if the inspect section needs
iteration. Last in the order (content on top of a stable base).

---

## P7. Housing tiers (economy / standard / premium with parking)

**Goal.** Three dorm choices that trade cost against quality, with the premium tier solving parking.

**Catalog rows (added as 45 and 46; the existing Freshman Dorm is the standard tier).**
| Row | Name | Footprint | Cost | Upkeep | Beds | Quality | Notes |
|---|---|---|---|---|---|---|---|
| 45 | Bayou Bunkhouse (economy) | 3×2 | $420k | $6k | 360 | 1 | "Just rooms": shared baths, −1 happiness radius 4, cheapest bed |
| 13 | Freshman Dorm (standard) | 3×2 | $700k | $9k | 300 | 2 | unchanged |
| 46 | Magnolia Suites (premium) | 3×3 | $1.4M | $16k | 240 | 3 | bigger rooms; includes 60 parking spaces counted toward the parking requirement; +3 happiness radius 6; room fees +$400/bed/semester |

- Housing quality (already in the quality composite) uses the bed-weighted mean of tiers.
- Room-fee revenue line in the ledger by tier (economy $0, standard $150, premium $400 per bed per
  semester). Applicants prefer a mix: an all-economy campus gets −3% applicants; ≥ 20% premium beds +3%.
- Paint descriptors: bunkhouse = long tin-roof blocks; suites = brick with galleries and a courtyard.

**Modules.** data.js (rows, blurbs, paint), contract.js (B_ORDER 46 rows; update the row-count tests),
buildings.js (parking credit), economy.js (room fees, applicant mix), sprites_buildings.js (two painters),
ui (build menu picks them up automatically). Tests: row counts, parking credit, fee ledger.

**Size.** One cheaper-model pass for data/economy/tests (~200k) + one art pass for the two painters
(~200k).

---

## Cost summary

| Project | Passes | Model | Est. tokens |
|---|---|---|---|
| P4 Storm prep | 1 | cheaper | 250k |
| P5 Bigger centered UI | 1 | cheaper | 250k |
| P3 Budget + wide Season panel | 1 | strong | 350k |
| P1 Coaching staff | 1 | strong | 350k |
| P2 Roster recruiting | 1 | strong | 400k |
| P7 Housing tiers | 2 | cheaper | 400k |
| P6 Dining menus | 1–2 | strong + cheaper | 500k |

Roughly 2.5M tokens, about one week's budget at the current pace, with a QA playthrough after P3 and
after P6.
