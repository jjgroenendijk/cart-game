# 010 Dynamic world

Status: open (concept — to be refined)

## Context

Bundles four deferred "living world" extensions from 001-006, all
atmosphere/physics polish on top of the static shipped world:

- time-of-day cycle — `002:69,129` (fixed sun, out of scope)
- weather particles (rain/snow) — `004:42`
- ambient wildlife — `004:42`
- water buoyancy — `004:42,185` (water is visual-only; kart drives through)

Grouped because all four animate the static 002 sky / 004 environment over
time and share a per-frame `update(dt, time)` driver. Splitting would
duplicate the time + param-broadcast plumbing 001's `lightUniforms` /
`Renderer.update` already start.

## Goal

- Time-of-day: animated sun arc (elevation+azimuth over a day cycle) feeding
  001's `lightUniforms.sunDir`; 002 sky + posterize + fog retune per phase
  (dawn/day/dusk/night). Optional day length + time scale.
- Weather: particle system(s) for rain/snow, wind direction, visibility/fog
  shift. Kart unaffected physically (visual) unless 005 ties audio (rain bed).
- Wildlife: ambient non-interactive critters (birds, etc.) — instanced,
  no colliders, no gameplay.
- Water buoyancy: physics response on the 004 water plane — kart floats/sinks
  (drag + buoyant force), replaces current drive-through behavior.

## Non-goals

- Seasons as full system (weather presets only)
- Storm/lightning gameplay effects
- Fishable/huntable wildlife (ambient only)
- Fluid simulation (buoyancy = simplified forces, not SPH)
- Per-track climate (single world climate)

## Dependencies

002 (sky + fog + lightUniforms consumer). 004 (water plane, env group,
dispose precedent). 005 (weather/rain audio bed — soft). 001 (lightUniforms).
003 (heightmap for weather/wildlife placement). Buoyancy needs Rapier forces
on kart RigidBody.

## Needs refinement

- Should this stay one item or split (dynamic sky vs world-life vs buoyancy)?
  Buoyancy is physics, not atmosphere — candidate to split out if it grows
- Day length default + whether cycle is continuous or scripted
- Night lighting: does 001 cel shader need a night palette / emissive pass?
- Buoyancy vs kart arcade feel: sinking kart = frustration; decide forgiveness
- Weather toggle: random over time vs fixed per session vs menu-driven (012)
- Performance: weather particles + wildlife add to 011 LOD/perf budget
