# 038 Dusk/dawn shadow fade (night-wipe + shadow-pop)

Status: pending-review (implemented in 3 commits; visual acceptance pending)

## Context

Two reported visual issues, same root cause (the binary shadow toggle):

- Issue 2 (night wipe): during dusk -> night, darkness appears to load in
  from the bottom/foreground as a wipe/band, not a coherent global dim.
- Issue 3 (shadow pop): at dawn, cast tree/prop shadows appear at full
  strength instantly instead of fading in. Most visible on the start-menu
  camera.

Root cause = `src/core/Renderer.ts:318` flips the shadow-casting sun on/off
across a hard threshold:

this.sun.castShadow = state.sunDirWorld.y > SHADOW_MIN_SUN_Y;

SHADOW_MIN_SUN_Y = sin(5 deg). Two failure modes:

- Dawn (sun.y crosses ~5 deg UP): castShadow false -> true; the cel shader
  recompiles (USE_SHADOWMAP define flips) and every prop shadow snaps to
  full intensity -> pop (issue 3). setShadowTarget runs only while racing
  (`src/core/Game.ts:238`), so on the menu cam the shadow target is pinned
  at origin and the pop sweeps the whole visible terrain.
- Dusk (sun.y crosses ~5 deg DOWN) through twilight: a low grazing sun
  plus the finite directional shadow frustum (ortho half-extent 80,
  camera.far up to 400, follows the kart) draw a moving boundary between
  shadowed (near = bottom of screen) and still-lit (far) terrain ->
  darkness reads as a bottom-up wipe (issue 2). The castShadow flip itself
  is a second discontinuity.

The cel shadow term (`src/materials/cel.ts:193-205`) multiplies diffuse by
three.js getShadow(...); dirShadow.shadowIntensity is fixed at 1 and is NOT
driven by the day cycle, so there is no fade path today.

Issue 2 has a second driver outside this plan: the blocky heightmap-texel
normal (021) makes the dusk cel-band darkening read as an uneven sweep.
021 owns that; this plan owns the shadow desync.

## Scope

Closes issues 2 + 3. Both share one fix: replace the hard castShadow flip
with a continuous, elevation-driven shadow-visibility fade. Not in scope:

- Issue 1 / the blocky grid -> 021.
- A moonlight caster or extra lights -> future; the design leaves room.
- Shadow map resolution / quality-tier extents.
- The cel toon look (band count, bandEdge).

## Goal

Cast shadows fade in/out smoothly across a dawn/dusk elevation band so:

- Dawn: shadows ramp 0 -> 1 as the sun rises through the band (no pop).
- Dusk: shadows ramp 1 -> 0 as the sun lowers; the frustum-driven
  bottom-up band is gone before the frustum degenerates.
- Deep night: shadow contribution 0; cel shadowless path; no regression.
- Dusk -> night darkens coherently (lighting + fog + sky + shadow + stars
  - moon all read the same elevation state).

Design: a per-directional-light fade scalar so a future moonlight caster
slots in with its own fade; the shadow-map pipeline stays alive across the
band (no teardown/recompile mid-transition).

## Non-goals

- Revert or disable the castShadow pipeline (keep rendering the shadow map).
- Add a second light now (moon); only reserve the per-light fade hook.
- Replace SHADOW_MIN_SUN_Y with a wider hard threshold; the fix is a ramp,
  not a moved step.
- Touch kart/prop cel shading outside the shared shadow term.
- Fix the blocky normal (021).

## Architecture (change)

