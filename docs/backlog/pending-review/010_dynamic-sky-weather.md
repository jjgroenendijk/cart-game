# 010 Dynamic sky, weather and moon/stars

Status: pending-review (implemented; 4 code commits + this docs/verify commit landed)

## Implementation summary

Landed in 4 atomic commits (`b2f9af4`, `1fbfe1d`, `881ada5`, `dbd53ab`)
plus this docs/verify commit. All gates green: typecheck, eslint,
markdownlint, secretlint, vitest (529 tests), prettier, governance hook.
Production build clean (68 modules). Visual verify logged in
`docs/troubleshooting/2026-06-23_010-dynamic-sky-weather-verify.md`.

- `src/environment/dayCycle.ts` (pure): `computeDayCycle(elapsed, opts)`
  returns a fresh `DayCycleState` (sun arc via `setFromSphericalCoords`,
  sine elevation over `dayLengthSeconds`, 4-phase color + intensity + fog
  curves, `nightFactor`). `phaseFor(elev, isRising)` pure. Shared
  `dayCycleState` singleton paralleling `lightUniforms` (Vector3/Color
  field refs replaced on each write). `applyDayCycleToTargets(state, dest)`
  pure helper for jsdom-safe unit tests. 289 lines.
- `src/core/Renderer.ts` (applies): `applyDayCycle()` at the top of
  `renderViews` forwards the singleton into the live lights + Sky
  sunPosition + scene.fog + every slot's `SkyPosterizePass`. Reuses the
  pure helper for the camera-independent writes. 317 lines.
- `src/environment/DynamicSky.ts` (advances): Environment child owning
  the clock, a seeded procedural star field (`THREE.Points`, 600 points
  on a shell), and a low-poly moon disc (`MeshBasicMaterial`). `update`
  advances the clock, calls `computeDayCycle`, REPLACES the singleton
  fields per its contract, fades stars/moon by `nightFactor`, positions
  the moon at the anti-sun dir. Layer 0 + `fog:false` so the sky-posterize
  depth mask keeps them visible and Sobel/hull outlines skip them. 155
  lines.
- `src/environment/Weather.ts` (precip): Environment child owning a
  fixed-per-session rain/snow `THREE.Points` field (seeded; weighted
  70/15/15 clear/rain/snow pick via `selectWeatherPreset(seed)`,
  overridable via `WeatherOptions.preset`). Wind drift + wrap; Y wraps
  ground -> ceiling. Cascade order in `Environment.update` is DynamicSky
  -> clouds -> water -> Weather so Weather patches the just-written
  `dayCycleState` fog (near -20%, far -15%, color lerped 25% toward a
  preset tint). Clear preset builds nothing; `update` is a no-op. 213
  lines.
- `src/environment/Environment.ts`: 5 children (propField, clouds, water,
  dynamicSky, weather); ctor + update + dispose cascade.
- `src/core/Game.ts`: reorder only — `this.time += dt; this.env.update`
  moved to BEFORE the render block (was after). Net-zero lines; stays at
  600/600. Kills the 1-frame sky lag.

## Context

010 was a concept stub bundling four "living world" extensions. Refined into
three items: 010 (this) owns the atmosphere + time driver; 017 owns ambient
wildlife; 018 owns water buoyancy + life bar. All four share a per-frame
time driver, but wildlife is pure decor and buoyancy is physics + a gameplay
state, so each gets its own file and cadence. 014 (clouds + sky decor)
forward-depends on this item (time-of-day drives cloud tint/density).

Today the sun is fixed. `lightUniforms.ts:10-17` derives one world-space sun
dir from `SUN_ELEVATION`/`SUN_AZIMUTH` via `setFromSphericalCoords`; it is set
once and never animated. `Renderer` writes the shared uniforms once per view
before each `composer.render()` (`Renderer.ts:172-188,228-239`), reading the
sun dir from the `uSunDirWorld` singleton and color/intensity from the live
Three lights (`Renderer.ts:69-70`). The Preetham `Sky` copies the sun dir
into `sunPosition` only at construction (`Renderer.ts:108-117,116`), so the
visible disc never moves. Fog is set once in the ctor (`Renderer.ts:97`).
`SkyPosterizePass` band tints are static per slot
(`skyPosterize.ts:191-201`).

Weather was out of scope (`004:42`); water is visual-only (`Water.ts:16-22`).

Real constraints, resolved against the code:

- `Game.ts` is exactly 600/600 lines. This item adds ZERO Game lines: sky,
  weather, moon and stars are `Environment` children driven by the existing
  `env.update(dt, time)` call (`Game.ts:292`); `Environment.update` cascades
  to children (`Environment.ts:35`). Renderer (257/600) owns all lighting
  writes and reads a day-cycle singleton in its existing per-view write.
