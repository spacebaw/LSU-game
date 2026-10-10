# Fidelity plan: time, art, UI (2026-10-10)

Josh's notes after playing: default time still too fast; upgrade art quality across the board; UI elements
too small and squished into boxes and corners. Three tracks, each shippable on its own.

## Track A — Time (small, first)

Goal: a calendar day should feel like a day. Today 1× = 5 ticks/s, 100 ticks/day → 20 s/day, 40 min/year.
Target: ~40–45 s/day at 1× (≈ 80–90 min/year) WITHOUT making students and water look sluggish.

Preferred mechanism: raise `params.time.ticksPerDay` 100 → 200 so the world keeps its lively tick rate and
only the calendar slows. Prerequisite audit (grep): every place that converts ticks↔days must derive from
`ticksPerDay` (hydro `dtDay` per step, rain per-event totals, mosquito daily step, subsidence, economy
monthly, objective deadlines, set-piece `len` in ticks stays as is, autosave rules, `SKY_TICKS` 300 — the
sky cycle is tick-based and should stay ~60 s real at 1×, i.e. 1.5 sky cycles per day instead of 3).
Any hard-coded `/100`, `1/40`, `* 100` must be fixed. Fallback if the audit is risky: `baseTps` 5 → 3.
Also: default new-game speed stays 1×; keep 2×/4×/8×; the tutorial's forced 1× drops remain.

## Track B — Art fidelity (largest; do in this order, each with a before/after contact sheet)

Style guide first (docs/ART_STYLE.md, written by the first art agent and reused by the rest): light from
the upper-left, 5-tone ramps per material (deep shadow, shadow, base, light, highlight) instead of 2–3,
1-px darker outline on silhouettes against sky/water, dithered transitions on large flat areas, consistent
purple #461D7C / gold #FDD023 accent usage, warm night window glow #FFD27A, cool shadow tint #2B2550 at 20%.

Resolution: author every painter at 2× (128×64 per tile) as the master and downsample for 1× and 0.5×
(current masters are 1×, so 2× is an upscale today). Watch atlas memory: stay under 64 MB total, lazy-bake
by zoom, evict on zoom change. Safari canvas memory is the constraint.

B1. Terrain and water (always on screen, biggest win): grass with noise-driven tone variation, tufts and
    dirt patches; soft blends across tile edges so the grid disappears on flat ground; cliff faces with
    strata and grass overhang; marsh with reed clumps, lily pads and standing-water sheen; water with two
    layered wave bands, sun glints, shoreline foam and shallow-bed tint; sand/shell beaches at the cove.
B2. Vegetation: live oaks with clustered canopies (3–4 leaf tones, dappled underside), buttressed trunks,
    moss strands with wind sway already in place; bald cypress with knees and rust autumn; azaleas with
    blossom clusters; palmettos; crepe myrtles as a new accent planting (purple blooms); understory shrubs
    on marsh edges.
B3. Buildings: one architectural language ("Louisiana Collegiate": cream and brick stucco, red clay tile
    hip roofs, arcades and galleries with iron railings, dormers, cupolas, louvered shutters) with a
    distinctive silhouette per row; window grids with mullions; awnings and signage; rooftop HVAC, vents,
    gutters; entrance steps and planters; per-row interior light variation at night; construction stages
    with scaffolding and cranes; weathering and damage overlays that read.
B4. Characters: students with 8-frame walk cycles, 6 skin tones, 10+ outfit palettes, hair variants,
    backpacks, umbrellas in rain, idle fidgets, sitting on quad benches; Roux the tiger; gators with
    swim/walk/lunge and tail motion; Wildlife Officer; vehicles (fogger truck, pirogues, parade floats).
B5. Effects: ambient occlusion at building bases, rain splashes on paved aprons, puddle reflections of
    lights, stadium glow haze, fireworks with trails, fog volumes over water, heat shimmer.
B6. Icons: palette and build-menu icons re-rendered from the 2× masters with a consistent frame.

## Track C — UI scale and breathing room

Principles: an 8-px spacing scale; 16–20 px gutters from every screen edge (nothing hugs a corner);
base font 13 → 15 px, titles 20–24 px; panels get 16 px padding and 12 px between rows; fewer nested
boxes; one shadow style; icons at 2× in the palette and build menu.

C1. Top bar: 44 → 56 px tall; stat tiles with larger numbers (20 px) and small caps labels; date/weather
    chip roomier; speed buttons 36 px; panel buttons with icons + labels, not crammed.
C2. Goals tracker and needs strip: wider (360 px), 16 px padding, progress bar 8 px, buttons 36 px tall;
    needs gauges with real labels and numbers readable at a glance.
C3. Palette: 100 → 140 px tall; tiles 96 px wide with 2× icons and full names on two lines; tabs 15 px.
C4. Build menu: cards 320 px wide with 64-px icons; detail column 360 px; body text 15 px, 1.45 line
    height; requirement glyphs 18 px with labels.
C5. Cards, toasts, panels: 16–20 px padding, 15 px body, 36 px buttons, 12 px radius; toasts bottom-right
    with a 20 px gutter; decision toasts larger with visible Y/N keys.
C6. Minimap 160 → 200 px with a 20 px gutter; overlay key buttons 36 px with tooltips.
C7. A UI scale setting (90 / 100 / 115 / 130 %) in Settings, applied as a CSS variable, remembered.
C8. Verify at 1280×800, 1440×900, 1920×1080 with screenshots; nothing overlapping the map centre.

## Order and cost

A (one Sonnet agent, ~150k) → C (one strong-model agent, ~350k) → B1 → B2 → B3 (one strong-model agent
each, ~350–450k) → B4 → B5 → B6 (Sonnet where mechanical). QA playthrough after C and after B3.
