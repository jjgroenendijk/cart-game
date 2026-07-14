/**
 * Time-smoothed snow-cover accumulator (pure, WebGL-free, jsdom-safe).
 *
 * The weather channel emits an instantaneous snow-cover TARGET (0..1) that jumps
 * as a front fades in/out. Writing it straight to uSnowCover would snap the
 * ground white in a single frame. {@link easeToward} eases a CPU-held scalar
 * toward that target at a bounded per-second rate, so cover BUILDS as a front
 * settles and MELTS back to bare ground once it passes.
 *
 * Asymmetric by design: snow builds faster than it melts (a fresh fall whitens a
 * slope in tens of seconds; a thaw lingers). The eased scalar is the single
 * source of truth Environment writes to the shared snowUniform.uSnowCover each
 * frame -> terrain + props + tracks all read one value.
 */

/** Per-second build rate (target > cur): 0 -> 1 over ~1/rate seconds (~17s). */
export const SNOW_BUILD_RATE = 0.06;
/** Per-second melt rate (target < cur): slower than build so a thaw lingers
 *  (1 -> 0 over ~50s). */
export const SNOW_MELT_RATE = 0.02;

/**
 * Ease `cur` toward `target` by a single bounded step this frame. Building
 * (target > cur) advances at `buildRate`; melting (target < cur) at the slower
 * `meltRate`. The step is `rate * dt` (framerate-independent) and clamped so
 * `cur` can never overshoot `target` -> the approach is monotonic. A non-positive
 * `dt` (or `cur` already at `target`) returns `cur` unchanged.
 */
export function easeToward(
  cur: number,
  target: number,
  dt: number,
  buildRate = SNOW_BUILD_RATE,
  meltRate = SNOW_MELT_RATE,
): number {
  if (!(dt > 0) || target === cur) return cur;
  if (target > cur) return Math.min(cur + buildRate * dt, target);
  return Math.max(cur - meltRate * dt, target);
}
