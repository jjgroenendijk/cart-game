/**
 * Pure snow tire-track ring-buffer math (snow-realism commit 3). No THREE,
 * Rapier, WebGL, or DOM: jsdom-testable profile/append/fade math the GL owner
 * (SnowTracksLayer.ts) consumes. Mirrors skidMarks.ts, but each segment is a
 * depth-profiled cross-section (a shadowed CENTER channel flanked by two raised
 * OUTER berms of displaced snow) rather than a flat quad. The GL owner bakes
 * terrain-conformed Y at append time, so this module leaves the per-vertex Y at
 * the LIFT offset only (berm lift / channel lift); the layer adds terrain
 * height on top. Depth reads from shading + berm relief, NOT from sinking below
 * the ground (the channel stays at/above the surface so terrain never occludes
 * it, and the terrain mesh/collider are untouched).
 */

/**
 * One ring segment = a 6-vertex strip: prev row (left berm, center channel,
 * right berm) then curr row (same three rails). X/Z are baked here; Y holds the
 * LIFT above terrain (berm lift for the two outer rails, channel lift for the
 * center), which the GL owner adds to terrain.heightAt.
 */
export interface TrackSegment {
  birth: number; // uTime at append (set by the GL owner)
  // prev row: left berm (l), center channel (c), right berm (r)
  plx: number;
  ply: number;
  plz: number;
  pcx: number;
  pcy: number;
  pcz: number;
  prx: number;
  pry: number;
  prz: number;
  // curr row: left berm, center channel, right berm
  clx: number;
  cly: number;
  clz: number;
  ccx: number;
  ccy: number;
  ccz: number;
  crx: number;
  cry: number;
  crz: number;
}

/** Per-tier segment capacity (low/med/high). Larger than skid marks: tracks
 *  are continuous (laid every step on snow), not just during drift. */
export const TRACK_SEGMENTS: Record<"low" | "med" | "high", number> = {
  low: 512,
  med: 1024,
  high: 2048,
};

/** Half-width of one tire track in world units (channel-center to berm crest). */
export const TRACK_HALF_WIDTH = 0.18;
/** Berm lift: displaced snow piled at the track edges (world units, +y). */
export const TRACK_BERM_LIFT = 0.04;
/** Channel lift: kept slightly ABOVE the surface so terrain never occludes the
 *  groove; depth relief comes from shading + the taller berms, not from sinking. */
export const TRACK_CHANNEL_LIFT = 0.01;
/** Min travel distance between segment appends (continuous, dense but capped). */
export const TRACK_MIN_STEP = 0.18;
/** Base linear fade duration in seconds on calm/clear ground (~25 s). */
export const TRACK_FADE_TIME = 25.0;
/** Snowfall-shortening strength: higher -> tracks refill faster while snowing. */
export const TRACK_FADE_SNOW_K = 3.2;
/** Fade-time floor so heavy snowfall never fully clips tracks to nothing. */
export const TRACK_MIN_FADE = 4.0;
/** Eased uSnowCover above this reads as "on snow" (weather-driven cover). */
export const TRACK_SNOW_THRESHOLD = 0.12;

/** Append rule: on snow + rear wheel grounded + not in water + moved >= minStep.
 *  Pure; the GL owner passes the eased-cover-or-white-tint `onSnow`. */
export function shouldAppendTrack(
  onSnow: boolean,
  grounded: boolean,
  inWater: boolean,
  movedDist: number,
  minStep: number,
): boolean {
  return onSnow && grounded && !inWater && movedDist >= minStep;
}

/**
 * True when the rear-wheel surface reads as snow. Two independent triggers:
 * weather-driven eased `cover` above {@link TRACK_SNOW_THRESHOLD} (snowy
 * weather anywhere), OR a near-white / desaturated LINEAR surface tint (tundra
 * ground even under a clear sky). Pure.
 */
export function trackOnSnow(cover: number, r: number, g: number, b: number): boolean {
  if (cover > TRACK_SNOW_THRESHOLD) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 0.6 && max - min < 0.14;
}

/**
 * Fill a segment's 6 cross-section corners from prev/curr wheel center pos + a
 * unit right vector (perpendicular to travel in XZ) + halfWidth. Berms sit at
 * +/- halfWidth with `bermLift`; the center channel sits on the travel line with
 * `channelLift`. Mutates `out` XZ + Y-lift; the GL owner bakes terrain height.
 * Pure.
 */
export function trackProfileCorners(
  prevX: number,
  prevZ: number,
  currX: number,
  currZ: number,
  rightX: number,
  rightZ: number,
  halfWidth: number,
  bermLift: number,
  channelLift: number,
  out: TrackSegment,
): TrackSegment {
  const lx = rightX * halfWidth;
  const lz = rightZ * halfWidth;
  // prev row
  out.plx = prevX + lx;
  out.ply = bermLift;
  out.plz = prevZ + lz; // left berm
  out.pcx = prevX;
  out.pcy = channelLift;
  out.pcz = prevZ; // center channel
  out.prx = prevX - lx;
  out.pry = bermLift;
  out.prz = prevZ - lz; // right berm
  // curr row
  out.clx = currX + lx;
  out.cly = bermLift;
  out.clz = currZ + lz;
  out.ccx = currX;
  out.ccy = channelLift;
  out.ccz = currZ;
  out.crx = currX - lx;
  out.cry = bermLift;
  out.crz = currZ - lz;
  return out;
}

/**
 * Living fade: base fade on calm ground, SHORTER while snowing so tracks refill
 * (fresh snow settles into the grooves). `snowfallRate` in [0,1] (the eased
 * cover proxies active snowfall). Rate 0 -> exactly `baseFade`; higher rate ->
 * shorter, floored at {@link TRACK_MIN_FADE}. Pure + monotonic non-increasing.
 */
export function trackFadeTime(baseFade: number, snowfallRate: number): number {
  const r = snowfallRate <= 0 ? 0 : snowfallRate >= 1 ? 1 : snowfallRate;
  if (r === 0) return baseFade;
  const fade = baseFade / (1 + TRACK_FADE_SNOW_K * r);
  return fade < TRACK_MIN_FADE ? TRACK_MIN_FADE : fade;
}

/** Linear fade: 1 at birth, 0 at fadeTime, clamped. Negative age -> 1. */
export function trackFade(age: number, fadeTime: number): number {
  if (age <= 0) return 1;
  const f = 1 - age / fadeTime;
  if (f <= 0) return 0;
  return f >= 1 ? 1 : f;
}

/** Ring cursor for segments (mirrors skidMarks.ts SkidRingCursor). */
export interface TrackRingCursor {
  capacity: number;
  head: number;
  count: number;
}

export function makeTrackRing(capacity: number): TrackRingCursor {
  const cap = Math.max(1, Math.floor(capacity));
  return { capacity: cap, head: 0, count: 0 };
}

/** Push one segment slot: returns the index written; wraps + overwrites the
 *  oldest once full. head advances (mod capacity); count caps at capacity. */
export function trackRingPush(cur: TrackRingCursor): number {
  const idx = cur.head;
  cur.head = (cur.head + 1) % cur.capacity;
  if (cur.count < cur.capacity) cur.count += 1;
  return idx;
}
