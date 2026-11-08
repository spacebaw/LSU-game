# UI refresh: light, Material, nested (2026-11-08)

Josh: "I don't like all the dark background colors. I want to switch to a much lighter UI across the space, white or a
light gray, something very modern and hip, like Material Design for Android, in that lane. I'd rather start nesting
menus more as opposed to so much stuff constantly on the screen. Neater and cleaner across the board."

Decisions Josh took when asked (2026-11-08):
- **Influence:** Material 3, with Two Point Campus setting the tone.
- **At rest:** minimal. App bar, a Build button, a one-line goal pill, an alerts badge. Everything else opens on demand.
- **Brand:** purple is the primary colour; gold is reserved for the one key action.
- **Dark theme:** dropped. Light only.

## 1. What is true today (measured on this build, 1440 × 900, full HUD)

- At rest the chrome covers roughly 40 % of the screen: a 5.6 rem top bar (five stats, date, speed, six panel buttons,
  mute), the goals tracker (portrait, title, why, progress, two buttons, next-up, a five-gauge needs strip, an alert row),
  the minimap, six overlay letter buttons, the issues tray, the news ticker, and a palette 18 rem tall with seven cards.
- Every surface is dark purple glass (`--panel-bg` gradient at 92 % alpha, gold `--gold` accents, serif Georgia titles,
  emoji glyphs for the panel buttons). `src/style.css` is 670 lines / 85.6 KB against a 96 KB cap in `ui.test.mjs`.
- `ui.js` (3,222 lines) builds the whole DOM once (`BSU.ui.el`, never re-queried; skeleton at the top of the file) and runs
  the input state machine; `ui_panels.js` (1,737 lines) builds the Budget, Season, Storm, Land Office, Almanac and
  Milestones panels through `M.registerPanel(name, {build, refresh, events})`; Settings, How to play, About and Debug are
  registered in ui.js. Every panel is a centred modal; the Build menu is its own modal (`#build-menu`, key G).
- Three HUD modes already exist (`settings.hudMode`: full / compact / hidden; H cycles, Shift+H restores). Compact turns
  every part into a pill that opens on hover or click (Goal · 2/5, Map, Build · G, All clear). This is the seed of the
  new at-rest layout.
- Display sizes Compact 100 % / Comfortable 115 % / Large 130 % (`--ui-scale`), picked on the title screen or in Settings.
- Notifications: `M.notify` (toasts top-right), the ticker (news line), modal cards (`#cards`), decision toasts, coach marks.
- Tests that assert the DOM and CSS: `ui.test.mjs` 409, `ui_panels.test.mjs` 213, `menu.test.mjs` 40, `safari.test.mjs` 14.
  A refresh that moves things will rewrite a good share of these; budget for it in every pass.
- The game is one file with no web fonts; the icon sprites (47 HD icons) are canvas-drawn; panel glyphs are emoji.

## 2. Direction

**From Material 3 (the system).** Tonal surfaces instead of glass; elevation by surface tint plus a soft shadow; a shape
scale (pills for buttons and chips, 16 px cards, 28 px sheet corners); a type scale (display / headline / title / body /
label); state layers for hover, press and selection; these components: top app bar, extended FAB, bottom sheet, side sheet,
navigation menu, assist and filter chips, snackbar, dialog, segmented buttons, sliders, switches, tooltips.
**From Two Point Campus (the tone).** White cards with a coloured header band per category, chunky friendly icons, big
readable numbers, a playful voice, the map as the hero with the UI staying out of its way.
**From Bayou State (kept).** Purple as the identity colour, gold for the single most important action on screen, the HD
building icons, the copy voice, every hotkey, the coach and card systems, the three display sizes.
**Not Material.** No bottom navigation bar (this is a desktop game), no Roboto (system sans stack, see §8), no ripple on the
canvas, no blur (M3 does not use it and it costs frames).

## 3. Tokens (the spec U0 writes into docs/UI_STYLE.md and U1 implements)

Colour roles (M3 names, light scheme; the hexes are the starting point, U0 may tune them against the map):
- `surface` #FBFAFD · `surface-container-low` #F5F3F8 · `surface-container` #EFEDF3 · `surface-container-high` #E9E6EF ·
  `outline` #79757F · `outline-variant` #CAC4D0
