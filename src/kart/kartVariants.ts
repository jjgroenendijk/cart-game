/**
 * 024 kart archetype registry, derived from the per-model files in
 * src/kart/models/ (one KartModelDef per kart: name, tuning, silhouette,
 * stance, chassis builder, stock colorway). This module adds the derived
 * presentation bits: resolved stock colors and normalized stat bars. Pure +
 * WebGL-free so unit tests run under jsdom. Stat bar bounds are scanned once
 * from the registered tunings at module load; statBarsFor normalizes any
 * KartTuning against those bounds (divide-by-zero guarded).
 */

import type { KartTuning } from "./KartController";
import type { KartColors } from "./Kart";
import { colorwayById, type KartColorwayId } from "./kartColorways";
import { KART_MODELS } from "./models";
import { makeRNG } from "../core/rng";

export type { KartSilhouette, KartVariantId } from "./models";
import type { KartSilhouette, KartVariantId } from "./models";

export interface StatBars {
  speed: number;
  accel: number;
  grip: number;
  mass: number;
}

export interface KartVariant {
  id: KartVariantId;
  name: string;
  /** Stock paint: the colorway this model ships in (083). */
  colorway: KartColorwayId;
  /** Resolved stock colors (colorwayById(colorway).colors), kept for callers. */
  colors: KartColors;
  tuning: KartTuning;
  silhouette: KartSilhouette;
  statBars: StatBars;
}

function boundsOf(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

const SPEED_BOUNDS = boundsOf(KART_MODELS.map((m) => m.tuning.maxSpeed));
const ACCEL_BOUNDS = boundsOf(KART_MODELS.map((m) => m.tuning.engineForce));
const GRIP_BOUNDS = boundsOf(KART_MODELS.map((m) => m.tuning.grip));
const MASS_BOUNDS = boundsOf(KART_MODELS.map((m) => m.tuning.mass));

function norm(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return (value - min) / (max - min);
}

export function statBarsFor(tuning: KartTuning): StatBars {
  return {
    speed: norm(tuning.maxSpeed, ...SPEED_BOUNDS),
    accel: norm(tuning.engineForce, ...ACCEL_BOUNDS),
    grip: norm(tuning.grip, ...GRIP_BOUNDS),
    mass: 1 - norm(tuning.mass, ...MASS_BOUNDS),
  };
}

export const KART_VARIANTS: KartVariant[] = KART_MODELS.map((m) => ({
  id: m.id,
  name: m.name,
  colorway: m.colorway,
  colors: colorwayById(m.colorway).colors,
  tuning: m.tuning,
  silhouette: m.silhouette,
  statBars: statBarsFor(m.tuning),
}));

export function variantForRival(seed: number, index: number): KartVariantId {
  const rng = makeRNG((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  return rng.pick(KART_VARIANTS).id;
}

export function variantById(id: KartVariantId): KartVariant {
  const v = KART_VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`variantById: unknown variant id "${id}"`);
  return v;
}
