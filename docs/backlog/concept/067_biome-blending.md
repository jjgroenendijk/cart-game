# 067 Spatial biome blending / multi-biome circuits

Status: open (concept - to be refined)

## Context

Today one biome owns the whole world (025 `selectBiome` picks a single
`BiomeDefinition` per seed). 055 ships the authoring kit + validator so
adding a biome is a safe data task, but the world stays single-biome. The
visually big follow-up is blending biome terrain/flora across a circuit so a
lap traverses distinct regions (foothills -> alpine -> tundra pass).

055's Non-goals defer this explicitly: blending needs the validation layer
to exist first (every blended region must still be drivable, readable,
registered, above water).

## Goal

Blend biome terrain + flora by region or along the track, so a single world
holds multiple biomes with readable transitions instead of hard seams.

## Needs refinement

- Blend model: per-region blend weights vs along-track banding vs a
  height-driven gradient (low=tropical, high=alpine). Decide which is the
  first cut.
- Terrain resolution: `biomeTerrain(def)` is single-biome today. Blending
  needs `terrainAt(x,z)` resolve a weighted cfg per sample -> rework
  `heightAt`/`colorAt` or layer multiple `HeightSource`s. Big seam.
- Flora: PropField/DressingChunkManager sample per-chunk props off one biome;
  multi-biome needs a region -> biome lookup at placement. 043's water
  reject + the per-chunk seed stay, but the biome per chunk changes.
- Cel band continuity: per-fragment world-normal-from-height-texture already
  keeps bands continuous across chunk seams; a blended terrain must keep
  colorAt continuous across a biome boundary (lerp the palettes? hard step?).
- Validator: each region's biome must pass `validateBiome`; the corridor
  crosses regions, so `DRIVE_GRADE` (today biome-independent) may need a
  per-segment biome lookup if blending perturbs on-track relief.
- Performance: per-sample biome resolution on the hot `heightAt` path.

## Depends on

055 (validator + archetypes must exist first). 025 (single-biome framework
being extended). 023 (per-chunk streaming the region lookup feeds).
Coordinate with OPEN 021 (colorAt continuity across blended palettes).