```text
src/environment/
  dayCycle.ts        # add shadowFadeFor(elevDeg) pure fn: smoothstep ramp
                     #   0 below SHADOW_FADE_LOW (3 deg), 1 above
                     #   SHADOW_FADE_HIGH (18 deg); symmetric dawn/dusk.
                     #   Add shadowFade to DayCycleState; compute in
                     #   computeDayCycle; copy in DynamicSky.writeState.
  dayCycle.test.ts   # ramp monotonic 0..1 across 3..18 deg; 0 below 3,
                     #   1 above 18; dawn == dusk symmetry.
src/materials/
  lightUniforms.ts   # add shared uShadowFade { value: 1 } (default 1 so
                     #   non-daycycle paths + tests are unchanged).
  lightUniforms.test.ts # uShadowFade present, default 1.
  cel.ts             # shadow term: diffuse *= getShadow(...) * uShadowFade
                     #   (inside the USE_SHADOWMAP guard). uShadowFade comes
                     #   from the spread of lightUniforms (already shared).
  cel.test.ts        # shadow-term source multiplies by uShadowFade.
src/core/
  Renderer.ts        # applyDayCycle: write lightUniforms.uShadowFade.value
                     #   = state.shadowFade; set this.sun.castShadow =
                     #   state.shadowFade > 0 (map renders through the band;
                     #   off only at fade 0 -> cel recompiles shadowless at
                     #   full dark, invisible). Drop SHADOW_MIN_SUN_Y.
  Renderer.test.ts   # castShadow follows shadowFade (>0 on, ==0 off);
                     #   uShadowFade written from the state.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(dayCycle): add elevation-driven shadowFade`
   - dayCycle.ts shadowFadeFor + DayCycleState.shadowFade +
     computeDayCycle + DynamicSky.writeState; dayCycle.test.ts ramp +
     symmetry.
2. `feat(materials): uShadowFade uniform + cel shadow-term fade`
   - lightUniforms.uShadowFade (default 1) + cel shadow term \*
     uShadowFade; lightUniforms.test.ts + cel.test.ts. Off-path
     unchanged (default 1).
3. `fix(render): fade shadows across the dawn/dusk band`
   - Renderer.applyDayCycle writes uShadowFade + castShadow =
     shadowFade > 0; remove SHADOW_MIN_SUN_Y; Renderer.test.ts. Closes
     issues 2 + 3.

## Risks

- castShadow on through the band = shadow map renders during twilight
  (small fill cost). Mitigated: off again at fade 0 (deep night). The cel
  recompile happens at fade ~= 0 (full dark) -> invisible.
- Long grazing shadows inside the 3..18 deg band could stretch. Mitigated:
  the ramp drives them to 0 by 3 deg, before the frustum degenerates
  badly; existing shadow.bias / normalBias keep acne in check. Visual
  verify.
- uShadowFade default 1 -> karts/props/tests outside the day cycle are
  bit-identical. Assert in tests.
- Per-light fade is sun-only for now; a future moon light needs its own
  fade (documented in cel.ts + dayCycle.ts). Not a regression.

## Acceptance

- [ ] Dawn: cast shadows fade 0 -> 1 over sun 3 -> 18 deg (no pop), visible
      on the menu cam as well as the race cam.
- [ ] Dusk: cast shadows fade 1 -> 0 over 18 -> 3 deg; no bottom-up wipe
      band; darkness coherent across terrain + props.
- [ ] Deep night: castShadow off (shadowFade 0); cel shadowless path; no
      shadow acne / no regression vs today's night.
- [ ] sun/ambient/fog/sky/stars/moon stay synchronized (all read the same
      elevation state); dusk -> night reads as one coherent transition.
- [ ] uShadowFade default 1; non-daycycle paths unchanged.
- [ ] All touched files <= 600 lines; typecheck + lint + test + hook green.

## Defaults

- shadowFade band: SHADOW_FADE_LOW 3 deg, SHADOW_FADE_HIGH 18 deg
  (symmetric dawn/dusk). 0 below 3 deg, 1 above 18 deg.
- uShadowFade default 1 (unchanged lit look outside the day cycle).
- castShadow = shadowFade > 0.

## Verification

Scrub the day cycle (short DynamicSky dayLength, or a temporary debug
time-of-day control) and watch the menu cam + race cam:

- Hold at sun elevations 0 / 3 / 10 / 18 / 25 deg; confirm shadow term
  0 / ~0 / ~0.5 / 1 / 1 (read uShadowFade via a render probe or HUD).
- Dawn sweep: no single-frame shadow pop; shadow term rises smoothly.
- Dusk sweep: no bottom-up wipe band; terrain + props dim together.

## Previous implementation

The castShadow threshold came with the real-shadow wiring (Renderer
setShadowTarget + the cel USE_SHADOWMAP path). 010 added the day cycle
(dayCycle.ts); 014 added stars/moon (DynamicSky nightFactor). This plan
adds the missing fade between them.

## Depends on

010 (dayCycle). 001 (cel material). The Renderer directional-shadow
wiring (Renderer.sun + cel USE_SHADOWMAP). 021 (merged) supplies the
smooth per-pixel terrain normal; with 021 in, issue 2's dusk coherence
is fully resolved (shadow desync here + the former bandy normal).
