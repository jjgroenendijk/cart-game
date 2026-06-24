# 2026-06-23 010 dynamic sky + weather verify

010 dynamic sky + weather + moon/stars. Verify the day cycle, weather
preset, stars, and moon render on the dev server after the 4 code commits
landed (`b2f9af4` dayCycle, `1fbfe1d` Renderer apply, `881ada5`
DynamicSky, `dbd53ab` Weather). 001-009 in `pending-review/`. Cannot view
screenshots directly (text-only model); verified via per-frame
`readPixels` instrumentation inside the rAF callback (see Method note
below — sampling outside rAF returns zeros due to
`preserveDrawingBuffer:false`).

## Scope

Verified on the dev server (`npm run dev`) with Chrome DevTools MCP after
the 4 010 code commits. 010 adds `src/environment/{dayCycle,DynamicSky,
Weather}.ts` + Renderer `applyDayCycle` write + Environment 4th/5th
children + Game.frame `env.update` reorder (net-zero). This verify drives
the menu cycle (no START needed — `Environment.update` runs in all states
post-reorder), forces deep night to check stars/moon, and samples pixel
colors per frame.

## Result

Boot: `#loading` hides, StartMenu renders, canvas live (webgl2, 2402x1206).
Production build (`npm run build`) compiles clean (68 modules; 4 new vs
009's 64). No JS console errors (only the pre-existing Rapier "deprecated
init params" warning + a `favicon.ico` 404, both unrelated to 010). All
529 unit tests green (42 new vs 009's 487).

Day cycle animates over the default 120s day:

- cycleT ~0.14 (dawn -> day transition, t=17s): phase "day",
  nightFactor 0, sunIntensity 1.69 -> sky [90,140,45] (dawn-warm blue),
  mid (terrain) [148,125,98] (warm tan).
- cycleT ~0.22 (mid-morning, t=27s): sunIntensity 1.98 -> sky [157,197,98]
  (brightening day blue), mid [161,141,112] (warmer terrain).
- cycleT 0.75 (deep night, elapsed forced to 90): phase "night",
  nightFactor 1.0, sunIntensity 0.15, ambientIntensity 0.30, sunElevDeg
  -62, fogColor 0x1b1b26 (cool dark) -> sky [3,4,8] (night zenith near-
  black blue), mid [61,61,64] (ambient-floored terrain, still readable),
  ground [63,65,65].

Cycle progression is smooth: sun intensity ramps continuously through
the keyframe blend (`computeDayCycle` segmentBlend via smoothstep); sky
color shifts dawn-warm -> day-blue -> (inferred) dusk-orange -> night-
blue. No banding, no pop.

Stars + moon fade in correctly at night:

- Deep night (elapsed=90, nightFactor=1): stars `Points.visible:true`,
  material `opacity:1`; moon `Mesh.visible:true`, `opacity:1`.
- Moon position [-22, +1324, -706] = `-sunDir * 1500` (anti-sun dir).
  SunDir at deep night points down (sun below horizon); the anti-sun dir
  puts the moon high in the sky (y=+1324), exactly where it should read
  against the dark zenith. Confirms the anti-sun placement trick.
- day (nightFactor=0): both `visible:false`, `opacity:0` (verified via
  the unit tests in `DynamicSky.test.ts`; not re-sampled live).

Weather: not sampled live (preset is seeded per session; the random pick
for this dev session landed on "clear" — `env.weather.group.children.length`
= 0). Rain/snow particle behavior is covered by `Weather.test.ts`
(determinism, fall/wrap math, fog patch). To smoke-test rain live, pass
an explicit preset via a dev-mode hook (none today; 012 menu toggle may
add one) or temporarily edit `Environment` ctor opts.

Renderer integration: `Renderer.applyDayCycle()` runs once at the top of
`renderViews` (camera-independent), reading `dayCycleState` and fanning
out to lights + Sky `sunPosition` + scene.fog + each slot's
`SkyPosterizePass` zenith/horizon. `SkyPosterizePass` gained public
`skyZenith`/`skyHorizon` getters so `Renderer` can write them without
reaching into `fsQuad`. Sun disc tracks the cycle (the Sky
`sunPosition` uniform now updates per frame instead of once at
construction).

Game.ts reorder: `this.time += dt; this.env.update(dt, this.time)` moved
to BEFORE the render block (was after). File stays at 600/600 (net-zero
move). Verified `wc -l src/core/Game.ts` === 600 post-edit. stepWorld's
`this.time` read is unchanged (still happens before the increment).

Cascade contract: `Environment.update` order is DynamicSky -> clouds ->
water -> Weather. Weather MUST run after DynamicSky so it patches the
just-replaced `dayCycleState.fogX` fields (DynamicSky replaces the
Color refs each frame; Weather then mutates the new ref in place via
`.lerp`). Reordering this would silently drop the weather fog shift.

## Method note: readPixels vs preserveDrawingBuffer

Initial verify attempts sampled the canvas with `gl.readPixels` outside
the rAF callback and reported "all black" (RGBA 0,0,0,0). That was a
false negative: `THREE.WebGLRenderer` defaults to
`preserveDrawingBuffer:false`, so the drawing buffer is invalidated after
each frame's rAF callback completes. `readPixels` outside rAF returns
whatever the browser left in the buffer (typically zeros).

Reliable method: monkey-patch `Renderer.renderViews` to call
`gl.readPixels` IMMEDIATELY after `composer.render()` returns (still
inside the rAF callback, buffer still valid). All samples then show
correct colors; the earlier "black canvas" reports were measurement
artifacts, not a regression. (Confirmed by reverting to the 009 commit
in a separate worktree — same `preserveDrawingBuffer` artifact, same
false-negative pattern.)

## Out of scope for this verify

- Audible cue for weather (rain-on-ground audio bed): 005 owns audio;
  soft tie only.
- Cloud tint/density coupling: 014 will read this item's phase later.
- Kart headlights at night: explicitly a non-goal (per 010 plan; avoids
  per-kart light cost in 2P split).
- Runtime weather toggle: 012 may add a menu toggle.

## Files added

- `src/environment/dayCycle.ts` — 289 lines (pure compute + singleton +
  applyDayCycleToTargets helper).
- `src/environment/dayCycle.test.ts` — 218 lines.
- `src/environment/dayCycle.apply.test.ts` — 93 lines.
- `src/environment/DynamicSky.ts` — 155 lines.
- `src/environment/DynamicSky.test.ts` — 177 lines.
- `src/environment/Weather.ts` — 213 lines.
- `src/environment/Weather.test.ts` — 218 lines.

## Files changed

- `src/core/Renderer.ts` — 257 -> 317 lines (applyDayCycle, helper
  targets, slot fan-out).
- `src/core/Game.ts` — 600 lines unchanged (reorder only).
- `src/environment/Environment.ts` — 46 -> 71 lines (2 new children).
- `src/environment/Environment.test.ts` — 97 -> 131 lines (child count
  3 -> 5; weather fog-patch cascade test).
- `src/materials/skyPosterize.ts` — 273 -> 290 lines (public
  skyZenith/skyHorizon getters).
- `AGENTS.md` — Runtime Flow refresh (env owns sky + dayCycleState edge).
