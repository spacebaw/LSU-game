export const meta = {
  name: 'bayou-architecture',
  description: 'Fix GDD round-2 issues, write ARCHITECTURE.md + contract.js + module briefs, adversarial review, fix',
  phases: [
    { title: 'Fix GDD', detail: 'apply 49 round-2 critique issues' },
    { title: 'Architect', detail: 'ARCHITECTURE.md: state, contracts, events, tick/render order' },
    { title: 'Contract', detail: 'contract.js + per-module briefs in parallel' },
    { title: 'Review', detail: '4 adversarial lenses, fix, repeat once' },
    { title: 'Verify', detail: 'build --check and load contract.js headless' },
  ],
}

const ROOT = '/Users/joshfleig/Desktop/Claude/bayou-state'
const SCRATCH = '/private/tmp/claude-502/-Users-joshfleig-Desktop-Claude/fb39c7b3-595d-4955-a705-28fe9ff8fb98/scratchpad'

const CONSTRAINTS = `
FIXED PROJECT FACTS (do not re-decide):
- Deliverable: ONE self-contained ${ROOT}/index.html built by \`node build.mjs --check\` from src/index.template.html + src/style.css + the JS modules listed in src/manifest.json (concatenated in order into one <script>). Vanilla JS + Canvas 2D. No ES modules/import/export, no fetch, no Workers, no OffscreenCanvas, no fonts/images/CDNs. Works from file:// in Chrome and Safari.
- Every module is an IIFE assigning to window.BSU.<name>; NOTHING touches the DOM, timers, AudioContext or requestAnimationFrame at definition time; all setup happens in init() called by session.js at boot. Must load in Node via test/domstub.mjs.
- docs/HEADLESS_API.md and test/smoke.mjs are AUTHORITATIVE for the headless API (BSU.session.newGame({seed, skipTutorial}), BSU.session.save/load(slot) returning JSON string/state, BSU.headless.tick/render/snapshot/findSpot/place/forceHurricane/click/key/fastForwardDays/state). Where the GDD disagrees, the GDD changes.
- docs/TESTING.md describes the three harnesses (build --check, headless Node via domstub, real headless Chrome via test/browser.mjs). test/modules.mjs runs every BSU.<module>.selfTest().
- Concurrency reality: ~16 modules will be implemented by SEPARATE agents in parallel, each seeing only ARCHITECTURE.md, contract.js, its brief, and the GDD. If an interface is ambiguous, two agents will implement it two ways. Precision beats brevity.
`

phase('Fix GDD')
log('Applying the 49 round-2 critique issues to docs/GDD.md')
const fixSummary = await agent(`You are the lead designer of BAYOU STATE. The authoritative design document is ${ROOT}/docs/GDD.md (~36,000 words). Two critics produced the issues in ${SCRATCH}/critic_complete_2.json (35 issues) and ${SCRATCH}/critic_fun_2.json (14 issues). A previous fixer began applying them and was killed mid-edit, so SOME may already be applied and the document may have a half-applied edit somewhere.

Do this:
1. Read both JSON files. Read the whole GDD once.
2. For EACH issue, check whether it is already resolved in the document. If not, apply the fix in place, keeping one coherent set of numbers and no contradictions. Blockers and majors first. Prefer the critic's proposed fix unless it conflicts with these fixed facts:
${CONSTRAINTS}
3. Specifically: (a) §15.2's headless API must be replaced by a pointer to docs/HEADLESS_API.md and the skipTutorial semantics defined (skipTutorial=true: Founders' Hall, a path to the Pirogue Landing and the 120 founding students are pre-placed, the calendar runs, the palette is fully unlocked per normal unlock rules, no scripted tutorial beats; the scripted Year-1 storm still happens on schedule). (b) Set pieces must be defined so that headless tick(n) advances them: event time is measured in sim ticks (10 ticks = 1 s of event time) so a 90-s landfall = 900 ticks with the calendar frozen; forceHurricane(cat) schedules landfall at tick+600 skipping the cone wait. (c) The per-tile representation must cover paths, roads, boardwalks, gator fences and debris (a 'surface' Uint8Array layer is fine). (d) Objective 11 (levee ring) must be satisfiable given the tutorial canal; define the floodgate rule so it is. (e) Scan for any half-applied edit (dangling sentence, duplicated paragraph, a table row with the wrong column count) and repair it.
4. Append a short '## 17. Change log' listing each issue id/section and one line on how it was resolved (or 'already applied').
5. Re-read the whole document once at the end for consistency.
Return a summary: counts of applied / already-applied / rejected (with reasons), and any remaining design ambiguity you could not resolve.`,
  { label: 'fix-gdd-round2', phase: 'Fix GDD', effort: 'high' })
log('GDD fix pass done')

