export const meta = {
  name: 'bayou-impl-wave0',
  description: 'Implement the three foundational modules in parallel: data.js, terrain.js, sprites.js',
  phases: [{ title: 'Wave 0', detail: 'data, terrain, sprites' }],
}
const ROOT = '/Users/joshfleig/Desktop/Claude/bayou-state'
const RESULT = { type: 'object', properties: {
  file: { type: 'string' }, lines: { type: 'number' },
  publicSurface: { type: 'array', items: { type: 'string' } },
  tier1Complete: { type: 'boolean' }, tier2Done: { type: 'array', items: { type: 'string' } }, tier2Skipped: { type: 'array', items: { type: 'string' } },
  deviations: { type: 'array', items: { type: 'string' } }, testOutput: { type: 'string' }, knownGaps: { type: 'array', items: { type: 'string' } },
}, required: ['file', 'lines', 'publicSurface', 'tier1Complete', 'tier2Done', 'tier2Skipped', 'deviations', 'testOutput', 'knownGaps'] }

const impl = (file, extra) => `You are implementing ONE module of BAYOU STATE, a SimCity-style university-in-a-swamp game delivered as a single HTML file (vanilla JS + Canvas 2D, no libraries, no network, no ES modules). Working dir: ${ROOT}.
You own exactly: src/js/${file}. Do not edit any other src file. You may append to docs/INTEGRATION_NOTES.md under a '## ${file}' heading and create test/unit/${file.replace('.js', '')}.test.mjs.

Read IN FULL before writing code: docs/ARCHITECTURE.md (the authoritative module contract: your module's exact API, the state tree, enums, events, tick order, coding rules in §10, tiers in §11), docs/briefs/${file.replace('.js', '')}.md (your checklist), src/js/contract.js (the frozen foundation you build on: enums, params, rng, events, helpers, newState). Read the GDD sections your brief cites in docs/GDD.md (it is 45k words; read the cited sections fully, skim the rest as needed). ${extra}

Requirements:
- Implement EVERYTHING in your brief's Tier 1 checklist completely, then Tier 2. No TODOs, no stubs, no 'simplified for now'. Every number comes from BSU.params (add a note to INTEGRATION_NOTES.md if a constant you need is missing from params, and use a local const with the GDD value meanwhile).
- Module shape: 'use strict' IIFE that extends window.BSU exactly as ARCHITECTURE.md §1/§10 specify (init/reset/tick/selfTest lifecycle as applicable). Zero DOM/timer/audio access at definition time. Must load in Node through test/domstub.mjs.
- Determinism: all simulation randomness through BSU.rng streams; never Math.random in sim code.
- Robustness: no exception may escape your public functions on any input; guard array bounds; never produce NaN.
- selfTest(): pure (no canvas), asserts the brief's listed invariants, returns {ok, notes}.
- Testing: write test/unit/${file.replace('.js', '')}.test.mjs that uses makeWindow() from test/domstub.mjs + node:vm to load contract.js, any dependency modules that already exist in src/js (skip missing ones gracefully), then your file; then runs selfTest() and 3–8 scenario checks from your brief's 'Done means' list. Run \`node --check src/js/${file}\` and \`node test/unit/${file.replace('.js', '')}.test.mjs\` and make them pass. Paste the real output in testOutput.
- Quality bar: this is a showcase; write clean, well-structured, commented code, but completeness beats elegance.
Return the structured result (file, lines, publicSurface, tier1Complete, tier2Done, tier2Skipped, deviations from ARCHITECTURE.md (should be none), testOutput, knownGaps).`

phase('Wave 0')
const results = await parallel([
  () => agent(impl('data.js', `data.js is a transcription task with zero tolerance for drift: all 43 catalog rows (GDD §0.3 and §4, every column, tier costs, effects, paint descriptors per ARCHITECTURE.md §4), storm names, ticker lines, student/gator/coach/starter name tables, rivals, festivals, calendar constants, milestone/objective text tables if ARCHITECTURE.md assigns them here. Cross-check every row against §0.3 twice. Include a selfTest that validates every row against BSU.catalogRowSchema and counts rows/tables.`), { label: 'impl:data.js', phase: 'Wave 0', schema: RESULT, effort: 'high' }),
  () => agent(impl('terrain.js', `terrain.js owns map generation (GDD §3 in full: the profile, the ridge crown, the Crevasse Reach, the bayou spline, cove, cypress lake, cheniers, the river, generator guarantees G1–G8 with retry-on-failure, the §3.3 distribution), tile-type derivation, walk-cost grid, chunk dirty flags, subsidence, and the start plot. Its selfTest must generate several seeds and assert every guarantee and the distribution ranges. Make generation fast (< 150 ms per seed in Node).`), { label: 'impl:terrain.js', phase: 'Wave 0', schema: RESULT, effort: 'high' }),
  () => agent(impl('sprites.js', `sprites.js is the base of the procedural art stack (GDD §12 in full, ARCHITECTURE.md §6): the atlas/cache API sprites.get(...), the palette, tile geometry (64×32 diamonds, 6 px per foot elevation), terrain tile painters for every tile type and elevation edge, water, surfaces (path/road/boardwalk/fence), vegetation painters (live oak 3 stages with Spanish moss, bald cypress with knees and November rust, azalea bloom states, palmetto), the pixel-art helpers and shading conventions that sprites_buildings.js and sprites_entities.js will reuse (document them in a header comment and in INTEGRATION_NOTES.md). This is a showcase: the terrain and trees must look genuinely good — layered shading, dithered edges, moss strands, cypress knees, water highlights baked for chunks. Since Node has no real canvas, verify visually with the real-Chrome harness: write a scratch HTML in the scratchpad dir /private/tmp/claude-502/-Users-joshfleig-Desktop-Claude/fb39c7b3-595d-4955-a705-28fe9ff8fb98/scratchpad/sprites-preview.html that inlines contract.js + sprites.js and draws a contact sheet of every sprite/variant onto a canvas, screenshot it with test/browser.mjs (--file that path --shot .../sprites-sheet.png), READ the PNG and iterate until it looks great. Include the final PNG path in knownGaps or testOutput.`), { label: 'impl:sprites.js', phase: 'Wave 0', schema: RESULT, effort: 'high' }),
])
const done = results.filter(Boolean)
log(`Wave 0: ${done.length}/3 modules returned`)
return { results: done, failed: ['data.js', 'terrain.js', 'sprites.js'].filter((f, i) => !results[i]) }
