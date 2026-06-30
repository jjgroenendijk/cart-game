# 043 Flora placement avoids water

Status: open (concept - to be refined)

## Context

Discovered during 028 alpine work: alpine has cold mountain lakes
(`waterLevel: -5`), so terrain beds sit below the water surface. Prop
placement has NO water check. `propSampler.tryCandidateAt` rejects only on
corridor/spawn/slope (`propSampler.ts:202`), then pins the prop at
`y = heightAt(x, z)` (`propSampler.ts:220`). A candidate whose terrain
height is below `waterLevel` spawns a fully submerged tree/rock.

Affects every biome where water sits near or above the terrain floor:
alpine lakes (028), future swamp (OPEN 029), beach (033), tropical (030),
mediterranean (034). Temparate + desert are unaffected (desert waterLevel
-100; temperate default sandLevel).

## Goal

Flora (big + decor) is never placed below the biome water level: no pines
growing out of lakes, no bushes on a lake bed. Placement stays seeded +
deterministic; no visual pop-in from late skips.

## Needs refinement

- Gate location: `tryCandidateAt` reject (cleanest, single point) vs a
  PropField post-filter. Reject is cheaper + keeps determinism.
- `SamplerTerrain` interface (`propSampler.ts:10`) exposes only
  `heightAt/normalAt/spline`. Needs a `waterLevel` field threaded from the
  biome/Terrain so the sampler can compare without a new dep.
- Reject test: `heightAt(x, z) < waterLevel - epsilon`? Epsilon so a
  waterline rock/bush can still sit at the shore (per-kind policy: rocks
  in shallow shore water may be desirable -> decide shore tolerance).
- RNG parity: a water reject MUST consume no scale/seed rng, mirroring the
  existing reject rule (`propSampler.ts:198-200`) so seeds stay stable.
- Decor InstancedMesh count is fixed per kind; water rejects lower the
  drawn count, not the buffer size (already the case for slope rejects).

## Depends on

025 (flora + dressing framework, the sampler). 028 (alpine lakes surfaced
it). Coordinate with OPEN 029 (swamp) where water is central to the look.
