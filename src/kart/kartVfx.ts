/**
 * Pure kart action-VFX emitter + ring-buffer core (053 commit 1). No THREE,
 * Rapier, WebGL, or DOM: jsdom-testable math the GL owner (commit 2,
 * KartVfx.ts) consumes. Mirrors Weather.ts advancePosition — the GPU shader
 * mirrors spawnParticle's velocity/tint expressions verbatim. Emission is
 * dt-accumulated; poof is a caller-driven burst (rate 0). Particles live in
 * a fixed-capacity ring; budgets split across N karts.
 */

export type EmitterKind = "dust" | "driftSmoke" | "splash" | "poof";

/** Inputs that gate emission (read off a KartController at runtime). */
export interface EmissionInputs {
  speed: number; // m/s, signed forward speed
  grounded: boolean; // any wheel grounded
  isDrifting: boolean; // controller.isDrifting
  inWater: boolean; // controller.inWater
}

/** Per-kind visual/lifetime params (used by spawn + GL owner; pure data). */
export interface EmitterParams {
  life: [number, number]; // seconds [min,max]
  size: [number, number]; // world units start [min,max]
  growth: number; // multiplier over life (smoke grows)
  speed: [number, number]; // initial outward speed m/s [min,max]
  rise: number; // +y velocity m/s added
  quantizedFadeSteps: number; // cel-banded fade: 0 = smooth, N = bands
}

/** Look targets (053): dust short+small; driftSmoke longer+grows+quantized;
 *  splash fast upward fan; poof expanding burst. Pure data. */
export const EMITTER_PARAMS: Record<EmitterKind, EmitterParams> = {
  dust: {
    life: [0.4, 0.8],
    size: [0.06, 0.12],
    growth: 1.4,
    speed: [0.5, 1.5],
    rise: 0.6,
    quantizedFadeSteps: 0,
  },
  driftSmoke: {
    life: [0.8, 1.4],
    size: [0.25, 0.45],
    growth: 2.2,
    speed: [0.3, 0.9],
    rise: 1.2,
    quantizedFadeSteps: 3,
  },
  splash: {
    life: [0.3, 0.6],
    size: [0.05, 0.12],
    growth: 1.0,
    speed: [2.0, 4.0],
    rise: 3.0,
    quantizedFadeSteps: 0,
  },
  poof: {
    life: [0.4, 0.7],
    size: [0.15, 0.3],
    growth: 2.5,
    speed: [2.5, 4.5],
    rise: 0.8,
    quantizedFadeSteps: 2,
  },
};

const DUST_SPEED_MIN = 8; // m/s kick-off threshold
const DUST_RATE_SLOPE = 2.0; // particles/sec per m/s above threshold
const DUST_RATE_MAX = 80; // cap so a speed spike cannot flood the ring
const DRIFT_SMOKE_RATE = 30; // particles/sec while drifting (flat)
const SPLASH_RATE = 16; // particles/sec continuous spray while inWater

/** Particles/sec for a kind. poof is a burst API (rate 0). Dust ~linear
 *  above 8 m/s (grounded); driftSmoke flat while drifting&&grounded; splash
 *  low spray while inWater. */
export function emissionRate(kind: EmitterKind, s: EmissionInputs): number {
  switch (kind) {
    case "dust":
      if (!s.grounded || s.speed <= DUST_SPEED_MIN) return 0;
      return Math.min(DUST_RATE_MAX, DUST_RATE_SLOPE * (s.speed - DUST_SPEED_MIN));
    case "driftSmoke":
      return s.isDrifting && s.grounded ? DRIFT_SMOKE_RATE : 0;
    case "splash":
      return s.inWater ? SPLASH_RATE : 0;
    case "poof":
      return 0;
  }
}

export interface SpawnAccumulator {
  remainder: number;
}

/** Advance by dt: folds rate*dt into the carried remainder, returns the
 *  floor as this frame's spawn count, keeps the fraction on `state`. Pure:
 *  same (state, rate, dt) -> same count + mutated remainder. Clamped >= 0. */
export function accumulateSpawns(state: SpawnAccumulator, rate: number, dt: number): number {
  const next = state.remainder + rate * dt;
  const clamped = next > 0 ? next : 0;
  const count = Math.floor(clamped);
  state.remainder = clamped - count;
  return count;
}

/** Ring buffer cursor (capacity, wrap, oldest-overwrite); caller owns arrays. */
export interface RingCursor {
  capacity: number;
  head: number;
  count: number;
}

export function makeRing(capacity: number): RingCursor {
  const cap = Math.max(1, Math.floor(capacity));
  return { capacity: cap, head: 0, count: 0 };
}

