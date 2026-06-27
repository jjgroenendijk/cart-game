/**
 * 024 kart archetype registry. Six tunings + silhouettes + colorways define the
 * selectable variants. Pure + WebGL-free so unit tests run under jsdom. Stat
 * bar bounds are scanned once from the six tunings at module load; statBarsFor
 * normalizes any KartTuning against those bounds (divide-by-zero guarded).
 */

import { DEFAULT_TUNING, type KartTuning } from "./KartController";
import type { KartColors } from "./Kart";
import { makeRNG } from "../core/rng";

export type KartVariantId = "balanced" | "speed" | "grip" | "heavy" | "feather" | "trail";

export interface KartSilhouette {
  bodyDims: [w: number, h: number, d: number];
  tireRadius: number;
  noseZ: number;
  spoilerH: number;
}

export interface StatBars {
  speed: number;
  accel: number;
  grip: number;
  mass: number;
}

export interface KartVariant {
  id: KartVariantId;
  name: string;
  colors: KartColors;
  tuning: KartTuning;
  silhouette: KartSilhouette;
  statBars: StatBars;
}

interface VariantSpec {
  id: KartVariantId;
  name: string;
  colors: KartColors;
  tuning: KartTuning;
  silhouette: KartSilhouette;
}

const VARIANT_SPECS: VariantSpec[] = [
  {
    id: "balanced",
    name: "Balanced",
    colors: { body: 0xff5252, accent: 0xffd23f },
    tuning: { ...DEFAULT_TUNING },
    silhouette: { bodyDims: [1.1, 0.4, 1.9], tireRadius: 0.35, noseZ: -1.0, spoilerH: 0.06 },
  },
  {
    id: "speed",
    name: "Speedster",
    colors: { body: 0x4fc3f7, accent: 0xffffff },
    tuning: {
      ...DEFAULT_TUNING,
      maxSpeed: 39,
      engineForce: 8200,
      grip: 8.5,
      mass: 270,
      maxSteerRate: 2.4,
      topSpeedSteerFactor: 0.6,
      driftBoost: 1.14,
    },
    silhouette: { bodyDims: [1.1, 0.42, 2.1], tireRadius: 0.35, noseZ: -1.15, spoilerH: 0.14 },
  },
  {
    id: "grip",
    name: "Grip",
    colors: { body: 0x66bb6a, accent: 0x222222 },
    tuning: {
      ...DEFAULT_TUNING,
      maxSpeed: 30,
      engineForce: 10500,
      grip: 11.5,
      driftGrip: 2.0,
      mass: 250,
      maxSteerRate: 2.9,
      brakeForce: 12500,
    },
    silhouette: { bodyDims: [1.05, 0.38, 1.7], tireRadius: 0.34, noseZ: -0.9, spoilerH: 0.03 },
  },
  {
    id: "heavy",
    name: "Heavy",
    colors: { body: 0xab47bc, accent: 0xffd23f },
    tuning: {
      ...DEFAULT_TUNING,
      mass: 340,
      maxSpeed: 32,
      engineForce: 9400,
      grip: 10.5,
      driftGrip: 1.9,
      maxSteerRate: 2.3,
      uprightTorque: 34,
    },
    silhouette: { bodyDims: [1.3, 0.45, 1.95], tireRadius: 0.42, noseZ: -1.0, spoilerH: 0.08 },
  },
  {
    id: "feather",
    name: "Feather",
    colors: { body: 0xff9800, accent: 0xfff3e0 },
    tuning: {
      ...DEFAULT_TUNING,
      mass: 200,
      maxSpeed: 33,
      engineForce: 8800,
      grip: 8.8,
      driftGrip: 1.3,
      maxSteerRate: 3.0,
      driftBoost: 1.18,
      uprightTorque: 22,
    },
    silhouette: { bodyDims: [0.95, 0.38, 1.8], tireRadius: 0.3, noseZ: -0.95, spoilerH: 0.05 },
  },
  {
    id: "trail",
    name: "Trailblazer",
    colors: { body: 0x26a69a, accent: 0xc6ff00 },
    tuning: {
      ...DEFAULT_TUNING,
      mass: 280,
      maxSpeed: 33,
      engineForce: 9200,
      grip: 9.0,
      suspensionStiffness: 30000,
      suspensionDamping: 3000,
      suspensionTravel: 0.4,
      wheelRadius: 0.42,
    },
    silhouette: { bodyDims: [1.15, 0.5, 1.9], tireRadius: 0.46, noseZ: -1.0, spoilerH: 0.07 },
  },
];

function boundsOf(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

const SPEED_BOUNDS = boundsOf(VARIANT_SPECS.map((s) => s.tuning.maxSpeed));
const ACCEL_BOUNDS = boundsOf(VARIANT_SPECS.map((s) => s.tuning.engineForce));
const GRIP_BOUNDS = boundsOf(VARIANT_SPECS.map((s) => s.tuning.grip));
const MASS_BOUNDS = boundsOf(VARIANT_SPECS.map((s) => s.tuning.mass));

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

export const KART_VARIANTS: KartVariant[] = VARIANT_SPECS.map((s) => ({
  ...s,
  statBars: statBarsFor(s.tuning),
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
