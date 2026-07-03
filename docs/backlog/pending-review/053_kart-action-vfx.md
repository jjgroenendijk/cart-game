# 053 Kart action VFX: drift smoke, surface dust, splashes, skid marks

Status: done (pending PR merge)

## Context

The world has had every visual pass (biomes, dynamic sky, weather, clouds,
water, wildlife) but the racing action itself has zero VFX: the only
particles in the game are Weather's rain/snow (`environment/Weather.ts`).
A drifting kart emits a drift AUDIO voice (005/015) and a respawn plays a
cue (`audio/respawnCue.ts`) with nothing on screen - the eye lags the ear.
For a kart racer this is the highest-impact visual gap: it is in view 100%
of racing time, in every biome, on every circuit.

Every input signal already exists and is public:

- `KartController.wheels: WheelState[]` - per-wheel `grounded`,
  `compression`, `steerAngle`, `spin` (`kart/KartController.ts:103`);
  plus `grounded`, `isDrifting`, `inWater`, `speed`, `life`,
  `tuning.wheelRadius`.
- Respawn is a single choke point: `FieldBuilder.respawnAhead`
  (`core/FieldBuilder.ts:488`) already calls `gameAudio.onRespawn()`.
- Surface color: `colorAt(x, z)` (terrain `HeightSource`,
  `terrain/heightSource.ts:65`) returns the LINEAR terrain color -> dust
  tinted per-surface is biome-correct for free (red badlands dust, white
  tundra spray, sand desert plumes) with no per-biome data.

The implementation idiom is proven twice: `Weather.ts` (010/041) is a
single `THREE.Points` with a stateless GPU advance whose math has a pure
jsdom-tested mirror (`advancePosition`); `critters.ts`/`propSampler.ts`
split pure placement from a thin GL owner. Repo constraints that shape the
design: zero committed textures (procedural point sprites only), LINEAR
shader output + fog, layer 0 for kart-space objects, pooled buffers with
zero per-frame allocation, quality tiers in `core/quality.ts`.

## Goal

Racing reads as fast, physical, and alive: wheels kick surface-tinted dust
at speed, drifting pours smoke and lays fading skid marks, water contact
splashes, respawn puffs. All procedural, cel-consistent, deterministic
under a fixed time (so 052 stills can cover it), and within the existing
frame budget on the low quality tier.

## Non-goals

- No gameplay/physics change; VFX read controller state, never write it.
- No committed sprite/texture assets; shaped point sprites are computed in
  the fragment shader (soft disc / streak from gl_PointCoord).
- No speed lines, boost flames, or collision sparks in v1 -> existing
  concept 050 (impact particles/sparks/debris) keeps the contact-force
  half; this plan ships the wheel-dust/drift-smoke half 050 also
  sketches (keeps this a clean vertical slice).
- No per-rival VFX distance culling beyond the existing kartLod levels
  (minimal-LOD karts stop emitting; that is the whole policy).

## Architecture (change)

