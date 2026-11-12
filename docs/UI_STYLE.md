# UI style sheet (U0 of docs/PLAN_UI_REFRESH.md)

The single source for the refresh: U1 copies §1 into `style.css` verbatim, U2–U5 build the surfaces of §3 to the sizes here,
U6 re-ran §5 on the live DOM (`tools/qa/contrast_audit.mjs`) and §8 records what was built. The mock that renders every surface below is `tools/ui_mock/index.html` (open it; `` ` `` toggles the toolbar,
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
  --warn: #B26A00; --warn-text: #8A5200;
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
- `warn` **#B26A00** added: the "warn" gauge level and the amber issue glyph; gold (`tertiary`) is 1.4:1 on a track and is never used for that. **U6:** `warn` is 3.7–4.1:1 on the light surfaces, so it is a fill / icon / border colour only; text in the warn hue (the heat-advisory weather line, an interrupt goal's kicker, the detail's lock line, the Land Office's why line, the warn chip) uses **`warn-text` #8A5200** (5.5 on `surface-container`, 6.1 on `surface`).
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

**Stat chip** · 40 px pill, `surface-container`, padding 0 12 0 8; 24 px `primary` icon (paid / group / star / mood / eco), then two lines:
value title-lg tabular + label uppercase in `on-surface-variant`. Students carries "cap 1,500" as a label-size suffix after the value.
Selected (its popover open) = `secondary-container`. **Badge variant**: a 9 px `error` dot with a 2 px `surface` ring at the icon's top-right
when a need is binding (Students) or cash runway is red (Cash). Click opens the chip's popover; Prestige / Happiness / Ecology open the
Almanac row for that stat (U2 may give them a popover later).

**Date / weather chip** · same chip, not selectable; sunny / cloud / rain / moon glyph, value "Apr 9, Y1" at title size, label "SPRING · CLEAR"
("HEAT ADVISORY" in `warn`, "RIVER WINDOW" in `water`). Click opens the Almanac in the Menu sheet.

**Speed segmented button** · 40 px, 1 px `outline` border, pill, five segments (pause icon, 1×, 2×, 4×, 8×) min 36 px wide, padding 0 10,
1 px dividers; selected segment `secondary-container`. Space / 1 2 3 4 as today.

**Icon button** · 40 px circle, `on-surface-variant` 24 px glyph, 44 px target; selected (its popover open) `secondary-container`. **Badge**:
16 px `error` pill, white 10 px / 600 count, top-right; "all clear" = a 8 px `success` dot. Sizes 32 px inside dense rows (alerts, inspect pill).

**Goal pill** · top-left at (gutter, bar + 8), 40 px pill, `surface-float`, elevation 1; 24 px progress ring (`primary` on
`surface-container-high`, 3 px) · kicker "GOAL 6" in `primary` · title 500 · "2 / 5" tabular `on-surface-variant` · expand_more.
Click expands to the goal card; a goal change expands it on its own and the card collapses after 10 s without hover.

**Goal card** · same anchor, 360 wide, radius 16, padding 16, elevation 2, `surface-float`. Portrait 48 px circle (1 px edge) · kicker
"NEW GOAL · 6 OF 22" · title (title role) · close icon; why line in `on-surface-variant`; 8 px progress bar + "2 / 5"; actions
**Build it: Live Oak** (gold) + **Show me** (tonal); 1 px divider; "NEXT UP · title". Esc or outside click collapses to the pill.

**Build extended FAB** · bottom-right at the gutter, 56 px pill, `tertiary` / `on-tertiary`, elevation 3, padding 0 20 0 16; construction
icon · "Build" (title) · key cap "G" (1.5 px border, 20 px). Hidden while the bottom sheet, the side sheet or a dialog is open. G toggles.

**Snackbar** · bottom-centre lane, bottom gutter, 340–640 wide, radius 12, `surface-float`, elevation 3, padding 8 8 8 16, body text,
at most two stacked 8 px apart (news above decisions), 6 s for news. Plain: message · text button "Log" · close icon. **Decision**: bold
lead ("Cove levee at 72 %") · two actions (text "Hold", tonal "Send the crew") · a 3 px `primary` countdown line along the bottom edge that
shrinks with the deadline. When the inspect card is open and the lane would touch it, the lane shifts right of the card (U3).

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

**Side sheet (Menu)** · right gutter, top bar + 8, bottom gutter, 360 wide, opaque `surface`, radius 16, elevation 3, 1 px edge; head 56 px
(headline + close), body scrolls inside. **List state**: list items 48 px with a label-size second line and the hotkey cap at right
(Budget B · Season N · Storm T · Land Office O · Almanac · Milestones L · Log), divider, Settings / How to play / About with chevrons.
**Panel state**: head = arrow_back · panel title · close; the `registerPanel` body in `.budget` styling (kicker sections, rows with 1 px
`surface-container-high` dividers, totals 600, policy rows 48 px with a slider / segmented / switch at right). Esc closes the sheet, back
returns to the list; B N T O L open the sheet straight to the panel.

**Bottom sheet (Build)** · full width, docked, top corners 28, opaque, elevation 3, 1 px top edge; 24 px handle row (32 × 4 `outline-variant`
pill; ⤢ and close icons at the right), 40 px category tabs (selected `primary` with a 3 px bar; `warn` pip for new items), 1 px divider, the
palette: item cards 112 wide (64 px icon, name 600, price label) in a horizontal scroller · divider · bulldoze + info icons. ≈ 220 px tall.
**Expanded** (drag up, ⤢, Shift+G): 80 % height; head "Build" + hint + search field (240) + close; three columns 200 / 1fr / 300: rail
(list items 40 px, ★ + count), cards grid (min 210 wide: icon, name title, price, requirement chips; selected `secondary-container`; locked 38 %),
detail (80 px icon, name headline, meta, ★ goal banner in `tertiary-container`, text, quote, EFFECTS list, sticky foot Place · Enter + Show
on map). G toggles, Esc closes, arrows move, Enter arms.

**Inspect card** · bottom-left at the gutter, 320 wide, radius 16, padding 12 16 16, elevation 2, `surface-float`: 56 px sprite, title +
label-size sub, collapse (expand_more) and close icons; rows label / value 500 tabular with `surface-container-high` dividers (`success`
for On · On); actions Pilings (tonal) · Repair (text) · Demolish (text, `error`, right). **Pill**: 40 px, 32 px sprite circle, name 600,
"286 / 300 beds", expand_less + close (32 px). Esc or right-click closes; the kitchen menu editor stays a dialog.

**Dialog + scrim** · centred, 420 wide, `surface-container-high`, radius 28, padding 24, elevation 3, over a 32 % scrim (the bar too);
kicker · headline · body in `on-surface-variant` · actions right-aligned (text, then filled). Esc = the dismiss action. Board, failure,
storm and voice cards use it; the voice card's two choices are tonal + filled.

**Filter chip** · 32 px, radius 8, 1 px `outline`, key cap 20 px `surface-container-high`; selected `secondary-container` with the cap in
`secondary` / white. The lit chip in the bar is the 24 px pill form (`secondary-container`, 1 px `secondary`).

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

**Title card** · centred, 560 wide, radius 28, padding 24, opaque, over the 48 % scrim: kicker · wordmark (display serif, `primary`, 4 px
`tertiary` underline) · italic serif tagline · **Charter the university** (gold, 48 px) · text buttons Continue / How to play / About /
Settings · Seed outlined field (180) + mute icon · DISPLAY SIZE segmented (Compact 100 % · Comfortable 115 % · Large 130 % · Auto) + hint ·
motto kicker.

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
warn-text #8A5200       surface-container #EFEDF3  text   5.50    pass   U6: the heat-advisory weather line (warn is a fill / icon colour only)
warn-text #8A5200       surface #FBFAFD           text   6.14    pass   U6: an interrupt goal kicker, the detail lock line, the Land Office why line
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

43 pairs, 0 failing (text ≥ 4.5, icons / borders ≥ 3.0; info rows are decorative)

**U6 live-DOM audit** (`node tools/qa/contrast_audit.mjs`, 1440 × 900, 96-map, 100 %; every visible text node, `svg.ic` icon and control border against its effective background: ancestors up to the first opaque / ≥ 94 % surface, translucent layers and the dialog scrim composited, a floating surface composited over the world-canvas pixel under it; text ≥ 4.5, ≥ 24 px or bold ≥ 19 px and icons / borders ≥ 3.0; inactive content is "info", not gated):

```
state                         checked   failing   info
----------------------------  --------  --------  ----------
title                         20        0         0
title-dimmed-under-sheet      55        0         20
at-rest                       44        0         1
goal-card                     49        0         1
popover-needs                 66        0         1
popover-budget                57        0         1
popover-alerts                77        0         1
popover-layers                70        0         1
popover-map                   48        0         1
popover-breakdown             59        0         1
menu-list                     79        0         1
menu-budget                   88        0         1
menu-settings                 76        0         1
build-collapsed               70        0         2
build-expanded                125       0         11
dialog                        49        0         1
coach                         49        0         1
inspect-card                  78        0         6
inspect-pill                  48        0         1
snackbars                     56        0         1
night                         50        0         1
storm                         43        0         12
hud-hidden                    2         0         0
total                         1358      0         67
```

The first run found 39 failures of two kinds and both were fixed in `style.css`: text in `warn` (3.65 on `surface-container`: the weather line's heat advisory, the interrupt goal kicker) → the `warn-text` role; the gold `star` icon in the Build rail (1.5–1.7 on white) → the card's `tertiary-container` disc with `on-tertiary-container`. The 67 info rows are inactive content by design: the dimmed title card under the sheet (14 %, `pointer-events: none`), the 38 % greyed Build cards (their "Unlocks: …" line stays at full strength and passes), the HUD dimmed under the expanded Build sheet, the speed buttons disabled during a set piece, the cash delta at opacity 0 between flashes, and the inspect card's empty meter dots at 30 %.

`surface-float` is `surface` at 94 %: over the brightest map green the effective background darkens by about 1 %, which moves the ratios
above by less than 0.1. Gold is a fill only (`on-tertiary` text on it); `outline-variant` is decorative (M3's own rule) and every control
that needs a visible boundary uses `outline`.

## 6. Icons (24 px, `fill: none; stroke: currentColor; stroke-width: 2; round caps and joins`; two glyphs are filled)

U5 registered every path in `BSU.icons` (`src/js/icons.js`; `icons.get(name, cls)` returns a fresh `<svg class="ic" viewBox="0 0 24 24" data-icon=…>`, `icons.names()` lists them; the CSS sizes `.ic` 24 px, `.s20` 20 px, `.sm` 18 px). There is no `<symbol>` sprite in the game; the mock keeps its own.

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

**Added in U5** (all the same grid, stroke 2, `currentColor`; `star`, `play_arrow`, `play_arrow_left` and `dot` are filled): `notifications_off` (bell + slash, the muted kind) · `more_horiz` (the ⋯ more glyph; no DOM button asks for it yet) · `chevron_left` · `play_arrow_left` · `skip_next` (Skip) · `swap_horiz` (the Drag requirement) · `undo` · `my_location` (Locate) · `dot` · `error` · `check_circle` · `star_border` · `hourglass` · `crowd` · `mood_neutral` / `mood_bad` · sky: `sunrise` `sunset` `moon` `cloud` `rainy` `storm` `thermostat` (with `sunny`, `cyclone`) · alert and issue kinds: `bolt` `drop` `no_water` `wave` `crack` `link` `sandbag` `bug` `mosquito` `gator` `pets` · requirements: `walk` `road` `pilings` (with `bolt`, `drop`, `swap_horiz`). `volume_off` (the mute variant) was added in U2. **Added in U6:** the needs gauges lead with a glyph: `bed` (`M3 20v-9` `M3 16h18` `M21 20v-6a2 2 0 0 0-2-2h-8v4` `M5 12h3`), `school` (a mortarboard: `M12 4 2 9l10 5 10-5-10-5z` `M6 11.5v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5` `M22 9v5`), `restaurant` (fork and knife: `M7 3v18` `M4 3v4a3 3 0 0 0 6 0V3` `M17 3c-2 2.5-3 5-3 8h3v10` `M17 3v18`) and **`sewage`** (a drain grate: `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z` `M8.5 9v6` `M12 9v6` `M15.5 9v6`); power and water reuse `bolt` and `drop`. The Alerts rows' Fix chip uses `construction`, Link it uses `link`. 78 names.

## 7. Decisions U0 took where the plan left room

- Snackbars are light (`surface-float`), not M3's inverse-surface: Josh asked for no dark panels.
- The FAB hides while the Build sheet, the Menu sheet or a dialog is open (it would sit under them); the coach rings it in place.
- Stat-chip popovers open on the left gutter and are the pill's width or wider so the pill is covered whole, not half.
- The HD icon tiles keep their baked purple plate and gold rim inside white cards (zero art work; see the questions in the hand-back).
- The compact density rule (§1) is a container query, not a display-size special case: it fires on width, so a narrow window at 100 % gets it too.
- Inspect pill is the collapsed state of the inspect card (expand_more on the card, expand_less on the pill), 40 px like the goal pill.

## 8. Implemented (as built, U1–U6; one entry per surface of §3, what differs from the spec and why)

The tokens of §1 are `style.css`'s `:root` verbatim (plus `--warn-text`, U6, and the layout line `--topbar-h --palette-h --bot --side --inspect-w` with the old type names `--fs-small lead num` as aliases). State layers are `::before` in `currentColor` (hover 8 %, press 12 %); the 44 px hit area is `::after`; `.btn` is tonal, `.btn.primary` filled, `.btn.icon` a 40 px circle (32 px in dense rows), `.btn.small` 32 px, `.btn.danger` text in `error`, `.btn.gold` the three gold fills (`#btn-charter`, `#btn-obj-build`, `#fab-build`); selection controls (`.seg-btn .speed-btn .ov-btn .toggle .fb-tab .list-item .tab`) are outlined / transparent off and `secondary-container` on. Colours that are not CSS stay drawn: the minimap field, the Land Office section map, the map labels and beacons (canvases).

- **App bar.** As specified: brand mark (the eco leaf on a 32 px `primary` square) with the wordmark · five stat chips · spacer · date chip · speed segmented · spacer · Alerts (badge) · lit overlay chip · Layers · Map · Menu · a mute icon button (not in the spec list) · the Endowed chip. A size container: under 118 rem the stat labels, the cap suffix and the weather line hide; `fitTopbar` keeps a two-step JS backstop (`tight` hides the wordmark, `bare` the same labels). "Esc from the map with nothing open = Menu" was **not** built: `M` toggles the Menu sheet (U6) and Esc only ever closes things, so one more Esc always leaves a clear screen (every QA helper relies on it).
- **Stat chip.** As specified: 24 px `primary` icon (paid / group / star / mood / eco), value over an uppercase label, "cap 1,500" as the suffix on the Students value, the 9 px `error` dot with its 2 px ring (Students: a need is binding; Cash: the runway is red or cash negative), `secondary-container` while its popover is open. Cash → the mini budget, Students → the needs popover; Prestige / Happiness / Ecology open the breakdown popover (not the Almanac row). The applicants count sits on the needs popover's last line.
- **Date / weather chip.** A button that opens the Almanac; the sky glyph is a registry icon swapped by phase (`sunrise sunny sunset moon`, `rainy` while it rains, `storm` in the outer bands, `cyclone` at landfall); value "Aug 6, Y1 · Summer", label "105° · Rain tmrw" (heat advisory in `warn-text`, river window in `water`), hidden under 118 rem.
- **Speed segmented · Icon button · Filter chip · List item · Text field · Buttons.** As specified. The bar's icon buttons are `.btn.icon` + `svg.ic`; the popover heads use the 32 px size; the badge count is the open issues, the dot the all-clear. Filter chips are the Layers popover's six (key cap · glyph · name) and the lit 24 px chip beside the Layers icon. List items are the Menu list (48 px, icon, second line, hotkey cap or chevron) and the Build rail (40 px, ★ disc + count). The text field is the Build sheet's search (`.text-field`, leading search icon) and the title's Seed (`.of`, the label in the border).
- **Goal pill ↔ card.** As specified (ring, kicker "GOAL 6" / "MILESTONE" — `warn-text` for an interrupt, title, "1 / 5", expand_more; the card with the portrait, kicker "GOAL · 6 OF 22" / "NEW GOAL · …", title, the objective text when it adds to the title, why, the 8 px bar, Build it (gold) + Show me (tonal), a fold chevron and the dismiss ✕, the NEXT UP line over a divider). The 10 s fold, hover hold, Esc and outside click; the kind stripe stays on the card; a short window drops the why and next-up lines. The student speech bubble (`#speech-bubble`) hangs under the card as before.
- **Build extended FAB.** As specified; toggles the Build sheet (G does the same, Shift+G expands) and hides while either sheet, the Menu sheet or a dialog is open; beside an open inspect card it keeps its corner (the card is bottom-left).
- **Snackbar.** The lane (`#snack-lane`, bottom centre, up to 640 wide), two visible, 6 s, news above the decision; news lines carry a Log text button and pan on click; notifications keep their action / Show me / Locate buttons and never wait (they replace the oldest visible news line), news lines queue; the 4 px kind stripe on the left and a leading kind icon (the mock had neither). The decision snackbar: bold lead, "Hold" text, "Send the crew" tonal, the 3 px `primary` line along the bottom edge; the football options stay a column (a row during the set piece). The lane shifts right of an open inspect card. Snackbars have no exit animation (they leave the DOM).
- **Popover.** needs · mini budget · Alerts · Layers · Map · breakdown, 360 wide (Alerts / Layers 400, Map its canvas), 8 px under the bar, the stat-chip ones on the left gutter, the icon ones right-aligned to their icon, one at a time, Esc / outside press / the same control closes, the control shows selected. Needs: six gauge rows, each leading with its glyph (U6: `bed school restaurant bolt drop sewage`), the binding line in its level colour, Locate, the applicants line. Alerts: rows with a 32 px severity tile (`error-container` for 3, `primary-container` for 2, neutral for 1) holding the kind's icon, the title + age, the ×N badge, a **tonal icon + label chip** for Fix / Link it (U6: `construction` / `link`; the label stays the button's text), Locate / Snooze / Dismiss / the mute bell as 28 px icon buttons (`data-act`), In progress, Suggestions, the hidden line, and the foot Spotlight (tonal) + Clear N · $ (filled). Map: the pin (`settings.keepMinimap`, selected while pinned; a pinned popover survives Esc and other popovers); Settings also pins Layers (`keepOverlays`), stacked under a pinned Map. Hotkeys: I cycles the issues (it does not open the popover).
- **Side sheet (Menu).** `#menu-sheet`: right gutter, bar + 8 → bottom gutter, 360 wide, opaque, **28 px top-left** corner and 16 px elsewhere, elevation 3, no scrim, 1 px edge; head 56 px (back arrow in the panel state, headline title, close); list items 48 px with a leading icon, a label-size second line and the hotkey cap (chevron where there is none); panels render in the body with 8 px padding and scroll inside it (checked at 1280 × 800 / 130 %). Settings is one list: Display size, Alerts, Audio, Keep the minimap open, Keep overlays visible, Particles, Screen shake, Reduce motion, Colour-blind overlays, then Tour and Save / Load / New game. B N T O L deep-link and the same key closes; **M toggles the sheet** (U6; mute moved to Shift+M); Esc closes it from either state. Opened from the title screen the sheet sits at the top gutter with no back arrow and the title card dims aside.
- **Bottom sheet (Build).** Two elements that swap: the collapsed sheet `#palette` (handle row with ⤢ and ✕, tabs with the `warn` pip, cards 112 wide at 64 px icons, a ★ disc in `tertiary-container` on the goal / needed building, greyed cards at 38 % with their "Unlocks: …" line at full strength, bulldoze and info icons, 240 px tall) and the expanded `#build-menu` at 80 % height (head with hint + search field 240 + ⤢ + ✕, rail 200 with the ★ disc (U6: the rail star was a bare gold glyph on white, 1.7:1), grid cards min 210 with icon / name / price · upkeep / requirement chips, detail 300 with the Place · Enter foot pinned under a scrolling body). Edge to edge, not inset by the gutter. Esc closes outright from either state; ⤢, the handle, Shift+G switch; arrows move, Enter arms, `/` searches. The compact (icons-only) palette of the old HUD is gone (U6 removed its last toggle).
- **Inspect card.** `#inspect`: 320 wide, bottom-left at the gutter above the Build sheet, 56 px sprite tile, title + label-size sub, a collapse chevron and a close icon, rows, the action row under a 1 px rule; capped in height so it never reaches the goal pill (the body scrolls). Collapsed: the 40 px pill with the 32 px round sprite, the name, a one-line meta ("300 beds", "No power", "Under construction 40 %"), chevron up + close. The kitchen Menu summary and the network pill stay inside the body; the Edit menu stays a dialog.
- **Dialog + scrim.** `#cards` and the student voice (`#voice-dialog`): 420 px, 28 px corners, `surface-container-high`, 24 px padding, over the 32 % scrim (the bar too); kicker · headline · body · actions right-aligned with the filled one last (long labels wrap inside full-height buttons). Esc runs the action flagged `dismiss`, a modal card ignores it; focus moves in and comes back.
- **Coach card.** 340 wide with **28 px corners** (not 16), elevation 3, the counter as a `primary` label ("QUICK TOUR · 3 OF 6"), Back / Skip tour text buttons, a filled Next ("Geaux build" last); the ring is the target + 8 px, 3 px `primary` at 12 px radius (not a pill) with a transform / opacity pulse; the four panes tile the scrim (not one spread shadow). Placement: below the target (above for the lower half), right-aligned on the right half, else right / left / the corner with the least overlap; always inside the window and never over its own target. The panes and ring are the one place that animates position (an overlay).
- **Title card.** As specified: kicker · wordmark (serif, gold underline) · sans italic tagline · Charter the university (gold) · Continue ("Continue · <date>" when a save exists) / How to play / About this build / Settings as text buttons · the Seed outlined field + mute icon · Display size segmented + hint · motto. How to play / About / Settings open the Menu sheet; while it is open the card dims to 14 %, slides 12 rem left and ignores the pointer (inactive by design: the audit reports it as info).
- **Motion.** 160 / 240 / 160 ms; opening keyframes `rise` / `sheet-in` / `sheet-up`; closing is one `--dur-close` transition of opacity, transform and `display … allow-discrete` into each surface's `.hidden` look (`.hidden{display:none !important}` is the fallback for a browser without discrete transitions: it hides at once; `safari.test` asserts every such surface has the pair). Reduce motion (Settings; default = the OS preference until the player flips it): on → `body.reduce-motion` (durations 0, every animation and transition ends at once, no ring pulse); **off → `body.motion-on`** (U6: the tokens run even when the OS asks for reduced motion; the media query only sets the default).
