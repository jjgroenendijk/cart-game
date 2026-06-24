/**
 * 011 perf sampler + budget. Pure helpers that classify a renderer.info plus
 * frame-time snapshot against per-metric budgets, plus an EWMA frame-time
 * smoother. No Three.js or WebGL types: PerfSample carries plain numbers so
 * this module runs under jsdom unit tests. Loop/render adapters build a
 * PerfSample each frame and call classify() for HUD coloring; FrameMsEwma
 * smooths the raw dt into a stable frameMs.
 *
 * Pure: no Three, no WebGL, no DOM, no side effects. Fully unit tested.
 */

export interface PerfSample {
  frameMs: number;
  fps: number;
  drawCalls: number;
  tris: number;
  geometries: number;
  textures: number;
  shadowCasters?: number;
}

export type MetricStatus = "ok" | "warn" | "bad";

export interface MetricThreshold {
  warn: number;
  bad: number;
}

export interface BudgetTargets {
  frameMs: MetricThreshold;
  drawCalls: MetricThreshold;
  shadowCasters: MetricThreshold;
  tris: MetricThreshold;
}

export interface PerfClassification {
  frameMs: MetricStatus;
  drawCalls: MetricStatus;
  shadowCasters: MetricStatus;
  tris: MetricStatus;
}

export const DEFAULT_BUDGET_1P: BudgetTargets = {
  frameMs: { warn: 14, bad: 16.6 },
  drawCalls: { warn: 80, bad: 120 },
  shadowCasters: { warn: 40, bad: 80 },
  tris: { warn: 350000, bad: 500000 },
};

export function rate(value: number, t: MetricThreshold): MetricStatus {
  if (value >= t.bad) return "bad";
  if (value >= t.warn) return "warn";
  return "ok";
}

export function classify(sample: PerfSample, targets: BudgetTargets): PerfClassification {
  return {
    frameMs: rate(sample.frameMs, targets.frameMs),
    drawCalls: rate(sample.drawCalls, targets.drawCalls),
    shadowCasters: rate(sample.shadowCasters ?? 0, targets.shadowCasters),
    tris: rate(sample.tris, targets.tris),
  };
}

export class FrameMsEwma {
  private value = Number.NaN;

  constructor(private readonly alpha = 0.1) {}

  push(ms: number): number {
    if (Number.isNaN(this.value)) this.value = ms;
    else this.value += (ms - this.value) * this.alpha;
    return this.value;
  }

  get smoothed(): number {
    return this.value;
  }

  reset(): void {
    this.value = Number.NaN;
  }
}