- Per-frame order matters: `env.update` runs AFTER render today
  (`Game.ts:283` render vs `:292` env update). For zero lighting lag the plan
  moves the `env.update(dt, this.time)` call to just before the render block
  in `Game.frame`. This is a net-zero reorder (a moved line, not an added
  one); it is safe because clouds drift + water waves are frame-rate visuals
  unaffected by ordering. Alternative: accept a 1-frame sky lag (invisible
  for a slow cycle) and skip the reorder.
- Lighting ownership rule holds ("Renderer writes lighting once/frame"): the
  DynamicSky child computes state and writes a shared `dayCycleState`
  singleton; Renderer applies it. No material reaches outside the singleton.
- Weather is a fixed session preset (deterministic, seeded), not a runtime
  state machine. Simplest to test; a 012 menu toggle can layer later.
- Zero-asset policy holds: weather = `THREE.Points`; moon/stars = procedural
  points/sprite; no textures.
- Night = palette retune + moon + stars (no kart headlights — avoids the
  per-kart light cost, risky in 2P split).

## Goal

Animate the atmosphere over a day cycle, zero-asset:

- Time-of-day: animated sun arc (elevation+azimuth over a day length) feeding
  `lightUniforms.uSunDirWorld`; phase retune (dawn/day/dusk/night) of sun
  color+intensity, ambient, sky band tints and fog.
- Moon: at night swap the sky "sun" to a moon dir + tint; lower sun
  intensity.
- Stars: procedural `Points` field, alpha-faded by a night factor.
- Weather: fixed per-session preset (rain or snow) as seeded `Points`, a wind
  direction, and a fog (color/near/far) shift. Visual only.

## Non-goals

- Kart headlights / per-kart lights (night lighting is sky + palette only).
- Runtime weather changes or a weather state machine (fixed preset; 012 may
  add a toggle).
- Seasons; storm/lightning gameplay; fluid simulation.
- Cloud tint/density coupling (014 owns clouds; 014 will read this item's
  phase later).
- Per-track climate (single world climate).

## Architecture (new)

```text
src/environment/
  dayCycle.ts        # PURE computeDayCycle(elapsed, opts)->DayCycleState:
                     #   sun dir via setFromSphericalCoords (mirrors
                     #   lightUniforms.ts:10-17), phase from sun elevation,
                     #   color curves (sun/ambient/sky/fog) per phase.
                     #   Exported phaseFor(elev) + lerp curves for tests.
                     #   Shared mutable dayCycleState singleton (parallels
                     #   lightUniforms) that Renderer reads.
  DynamicSky.ts      # Environment child. Owns: clock (day length), weather
                     #   Points (seeded rain/snow preset), moon, star Points.
                     #   update(dt,time): advance clock -> computeDayCycle ->
                     #   write dayCycleState + lightUniforms.uSunDirWorld;
                     #   fade stars/moon by nightFactor; drift weather by
                     #   wind. dispose() frees GL resources (Clouds precedent).
src/core/
  Renderer.ts        # ADD per-frame application of dayCycleState: copy
                     #   sunDir->Sky sunPosition (today set once :116);
                     #   setSkyTints(state) per slot (skyPosterize uniforms);
                     #   setFog(state) (scene.fog color/near/far). Reads the
                     #   singleton inside the existing per-view write
                     #   (:228-239). ~257 lines now, ample headroom.
  Game.ts            # REORDER only: move env.update(dt,this.time) (:292) to
                     #   just before the render block. Net-zero lines. (Or
                     #   skip + accept 1-frame lag.)
src/environment/
  Environment.ts     # construct DynamicSky child + cascade update/dispose.
                     #   ~46 lines now, ample headroom.
```

## Contracts with 001-009

- 001: reads `lightUniforms` by ref (`cel.ts:133`); sees animated sun + phase
  colors with no change. Verify night ambient does not flatten cel bands.
- 002: `SkyPosterizePass` tints retuned per phase; the synthetic band mix
  (`skyPosterize.ts:227-233`) is the main night look lever.
- 003: none (heightmap unused by atmosphere).
- 004: `Environment` gains the DynamicSky child; Clouds/Water unchanged.
- 005: none now. Optional rain audio bed is a later soft tie (005 owns audio).
- 006: cycle pauses in menu (DynamicSky not advanced while state==="menu",
  matching the `state !== "menu"` gate at `Game.ts:262`).