- `on-surface` #1C1B1F · `on-surface-variant` #49454F
- `primary` #461D7C (BSU purple) · `on-primary` #FFFFFF · `primary-container` #E9DDFF · `on-primary-container` #1F0A47
- `secondary` #5E2CA5 (selected states, links) · `secondary-container` #F0E7FF
- `tertiary` (the key action) #F5B700 gold · `on-tertiary` #2B1246 · `tertiary-container` #FFE680
- `error` #B3261E · `error-container` #F9DEDC · `success` #2E7D4F · `success-container` #DDF3E4 ·
  `water` #4FA3D6 and `moss` #6A8F3C stay for the needs gauges and overlays
- Over the map, every floating surface is `surface` at 94 % with a 1 px `outline-variant` border and elevation 2;
  nothing is translucent enough to show the map through text.

Type: one family, the system sans stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`); the serif stays only
on the title wordmark. Scale (at 100 %): display 2.6 rem / 700 (wordmark only), headline 1.7 rem / 600 (panel titles),
title 1.3 rem / 600 (card titles, stat values), body 1.2 rem / 400, label 1.05 rem / 500 with +0.02 em tracking and
uppercase only for stat labels and kickers. Tabular figures everywhere a number can change.
Shape: pill (999 px) for buttons, chips, the FAB and the goal pill; 12 px for list items and small cards; 16 px for cards and
popovers; 28 px for the top corners of sheets; 0 for the app bar.
Elevation: 0 app bar on a solid surface; 1 for chips and cards at rest (`0 1px 2px rgba(28,27,31,.12)`); 2 for popovers and
the goal card (`0 2px 6px rgba(28,27,31,.16)`); 3 for sheets and dialogs (`0 6px 18px rgba(28,27,31,.18)`); plus the scrim
`rgba(28,27,31,.32)` under dialogs only.
Spacing: a 4 px grid; 8 px inside chips, 12 px inside cards, 16 px panel padding, 24 px sheet padding; the 16 px map gutter.
Motion: 160 ms standard easing for state layers, 240 ms emphasized-decelerate for sheets and popovers opening, 160 ms
accelerate closing; `prefers-reduced-motion` turns them to 0.
States: hover = 8 % primary state layer, press 12 %, selected = `secondary-container` fill with `on-secondary-container`
text, disabled 38 % opacity. Focus ring 2 px `primary` outside the shape.
Contrast: WCAG AA for text (4.5:1) and 3:1 for icons and borders, checked by U6 on every surface; gold is never used for
text on white (it fails), only as a fill with `on-tertiary` text.

## 4. Information architecture (the at-rest screen and what nests where)

At rest, exactly four things sit over the map:
1. **App bar** (full width, solid `surface`, 48 px at 100 %): the brand mark · stat chips Cash, Students (with "cap 1,500"
   inline), Prestige, Happiness, Ecology · a date-and-weather chip · the speed segmented button (pause 1× 2× 4× 8×) ·
   **Alerts** icon with a count badge · **Layers** icon · **Map** icon · **Menu** icon. The capacity chip opens the needs
   popover (the five gauges, the binding line, the sewage alert) on click; the cash chip opens a mini budget popover
   (income, expenses, runway, "Open Budget").
2. **Goal pill** (top-left, under the bar): kicker + title + a small progress ring, one line. Click, or a goal change,
   expands it to the goal card (portrait, title, why, progress, Build it in gold, Show me, next-up, dismiss); it collapses
   after 10 s without hover or on click. The needs strip leaves the card for the capacity chip.
3. **Build** extended FAB (bottom-right, gold, "Build · G"): opens the build sheet (§4, Build).
4. **Snackbars** (bottom-centre, max two, 6 s): news and notifications. The ticker line is gone; its history is the Log.

Nested:
- **Menu** (icon, top-right; also Esc from the map when nothing is open) → a right **side sheet** with a vertical list:
  Budget (B), Season (N), Storm (T), Land Office (O), Almanac, Milestones (L), Log, Settings, How to play, About. Each
  item opens its panel INSIDE the same sheet (a back arrow returns to the list; the hotkeys open the sheet straight to
  that panel). `registerPanel` keeps its contract; the host changes from a centred modal to the sheet body.
- **Alerts** (icon with badge) → the issues tray as a popover: the list, Fix / snooze / dismiss per row, Spotlight,
  Clear N. The "All clear ✓" state is the badge with no count.
- **Layers** → a popover of the six overlays as filter chips with their letters (F W K P C E); the active overlay's chip
  stays lit in the bar (one small chip appears next to the icon while any overlay is on).
- **Map** → the minimap as a popover card (today's canvas, same click-to-pan); a pin keeps it open; remembered in settings.
- **Build FAB** → a **bottom sheet** (the palette): category tabs in a row, the item cards in a horizontal scroller, the
  bulldoze and info buttons at the right; drag handle or the ⤢ button expands it into the full build sheet (today's build
  menu: category rail, cards, detail column) at 80 % height. Esc closes; G toggles.
- **Inspect** → a card anchored bottom-left above the snackbar lane (today's side panel content: title, sprite, body,
  actions), collapsible to a one-line pill; the kitchen menu editor stays a dialog.
- **Cards** (Board, failure, storm, voice) → M3 dialogs with a scrim; decision toasts → a snackbar with two actions and
  the countdown as a thin progress line.
- **Coach** → unchanged flow; the ring, box and panes restyled; the box is a card with the step counter as a label.
- **HUD modes** fold into one at-rest state. H still hides everything (screenshots), Shift+H restores. The `compact`
  mode and the `hudMode` setting go; Settings gains "Keep the minimap open" and "Keep overlays visible" for players who want
  the Moderate layout.
- **Title screen**: a white card over the dimmed map, the wordmark in purple serif with a gold underline stroke, the
  charter button gold, How to play / About / Settings as text buttons, Display size as a segmented button, the seed field
  as an outlined text field.

## 5. Component mapping

| Today | New home | Pass |
|---|---|---|
| `#topbar` stats, date, speed | app bar chips + segmented speed | U2 |
| `#btn-budget … #btn-menu` (six buttons) | Menu side sheet list | U3 |
| `#objective-card` + `#needs-strip` | goal pill ↔ goal card; needs popover from the capacity chip | U2 |
| `#minimap-wrap` | Map popover (pinnable) | U2 |
| `#overlay-buttons` + `#legend` | Layers popover; legend inside it | U2 |
| issues tray (`issues.js` DOM) | Alerts popover + badge | U2 |
| `#ticker` + `#ticker-log` | snackbars + Log panel in the Menu sheet | U2 |
| `#palette` | bottom sheet (collapsed build sheet) | U4 |
| `#build-menu` | expanded build sheet | U4 |
| `#inspect.panel.side` | inspect card, collapsible | U3 |
| `#panels` modals (`registerPanel`) | side sheet host with back navigation | U3 |
| `#cards`, `#decision-toast`, `#voice-card` | dialogs; snackbar with actions | U3 |
| `#coach` | restyled, same flow | U5 |
| `#title` | title card | U5 |
| `#notifications` | snackbars | U2 |
| emoji glyphs | inline SVG icon set (≈ 24 Material Symbols Rounded paths, ~6 KB) | U5 |
| `#perf-chip`, `#perfmode-chip`, `#hint`, `#btn-skip` | restyled only | U1 |

