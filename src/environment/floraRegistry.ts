import type { BuiltProp } from "./propFactory";

/**
 * Flora kind name; a plain string so biomes register cactus/pine/palm/etc.
 * without union churn. Resolved at build time via this registry.
 */
export type FloraKind = string;

/**
 * Collider recipe a big flora kind contributes. Decor kinds use "none" and
 * get no Rapier body. Cylinder is centred on the body origin; ball derives
 * its radius from the same per-seed value the visual uses so the collider
 * tracks the visible bulk (see rockRadius/ROCK_BURY parity).
 */
export type FloraCollider =
  | { shape: "cylinder"; halfHeight: number; radius: number }
  | { shape: "ball"; radius: (seed: number) => number; bury?: number }
  | { shape: "none" };

/**
 * Build contract for one flora kind. Big props get Rapier bodies + merged
 * buckets; decor get an InstancedMesh, no collider.
 */
export interface FloraBuilder {
  /** Build geometry+material for one instance from a seed (big) or shared template (decor). */
  build(seed: number): BuiltProp;
  /** Big -> Rapier body + merged buckets; decor -> InstancedMesh, no collider. */
  big: boolean;
  collider: FloraCollider;
}

const registry = new Map<FloraKind, FloraBuilder>();

/**
 * Register a flora kind. Idempotent: re-registering the same kind overwrites
 * the previous builder so a biome module can be re-imported without leaking
 * stale entries.
 */
export function registerFlora(kind: FloraKind, builder: FloraBuilder): void {
  registry.set(kind, builder);
}

/** Look up a kind; throws a clear Error if unregistered so a typo fails loudly. */
export function floraFor(kind: FloraKind): FloraBuilder {
  const b = registry.get(kind);
  if (!b) throw new Error(`floraRegistry: unknown flora kind "${kind}"`);
  return b;
}

export function isRegisteredFlora(kind: FloraKind): boolean {
  return registry.has(kind);
}

/** All registered kinds, in insertion order (first-registered first). */
export function registeredFloraKinds(): readonly FloraKind[] {
  return [...registry.keys()];
}
