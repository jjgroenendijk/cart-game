/**
 * Parameterized flora archetype library. Each archetype takes a config of
 * knobs and returns the same {build, big, collider} shape `registerFlora`
 * consumes, so a biome assembles its flora from data instead of hand-building
 * bespoke geometry. Builders live in family modules; this barrel is the
 * stable public surface biome flora modules import from:
 *
 *   trees.ts       -> coniferTree (stacked-cone spire), canopyTree (broadleaf)
 *   rocks.ts       -> ballRock (noisy dodeca)
 *   shrubs.ts      -> lumpyShrub (squashed ico)
 *   groundcover.ts -> groundDecor (grass blade / flower petal)
 *
 * All geometry is authored base-at-y=0 (PropField places the origin at
 * terrain height), deterministic from seed, and WebGL-free (jsdom-testable).
 * Decor builders ignore the seed arg (shared template for an InstancedMesh).
 */

export { coniferTree, canopyTree } from "./trees";
export type { ConiferTreeConfig, CanopyTreeConfig } from "./trees";
export { ballRock } from "./rocks";
export type { BallRockConfig } from "./rocks";
export { lumpyShrub } from "./shrubs";
export type { LumpyShrubConfig } from "./shrubs";
export { groundDecor } from "./groundcover";
export type { GroundDecorConfig } from "./groundcover";
