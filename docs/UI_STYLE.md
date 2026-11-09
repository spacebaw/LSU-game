# UI style sheet (U0 of docs/PLAN_UI_REFRESH.md)

The single source for the refresh: U1 copies §1 into `style.css` verbatim, U2–U5 build the surfaces of §3 to the sizes here,
U6 re-runs §5. The mock that renders every surface below is `tools/ui_mock/index.html` (open it; `` ` `` toggles the toolbar,
← → step screens, the hash records screen · size · viewport). All sizes are at display size 100 % (1 rem = 10 px);
Comfortable and Large multiply every rem value by 1.15 / 1.3. The map gutter and the 1 px edges stay in px.

## 1. Tokens

Paste as-is (this is the `:root` block of the mock; `tools/ui_mock/contrast.mjs` reads it to produce §5).

```css
:root {
  --ui-scale: 1;
  /* colour roles (M3 names, light scheme) */
  --surface: #FBFAFD; --surface-container-low: #F5F3F8; --surface-container: #EFEDF3; --surface-container-high: #E9E6EF;
  --surface-float: rgba(251, 250, 253, .94);
  --on-surface: #1C1B1F; --on-surface-variant: #49454F; --outline: #79757F; --outline-variant: #CAC4D0;
  --primary: #461D7C; --on-primary: #FFFFFF; --primary-container: #E9DDFF; --on-primary-container: #1F0A47;
  --secondary: #5E2CA5; --on-secondary: #FFFFFF; --secondary-container: #F0E7FF; --on-secondary-container: #1F0A47;
  --tertiary: #F5B700; --on-tertiary: #2B1246; --tertiary-container: #FFE680; --on-tertiary-container: #2B1246;
  --error: #B3261E; --on-error: #FFFFFF; --error-container: #F9DEDC; --on-error-container: #410E0B;
  --success: #1F6B3F; --success-container: #DDF3E4; --on-success-container: #07331B;
  --warn: #B26A00;
  --water: #2E86BE; --moss: #5E8232;
  --scrim: rgba(28, 27, 31, .32); --scrim-title: rgba(28, 27, 31, .48);
  /* type */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --font-serif: Georgia, "Times New Roman", serif;
  --fs-display: 4.4rem; --fs-headline: 1.7rem; --fs-title-lg: 1.5rem; --fs-title: 1.3rem; --fs-body: 1.2rem; --fs-label: 1.05rem;
  --lh-body: 1.4; --track-label: .02em;
  /* shape */
  --shape-pill: 999px; --shape-sm: 1.2rem; --shape-md: 1.6rem; --shape-lg: 2.8rem;
  /* elevation */
  --elev-1: 0 1px 2px rgba(28, 27, 31, .12); --elev-2: 0 2px 6px rgba(28, 27, 31, .16); --elev-3: 0 6px 18px rgba(28, 27, 31, .18);
  /* spacing (4 px grid) */
  --sp-1: .4rem; --sp-2: .8rem; --sp-3: 1.2rem; --sp-4: 1.6rem; --sp-5: 2rem; --sp-6: 2.4rem; --gutter: 16px;
  /* sizes */
  --bar-h: 4.8rem; --control-h: 4rem; --target: 4.4rem; --fab-h: 5.6rem; --icon: 2.4rem;
  /* motion */
  --dur-std: 160ms; --dur-open: 240ms; --dur-close: 160ms;
  --ease-std: cubic-bezier(.2, 0, 0, 1); --ease-decel: cubic-bezier(.05, .7, .1, 1); --ease-accel: cubic-bezier(.3, 0, .8, .15);
  /* states */
  --state-hover: .08; --state-press: .12; --disabled: .38;
}
@media (prefers-reduced-motion: reduce) { :root { --dur-std: 0ms; --dur-open: 0ms; --dur-close: 0ms; } }
html { font-size: calc(10px * var(--ui-scale)); }
```

**Tuned against the plan's §3 hexes (why):**
- `success` #2E7D4F → **#1F6B3F**: the plan's green was 4.3:1 on `success-container` and 4.0:1 on `surface-container-high`; text ("+$88k", "On · On") needs 4.5.
- `water` #4FA3D6 → **#2E86BE** and `moss` #6A8F3C → **#5E8232**: gauge fills must read 3:1 against their track (`surface-container-high`); the originals were 2.2 and 2.9. The map overlays keep their own colours in render.js (canvas, not CSS).
- `warn` **#B26A00** added: the "warn" gauge level and the amber issue glyph; gold (`tertiary`) is 1.4:1 on a track and is never used for that.
- `on-secondary-container` #1F0A47, `on-error-container` #410E0B, `on-success-container` #07331B, `on-tertiary-container` #2B1246 added (the plan named the containers without their text roles).
- `surface-float` = `surface` at 94 % (plan §3): every floating surface over the map; sheets, the app bar and dialogs are opaque.
- `display` 2.6 rem → **4.4 rem**: only the title wordmark uses it and 26 px read as a subtitle on a 56 rem card.
- `title-lg` 1.5 rem / 600 added for stat-chip values and sheet detail names (the plan's "big readable numbers"); `title` 1.3 stays for card titles.

**Display size.** `--ui-scale` 1 / 1.15 / 1.3 drives `html { font-size }`, so every rem value scales; `--gutter` (16 px), the 1 px edges and
the scrims do not. The app bar is a size container: under **118 rem** of bar width (1280 × 115 %, 1280 × 130 %, 1440 × 130 %) the stat
labels and the "cap 1,500" suffix hide (`@container appbar (max-width: 118rem)`); the icon and the value stay, the needs popover carries the cap.

## 2. Type, shape, elevation, spacing, motion, states

| Role | Size / weight | Used for |
|---|---|---|
| display | 4.4 rem / 700 serif, +.06 em | title wordmark only (gold 4 px underline) |
| headline | 1.7 rem / 600 | sheet titles (Menu, Budget, Build), dialog title |
| title-lg | 1.5 rem / 600, tabular | stat values, detail name |
| title | 1.3 rem / 600 | card / popover / inspect / coach titles, date value, FAB label |
| body | 1.2 rem / 400, lh 1.4 | everything else; 500 for button labels and row values |
| label | 1.05 rem / 500, +.02 em, UPPERCASE for kickers and stat labels | kickers, stat labels, prices, hints, key caps (600) |

Shape: pill for buttons, chips, the FAB, the goal pill, the inspect pill; `shape-sm` 12 px list items, item cards, snackbars, filter-chip keys,
text fields (8 px); `shape-md` 16 px cards, popovers, the side sheet, the coach box; `shape-lg` 28 px dialog, title card and the top corners
of the bottom sheet; 0 for the app bar. Elevation: 0 app bar (1 px `outline-variant` bottom edge); 1 chips, pills, snackbar news, cards at rest;
2 popovers, goal card, inspect card; 3 sheets, dialogs, the FAB, the coach box; scrim 32 % under dialogs (48 % under the title card).
Every floating surface carries a 1 px `outline-variant` edge. Spacing: 8 inside chips, 12 inside cards and popover rows, 16 panel / popover
padding, 24 dialog and title padding; 8 between the bar and the first row of surfaces; 16 gutter. Motion: state layers 160 ms standard;
popovers and sheets open 240 ms emphasized-decelerate (sheets translate, popovers fade + 8 px rise), close 160 ms accelerate; transform /
opacity only. States: hover 8 % and press 12 % of the control's own text colour (`currentColor` layer); selected = `secondary-container` fill +
`on-secondary-container` text; disabled 38 % opacity; focus ring 2 px `primary` outside the shape (`:focus-visible`). Visual control
height 40 px, hit target 44 px (a `::after` extension of 2 px above and below; the bar's 48 px gives the room).

## 3. Surfaces (sizes at 100 %)

**App bar** · full width, 48 px, opaque `surface`, 1 px `outline-variant` bottom edge, padding 0 8 0 12, gap 8. Left to right: brand mark
(32 px `primary` rounded 8, white leaf) · stat chips · spacer · date chip · speed segmented · spacer · Alerts (badge) · [lit overlay chip] ·
Layers · Map · Menu. Nothing else may overlap it. Esc from the map with nothing open = Menu.

*Implemented in U1:* 48 px opaque `surface` with the 1 px bottom edge; the brand mark is the old ▣ glyph on a 32 px `primary` square (the leaf arrives with U5); Alerts / Layers / Map icon buttons and the lit chip do not exist yet (U2), so the Budget / Season / Storm / Land / Almanac / Menu / Mute text buttons stay, as plain text buttons (labels fold away through the existing `tight`/`cap` shed steps, not the container query).

*Implemented in U2:* as specified: brand mark (still ▣) with the wordmark beside it (the `tight` step hides the wordmark) · the five stat chips · a spacer · the date chip · the speed segmented · a spacer · Alerts (badge) · [lit chip] · Layers · Map · Menu · mute (an icon button, not in the spec list) · the Endowed chip. The bar is the size container: under 118 rem the stat labels, the cap suffix and the weather line hide; a two-step JS backstop (`tight`, then `bare`) covers the rest. The Menu icon opens an interim Menu popover (the list of §3 "Side sheet", with hotkey caps) until U3; "Esc from the map with nothing open = Menu" is U3's.

**Stat chip** · 40 px pill, `surface-container`, padding 0 12 0 8; 24 px `primary` icon (paid / group / star / mood / eco), then two lines:
value title-lg tabular + label uppercase in `on-surface-variant`. Students carries "cap 1,500" as a label-size suffix after the value.
Selected (its popover open) = `secondary-container`. **Badge variant**: a 9 px `error` dot with a 2 px `surface` ring at the icon's top-right
when a need is binding (Students) or cash runway is red (Cash). Click opens the chip's popover; Prestige / Happiness / Ecology open the
Almanac row for that stat (U2 may give them a popover later).

*Implemented in U1:* the chip is a 40 px pill with the value over the label (CSS grid, no DOM change); no icon glyphs and no badge dot yet (U2 / U5); "Apps 980 / Cap 1,500" still replaces the label row when the capacity chip shows, instead of the "cap 1,500" suffix; the needs popover is U2.

*Implemented in U2:* as specified: the 24 px `primary` SVG icon (paid / group / star / mood / eco), value over label, "cap 1,500" as the suffix on the Students value, the 9 px `error` dot with its 2 px ring (Students: a need is binding; Cash: the runway is red or cash is negative), `secondary-container` while its popover is open. Cash → the mini budget, Students → the needs popover; Prestige / Happiness / Ecology keep today's breakdown popover (not the Almanac row). The applicants count moved to the needs popover's last line.

**Date / weather chip** · same chip, not selectable; sunny / cloud / rain / moon glyph, value "Apr 9, Y1" at title size, label "SPRING · CLEAR"
("HEAT ADVISORY" in `warn`, "RIVER WINDOW" in `water`). Click opens the Almanac in the Menu sheet.

*Implemented in U1:* date and weather text share one chip (weather label in the small uppercase role, hidden by the existing shed steps).

*Implemented in U2:* the chip is a button that opens the Almanac; the glyph is still the emoji sky / storm glyph (U5 draws sunny / cloud / rain / moon); the value reads "Apr 9, Y1 · Spring" and the label "83° · Rain tmrw" (heat advisory in `warn`, river window in `water`), hidden under 118 rem.

**Speed segmented button** · 40 px, 1 px `outline` border, pill, five segments (pause icon, 1×, 2×, 4×, 8×) min 36 px wide, padding 0 10,
1 px dividers; selected segment `secondary-container`. Space / 1 2 3 4 as today.

**Icon button** · 40 px circle, `on-surface-variant` 24 px glyph, 44 px target; selected (its popover open) `secondary-container`. **Badge**:
16 px `error` pill, white 10 px / 600 count, top-right; "all clear" = a 8 px `success` dot. Sizes 32 px inside dense rows (alerts, inspect pill).

*Implemented in U2:* as specified for the bar's Alerts / Layers / Map / Menu / mute (`.btn.icon` + `svg.ic`), the popover heads (32 px) and the Map pin; the badge count is the open issues (`issues.main`), the dot the all-clear state. The Alerts rows keep today's text buttons (Fix · ⌖ · zz · ✕ · 🔔), not 32 px icon buttons.

**Goal pill** · top-left at (gutter, bar + 8), 40 px pill, `surface-float`, elevation 1; 24 px progress ring (`primary` on
`surface-container-high`, 3 px) · kicker "GOAL 6" in `primary` · title 500 · "2 / 5" tabular `on-surface-variant` · expand_more.
Click expands to the goal card; a goal change expands it on its own and the card collapses after 10 s without hover.

**Goal card** · same anchor, 360 wide, radius 16, padding 16, elevation 2, `surface-float`. Portrait 48 px circle (1 px edge) · kicker
"NEW GOAL · 6 OF 22" · title (title role) · close icon; why line in `on-surface-variant`; 8 px progress bar + "2 / 5"; actions
**Build it: Live Oak** (gold) + **Show me** (tonal); 1 px divider; "NEXT UP · title". Esc or outside click collapses to the pill.

*Implemented in U1:* the card keeps today's position, the needs strip and the Build it / Show me buttons; the portrait is the 48 px circle; Build it is the gold button; the "collapsed" and `hudMode` pill forms are plain pills (no progress ring until U2). A kind accent (`interrupt` / `background`) stays as a 4 px left stripe.

*Implemented in U2:* the pill and the card as specified (ring, kicker "GOAL 6" / "MILESTONE", title, "2 / 5", expand_more; the card with the portrait, kicker "GOAL · 6 OF 22" — "NEW GOAL · …" on the change that opened it — title, the objective text when it adds to the title, why, the 8 px bar, Build it (gold) + Show me (tonal), a fold chevron and the dismiss ✕ in the head, the NEXT UP line over a divider). The 10 s fold, hover hold, Esc and outside click are in; the needs strip left the card. The kind stripe stays on the card and colours the pill's kicker `warn` for an interrupt. A short window (`#hud.short`) still drops the why and next-up lines.

**Build extended FAB** · bottom-right at the gutter, 56 px pill, `tertiary` / `on-tertiary`, elevation 3, padding 0 20 0 16; construction
icon · "Build" (title) · key cap "G" (1.5 px border, 20 px). Hidden while the bottom sheet, the side sheet or a dialog is open. G toggles.

*Implemented in U2:* as specified (`#fab-build`); it toggles today's palette as the interim sheet (G does the same; Shift+G opens the full build menu) and hides while the sheet, a panel, a card or the build menu is open; beside an open inspect panel it shifts left of it. The palette's own gold Build toggle became the filled "All buildings · ⇧G" button, so gold stays on three things.

**Snackbar** · bottom-centre lane, bottom gutter, 340–640 wide, radius 12, `surface-float`, elevation 3, padding 8 8 8 16, body text,
at most two stacked 8 px apart (news above decisions), 6 s for news. Plain: message · text button "Log" · close icon. **Decision**: bold
lead ("Cove levee at 72 %") · two actions (text "Hold", tonal "Send the crew") · a 3 px `primary` countdown line along the bottom edge that
shrinks with the deadline. When the inspect card is open and the lane would touch it, the lane shifts right of the card (U3).

*Implemented in U1:* the notification stack (`.notif`) and the decision toast are re-skinned in place (`surface-float`, elevation 3, 12 px radius, kind stripe on the left); the countdown line is the 4 px `primary` bar under the options. Snackbar lane and Log panel are U2.

*Implemented in U2:* the lane (`#snack-lane`, bottom centre, up to 640 wide), two visible, 6 s, news above the decision; news lines carry a Log text button and pan on click; notifications keep their action / Show me / Locate buttons and never wait (they replace the oldest visible news line), news lines queue. The kind stripe on the left stays (the mock had none). The decision snackbar: bold lead, "Hold" as text, "Send the crew" tonal, the 3 px `primary` line along the bottom edge; the football option buttons stay as a column (a row during the set piece). The Log is Menu → Log. The inspect-card shift of the lane is U3's.

**Popover** · 360 wide (Alerts and Layers 400, Map fits its canvas), radius 16, padding 16, elevation 2, `surface-float`, head = title +
close icon. Anchored 8 px under the bar: stat-chip popovers sit on the left gutter (so they cover the goal pill whole instead of peeking),
icon popovers align their right edge to their icon, clamped to the gutters. One open at a time; Esc, outside click or the same control
closes; the opening control shows selected. Contents: **needs** six gauges (label 64 px · 8 px bar · value; ok `success`, ≥ 85 % `warn`,
full `error`), the binding line + "Build" text button, the sewage alert row (`error-container`); **mini budget** Income / Expenses / Net /
Runway rows + "Open Budget · B" tonal; **alerts** rows (32 px glyph tile by severity: `error-container`, `tertiary-container` + `warn`,
`primary-container`; title 600 + label line; Fix / Build / Link it text button, snooze and dismiss 32 px icons; 1 px dividers) and a foot
Spotlight (tonal) + Clear N · $ (filled); **layers** six filter chips, the legend for the active one, the Settings hint; **map** the
200 px minimap canvas (radius 8), pin icon (selected when pinned, remembered in settings), click-to-pan line. Hotkeys: I alerts,
F W K P C E overlays, M map.

*Implemented in U1:* only today's `#popover` (breakdown card) exists; it carries the spec surface (360 → 340 wide, unchanged), title role and `success` / `error` signs.

*Implemented in U2:* needs, mini budget, Alerts, Layers, Map and (interim) Menu as specified: 360 wide (Alerts / Layers 400, Map its canvas, Menu 320), 8 px under the bar, the stat-chip ones on the left gutter, the icon ones right-aligned to their icon, one at a time, Esc / outside press / the same control closes, the control shows selected. Needs: six gauge rows (Sewage is the sixth), the binding line in its level colour (the sewage alert is that line in `error-container`), Locate, the applicants line. Mini budget: last month's Income / Expenses / Net / Runway + "Open Budget · B". Alerts: today's tray rows (Fix / ⌖ / zz / ✕ / 🔔, In progress, Suggestions, the hidden line) with the foot Spotlight (tonal) + Clear N · $ (filled); titles may wrap to two lines. Layers: the six filter chips, the legend as swatches that echo the canvas colours, the note. Map: the pin (`settings.keepMinimap`, selected while pinned; a pinned popover survives Esc and other popovers; its icon unpins it); Settings also pins the Layers popover (`keepOverlays`), stacked under a pinned Map. Hotkeys: I still cycles the issues (it does not open the popover), M stays mute.

**Side sheet (Menu)** · right gutter, top bar + 8, bottom gutter, 360 wide, opaque `surface`, radius 16, elevation 3, 1 px edge; head 56 px
(headline + close), body scrolls inside. **List state**: list items 48 px with a label-size second line and the hotkey cap at right
(Budget B · Season N · Storm T · Land Office O · Almanac · Milestones L · Log), divider, Settings / How to play / About with chevrons.
**Panel state**: head = arrow_back · panel title · close; the `registerPanel` body in `.budget` styling (kicker sections, rows with 1 px
`surface-container-high` dividers, totals 600, policy rows 48 px with a slider / segmented / switch at right). Esc closes the sheet, back
returns to the list; B N T O L open the sheet straight to the panel.

*Implemented in U1:* panels still open centred over the map (`#panels .panel`: opaque `surface`, radius 16, elevation 3, 1 px edge, 20 px padding, headline title); the side-sheet host and list state are U3.

*Implemented in U2:* the list state exists as the interim Menu popover (`#pop-menu`, 320 wide, 48 px list items with the second line and the hotkey caps, a divider, Settings / How to play / About); each item opens today's centred panel. Log is a panel now (`registerPanel('log')`). Settings gained "Keep the minimap open" and "Keep overlays visible" and lost the HUD mode row (H hides, Shift+H restores; not a setting). Panel content uses `.row` / `.set-row` with 1 px `surface-container-high` dividers, `.seg` segmented buttons, `.toggle` (outlined off, `secondary-container` on) and primary-accent sliders / checkboxes.

*Implemented in U3:* the side sheet is `#menu-sheet` (360 wide at 100 %, full height from the bar + 8 to the bottom gutter, **28 px top-left** corner and 16 px elsewhere per the task, elevation 3, no scrim, 1 px edge); head 56 px (back arrow only in the panel state, headline title, close); list items 48 px with a leading 24 px icon, a label-size second line and the hotkey cap (chevron where there is none); panels render in `.sheet-body` with 8 px padding. Settings is one list (label left, control right; Display size, Alerts and the audio row stack or share the row by width): Display size, Alerts, Audio, Keep the minimap open, Keep overlays visible, Particles, Screen shake, Colour-blind overlays, then Tour and Save / Load / New game. The Budget keeps the mock's stacked kicker sections; the football tables shrink their columns rather than scroll sideways. Esc closes the sheet from either state; B N T O L deep-link and the same key closes. Opened from the title screen the sheet sits at the top gutter with no back arrow.

**Bottom sheet (Build)** · full width, docked, top corners 28, opaque, elevation 3, 1 px top edge; 24 px handle row (32 × 4 `outline-variant`
pill; ⤢ and close icons at the right), 40 px category tabs (selected `primary` with a 3 px bar; `warn` pip for new items), 1 px divider, the
palette: item cards 112 wide (64 px icon, name 600, price label) in a horizontal scroller · divider · bulldoze + info icons. ≈ 220 px tall.
**Expanded** (drag up, ⤢, Shift+G): 80 % height; head "Build" + hint + search field (240) + close; three columns 200 / 1fr / 300: rail
(list items 40 px, ★ + count), cards grid (min 210 wide: icon, name title, price, requirement chips; selected `secondary-container`; locked 38 %),
detail (80 px icon, name headline, meta, ★ goal banner in `tertiary-container`, text, quote, EFFECTS list, sticky foot Place · Enter + Show
on map). G toggles, Esc closes, arrows move, Enter arms.

*Implemented in U1:* the palette stays a full-width docked bar (opaque `surface`, 1 px top edge, elevation 3, no rounded corners, no handle row) with a 40 px tab row (primary underline, `warn` pip), item cards (`surface-container-low`, 1 px `outline-variant`, selected `secondary-container`, locked 62 % with the unlock condition at full strength on hover), and the gold Build toggle (the future FAB). The build menu (G) is a re-skinned centred panel: rail list items, cards in the grid-card look, `tertiary-container` goal banner and Goal badge, primary Build this. Bottom / expanded sheet is U4.

*Implemented in U2:* the same bar, hidden at rest and shown by the FAB / G (Esc or its ✕ closes it; the FAB hides while it is open); nothing docks on it any more (`--bot` is the gutter while it is closed). The real bottom sheet (handle row, 28 px corners, ⤢ expand) and the expanded build sheet are U4; Shift+G opens today's build menu in the meantime.

**Inspect card** · bottom-left at the gutter, 320 wide, radius 16, padding 12 16 16, elevation 2, `surface-float`: 56 px sprite, title +
label-size sub, collapse (expand_more) and close icons; rows label / value 500 tabular with `surface-container-high` dividers (`success`
for On · On); actions Pilings (tonal) · Repair (text) · Demolish (text, `error`, right). **Pill**: 40 px, 32 px sprite circle, name 600,
"286 / 300 beds", expand_less + close (32 px). Esc or right-click closes; the kitchen menu editor stays a dialog.

*Implemented in U1:* the inspect side panel keeps its full-height right dock (`--inspect-w`, 4 px kind stripe on the left, 64 px sprite tile); the card / pill pair is U3.

*Implemented in U3:* `#inspect` is the card (320 wide, bottom-left at the gutter above the Build sheet, 56 px sprite tile, title + label-size sub, a collapse chevron and a close icon, rows, the action row under a 1 px rule). It is capped in height (`max-height: max(24rem, 100vh − bar − sheet − 28rem)`) so it never reaches the goal pill; the body scrolls. Collapsed it is the 40 px pill with the 32 px round sprite, the name and the chevron up + close, **without** the "286 / 300 beds" meta line of the mock (the card has no single headline number for every kind it inspects: tile, levee, gator, student). The 4 px kind stripe left with the dock. Differences from the mock: the card's rows are today's `.row`s (kind-specific, many); the kitchen Menu summary and the network pill stay inside the body.

**Dialog + scrim** · centred, 420 wide, `surface-container-high`, radius 28, padding 24, elevation 3, over a 32 % scrim (the bar too);
kicker · headline · body in `on-surface-variant` · actions right-aligned (text, then filled). Esc = the dismiss action. Board, failure,
storm and voice cards use it; the voice card's two choices are tonal + filled.

*Implemented in U3:* the same dialog for every card (420 px, 28 px corners) and the student voice (`#voice-card` is its scrim host, `#voice-dialog` the card: Decline text, Accept filled). Actions are right-aligned with the filled one last; long action labels (the failure card's options) wrap inside full-height buttons. Esc runs the action flagged `dismiss: true`, else closes; focus goes in and comes back (see INTEGRATION_NOTES "UI refresh U3"). The kicker line sits above the headline as in the mock.

*Implemented in U1:* `.card` (the card host) is the dialog: `surface-container-high`, radius 28, 24 px padding, elevation 3, no edge, over the 32 % scrim; the title is the headline role, the body `on-surface-variant`. Actions follow the new button rules (`.primary` = filled, default = tonal).

**Filter chip** · 32 px, radius 8, 1 px `outline`, key cap 20 px `surface-container-high`; selected `secondary-container` with the cap in
`secondary` / white. The lit chip in the bar is the 24 px pill form (`secondary-container`, 1 px `secondary`).

*Implemented in U1:* the six overlay keys (`.ov-btn`) are 36 px key buttons with a 1 px `outline` border on `surface-float` (selected `secondary-container` + `secondary` edge); they float on the map until the Layers popover (U2). The legend chip is `surface-float` with an `outline-variant` edge.

*Implemented in U2:* as specified: 32 px filter chips (key cap + name) in the Layers popover, the lit 24 px chip beside the Layers icon while an overlay is on (`#ov-lit`, click = the popover).

**List item** · 48 px (40 in the rail), radius 12, padding 0 12 0 16, body text with an optional label-size line, trailing hotkey cap /
count / chevron; selected `secondary-container`.

**Text field** · 40 px, radius 8, 1 px `outline`, floating label (label role on a `surface` patch), placeholder `on-surface-variant`;
focus = `primary` border 2 px. Leading search icon in the Build sheet.

**Buttons** · 40 px pill, label 500 body, padding 0 20 (text 0 12): text `primary`; filled `primary` / white, elevation 1; tonal
`secondary-container`; **gold** `tertiary` / `on-tertiary` 600 (exactly: Build FAB, Build it, Charter); outlined 1 px `outline`;
danger = text in `error`. Key caps inside buttons: 18 px, 1 px border of the text colour.

**Coach card** · 340 wide, radius 16, elevation 3, opaque; kicker "STEP 3 OF 6" in `primary` · title · body `on-surface-variant` · Back
(text) · spacer · Skip tour (text) · Next (filled). Placed above and right-aligned to its target. The ring: the target's rect + 8 px, pill,
3 px `primary` ring, the 32 % scrim everywhere else (one element, a spread box-shadow; no blur).

*Implemented in U1:* the box is 340 wide, opaque, radius 16, elevation 3; the ring is the target's rect with a 3 px `primary` border at 12 px radius (not a pill, not a spread shadow: the four scrim panes still tile the rest at 32 %). The pane / ring / box keep their 240 ms position transitions (an overlay, no layout cost): the one place that moves left / top / width / height.

**Title card** · centred, 560 wide, radius 28, padding 24, opaque, over the 48 % scrim: kicker · wordmark (display serif, `primary`, 4 px
`tertiary` underline) · italic serif tagline · **Charter the university** (gold, 48 px) · text buttons Continue / How to play / About /
Settings · Seed outlined field (180) + mute icon · DISPLAY SIZE segmented (Compact 100 % · Comfortable 115 % · Large 130 % · Auto) + hint ·
motto kicker.

*Implemented in U1:* as specified, except the tagline is the sans italic (the serif is the wordmark's alone, plan §8); Continue / How to play / About / Settings are text buttons; Display size is the outlined segmented button; opening a panel from the title fades the card out instead of blurring it.

## 4. Layout rules (what `window.mockCheck()` enforces)

- The at-rest screen is the bar, the goal pill, the Build FAB and the snackbar lane; nothing else until asked.
- Base surfaces (pill / card, FAB, inspect, snackbars) never overlap each other or the bar. Transient surfaces (popovers, sheets, dialog,
  coach box) may cover base surfaces but never the bar or each other; the scrims and the coach ring are exempt.
- Every surface stays inside the viewport at 1280 × 800, 1440 × 900 and 1920 × 1080 at all three display sizes (27 cases, all clean).
- Sheets scroll inside themselves (Budget at 1280 × 130 %); the expanded Build sheet keeps Place pinned at the detail column's foot.

## 5. Contrast (output of `node tools/ui_mock/contrast.mjs`)

```
foreground              background                kind   ratio   AA     where
----------------------  ------------------------  -----  ------  -----  ----------------------------------------
on-surface #1C1B1F      surface #FBFAFD           text   16.47   pass   body, titles on every floating surface and the app bar
on-surface #1C1B1F      surface-container-low #F5F3F8  text   15.55   pass   item / grid card names
on-surface #1C1B1F      surface-container #EFEDF3  text   14.75   pass   stat chip values
on-surface #1C1B1F      surface-container-high #E9E6EF  text   13.89   pass   dialog title, filter-chip key cap
on-surface-variant #49454F  surface #FBFAFD           text   8.99    pass   labels, kickers, secondary lines, placeholders
on-surface-variant #49454F  surface-container #EFEDF3  text   8.04    pass   stat chip labels
on-surface-variant #49454F  surface-container-low #F5F3F8  text   8.48    pass   card prices
on-surface-variant #49454F  surface-container-high #E9E6EF  text   7.58    pass   dialog body, req chips
on-surface-variant #49454F  secondary-container #F0E7FF  text   7.82    pass   label inside a selected stat chip
primary #461D7C         surface #FBFAFD           text   11.69   pass   text buttons, goal kicker, selected tab, wordmark
primary #461D7C         surface-container #EFEDF3  icon   10.47   pass   stat chip icons
primary #461D7C         surface-container-low #F5F3F8  text   11.03   pass   text button on a card
on-primary #FFFFFF      primary #461D7C           text   12.16   pass   filled button, brand mark
on-primary-container #1F0A47  primary-container #E9DDFF  text   13.63   pass   primary container text
primary #461D7C         primary-container #E9DDFF  icon   9.41    pass   info issue glyph
secondary #5E2CA5       surface #FBFAFD           text   8.49    pass   links, selected filter chip key
on-secondary #FFFFFF    secondary #5E2CA5         text   8.83    pass   selected filter-chip key cap
on-secondary-container #1F0A47  secondary-container #F0E7FF  text   14.74   pass   selected chip / segment / list item / tonal button
on-tertiary #2B1246     tertiary #F5B700          text   9.12    pass   Build FAB, Build it, Charter (gold)
on-tertiary-container #2B1246  tertiary-container #FFE680  text   13.21   pass   goal banner, ★ badge
warn #B26A00            tertiary-container #FFE680  icon   3.41    pass   warn issue glyph
error #B3261E           surface #FBFAFD           text   6.29    pass   Demolish text button, bad gauge value
on-error #FFFFFF        error #B3261E             text   6.54    pass   alerts badge
on-error-container #410E0B  error-container #F9DEDC   text   12.77   pass   alert row
error #B3261E           error-container #F9DEDC   icon   5.14    pass   alert row icon, bad issue glyph
success #1F6B3F         surface #FBFAFD           text   6.25    pass   +$88k net, On · On
on-success-container #07331B  success-container #DDF3E4  text   12.02   pass   all-clear row
success #1F6B3F         success-container #DDF3E4  icon   5.57    pass   all-clear icon
outline #79757F         surface #FBFAFD           icon   4.33    pass   segmented / text field / filter chip borders
outline #79757F         surface-container-high #E9E6EF  icon   3.65    pass   switch off border
primary #461D7C         surface-container-high #E9E6EF  icon   9.86    pass   progress fill on its track, slider
success #1F6B3F         surface-container-high #E9E6EF  icon   5.27    pass   gauge fill (ok) on its track
warn #B26A00            surface-container-high #E9E6EF  icon   3.44    pass   gauge fill (warn) on its track
error #B3261E           surface-container-high #E9E6EF  icon   5.30    pass   gauge fill (bad) on its track
water #2E86BE           surface #FBFAFD           icon   3.83    pass   water chip / gauge accent
water #2E86BE           surface-container-high #E9E6EF  icon   3.23    pass   water gauge fill on its track
moss #5E8232            surface #FBFAFD           icon   4.28    pass   ecology / moss accent
moss #5E8232            surface-container-high #E9E6EF  icon   3.61    pass   moss gauge fill on its track
tertiary #F5B700        surface #FBFAFD           info   1.73    info   gold underline under the wordmark (decorative; gold is never text or a required border)
outline-variant #CAC4D0  surface #FBFAFD           info   1.64    info   dividers and the 1 px edge of floating surfaces (decorative)
surface-container-high #E9E6EF  surface #FBFAFD           info   1.19    info   gauge / progress tracks (decorative)

41 pairs, 0 failing (text ≥ 4.5, icons / borders ≥ 3.0; info rows are decorative)
```

`surface-float` is `surface` at 94 %: over the brightest map green the effective background darkens by about 1 %, which moves the ratios
above by less than 0.1. Gold is a fill only (`on-tertiary` text on it); `outline-variant` is decorative (M3's own rule) and every control
that needs a visible boundary uses `outline`.

## 6. Icons (24 px, `fill: none; stroke: currentColor; stroke-width: 2; round caps and joins`; two glyphs are filled)

Inline `<symbol>` sprite (ids `i-<name>`), referenced as `<svg class="icon"><use href="#i-close"/></svg>`; U5 registers the same paths.

| name | path(s) |
|---|---|
| notifications | `M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z` `M10 21h4` |
| layers | `M12 3 3 8l9 5 9-5-9-5z` `M3 12l9 5 9-5` `M3 16l9 5 9-5` |
| map | `M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z` `M9 4v14` `M15 6v14` |
| menu | `M4 7h16` `M4 12h16` `M4 17h16` |
| close | `M6 6l12 12` `M18 6 6 18` |
| arrow_back | `M19 12H5` `M11 6l-6 6 6 6` |
| expand_less / expand_more / chevron_right | `M6 15l6-6 6 6` / `M6 9l6 6 6-6` / `M9 6l6 6-6 6` |
| construction | `M4 20l7-7` `M9 11l5-5 4 4-5 5z` `M15 5l2-2 4 4-2 2` |
| pause | `M8 5v14` `M16 5v14` (stroke 3) |
| play_arrow | `M8 5v14l11-7z` (filled) |
| push_pin | `M12 17v5` `M8 3h8l-1 6 3 3v2H6v-2l3-3z` |
| info | `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z` `M12 11v5` `M12 8h.01` |
| delete (bulldoze) | `M4 7h16` `M9 7V4h6v3` `M6 7l1 14h10l1-14` `M10 11v6` `M14 11v6` |
| check | `M5 12l4 4L19 7` |
| warning | `M12 3 2 21h20z` `M12 10v5` `M12 18h.01` |
| search | `M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z` `M15.5 15.5 21 21` |
| open_in_full (⤢) | `M14 4h6v6` `M20 4l-7 7` `M10 20H4v-6` `M4 20l7-7` |
| snooze | `M4 9h5l-5 6h5` `M13 5h7l-7 9h7` |
| star | `M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z` (filled) |
| paid (cash) | `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z` `M12 6.5v11` `M14.8 9.3c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2 0 2.7 5.6 1.3 5.6 4.1 0 1.3-1.3 2-2.8 2-1.4 0-2.5-.7-2.9-1.7` |
| group (students) | `M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z` `M3 20a6 6 0 0 1 12 0` `M16 5.5a3 3 0 0 1 0 5.5` `M21 20a6 6 0 0 0-4.5-5.8` |
| mood (happiness) | `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z` `M8.5 14.5a4.5 4.5 0 0 0 7 0` `M9 10h.01` `M15 10h.01` |
| eco (ecology, brand) | `M5 19c0-8 5-13 14-13 0 9-5 13-11 13` `M5 19l7-7` |
| sunny | `M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z` `M12 3v2` `M12 19v2` `M3 12h2` `M19 12h2` `M5.6 5.6l1.4 1.4` `M17 17l1.4 1.4` `M5.6 18.4 7 17` `M17 7l1.4-1.4` |
| volume_up | `M4 10v4h4l5 4V6L8 10z` `M16 9a4 4 0 0 1 0 6` `M18.5 6.5a7.5 7.5 0 0 1 0 11` |
| settings | the gear path in the mock (long; copy from the sprite) |

Still to draw in U5 (not in the mock): cloud / rain / moon for the date chip, a mute variant of volume_up, a sewage glyph for the Sewage gauge.

## 7. Decisions U0 took where the plan left room

- Snackbars are light (`surface-float`), not M3's inverse-surface: Josh asked for no dark panels.
- The FAB hides while the Build sheet, the Menu sheet or a dialog is open (it would sit under them); the coach rings it in place.
- Stat-chip popovers open on the left gutter and are the pill's width or wider so the pill is covered whole, not half.
- The HD icon tiles keep their baked purple plate and gold rim inside white cards (zero art work; see the questions in the hand-back).
- The compact density rule (§1) is a container query, not a display-size special case: it fires on width, so a narrow window at 100 % gets it too.
- Inspect pill is the collapsed state of the inspect card (expand_more on the card, expand_less on the pill), 40 px like the goal pill.

## 8a. Implemented in U2 (what the live sheet does differently from §3–§4, and why)

- The at-rest screen is the bar, the goal pill, the FAB and the lane (§4), plus the pre-existing alert strip (top centre, U3 / U5) and the undo chip / hint when they fire; a pinned Map or Layers popover is a base surface by choice.
- G toggles the Build sheet (the FAB's action) and Shift+G the full build menu, so the key and the FAB agree; U4 may make Shift+G the sheet's expand.
- Notifications never queue behind news (a click's feedback must be immediate): the oldest visible news line makes room; only news lines wait. Snackbars size to their content (340–640).
- The Alerts rows keep today's text action buttons and the purple glyph plate (the issue tests read them); the severity-coloured tiles and 32 px icon buttons of the mock are U5's.
- `svg.ic` is the icon class (not `.icon`: the palette and build-menu canvases already use `.icon`); `.sl` is the state layer of the non-button controls.
- The HUD's hidden state is session-only (`ui.hudMode()`), read once from the old `settings.hudMode` on load and then dropped.

## 8. Implemented in U1 (what the live sheet does differently from §1–§3, and why)

- Buttons: default `.btn` is tonal, `.btn.primary` filled, `.btn.small` 32 px (44 px hit area through `::after`), `.btn.icon` a 40 px circle (32 px in cards and panel heads), `.btn.danger` text in `error`; selection controls (`.seg-btn`, `.speed-btn`, `.ov-btn`, `.toggle`, `.fb-tab`) are outlined / transparent when off and `secondary-container` when on; a plain `.btn.active` (bulldoze, issue spotlight) is filled `primary`. Gold is `#btn-charter`, `#btn-obj-build`, `#btn-build-menu` (and `.btn.gold`).
- State layers are `::before` in `currentColor` (hover 8 %, press 12 %), transitions 160 ms on opacity / background-color; every other motion is transform / opacity at 240 ms decelerate, zeroed by `prefers-reduced-motion`.
- Type: `--fs-small`, `--fs-lead`, `--fs-num` survive as aliases of body, title and title-lg; body is now 12 px, so dense panels (Season, Storm) are 1 px smaller than before.
- Colours that stay hard-coded are not CSS: the minimap, the Land Office section map and the issue glyphs are canvases drawn by render.js / ui_panels.js (dark minimap field, kind-coloured glyphs on a purple plate); U2 / U3 move them into popovers and sheets where their backgrounds can follow.
- Issue rows keep a `primary` stripe and selection ring in CSS (ui.js no longer writes the kind colour inline); the kind colour lives on the glyph.
