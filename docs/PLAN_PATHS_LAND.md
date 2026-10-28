# Paths that connect themselves, and land you can buy (2026-10-28)

Josh, after playing: "it was unclear to me that all paths needed to connect to the founders path.
Help me plan a way to enforce path connection early on but make a snap and self connect whenever
possible. I want it to be important but not a struggle. Also, we need to expand the land area bc
I'm already maxed out. Add a way to buy or expand the original footprint."

## What is true today

- Access rule (GDD §3.6, `buildings.js` step 8): a building operates only if it touches a path that
  reaches the Founders' Hall network. Placement beside an unlinked path is allowed with `r.unlinked`
  and a severity-1 "Not linked" issue (gold link glyph), which the calm-alerts pass is now demoting to
  a tray-only suggestion. The tie machinery already exists but is reactive: `connectorFor` (auto tie
  within `params.build.connectorMax` = 4), `linkQuote`/`linkBuilding` (Issues-tray "Link it", reach 8).
- Nothing teaches the rule. The tutorial says "lay a path" and the ghost label mentions the hub only
  once a placement is already unlinked.
- The map is 64 × 64 (4,096 tiles) and dry land is scarce by design (ridge crown 70–100 tiles ≥ 5 ft,
  cheniers across the bayou, marsh buildable only on Pilings or after draining). Fourteen modules
  capture `BSU.MAP.W/H/N` at load (45 sites), so the world size is a page constant today. The late
  "Second Campus" charter ($20M, Year 5, bridge west) exists in economy.js but adds a hall, not land.

## Track P — paths that snap and self-connect (one pass, M)

Principle: the network is the thing the player builds; the game lays the last few tiles for them.
Make the connection visible, automatic and cheap, and refuse only when nothing can be done.

P1. **Auto-tie is the default.** Any placement (building, or the end of a path/road/boardwalk drag)
    that does not touch the network gets a gravel tie to the nearest network tile within
    `params.build.autoTieMax` = 12 (was connectorMax 4 / linkMax 8); over water the tie is a
    boardwalk at boardwalk cost. The ghost draws the tie as a dashed gold path and the price line
    reads "$600k + $8k tie". Shift while placing toggles "no tie" for players who mean it.
P2. **See the network.** In any drag tool, or while holding N, connected surfaces get a faint green
    sheen and unconnected runs an amber dash; Founders' Hall wears a small "Campus hub" badge. The
    ghost status line is one of: "Connected", "Ties in (+$8k, 4 tiles)", "Can't reach a path: draw one
    from campus first" with a Show me that pans to the nearest network tile.
P3. **Teach it once.** Tutorial step 2 gets the sentence "Everything you build must link back to this
    path. If you build near it, we lay the tie for you." The first auto-tie shows a one-time card
    ("Tied in: 3 tiles of gravel, $6k. Paths that reach Founders' Hall are what make a building
    work."). Both use the existing coach-mark and card systems.
P4. **Enforce early, gently.** Until the fifth completed building, a placement that cannot be tied
    (no network within 12) is refused with the P2 reason and Show me. After that it is allowed and
    becomes the (tray-only) "Not linked" suggestion with Link it, as today. An unlinked building shows
    a grey "Not connected" pill in its inspect card with the same Link it button.
P5. **Drag end snapping.** A path drag whose last tile is within 2 tiles of the network snaps onto
    it; a drag that ends short gets the auto-tie preview before commit (undo covers it).
Tests: buildings (auto-tie quotes, Shift opt-out, water tie, refusal window), ui (ghost lines,
network sheen, first-time card once), progress (tutorial text), browser screenshots of each line.
Files: buildings.js, ui.js, render_fx.js (sheen/dash/badge), progress.js, contract.js, style.css.

## Track L — land you can charter (three passes)

Recommendation: grow the world for new games and sell it in sections, rather than invent parcels on
the current map (which is already all buildable) or grow the grid at run time (hydrology, chunks and
saves all assume a fixed size). A 96 × 96 world is 2.25× the tiles and keeps every system's cost
inside its budget; 128 × 128 (4×) would need hydrology changes and is deferred.

L1. **World size per game (L, strong model).** `BSU.MAP` becomes a per-game object set at
    `newGame`/`load` before any allocation; the 45 module-level captures read live. New games are
    96 × 96 with the river still on the east edge and the Gulf off the south: the current 64 × 64
    content sits in the south-east, 32 new columns of backswamp with cheniers and a second bayou arm
    to the west, 32 new rows upriver to the north where the natural levee continues (more high
    ground upriver, as in life). Terrain gen uses world coordinates so the old region is identical.
    Old 64 × 64 saves keep their size and keep working (SAVE_VERSION 2 stores W/H). Gates: hydro,
    agents, chunks, minimap and save tests at both sizes; frame and tick budgets within 1.5× at 96².
L2. **Land Office and sections (M).** Outside the start charter (the original 64 × 64 rectangle for
    migrated saves; a 48 × 48 start charter around the ridge for new games) the world is divided into
    16 × 16 sections, drawn desaturated with a dashed boundary and a "State land" label. A Land
    Office panel (button in the top bar, also the Grounds tab card "Charter land") shows a minimap of
    sections with price and a Buy button; only sections adjacent to chartered land are for sale.
    Price = $400k + $9k per Dry tile + $20k per High tile + $2k per Marsh tile (water free), so a
    mostly-dry section is about $2–3M and swamp is cheap; sections 3+ need prestige ≥ 20, 6+ need
    ≥ 40. Buying fires a card, a ticker line and the first-purchase goal "Charter your first section".
    Placing on unchartered land shows the ghost reason "Charter this section at the Land Office
    ($2.4M)" with a button that opens the panel on that section. Agents may wander there; hydrology
    runs everywhere regardless.
L3. **Dredge and fill (S–M).** A Swamp-tab drag tool that raises Marsh to Dry over 10 days at $40k a
    tile (spoil from the bayou), −1 ecology per 4 tiles, disturbed-marsh mosquito rule applies; the
    counterpart of draining. Gives land inside the charter and makes the swamp feel workable.

Order: P (now, after the calm-alerts pass frees ui/buildings/issues) → L1 → L2 → L3, one agent each,
interleaved with the HD art passes (H4 characters next) as usage allows. Roughly 1.3–1.6M tokens.

## Decisions taken (change if Josh disagrees)

- Grow the world to 96 × 96 for new games rather than parcel the current map; migrated saves stay
  64 × 64 with no sections (they can still Dredge and fill).
- Auto-tie is on by default and reaches 12 tiles; Shift opts out; refusal only in the first five
  buildings.
- Section price by land quality, cash plus a prestige gate, no legislature event (simpler, readable).