## 6. Passes (sequential, one agent at a time; model in brackets)

**U0 — Mock and token sheet [Fable].** `docs/UI_STYLE.md` (the tokens of §3 as the single source, plus the component
specs: every surface above with its padding, type roles, states and sizes at the three display sizes) and a static
`tools/ui_mock/index.html` (plain HTML + CSS on the token sheet, no game code) that lays the new UI over a screenshot of
the map (`tools/qa/out/ui-hud-hidden.png`): the at-rest screen; the goal card open; the needs and alerts popovers; the
Layers and Map popovers; the build sheet collapsed and expanded; the Menu sheet with Budget inside; a dialog; the title
card. Josh opens it in a browser and approves or redirects before any game code changes. Gate: the mock renders at
1280 × 800, 1440 × 900 and 1920 × 1080 at the three display sizes without overlap; every text passes AA on its surface.

**U1 — Tokens and restyle in place [Sonnet].** `style.css` rewritten on `docs/UI_STYLE.md`: the token block, the type
scale, shape and elevation utilities, then every existing component re-skinned where it stands (buttons, chips, panels,
cards, tabs, sliders, segmented buttons, tooltips, popover, coach, title). No layout moves, no DOM changes beyond class
names. The dark gradients, glass alphas and gold text go. The `hudMode` compact/hidden still work. Gate: the 16-shot
matrix (`tools/qa/shots.mjs`) at 1440 × 900 and the three display sizes; `ui.test` CSS assertions updated; style.css
≤ 96 KB (the glass gradients leave; it should shrink).

**U2 — The at-rest screen [Fable].** App bar chips and popovers (needs, mini budget), goal pill ↔ card with the auto
expand/collapse, Alerts badge + popover, Layers popover, Map popover, snackbars replacing the ticker and `#notifications`,
the Build FAB (opening today's palette as an interim sheet), HUD modes folded (settings migration: `hudMode` read once
and dropped). `ui.js` input state machine untouched. Gate: play.mjs, ui.test rewritten for the new skeleton, screenshots
of every popover; Josh playtests.

