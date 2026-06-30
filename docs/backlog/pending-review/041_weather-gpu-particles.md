# 041 Weather GPU particle motion

Status: pending-review (implemented; integrated with 025 presets; awaiting review)

## Context

Split from 022 (perf pass), Phase 5.4. `environment/Weather.ts` runs a
1500-particle CPU loop + a full position-buffer re-upload every frame
(`update`: `positions += velocities*dt`, wrap X/Z around the world box +
Y ground->ceiling, then `attr.needsUpdate = true`). Every particle moves
every frame, so the whole buffer is always dirty: a partial/dirty-range
upload (the original 5.4 idea) cannot help.

The real win is GPU-shader motion: upload base positions + velocities
once, advance in the vertex shader by a monotonic `uTime` with stateless
wrap. This drops the per-frame CPU loop + the 1500\*3 float re-upload.

The blocker called out in the stub was fog parity: the current
`PointsMaterial` applies scene fog automatically, while a raw
`ShaderMaterial` does not. The repo already solved exactly this for water
in `materials/celWater.ts`: `fog:true` + manually declared `fogColor`/
`fogNear`/`fogFar` uniforms, with the renderer pushing scene-fog values
into those locations each frame, and a `smoothstep(fogNear, fogFar,
-vViewPos.z)` mix. This plan reuses that proven pattern.

## Scope

Closes the 022 Phase 5.4 deferral. Replace the CPU particle loop with
GPU vertex-shader motion for rain + snow. In scope:

- Stateless vertex-shader advance: `pos = advance(base, vel, uTime)` with
  wrap matching the CPU wrap visually (Y ground->ceiling reset, X/Z
  around +-worldHalf).
- Fog parity via a raw `ShaderMaterial` using the `celWater` fog pattern.
- Perspective point-size attenuation without renderer plumbing.
- Keep the `clear`-preset no-op fast path (Weather builds nothing).
- Keep the existing fog patch + follow-focus behavior.

Not in scope:

- Time-varying per-particle jitter (current velocities are constant per
  particle, set at build time; constant velocity maps to the shader 1:1).
  Any future wind-gust noise would need shader noise; documented, not
  done here.
- Changing weather preset weights, fog factors, or the day-cycle cascade
  order (Environment: sky-first-then-weather).
- A moonlight caster or shadow changes (038 owns shadow fade).

## Goal

Rain/snow particle motion + wrap runs entirely on the GPU. The CPU loop
and per-frame buffer re-upload are gone. Visual parity (motion, wrap,
fog fade, point size) with the current field, verified in-browser.

## Architecture (change)

```text
src/environment/
  Weather.ts        # add exported pure advancePosition() helper
                    #   (stateless GPU wrap math; WebGL-free, unit-tested).
                    # buildField: replace PointsMaterial with a raw
                    #   ShaderMaterial (fog:true + manual fog uniforms,
                    #   mirroring materials/celWater.ts). Geometry carries
                    #   a `velocity` attribute uploaded once; the static
                    #   `position` attribute is the base layout uploaded
                    #   once (never re-uploaded).
                    # uniforms: uTime, uHalf, uCeiling, uSize, uSizeRange,
                    #   uOpacity, uColor, fogColor, fogNear, fogFar.
                    # vertex shader: advance position via the same wrap as
                    #   advancePosition(); gl_PointSize with perspective
                    #   attenuation; project.
                    # fragment shader: uColor * uOpacity, then USE_FOG
                    #   smoothstep mix (celWater parity).
                    # update(): advance uTime accumulator only; set group
                    #   follow-focus; patchFog(). NO loop, NO needsUpdate.
                    # dispose(): geo + material dispose (unchanged).
  Weather.test.ts   # pure helper tests; shader-source assertions
                    #   (wrap GLSL, fog mix, gl_PointSize); uniform
                    #   defaults incl fog:true; upload-once invariant
                    #   (position buffer not mutated by update);
                    #   determinism (seed -> same base + velocity); fog
                    #   patch + follow-focus + clear no-op retained.
```

No new files. Weather.ts stays well under the 600-line cap (~215 today,
~+90 for shader strings + helper). All source lines <= 100 chars.

## Wrap math (stateless, GPU-equivalent)

The CPU teleports on overflow (`pos > half -> -half`, dropping overshoot;
`pos.y < 0 -> ceiling`). A stateless time-only function cannot replay that
overshoot-loss exactly, so this uses continuous mod wrap, which is visually
equivalent for a precipitation field (the concept flagged this as needing
visual verify, not bit-exact parity). Exported pure helper
`advancePosition(base, vel, t, half, ceiling)` returns `{x,y,z}`:

