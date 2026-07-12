/**
 * Kart model framework types. A kart model is fully described by one
 * KartModelDef living in its own file under src/kart/models/; the registry
 * (index.ts) collects them. Adding a kart = new def file + one id in
 * KartVariantId + one entry in the KART_MODELS array. Everything else
 * (variants, select overlay, rivals, preview) derives from the registry.
 */

import type * as THREE from "three";
import type { KartTuning } from "../KartController";
import type { KartColorwayId } from "../kartColorways";

export type KartVariantId =
  "balanced" | "speed" | "grip" | "heavy" | "feather" | "trail" | "lancia";

/** Coarse body proportions shared by chassis builders + spawn clearance. */
export interface KartSilhouette {
  bodyDims: [w: number, h: number, d: number];
  tireRadius: number;
  noseZ: number;
  spoilerH: number;
}

export interface WheelOffset {
  x: number;
  y: number;
  z: number;
}

/** Materials + target group a chassis builder works with. Builders take
 *  materials from the caller so a colorway repaint never touches geometry. */
export interface KartBodyCtx {
  group: THREE.Group;
  bodyMat: THREE.Material;
  accentMat: THREE.Material;
  darkMat: THREE.Material;
  silhouette: KartSilhouette;
}

/** One selectable kart, fully self-contained in its model file. */
export interface KartModelDef {
  id: KartVariantId;
  /** Display name (select overlay heading). */
  name: string;
  /** Stock paint: the kartColorways id this model ships in. */
  colorway: KartColorwayId;
  /** Physics tuning (KartController). */
  tuning: KartTuning;
  silhouette: KartSilhouette;
  /**
   * Wheel stance: local wheel offsets, order front-L, front-R, rear-L,
   * rear-R (front pair steers). y stays -0.35 everywhere: Kart.sync's
   * suspension bounce (`-0.35 + compression * 0.5`) hardcodes that base.
   */
  stance: ReadonlyArray<WheelOffset>;
  /**
   * When true the chassis mesh already includes its own wheels, so the shared
   * visual builder skips the four procedural wheel rigs (physics still uses
   * `stance` for suspension raycasts / VFX contact points). Used by imported
   * meshes; procedural karts leave it unset.
   */
  ownWheels?: boolean;
  /** Build the chassis (everything above the axles) into ctx.group. */
  build(ctx: KartBodyCtx): void;
}