**U3 — Nested surfaces [Sonnet, Fable reviews].** The Menu side sheet hosting every `registerPanel` panel with back
navigation and hotkeys that deep-link; Settings consolidated (Display size, Alerts, Audio, Keep minimap / overlays,
Particles, Shake, Colour-blind); inspect card; cards as dialogs; decision snackbar. Gate: ui_panels.test rewritten,
every panel screenshot at 1280 × 800 (the sheet must scroll, not overflow).

**U4 — Build sheet [Sonnet].** Palette → bottom sheet; build menu → the expanded sheet (category rail, cards, detail
column) with a search field; keyboard: G toggles, Esc closes, arrows move between cards, Enter arms. Gate: menu.test,
the tutorial's Build it flow (coach step "menu" rings the card in the open sheet), play.mjs.

**U5 — Title, coach, icons, motion [Sonnet].** Title card, How to play / About inside the Menu sheet, coach restyle,
inline SVG icons replacing the emoji glyphs, M3 motion with reduced-motion off switch. Gate: title screenshots, the
tour (`tools/qa/play.mjs` tutorial scenario), contract test for the icon registry.

**U6 — QA and docs [Fable].** Screenshot matrix 1280 / 1440 / 1920 × three display sizes × at rest, goal open, build
sheet, Menu sheet, dialog, night, storm; AA contrast audit (script over the token sheet and a DOM walk); Safari; fps
compare (DOM only, should be flat); `docs/ARCHITECTURE.md` §7 skeleton, `docs/INTEGRATION_NOTES.md`, `README.md`
screenshots. Josh's playtest notes folded in.

Each pass ends with the full battery (`node build.mjs --check` last, smoke at both sizes, modules, contract, every unit
file, `tools/qa/play.mjs`), a commit, a subtree push and the link.

## 7. Constraints and risks

- **One file, no web fonts.** The system sans stack is the type; it is SF on Mac, Segoe on Windows, Roboto on Android.
  Embedding Inter or Roboto would add ~200 KB of base64 per two weights; not planned.
- **Tests.** ~660 DOM/CSS assertions across ui, ui_panels, menu and safari tests. U1 keeps most; U2–U4 rewrite the
  layout ones. Every pass must leave 0 failed, not skip.
- **Readability over the map.** White surfaces over the bright green campus and the dark night map both work; thin
  outlines matter more than shadows at 100 % on a 1280 laptop. No translucency under text.
- **Laptops.** 1280 × 800 is the floor (`params.ui.minWidth` 1024). The minimal at-rest screen helps; sheets must
  scroll inside themselves.
- **Settings migration.** `hudMode` goes; saves carrying it load and ignore it. The save format is otherwise untouched.
- **Hotkeys and the coach** are contracts: every key keeps its meaning; the coach's ring targets move with the elements.
- **Performance.** DOM chrome does not touch the canvas frame; the only cost to watch is sheet animation during a storm
  (transform/opacity only, no layout animation).
- **Colour-blind setting** must still recolour the gauges and overlays under the new tokens.
- **Touch.** 44 px targets stay (`params.ui.touchTargetPx`); the sheet pattern is what a later tablet pass wants.

## 8. Decisions taken (change if Josh disagrees)

- System sans everywhere; the serif survives only on the title wordmark.
- No blur, no glass, no gradients; elevation is a shadow plus surface tint.
- Gold appears on exactly three things: the Build FAB, the goal card's Build it, the title's charter button.
- The ticker is replaced by snackbars plus a Log panel; the news voice is unchanged.
- The minimap is closed at rest (Josh chose Minimal); a Settings switch keeps it open for those who want it.
- Stats are chips, not cards; the capacity chip is the entry to the needs gauges.
- The goal pill auto-expands when the goal changes and collapses after 10 s idle.
- The dark theme is removed, including its settings key.
- Panels keep `registerPanel`; only the host changes. `ui_panels.js` content is restyled, not rewritten.

## 9. Order

U0 first, now, on Fable: it is the one pass whose output Josh must look at before anything else is built. Then
U1 → U2 → U3 → U4 → U5 → U6 one at a time, Sonnet where marked. Every push ends with the public link and a one-line
"what to try". If usage runs short, U1 + U2 together are the visible win: light theme and a clear screen.
