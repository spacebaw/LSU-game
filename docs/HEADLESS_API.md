# Headless API (fixed contract, required by `test/smoke.mjs`)

The built `index.html` must be loadable in Node via `test/domstub.mjs` (a DOM/Canvas stub: no
`AudioContext`, `requestAnimationFrame` never fires on its own, `localStorage` is in-memory,
canvas 2D calls are no-ops). Module load must not throw there. Boot must NOT auto-start the
render loop or the sim in a way that requires real timers; `session.js` starts the loop only in
a browser (`typeof requestAnimationFrame === 'function'` AND not `BSU.headlessMode`).

```js
BSU.session.newGame({ seed, skipTutorial })  // → state; also sets BSU.state
BSU.session.save(slot)                       // → JSON string (also written to localStorage under try/catch)
BSU.session.load(slot)                       // → state (from localStorage or the in-memory slot map)

BSU.headless.tick(n)          // run n sim ticks synchronously, no rendering (a tick is 0.2 s of play at 1×: baseTps 5; set pieces run at 10 ticks/s)
BSU.headless.render()         // run exactly one render frame (all passes, HUD update) on the stub canvas
BSU.headless.snapshot()       // → plain JSON-able summary:
   // { year, month, day, tick, cash, students, prestige, happiness, ecology,
   //   buildings, agents, gators, floodedTiles, floodedBuildings, storm: null|{name,cat,phase}, speed }
BSU.headless.findSpot(id)     // → {x,y} of a legal placement for catalog id (searches near the start plot; drag tools: a legal start tile) or null
BSU.headless.place(id, x, y)  // → {ok, reason} using the SAME validation/cost path as the UI (charges cash)
BSU.headless.forceHurricane(category) // schedule a storm to make landfall within ~600 ticks, skipping the cone wait
BSU.headless.click(px, py)    // optional: synthesize a pointer click at canvas pixel coords through the UI input state machine
BSU.headless.key(name)        // optional: synthesize a keydown (e.g. 'Escape', '1', ' ')
BSU.headless.fastForwardDays(n) // = tick(n * BSU.params.time.ticksPerDay)   (200)
BSU.headless.state()          // = BSU.state (the live state object)
```

Timing constants the tests assume (time pass, read them from `BSU.params.time`, never hard-code): 5 ticks per
second at 1× (`baseTps`; set pieces run at 10), **200 ticks per calendar day** (`ticksPerDay`), 10-day months,
120-day years (24,000 ticks per year = `ticksPerYear`). Hydro takes 80 steps per calendar day (`hydro.stepsPerDay`).

Any module may also expose `BSU.<module>.selfTest()` returning `{ ok, notes }`; `test/modules.mjs`
calls every one it finds.