/** Push one entry: returns the index written; wraps + overwrites the oldest
 *  slot once full. head advances (mod capacity); count caps at capacity. */
export function ringPush(cur: RingCursor): number {
  const idx = cur.head;
  cur.head = (cur.head + 1) % cur.capacity;
  if (cur.count < cur.capacity) cur.count += 1;
  return idx;
}

export function ringReset(cur: RingCursor): void {
  cur.head = 0;
  cur.count = 0;
}

/** Per-tier particle budget TOTAL across the field (low/med/high). */
export type VfxBudgetTier = "low" | "med" | "high";

export const VFX_BUDGET: Record<VfxBudgetTier, number> = {
  low: 512,
  med: 1536,
  high: 3072,
};

/** Equal-share floor every kart is guaranteed (total/kartCount). 0 when
 *  kartCount <= 0. The GL owner adds the remainder via budgetSplit. */
export function budgetPerKart(tier: VfxBudgetTier, kartCount: number): number {
  if (kartCount <= 0) return 0;
  return Math.floor(VFX_BUDGET[tier] / kartCount);
}

/** Full per-kart allocation: floor to every kart, remainder spread +1 across
 *  the first k slots so the sum is bit-exact. low/6 -> [86,86,85,85,85,85]. */
export function budgetSplit(tier: VfxBudgetTier, kartCount: number): number[] {
  if (kartCount <= 0) return [];
  const total = VFX_BUDGET[tier];
  const base = Math.floor(total / kartCount);
  const extra = total - base * kartCount;
  const out = new Array<number>(kartCount).fill(base);
  for (let i = 0; i < extra; i++) out[i] += 1;
  return out;
}

/** Spawn descriptor for a single particle (pure data; GL owner fills attrs). */
export interface SpawnedParticle {
  kind: EmitterKind;
  birth: number; // uTime at spawn
  x: number;
  y: number;
  z: number; // world spawn pos
  vx: number;
  vy: number;
  vz: number;
  life: number; // seconds
  sizeStart: number;
  growth: number;
  tintR: number;
  tintG: number;
  tintB: number; // LINEAR rgb 0..1
  fadeSteps: number;
}

const TWO_PI = Math.PI * 2;
const DUST_TINT_TOWARD_WHITE = 0.6;
const WHITE = { r: 1, g: 1, b: 1 };
const DRIFT_SMOKE_TINT = { r: 0.82, g: 0.79, b: 0.74 };
const POOF_TINT = { r: 0.92, g: 0.89, b: 0.82 };
const DUST_DEFAULT_TINT = { r: 0.6, g: 0.55, b: 0.45 };
const SPLASH_DEFAULT_TINT = { r: 0.7, g: 0.8, b: 0.85 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

function kindTint(
  kind: EmitterKind,
  surfaceTint?: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  switch (kind) {
    case "dust":
      return lerpColor(surfaceTint ?? DUST_DEFAULT_TINT, WHITE, DUST_TINT_TOWARD_WHITE);
    case "driftSmoke":
      return DRIFT_SMOKE_TINT;
    case "splash":
      return surfaceTint ?? SPLASH_DEFAULT_TINT;
    case "poof":
      return POOF_TINT;
  }
}

/** Build one SpawnedParticle from a kind + world pos + uTime + a seeded RNG.
 *  Pure: same (kind, pos, time, rng draw sequence) -> same output.
 *  `surfaceTint` (LINEAR rgb 0..1, colorAt/waterColor) blends toward white by
 *  the kind factor (dust 60%); splash verbatim; driftSmoke+poof ignore it. */
export function spawnParticle(
  kind: EmitterKind,
  pos: { x: number; y: number; z: number },
  time: number,
  rng: () => number,
  surfaceTint?: { r: number; g: number; b: number },
): SpawnedParticle {
  const p = EMITTER_PARAMS[kind];
  const life = lerp(p.life[0], p.life[1], rng());
  const sizeStart = lerp(p.size[0], p.size[1], rng());
  const angle = rng() * TWO_PI;
  const speedMag = lerp(p.speed[0], p.speed[1], rng());
  const vyFactor = 0.7 + 0.6 * rng();
  const tint = kindTint(kind, surfaceTint);
  return {
    kind,
    birth: time,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    vx: Math.cos(angle) * speedMag,
    vy: p.rise * vyFactor,
    vz: Math.sin(angle) * speedMag,
    life,
    sizeStart,
    growth: p.growth,
    tintR: tint.r,
    tintG: tint.g,
    tintB: tint.b,
    fadeSteps: p.quantizedFadeSteps,
  };
}
