export interface BuoyancyForce {
  up: number;
  drag: number;
}

export interface BuoyancyOptions {
  floatStrength: number;
  maxDepth: number;
  dragFactor: number;
}

export interface LifeOptions {
  drainRate: number;
  recoverRate: number;
}

export const DEFAULT_BUOYANCY: BuoyancyOptions = {
  floatStrength: 60,
  maxDepth: 1.0,
  dragFactor: 0.85,
};

export const DEFAULT_LIFE: LifeOptions = {
  drainRate: 1 / 7,
  recoverRate: 0.5,
};

export function buoyancyForce(
  depth: number,
  opts: BuoyancyOptions = DEFAULT_BUOYANCY,
): BuoyancyForce {
  if (depth <= 0) {
    return { up: 0, drag: 1 };
  }
  const clamped = depth > opts.maxDepth ? opts.maxDepth : depth;
  return { up: opts.floatStrength * clamped, drag: opts.dragFactor };
}

export function lifeDelta(
  submerged: boolean,
  dt: number,
  life: number,
  opts: LifeOptions = DEFAULT_LIFE,
): number {
  void life;
  return submerged ? -(opts.drainRate * dt) : opts.recoverRate * dt;
}

export function clampLife(life: number): number {
  return life < 0 ? 0 : life > 1 ? 1 : life;
}
