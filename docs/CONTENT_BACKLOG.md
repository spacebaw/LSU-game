# Content backlog (playtester notes + academic unit catalog)

Working list for the passes that follow the goal steps pass. Each pass ticks its items here and writes its own section in `INTEGRATION_NOTES.md`.

## 0. Decisions (Josh, 2026-11-18)

- **Academic buildings: colleges plus signature venues**, about 24 new buildings: one per college or school with none today (15), plus the places people visit (concert hall, theatre, art studios and gallery, vet teaching hospital, natural science museum, computer lab, ag greenhouses, band hall). Every department is listed inside its college's card. Not one building per department.
- **Level bar: a new Campus Level XP bar as the tester asked.** XP from building (costlier gives more) and from finishing goals; prestige stays as it is; level 20 unlocks College Town and its Town Center.
- **Pass order:** 1 unstick (receivership, fresh start) → 2 simulation and visual bugs → 3 audio → 4 colleges and venues → 5 more buildings, decorations and upgrade tiers → 6 Campus Level and College Town. One agent at a time; each pass is committed and published before the next starts.

## 1. Playtester notes (handwritten, four pages, one dated Nov 4; received 2026-11-18)

The screenshot that came with them shows the old purple HUD, so some notes predate the UI refresh (U0–U6), the goal pass, the crossings pass and the goal steps pass. Status: **open**, **verify** (probably fixed since; reproduce on the current build before changing anything), **done**.

### Stuck / soft-locks (pass 1)
- [x] **done** N10/N11 Receivership: "no idea what it was, wasn't able to get out", "does not let build at all", "soft-locks game". Wants an explanation and a way to see when it ends. *Found:* one red snackbar, then 120 days (20 minutes at 4×) with every placement refused as the bare word "Receivership", the Board's card back on top of it, and a campus still losing money went back in 60 days after it ended. *Now:* a standing chip with the countdown (the deficit, the Board's 60-day deadline, the days of receivership left), a dialog that explains it with the real numbers, 30 days instead of 120, the bulldozer / paths / repairs / Budget never frozen, "Receivership: N days left" on every refusal, and at least 90 days (in practice 160+) before the Board can come back.
- [x] **done** N21 "When trying to place path to start game, problem not letting continue with rest of game." *Found (two ways to get there):* the X on the goal card dismissed the tutorial's goal for good, and a path drawn while the game is paused completes nothing and nothing says the clock is stopped. *Now:* tutorial goals have no X (old saves heal), and a paused goal says "Done. The game is paused: press Play to go on." with a Resume button.
- [x] **done** N25 "Building tab not showing at the very start of game so you are stuck trying to complete the first goal." *Found:* the Build tabs are handed out by the tutorial (Essentials with goal 3, the rest when goal 5 is done), so a tutorial goal dismissed with the card's X meant no Build tab, ever; and after goal 3 the finished goal stayed on the card for half a minute, still asking for the Dining Hall. *Now:* the X is gone from tutorial goals, the card says "The next goal is on its way" between goals, and Founders' Hall can no longer be undone.
- [x] **done** N30 "When asked to build practice field asks to build 4, at most should be 2." The goal 15 counter reads 0 / 4 because it counts four steps, not four fields. *Now:* "Step 1 of 4" on the card and the pill for the eight goals that count steps (3, 5, 12, 15, 17, 19, 20, 22); counted goals keep "3 / 5".

### Simulation and visual bugs (pass 2)
- [ ] **open** N3 Drainage canals don't drain.
- [ ] **open** N4 Levee looks weird and does not seem to work as one.
- [ ] **open** N8 Football field rotated: goalposts on the wrong ends.
- [ ] **open** N9 Students never scatter, always in the same location.
- [ ] **open** N26 Quad Lawn should be connectable (adjacent lawns join).
- [ ] **open** N27 Keep gators, make them occasional, not always around.
- [ ] **open** N29 Night is too dark; add a glow at the mouse so you can see where you point.
- [ ] **open** N7 Vehicle bridge ("would help figure out connecting campus"). A Campus Road already bridges up to 3 water tiles, but nothing says so and the span may be too short.
- [ ] **verify** N13 Pedestrian bridge does not sit right, connects to the ground weirdly (crossings pass changed this).
- [ ] **verify** N15 NPCs don't know how to use bridges (crossings pass changed this).
- [ ] **verify** N5 Trees: building on them should clear them instantly (done for paths, roads, boardwalks, bridges; check footprints).