```text
span = 2 * half
x = mod(base.x + vel.x*t + half, span) - half   # XZ bidirectional wrap
z = mod(base.z + vel.z*t + half, span) - half
fall = (ceiling - base.y) + (-vel.y) * t          # Y: descend phase
y = ceiling - mod(fall, ceiling)                  # reset to ceiling at ground
```

`mod` is always-positive (JS `((v % s) + s) % s`). Builder guarantees
`base.y` in `[0, ceiling]` and `vel.y < 0`, so the Y form is well-defined.
The vertex shader mirrors these three expressions verbatim (tested via
shader-source assertion). Overshoot-loss vs continuous-wrap difference is
imperceptible and noted in the helper doc.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `perf(weather): add pure GPU particle advance helper`
   - Weather.ts: export `advancePosition()` (stateless wrap math above).
   - Weather.test.ts: helper tests (XZ bidirectional wrap, Y ceiling
     reset, periodicity, t=0 -> base, determinism). Exported fn is
     self-consistent + green on its own (no GL).

2. `perf(weather): move particle motion to GPU shader`
   - Weather.ts buildField: raw ShaderMaterial (fog:true + manual fog
     uniforms, celWater pattern), `velocity` attribute, uniforms (uTime,
     uHalf, uCeiling, uSize, uOpacity, uColor, fog*). Vertex shader
     advances + wraps via the same math as `advancePosition()`; fragment
     shader does uColor*uOpacity then fog mix. gl_PointSize with
     perspective attenuation.
   - update(): advance uTime accumulator; follow-focus; patchFog(); no
     loop, no needsUpdate. Clear fast path unchanged.
   - Weather.test.ts rewritten: shader-source assertions (wrap, fog mix,
     gl_PointSize), uniform defaults, fog:true, layer 0, depthWrite false;
     upload-once invariant (position buffer unchanged across update);
     uTime advances by dt; fog patch + follow-focus + clear no-op; seed
     determinism for base + velocity. Closes the 022 Phase 5.4 deferral.

## Risks

- Fog look mismatch vs the old PointsMaterial. Mitigated: reuses the
  exact celWater fog pattern already shipping + fog:true pushes live
  scene-fog values each frame. Browser visual verify.
- Point size differs from PointsMaterial sizeAttenuation (which uses a
  renderer-supplied `scale` uniform unavailable to a raw ShaderMaterial).
  Mitigated: perspective attenuation via `gl_PointSize = uSize *
(uRange / -mvPos.z)` clamped; uRange/uSize tuned in-browser. Tests
  assert the formula is present, not the pixel size.
- Continuous-wrap vs CPU overshoot-loss wrap. Imperceptible for a field;
  documented in the helper. Visual verify.
- uTime float precision over very long sessions. Mitigated: accumulate
  dt (starts 0); wrap math stays accurate well past any session length.
- Raw ShaderMaterial custom `velocity` attribute: three defines
  `#define attribute in` for WebGL2, so `attribute vec3 velocity;` works
  across both (same path celWater relies on for `varying`). No risk.

## Acceptance

- [ ] Rain/snow motion + wrap run on the GPU; `update()` has no particle
      loop and never sets `positionAttr.needsUpdate` (upload-once).
- [ ] Vertex-shader wrap matches `advancePosition()`; fog fade matches
      celWater parity (asserted in shader source + unit tests).
- [ ] `clear` preset still builds nothing; `update()` early-returns; no
      regression vs today.
- [ ] Fog patch + follow-focus behavior unchanged (fog near/far/color
      shift; group follows focusX/Z).
- [ ] Seed determinism holds for base positions + velocities.
- [ ] All touched files <= 600 lines, lines <= 100 chars; typecheck +
      lint + test + hook green; `npm run verify` clean.

## Verification

Browser (dev server): spawn rain + snow (force preset via
`new Weather({ preset })` or a seeded pick), confirm:

- Particles fall + drift + wrap with no visible seam; field never
  depletes; no per-frame hitch vs the CPU version (StatsHud F3).
- Distant particles fade into scene fog identically to the old field
  (fog parity).
- Point size shrinks with distance (attenuation) and looks close to the
  old PointsMaterial field.
- Clear preset: no particles, no cost.

## Depends on

010 (weather presets + fog patching; Weather reads dayCycleState fog each
frame). 022 (deferred here). celWater fog pattern (materials/celWater.ts).
Independent of 001/003/038.