phase('Architect')
const arch = await agent(`You are the principal engineer for BAYOU STATE, a SimCity-style university-in-a-swamp game. Read, in full: ${ROOT}/docs/GDD.md (the authoritative design, ~36k words; §0 is the engineering summary, §3.2 the per-tile arrays, §15 the technical notes), ${ROOT}/docs/HEADLESS_API.md, ${ROOT}/docs/TESTING.md, ${ROOT}/build.mjs, ${ROOT}/src/index.template.html, ${ROOT}/test/domstub.mjs, ${ROOT}/test/smoke.mjs, ${ROOT}/test/modules.mjs, ${ROOT}/test/browser.mjs.
${CONSTRAINTS}
Write ${ROOT}/docs/ARCHITECTURE.md: the complete technical contract that lets ~16 agents implement the modules in parallel and have them plug together on the first integration. It must contain, with exact names and signatures (JS, JSDoc-style types), no hand-waving:

1. Module list and manifest order (use the GDD §0.2 list: contract, data, terrain, hydro, weather, wildlife, buildings, economy, agents, sports, sprites, render, ui, audio, progress, session). A module may be split into 2–3 files if it would exceed ~2,000 lines (e.g. sprites_terrain.js / sprites_buildings.js / sprites_entities.js; ui_panels.js) — decide now and list the files in order.
2. The global state: BSU.state (created by BSU.newState(seed) in contract.js) as ONE plain object tree with typed arrays for the map. Document every field: name, type, owner module (the only writer), initial value, saved yes/no. Include: world typed arrays (index i = ty*64+tx) — elev, depth, sat, stand, mosq, subs, crest, integrity, sandbag, wear, flags, surface, tileType, walkCost, buildingAt (Int16, -1 = none), veg…; entities arrays (buildings, veg, agents, gators, vehicles, particles are NOT saved); calendar/sky/weather/storm; economy; sports; progress; ui/camera; rng state.
3. contract.js public surface: enums (BSU.T tile types, BSU.B building ids, BSU.SKY, BSU.OV overlays, BSU.STORM phases, BSU.OBJ, BSU.SURF surface kinds, BSU.FLAG bits), BSU.params (every tuning constant from the GDD with its section in a comment — list the param NAMES here, grouped), BSU.rng (mulberry32 with named streams: world, sim, fx), BSU.events.on/off/emit with the FULL event list and payload shapes, helpers (idx, tx/ty from i, nbr4, nbr8, inBounds, iso projection worldToScreen/screenToWorld with elevation, chebyshev, clamp, lerp, formatMoney, formatDate), BSU.catalogRowSchema.
4. data.js: the exact catalog row schema (id, name, w, h, cost, upkeep, tier costs, WR, needsPower/Water, pathAdjacency, placeRule enum, unlock rule shape, effects shape, paint descriptor for the parameterized painter) and the other data tables and their shapes.
5. Each simulation module's exact API: init(state), tick(state, dt) or per-rate hooks, queries; who calls what and in which order inside one 100 ms sim tick (write the tick order as a numbered list with the rate of each step: hydro 4 Hz, agents 10 Hz, mosquito daily, economy monthly, etc.); how the calendar freezes during set pieces; how speed multiplies ticks per frame.
6. Rendering: render.js pipeline pass order (terrain chunks → water → surfaces → depth-sorted entities → weather → lighting → overlays → HUD-canvas bits), the chunk cache (8×8 tiles, dirty flags via events), the depth-sort key, the camera (pan/zoom steps 0.5/1/2, world bounds), the sprite atlas API sprites.get(id, variant, frame, zoom) → {canvas, sx, sy, sw, sh, ox, oy}, particles API, screen shake, postcard export.
7. UI: ui.js owns the DOM. Give the DOM skeleton (ids and classes) for HUD, palette, inspect panel, ticker, toasts/cards, panels, title screen, settings, debug panel; the input state machine (idle / placing / dragging-tool / panning / inspecting) with pointer + wheel + keyboard + trackpad; keyboard map with precedence; how ui calls buildings.canPlace/place; ghost preview; overlays toggle. CSS conventions in src/style.css (purple #461D7C, gold #FDD023 palette tokens as CSS variables).
8. Save/load schema v1 as a JSON shape with base64 typed arrays; migration hook; autosave rules; localStorage keys; what is regenerated on load (agents, particles, chunk cache, atlas).
9. Boot sequence in session.js: contract → data → init order → newGame/continue → title screen → main loop (fixed-step accumulator, max 8 ticks per frame, render interpolation) → headless mode (BSU.headlessMode = typeof requestAnimationFrame !== 'function' || !document.getElementById('app')?.getBoundingClientRect || navigator.userAgent === 'node-headless'); the full BSU.headless implementation spec.
10. Cross-cutting rules: error policy (try/catch around each module's tick and each render pass, log once per error signature, never let one module kill the loop), determinism (all sim randomness from BSU.rng.sim), units (feet, dollars, ticks), performance budget per module, coding conventions ('use strict' IIFE, no globals, no DOM at definition, no external refs, no '</script' in source), selfTest() expectations.
11. Feature tiers: mark every GDD feature Tier 1 (must be in the first integration; everything on the GDD §15.5 'never cut' list plus what the 20-minute arc needs) or Tier 2 (the §15.5 cut-list items, in cut order). Implementers do Tier 1 completely before any Tier 2 in their module.
12. Worked walkthroughs through the interfaces (as sequences of calls/events): (a) the player places a dorm; (b) one sim tick during rain; (c) the landfall set piece from cone to damage report; (d) newGame → first frame; (e) save → reload.

Rules: be exhaustive and concrete (this document will be ~10–15k words); every cross-module call must appear on both sides; name every event and payload once, in one place. Do not write module code yet (contract.js is written by a following agent from this document), but you MAY pin exact function signatures as code blocks. When the GDD is ambiguous, DECIDE and record the decision in a '## Decisions' section at the end. Return a summary of the module/file list, the state tree's top-level keys, and your decisions list.`,
  { label: 'architect', phase: 'Architect', effort: 'max' })