- 007/008/009: none (atmosphere is render-only).
- 014: forward dep — clouds read this item's phase for tint/density.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(sky): pure day-cycle sun arc + phase model`
   - `dayCycle.ts`: `computeDayCycle`, `phaseFor`, day-cycle singleton.
   - tests: sun arc elevation/azimuth correct over a day; phase boundaries
     dawn/day/dusk/night; color curves monotonic + night darker than day.
2. `feat(sky): Renderer applies day-cycle lighting + sky tints + fog`
   - Renderer reads singleton in per-view write; copies sun->Sky sunPosition;
     `setSkyTints`/`setFog`. Reorder (or accept lag) env.update before render.
   - tests: Renderer forwards sunDir to Sky uniform; applies tints/fog per
     slot; no regression to lightUniforms sharing tests.
3. `feat(sky): DynamicSky controller + moon + stars`
   - `DynamicSky.ts` child; moon dir swap + intensity at night; star Points
     alpha by nightFactor; dispose frees resources.
   - tests: night factor fades stars in/out; dispose idempotent + frees
     geometry/material; determinism from seed.
4. `feat(sky): seeded weather preset (rain/snow) + fog shift`
   - weather Points (fixed session preset, `hashSeed("weather")^seed`);
     wind drift; fog near/far/color shift with intensity.
   - tests: same seed -> identical particle matrices; preset select rain vs
     snow; fog shift applied; dispose frees Points resources.
5. `docs: refine 010 plan + todo + 014 dep + troubleshooting`
   - mark 010 full plan in `docs/todo.md`; retarget 014 forward dep to 010;
     README project structure adds new files; troubleshooting verify case.

## Risks

- Game.ts 600/600: zero new lines. The only Game edit is the net-zero
  reorder of `env.update` (or skip it + take 1-frame lag).
- Layering: weather/star `Points` on camera-enabled layers get caught by the
  outline/posterize passes (layers 0/1/2, `src/AGENTS.md`). Rain under cel
  outline may look odd. Default: render weather on a non-outlined path; tune
  in review. Flag the post-effect interaction explicitly.
- Night cel flattening: very low ambient can crush the 4-band cel ramp. Keep
  a night ambient floor; verify kart still reads against terrain.
- Sky disc vs synthetic blend: 002 already obscures the Preetham sun at
  `uBandMix=0.85`. A moving sun needs the synthetic path to track the disc
  or the moon will not read. Verify per phase.
- Perf: weather point count + stars add to the 011 budget (cross-ref 011).
  Cap particle counts; low-poly moon.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.
- Weather never affects physics (visual only); buoyancy is 018.

## Acceptance

- [x] `dayCycle.ts` present; `computeDayCycle`/`phaseFor` pure + tested
- [x] Sun arc animates `lightUniforms.uSunDirWorld`; Sky disc + shadows follow
- [x] Phase retune of sun/ambient/sky tints + fog visible dawn->night
- [x] Moon swaps in at night; star field fades in/out by night factor
- [x] One weather preset (rain or snow) renders, seeded + deterministic
- [x] `Game.ts` unchanged in line count; `Renderer.ts` <=600 lines (317)
- [x] `npm run typecheck && lint && test` green; pre-commit hook green
- [x] No black screen at `npm run dev`; visual verify logged in
      `docs/troubleshooting/2026-06-23_010-dynamic-sky-weather-verify.md`

## Defaults

- day length: 120s full cycle (tunable; phase ~30s each for a 4-phase day)
- phases by sun elevation: dawn <8deg, day >=8, dusk <8 (descending), night
  <0 (sun below horizon); moon rises at night
- night ambient floor keeps cel bands readable; sun intensity ~0.15 at night
- weather: one seeded preset per session (clear/rain/snow pick at build,
  weighted to mostly clear); fog shift mild (color cooler, near pulled in)
- stars: ~600 points, alpha = clamp(-sunElev / 10, 0, 1)
- moon: simple lit sprite, lower intensity than day sun

## Previous implementation

None. Closest patterns: `lightUniforms.ts:10-17,45-56` (spherical sun +
uniform write), `SkyPosterizePass` tints (`skyPosterize.ts:191-201`), `Sky`
sunPosition (`Renderer.ts:116`), `Clouds.ts:69-72` (drift/wrap), seeded RNG
(`rng.ts:58-84`), `Environment.ts:35` (child update cascade).

## Depends on

000 (harness; test gate live). 001 (`lightUniforms` consumers). 002 (Sky +
posterize + fog). 004 (`Environment` child pattern + dispose). 014 forward
depends on this (cloud tint/density from phase). 011 (perf budget) cross-ref.
