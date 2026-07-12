import * as THREE from "three";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Ground-cover archetypes (split from the single archetypes.ts module; see
 * `./archetypes.ts` for the library overview). Moved verbatim: same knobs,
 * same geometry.
 *
 *   groundDecor -> grass (blade) / flower (petal)
 *
 * Decor builders ignore the seed arg (shared template for an InstancedMesh) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Flat ground decor: crossed blades or stem+petal. Decor, collider none. */
export interface GroundDecorConfig {
  /** "blade" = crossed planes (grass); "petal" = stem + petal blobs. */
  mode?: "blade" | "petal";
  /** Blade or stem height. */
  h?: number;
  /** Blade or petal count (defaults: blade 3, petal 1). */
  count?: number;
  /** Color palette; blades/petals cycle through it by index. */
  palette?: readonly number[];
  /** Stem color (petal mode only). */
  stemColor?: number;
}

/**
 * Flat ground decor. "blade" = crossed PlaneGeometry blades (grass);
 * "petal" = stem cylinder + icosahedron petal blobs (flower). Decor
 * (big=false), collider none. Shared template — ignores seed.
 */
export function groundDecor(cfg: GroundDecorConfig = {}): FloraBuilder {
  const mode = cfg.mode ?? "blade";
  const h = cfg.h ?? 0.5;
  const palette = cfg.palette ?? [0x5b8a42];
  const stemColor = cfg.stemColor ?? 0x4f7a3a;
  // Petal mode is heavier (stem + ico blobs); default to 1 bloom so the
  // decor triangle budget (<= 60) holds. Blade mode defaults to 3 blades.
  const count = cfg.count ?? (mode === "blade" ? 3 : 1);

  const build = (): BuiltProp =>
    buildOnce(
      () => {
        const parts: THREE.BufferGeometry[] = [];
        if (mode === "blade") {
          // Crossed plane blades (like grass); each rotated around Y.
          const w = 0.08;
          for (let i = 0; i < count; i++) {
            const blade = new THREE.PlaneGeometry(w, h);
            blade.translate(0, h / 2, 0);
            blade.rotateY((i / count) * Math.PI);
            parts.push(prepPart(blade, palette[i % palette.length]!));
          }
        } else {
          // Stem + petal blobs (like a flower). count=1 centres a single
          // bloom; count>1 rings petals around the stem top.
          const stem = new THREE.CylinderGeometry(0.03, 0.04, h, 4);
          stem.translate(0, h / 2, 0);
          parts.push(prepPart(stem, stemColor));
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2;
            const rad = count > 1 ? 0.12 : 0;
            const petal = new THREE.IcosahedronGeometry(0.14, 0);
            petal.translate(Math.cos(ang) * rad, h + 0.05, Math.sin(ang) * rad);
            parts.push(prepPart(petal, palette[i % palette.length]!));
          }
        }
        return mergeOrFirst(parts);
      },
      { vertexColors: true },
    );

  return { build, big: false, collider: { shape: "none" } };
}