log('ARCHITECTURE.md written')

phase('Contract')
const [contractRes, briefsRes] = await parallel([
  () => agent(`You implement the frozen foundation module of BAYOU STATE. Read in full: ${ROOT}/docs/ARCHITECTURE.md (authoritative), ${ROOT}/docs/GDD.md (for every constant; §0.3 building table, §3–§9 numbers, §15.2), ${ROOT}/docs/HEADLESS_API.md, ${ROOT}/test/domstub.mjs.
${CONSTRAINTS}
Write ${ROOT}/src/js/contract.js EXACTLY as ARCHITECTURE.md specifies: the BSU namespace bootstrap (window.BSU = window.BSU || {}), all enums, BSU.params with EVERY tuning constant from the GDD (hundreds; each with a trailing comment naming the GDD section; group by system), BSU.rng (mulberry32 with independent named streams and save/restore of their state), BSU.events (on/off/emit/once, emit wrapped in try/catch per listener with once-per-signature console.error), BSU.newState(seed) allocating the full state tree with typed arrays exactly as documented (64×64), all helpers (idx/tx/ty/nbr4/nbr8/inBounds/iso projection with elevation/chebyshev/manhattan/clamp/lerp/smoothstep/formatMoney/formatDate/base64 encode/decode for typed arrays), BSU.SAVE_VERSION, and BSU.catalogRowSchema validation helper. It must have zero DOM access at definition time and must load in Node through the stub.
Then update ${ROOT}/src/manifest.json to list ALL module files in ARCHITECTURE.md's order (contract.js first; files that don't exist yet are fine — build.mjs will report them missing, which is expected until implementation).
Write ${ROOT}/test/contract.test.mjs: loads contract.js alone through makeWindow() from test/domstub.mjs with vm.runInContext, then asserts: enums present, params has ≥ 150 keys and all numeric/finite, newState(42) allocates every documented array with the right length/type, rng is deterministic for a seed, events on/emit/off work and a throwing listener does not break others, iso projection round-trips, base64 round-trips a Float32Array. Run it with node and make it pass. Also run \`node --check src/js/contract.js\`.
If ARCHITECTURE.md is missing something you need, add it to ARCHITECTURE.md (do not silently invent it only in code). Return: the list of exported names, the params count, test output, and any additions you made to ARCHITECTURE.md.`,
    { label: 'contract.js', phase: 'Contract', effort: 'high' }),
  () => agent(`You write the per-module implementation briefs for BAYOU STATE. Read in full: ${ROOT}/docs/ARCHITECTURE.md (authoritative) and ${ROOT}/docs/GDD.md.
${CONSTRAINTS}
For EVERY module file listed in ARCHITECTURE.md's manifest order EXCEPT contract.js, write ${ROOT}/docs/briefs/<file-basename>.md containing:
1. Purpose and the public surface it must expose (copy the exact signatures from ARCHITECTURE.md).
2. State fields it owns (writer) and the fields it may read.
3. Events it emits (with payloads) and events it listens to.
4. The complete list of GDD rules it must implement, each as a checklist item with the GDD section reference and the concrete numbers/formulas (copy them in — the implementer should not need to hunt through 36k words, though they may). Order the checklist Tier 1 first, then Tier 2.
5. Edge cases and invariants (no NaN, bounds, what happens at map edges, on load, during set pieces, in headless mode).
6. selfTest() requirements: the specific assertions this module's selfTest must make (pure, no canvas; may create a throwaway state via BSU.newState and run its own tick).
7. How to test it in isolation before other modules exist (a snippet using makeWindow() + vm.runInContext to load contract.js, data.js and this file) and, for presentation modules, with test/browser.mjs.
8. Performance budget and the specific tricks required (from GDD §15.3 and ARCHITECTURE.md).
9. 'Done means': acceptance criteria.
For sprites/render/ui briefs include the visual spec details from GDD §12 and §11 (palette hex values, tile geometry, animation lists, ASCII layouts). For data.js include a reminder that every one of the 43 catalog rows plus all name/ticker/flavor tables from §0.3, §4 and §14 must be transcribed exactly. Briefs are typically 1,500–4,000 words each. Return the list of brief files written with their word counts.`,
    { label: 'briefs', phase: 'Contract', effort: 'high' }),
])
log('contract.js and briefs written')