```text
src/kart/
  kartVfx.ts        # NEW PURE: emitter rules + ring buffer math, no THREE.
                    #   EmitterKind = dust | driftSmoke | splash | poof.
                    #   emissionRate(kind, {speed, grounded, isDrifting,
                    #     inWater}) -> particles/sec (dust ~ speed above
                    #     8 m/s, driftSmoke gated on isDrifting&&grounded,
                    #     splash on inWater, poof = burst API);
                    #   spawnAccumulator (dt -> integer spawns, carries
                    #   remainder); ring-buffer cursor math (capacity,
                    #   wrap, oldest-overwrite); per-kind life/size/vel
                    #   jitter from seeded RNG; per-tier budget split
                    #   across 6 karts. jsdom-tested.
  KartVfx.ts        # NEW GL owner: ONE THREE.Points for all karts, layer 0.
                    #   CPU writes spawn attributes into the ring buffer
                    #   (birth, world pos, vel, tint, kind params) via
                    #   partial buffer updates; vertex shader ages/moves/
                    #   fades/grows from uTime like Weather (no per-frame
                    #   CPU particle sim). Fragment: soft-disc alpha from
                    #   gl_PointCoord, LINEAR color, scene fog, brightness
                    #   modulated by dayCycleState ambient (cloudTint
                    #   precedent) so smoke does not glow at night.
                    #   Dust tint = colorAt(wheelX, wheelZ) lerped toward
                    #   white; splash tint from biome waterColor.
  skidMarks.ts      # NEW PURE: ring buffer of road-space quad segments.
                    #   Append rule (drifting && rear wheel grounded &&
                    #   moved > minStep), segment corners from wheel world
                    #   pos + right vector, age-fade math, capacity wrap.
  SkidMarks.ts      # NEW GL owner: one BufferGeometry quad strip per
                    #   field, layer 1 (terrain-space, Sobel-safe),
                    #   conformed to heightAt + normalAt with a small
                    #   normal offset + polygonOffset against z-fighting;
                    #   shader fades segments by age from uTime.
  Kart.ts           # exposes wheelWorldPos(i, out) (wheel rig world
                    #   position; rigs already exist for visual sync).
src/core/
  FieldBuilder.ts   # owns KartVfx + SkidMarks lifecycle (build/dispose,
                    #   mirrors minimap/audio wiring); respawnAhead adds
                    #   vfx.burst("poof", pos) next to onRespawn(); per-
                    #   frame emitter sampling from views+rivals state.
                    #   At 528 lines; wiring stays thin (<40 lines), else
                    #   the emitter-sampling block moves to kartVfx.ts.
  quality.ts        # per-tier knobs: vfxParticleBudget (low 512 /
                    #   medium 1536 / high 3072 total) + skidSegments
                    #   (low 256 / high 1024). Renderer.setQuality
                    #   forwards; KartVfx/SkidMarks resize on change.
src/terrain/
  Terrain.ts        # expose colorAt (already on the HeightSource the
                    #   chunks consume; getter forwarding only).
```

## Look targets (cel discipline)

- Dust: small, short-lived (0.4-0.8 s), terrain tint 60% toward white,
  low opacity; reads as kicked ground, not fog.
- Drift smoke: larger (grows over life), 0.8-1.4 s, warm white-gray,
  2-3 opacity steps down over life (quantized fade = cel banding, not a
  smooth alpha ramp - matches the posterized sky language).
- Splash: fast upward fan at water entry + low continuous spray while
  `inWater`; tint = biome `waterColor` toward white.
- Poof: single 12-16 particle burst at the respawn point, synced with the
  respawn audio cue.
- Skid marks: dark road-color multiply, ~6 s linear fade, only while
  drifting - a lap's story stays readable on the tarmac behind the pack.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(kart): pure kart VFX emitter + ring buffer core`
   - `kartVfx.ts` + tests: rate gating per kind, accumulator remainder,
     ring wrap/overwrite, budget split, seeded jitter determinism.
2. `feat(kart): GPU particle layer for dust, drift smoke, splash, poof`
   - `KartVfx.ts` + `Kart.wheelWorldPos` + `Terrain.colorAt` +
     FieldBuilder wiring incl. respawn burst. Tests: shader source
     (aging/fade expressions mirror the pure math), uniform defaults,
     attribute layout, dispose removes GL resources.
3. `feat(kart): drift skid marks with age fade`
   - `skidMarks.ts` (+tests: append rule, corner math, wrap, fade) +
     `SkidMarks.ts` + wiring.
4. `feat(core): quality-tier VFX budgets`
   - `quality.ts` knobs + resize paths + tests; low tier verified under
     F3 with a full 6-kart drift pile-up.
5. `docs: AGENTS refresh, trim concept 050 overlap, move 053`
   - `src/AGENTS.md` ownership lines; rewrite
     `concept/050_impact-particles.md` to its remaining contact-force
     sparks/debris scope (dust/smoke shipped here); 052 scene note (a
     `?scene=` drift still now covers VFX pixels).

