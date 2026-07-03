# 054 Dynamic weather: level envelope, scheduled fronts, storm channels

Status: pending-review

## Context

Weather is fixed-per-session by design (`environment/Weather.ts:130-138`):
one seeded weighted pick at world build, then the same preset at constant
strength until the world rebuilds. `intensity` is a readonly 0-or-1
(`Weather.ts:172`). A preset can express exactly two things: one Points
field (`WEATHER_PRESET_CONFIG` scalars, `weatherPresets.ts:24-45`) and a
fog patch (`patchFog`, `Weather.ts:225`). Consequences:

- Weather never changes during play: no front rolling in mid-race, no rain
  easing off on the last lap - the single most atmospheric thing a sky
  system can do is structurally impossible today.
- Rain does not darken the day, wind does not move the clouds faster,
  storms have no lightning or thunder, the ground never looks wet. Each of
  those channels has a clean existing seam: the Environment.update cascade
  is DynamicSky -> biome bias -> Weather (`Environment.ts:37-44`), so a
  weather channel that writes `dayCycleState` after the sky is the
  established pattern; Clouds take a speed input; AudioManager already
  owns wind noise (`buildWind`) + one-shot cues.
- The player has no say: 042 gives time-of-day a race-config row +
  persistence; weather - the other half of "race mood" - has none.

Constraints to respect: the clear preset must stay free (`update()`
early-return, no field); temperate-parity and the rain/snow bit-identical
init (`Weather.ts:236-241`) hold whenever the new machinery is off;
Weather must keep reading fog AFTER DynamicSky writes it each frame.

## Goal

Weather becomes a living system: sessions play out as a seeded schedule of
fronts (clear builds to rain, rain fades out), each preset drives multiple
channels (particles, fog, sky dim, wind, wetness; storms flash + thunder),
and the player picks auto/clear/rain/snow/storm in race config. All
deterministic from the session seed; defaults bit-identical to today.

## Non-goals

- No gameplay coupling (wet grip, aquaplaning) -> concept stub during
  execution; VFX/audio only.
- No two simultaneous particle fields; fronts hand over through zero
  (cheaper, and reads naturally as weather easing before it turns).
- No new particle geometries (leaf-fall etc. belong to biome plans 036).
- No puddles/reflections; wetness is a ground-color darkening only.

## Architecture (change)

```text
src/environment/
  Weather.ts          # intensity: readonly 0|1 -> setLevel(k in [0,1]):
                      #   scales uOpacity + the fog-patch factors by k
                      #   (patchFog already multiplies by intensity - it
                      #   becomes the live level). Level 1 = bit-identical
                      #   to today. Adds rebuildField(preset, seed) so the
                      #   director can swap presets at level 0 without a
                      #   new Weather instance (group/points swap inside).
  weatherDirector.ts  # NEW PURE: seeded schedule. makeSchedule(seed,
                      #   weights, mode) -> segments [{preset, holdSec,
                      #   fadeInSec, fadeOutSec}]; auto mode re-rolls the
                      #   biome weight table per segment with the sub-seed
                      #   idiom (seed ^ hashSeed("weather-seg" + i));
                      #   levelAt(schedule, t) -> {preset, level} envelope
                      #   (trapezoid per segment, zero at boundaries).
                      #   Fixed modes = one infinite segment; "clear"
                      #   builds no field ever. jsdom-tested.
  weatherChannels.ts  # NEW PURE: per-preset channel config + apply:
                      #   dim (sun/ambient intensity multiplier at full
                      #   level; lerped by level, applied to dayCycleState
                      #   in the same post-sky slot as the fog patch),
                      #   windFactor -> Clouds drift speed multiplier,
                      #   wetness target (rain/storm 1, snow 0.3, else 0).
                      #   Existing presets default dim=1/wetness=0 ->
                      #   parity. jsdom-tested.
  lightning.ts        # NEW PURE: seeded flash event stream for storm
                      #   (nextFlash(seed, i) -> {atSec, strength,
                      #   thunderDelaySec}); min spacing >= 6 s (comfort
                      #   floor), strength shapes a 2-3 frame dayCycleState
                      #   sun/ambient/fog boost + a sky-flash tint.
  weatherPresets.ts   # storm preset: rain particle config, heavier fog,
                      #   dim ~0.7, lightning on. PRESET_ORDER appends
                      #   (never reorders - parity comment at :150).
  Environment.ts      # owns the director: update() resolves {preset,
                      #   level} from elapsed, drives weather.setLevel,
                      #   swaps fields at zero crossings, applies channel
                      #   writes in the cascade slot AFTER the biome bias,
                      #   BEFORE weather.patchFog. Exposes
                      #   setWeatherMode(mode) for the race-config row
                      #   (no rebuild; mirrors setTimeOfDay 042).
src/materials/
  cel.ts              # uWetness uniform: at 1, terrain diffuse darkens
                      #   ~25% + saturates slightly (LINEAR-space multiply;
                      #   no new texture, no extra pass). Default 0 =
                      #   byte-identical shader output.
src/audio/
  gameAudio.ts        # thunder one-shot (noiseBuffer burst through the
                      #   sfx bus, scheduled at ctx.currentTime +
                      #   thunderDelaySec) + rain bed (filtered noise loop,
                      #   gain follows level). No-op pre-resume, like all
                      #   audio.
src/core|ui/
  RaceConfigOverlay   # weather row: auto / clear / rain / snow / storm
                      #   (042 cycle-row + MenuNav pattern), live preview
                      #   via setWeatherMode; persistence
                      #   gamecart.weather.v1 (own storage module,
                      #   timeOfDayStorage pattern).
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(env): weather level envelope`
   - `setLevel` + `rebuildField`; level defaults to 1 (parity tests:
     uniforms + fog patch bit-identical at level 1; clear stays free).
