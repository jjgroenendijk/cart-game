# 041 Weather GPU particle motion

Status: open (concept - to be refined)

## Context

Split from 022 (perf pass), Phase 5.4. Weather (`environment/Weather.ts`)
runs a 1500-particle CPU loop + full position-buffer re-upload every frame
(update: positions += velocities\*dt, wrap X/Z around the world box + Y
ground->ceiling, then attr.needsUpdate=true).

Phase 5.4 was deferred: a partial/dirty-range upload does NOT help (all
1500 particles move every frame -> the whole buffer is dirty). The real
win is GPU-shader motion (upload initial positions + velocities once,
advance in the vertex shader by uTime with wrap). That needs a custom
shader with manual fog parity vs the current PointsMaterial (fog built in)
-> unverifiable headless.

## Goal

Eliminate the per-frame CPU particle loop + full buffer re-upload for
rain/snow.

## Needs refinement

- Vertex-shader motion: pos = base + vel\*uTime with sawtooth wrap matching
  the CPU wrap semantics (Y ground->ceiling, X/Z around +-worldHalf).
  Confirm the mod/wrap matches the per-frame CPU wrap visually.
- Fog: PointsMaterial applies scene fog automatically; a custom
  ShaderMaterial must replicate fogColor/fogNear/fogFar mix exactly (or use
  three's fog chunks via fog:true) -> visual parity check needed.
- Wind + snow drift jitter: currently per-particle constant velocity; a
  shader handles constant velocity fine, but any time-varying jitter would
  need noise in the shader.
- Keep the clear-preset no-op fast path (Weather builds nothing for clear).
- Needs browser visual verify (motion + fog parity).

## Depends on

010 (weather presets + fog patching; Weather reads dayCycleState fog each
frame). 022 (deferred here). Independent of 001/003/etc.