### Audio (pass 3)
- [ ] **open** N14 Sounds are weird: should be calmer and more subtle, too abrupt.
- [ ] **open** N17 A sound like a growling stomach: remove or change.
- [ ] **open** N16 Game-day music: more epic, currently too goofy and plain.

### New content (passes 4–6)
- [ ] N18 Buildings: Art, Music, Theatre, Computer Lab, Apparel / merch shop, Basketball arena, Golf course (takes a lot of space, forces extra land), Recycling center.
- [ ] N18 Decorations: Tiger statue, Train or airplane, General grounds (Parade Ground).
- [ ] N19 Upgrades for: Tiger Habitat, Library, Dining Hall, Rec Center, Health Center, Parking Lot (becomes a roofed multi-floor garage), Student Union (2 floors).
- [ ] N20 Rain water collection system; campus buses.
- [ ] N12 Level-up bar (a progress / mastery bar). XP from building and from goals; costlier buildings give more. About level 20 unlocks College Town and a College Town Center.
- [ ] Josh: a building for every academic unit in section 2.

### Already addressed
- [x] N1 Build tab UI gets funky when hidden; N2 Goals and Map buttons not in the corners; N24 Goals window glitchy: all replaced by the UI refresh (app bar, goal pill and card, Build sheet).
- [x] N28 Wetland Preserve forced close to campus, 20 tiles: the goal pass counts Preserve anywhere and made it a drag-to-paint tool, so 20 tiles is one drag.

### Liked (keep)
- N6 the team management system; N22 the new graphics; N23 the budget covering academics and sports.

## 2. Academic unit catalog (from lsu.edu, read 2026-11-18)

Sources: `lsu.edu/academics/index.php` and each college's own site. The game is fictional (Bayou State University, no real trademarks), so buildings take the discipline, never a donor or person name.

| Unit | Schools and departments | In the game today |
|---|---|---|
| College of Agriculture | Agricultural Economics & Agribusiness; Agricultural & Extension Education; Animal Sciences; Entomology; Experimental Statistics; Nutrition & Food Sciences; Plant, Environmental & Soil Sciences; Plant Pathology & Crop Physiology; Renewable Natural Resources; Textiles, Apparel Design & Merchandising | none |
| College of Art & Design | Architecture; Art; Interior Design; Landscape Architecture | none |
| College of Business | Accounting; Economics; Finance; Marketing; Public Administration; Management; Entrepreneurship & Information Systems; MBA | none |
| College of the Coast & Environment | Environmental Sciences; Oceanography & Coastal Sciences | Coastal Studies Institute |
| College of Engineering | Biological & Agricultural; Chemical; Civil & Environmental; Computer Science; Construction Management; Electrical & Computer; Mechanical & Industrial; Petroleum | Engineering Hall |
| College of Human Sciences & Education | Education; Information Studies; Kinesiology; Leadership & Human Resource Development; Social Work | none |
| College of Humanities & Social Sciences | African & African American Studies; Communication Sciences & Disorders; Communication Studies; English; French Studies; Geography & Anthropology; History; Philosophy & Religious Studies; Political Science; Psychology; Sociology; World Languages, Literatures & Cultures. Programs: Asian Studies; Classical Civilization; Comparative Literature; Disaster Science & Management; Interdisciplinary Studies; International Studies; Jewish Studies; Linguistics; Liberal Arts; Screen Arts; Women's, Gender & Sexuality Studies | Lecture Hall (generic) |
| School of Mass Communication | Journalism; Public Relations; Digital Advertising; Political Communication | none |
| College of Music & Dramatic Arts | School of Music; Bands; School of Theatre & Film | none |
| College of Science | Biological Sciences; Chemistry; Geology & Geophysics; Mathematics; Physics & Astronomy; Museum of Natural Science | none |
| School of Veterinary Medicine | Comparative Biomedical Sciences; Pathobiological Sciences; Veterinary Clinical Sciences; Veterinary Teaching Hospital | none |
| Honors College | | none |
| University College | first-year and undeclared students | none |
| Law Center | | none |
| Graduate School | | none |
| Online & Continuing Education | | none |
| Libraries | | Library |
| ROTC | Army (Military Science); Air Force (Aerospace Studies); Naval | none |

Not campus units, left out: the two Health Sciences Centers (New Orleans, Shreveport).

Totals: 18 top-level units (15 with no building yet) and about 75 schools, departments and programs.