2. `feat(env): seeded weather director + front schedule`
   - `weatherDirector.ts` (+tests: determinism, trapezoid envelope, zero
     at swaps, auto re-roll distribution, fixed-mode single segment);
     Environment wiring; default schedule = one infinite segment of the
     session pick -> behavior identical until a mode opts in.
3. `feat(env): weather channels (sky dim, cloud wind, wetness target)`
   - `weatherChannels.ts` + cascade slot + Clouds speed input +
     `cel.ts` uWetness (+shader-source tests). 052 stills guard the cel
     change (uWetness 0 scenes must not drift).
4. `feat(env): storm preset with lightning + thunder`
   - `lightning.ts` (+tests: spacing floor, determinism), dayCycleState
     flash application, gameAudio thunder/rain-bed hooks.
5. `feat(ui): weather row in race config + persistence`
   - overlay row + storage + Game/GameFlow wiring (`setWeatherMode`, no
     world rebuild); MenuNav + gamepad reach it; default = auto.
6. `docs: AGENTS refresh, grip-coupling stub, move 054`

## Risks

- Cascade-order fragility: dim/flash/fog must land between the biome bias
  lerp and patchFog, and never cache dayCycleState values across frames
  (documented trap, `Weather.ts:157-163`). Mitigation: one apply site in
  Environment.update; a test asserts write order via a scripted fake.
- Parity erosion: rain/snow init parity + temperate parity + clear-is-free
  are all load-bearing invariants. Mitigation: level-1/no-director paths
  are the constructors' existing paths; parity tests extended, not moved.
- Field swap hitch: rebuilding a 1500-particle field mid-race allocates.
  Mitigation: swaps only at level 0 (invisible), buffers sized once to the
  max preset count and refilled in place.
- Flash comfort: lightning is a luminance spike. Mitigation: spacing floor
  > = 6 s, strength cap, and the flash rides dayCycleState (ACES-tonemapped)
  > rather than a raw screen overlay.
- Wetness vs cel look: darkening can crush the road/grass band contrast.
  Mitigation: factor tuned against 052 rain stills; wetness affects
  terrain palette only (props unchanged).
- Menu preview: setWeatherMode with live preview must not rebuild the
  world (uniform + field-swap path only); RaceConfig back-out restores the
  persisted mode (042's cancel-abandoned-preview pattern).

## Acceptance

- [ ] Default session (auto, no player change) is bit-identical to today
      until the first scheduled front change; fixed "clear" never builds a
      field.
- [ ] A full auto session plays >= 2 distinct fronts over ~10 min, fading
      through zero; same seed -> same schedule, byte-for-byte.
- [ ] Storm: sky dims, lightning flashes (>= 6 s apart), thunder follows
      with the per-flash delay, ground reads wet; all revert as the front
      fades.
- [ ] Clouds visibly speed up under high-windFactor presets.
- [ ] Race-config weather row selects + persists + previews live without a
      world rebuild; MenuNav + gamepad reach it.
- [ ] uWetness=0 shader output byte-identical (test); 052 baseline scenes
      unchanged.
- [ ] Zero steady-state allocation (envelope + channel writes are
      uniform/scalar updates); all files <= 600 lines; `npm run verify` +
      hooks green.

## Verification

- F3 soak one auto session per biome; watch a front arrive + leave.
- Force storm via the race-config row: flash/thunder sync, wetness on the
  road, night storm (flash vs shadowless night path from 038).
- 2P split-screen storm on low tier; frame-time EWMA steady.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

010/041 (Weather field + GPU idiom - extended, not reworked), 042
(race-config row + storage + live-preview patterns), 025 (biome weight
tables feed auto mode), 038 (shadow fade interplay checked at night).
Composes with 052 (rain/storm stills join the scene matrix) and 053
(kart VFX read the same dayCycleState dimming). Stubs wet-grip gameplay
coupling as a new concept during execution.