## Risks

- Overdraw on low tier: big overlapping smoke sprites are fill-rate heavy.
  Mitigation: per-tier budget + max point size clamp (Weather clamps to
  32 px; smoke clamps higher but finite); F3 acceptance on low.
- Sky-posterize interplay: Weather forces depthWrite on transparent
  particles so they occlude the sky mask (documented in Weather.ts/039).
  Smoke near the horizon has the same failure mode -> follow the same
  documented depthWrite choice and note it for 039.
- Fixed-step vs render-frame: controller state changes at 60 Hz, emission
  runs per render frame. Mitigation: dt-accumulator emission (pure,
  tested); respawn burst keys off the respawnAhead choke point so
  teleports never leave a smoke trail across the map.
- Skid-mark z-fighting on slopes: offset along `normalAt` + polygonOffset;
  verify on alpine (steepest registered biome).
- 2P budget: both humans + 4 rivals emit; budget is per-field TOTAL and
  split by the pure helper, so 2P cannot double GPU cost.
- FieldBuilder headroom (528/600): wiring is bounded (<40 lines) with the
  sampling block in kartVfx.ts; if it still crowds the cap, land after
  046's extractions.

## Acceptance

- [x] Dust appears above 8 m/s on grounded wheels, tinted to the surface
      (emissionRate gates speed > 8 + grounded; spawnParticle blends terrain
      colorAt toward white). Per-biome visible difference still wants a live
      F3 drive.
- [x] Drift: smoke + skid marks while drifting only; marks fade in ~6 s
      (SKID_FADE_TIME = 6); no marks/smoke while airborne or in water
      (emissionRate + shouldAppendSkid gate; NaN sentinel resets on a gap).
- [x] Splash on water entry + spray while inWater, tinted per biome
      (emissionRate("splash") gates on inWater; tint = surfaceTint from
      terrain colorAt at the rear wheel).
- [x] Respawn poof at the respawn point, synced with the audio cue; no
      particle streaks across teleports (respawnAhead queues
      vfx.burst("poof", point) next to gameAudio.onRespawn()).
- [x] Zero per-frame allocation on the steady-state path (pooled ring
      buffers; partial GL buffer updates via addUpdateRange).
- [x] Budgets scale with quality tier (quality.ts vfxParticleBudget +
      skidSegments; FieldBuilder.setQuality + Game.setQuality). The "low
      tier holds 60 fps in a 6-kart drift cluster (F3 EWMA)" half still
      needs a live low-tier drive.
- [ ] Deterministic under fixed uTime (same seed + time -> same frame; a
      052 drift-scene still is stable). Motion keys on uTime so it is
      structurally sound, but no fixed-time test asserts it yet and 052
      stills are pending.
- [ ] Night: particles darken with dayCycle ambient (no glowing smoke).
      Both GL layers multiply by uAmbient from lightUniforms; needs a live
      night-lap verify.
- [x] All files <= 600 lines; `npm run verify` + hooks green (line caps
      hook-enforced; verify green at this commit).

## Verification

- F3 drive on temperate/desert/alpine/tundra: dust tint, drift smoke,
  skid fade, splash (alpine lakes), respawn poof, night lap for glow.
- 2P split-screen drift pile-up on low tier; watch calls/triangles + fps.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads 018 (inWater), 022 (pooling discipline), 025
(waterColor, biome parity untouched - VFX is state-driven, not biome
data). Follows 041's GPU-particle idiom. Composes with 052 (drift still
covers VFX pixels) and 046 (FieldBuilder headroom; land 046 first if
wiring crowds the cap). Overlaps concept 050 (impact particles): this
plan ships its wheel-dust/drift-smoke half; contact-force sparks/debris
(and speed lines/boost flames) stay in 050, trimmed during execution.