phase('Review')
const REV_SCHEMA = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'fix'] } } }, required: ['issues'] }
const LENSES = [
  { key: 'integration', p: `Lens: INTEGRATION. Read docs/ARCHITECTURE.md, src/js/contract.js and every docs/briefs/*.md. Pretend to be 16 separate implementers who never talk: find every interface that two of them could implement differently — ambiguous ownership of a state field, a function named on one side but not the other, a mismatched signature or payload, an init-order dependency that will throw, a circular dependency, a place where a presentation module would need to mutate sim state, event names used in a brief but missing from contract.js. Walk the five ARCHITECTURE.md walkthroughs and check each call exists on both sides.` },
  { key: 'testability', p: `Lens: TESTABILITY, HEADLESS AND SAVE. Read docs/HEADLESS_API.md, test/smoke.mjs, test/domstub.mjs, test/modules.mjs, docs/ARCHITECTURE.md, src/js/contract.js and the briefs for session, ui, render, audio, progress. Verify the headless API is fully specified and consistent with the smoke test; that boot never requires real timers, AudioContext, OffscreenCanvas, fonts or DOM APIs the stub lacks (list the exact DOM APIs each brief relies on and check test/domstub.mjs provides them); that the save schema covers every saved field with restore rules; that set pieces advance under headless tick(n); that forceHurricane, findSpot, place, click and key are specified; that every module has a meaningful selfTest spec.` },
]
let round = 0, remaining = []
while (round < 1) {
  round++
  const results = (await parallel(LENSES.map(L => () =>
    agent(`You are an adversarial architecture reviewer for BAYOU STATE (working dir ${ROOT}). ${L.p}
${CONSTRAINTS}
Report ONLY real problems, each with severity 'blocker' (implementers would produce incompatible or non-working code) | 'major' (would need rework at integration) | 'minor', a precise 'where' (file + section), the problem, and a concrete fix. Do not report style. Return an empty list if genuinely clean.`,
      { label: `review:${L.key}:${round}`, phase: 'Review', schema: REV_SCHEMA, effort: 'high' })
  ))).filter(Boolean)
  const issues = results.flatMap(r => r.issues).filter(i => round === 1 || i.severity !== 'minor')
  remaining = issues
  log(`Review round ${round}: ${issues.length} issues (${issues.filter(i => i.severity === 'blocker').length} blockers)`)
  if (!issues.length) break
  await agent(`You are the principal engineer for BAYOU STATE (working dir ${ROOT}). Apply ALL of the following review fixes across docs/ARCHITECTURE.md, src/js/contract.js, src/manifest.json, docs/briefs/*.md and, only if a fix requires a design decision, docs/GDD.md (record it in its §17 change log). Keep everything mutually consistent: a signature changed in ARCHITECTURE.md must change in every brief that names it and in contract.js. After editing, run \`cd ${ROOT} && node --check src/js/contract.js && node test/contract.test.mjs\` and make them pass.
${CONSTRAINTS}
ISSUES:
${JSON.stringify(issues, null, 1)}
Return a one-paragraph summary and the test output.`, { label: `fix:${round}`, phase: 'Review', effort: 'high' })
}

phase('Verify')
const verify = await agent(`Working dir ${ROOT}. Run: \`node --check src/js/contract.js\`, \`node test/contract.test.mjs\`, and \`node build.mjs --check\` (expected: it reports the not-yet-written modules as MISSING and exits 1 — that is fine; anything else is a problem). Then load contract.js alone through makeWindow() from test/domstub.mjs + vm.runInContext and print Object.keys(BSU), Object.keys(BSU.params).length, and the byte length of every typed array in BSU.newState(1).world (or wherever ARCHITECTURE.md puts the map arrays). Fix any failure in contract.js directly. Return the outputs verbatim and the list of brief files in docs/briefs with word counts (wc -w).`,
  { label: 'verify', phase: 'Verify', effort: 'medium' })

return { fixSummary, archSummary: arch, contract: contractRes, briefs: briefsRes, remainingIssues: remaining, verify }
