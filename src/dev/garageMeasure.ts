/**
 * Pure, WebGL-free helpers for the dev garage viewer (src/dev/Garage.ts). Two
 * concerns: formatting `measureKart` dimensions into human-readable readout
 * lines, and the reference-image scale-calibration math (pixels-per-meter plus
 * meters -> reference-pixel conversion for an overlay ruler). No DOM, no THREE,
 * so this module is unit-tested under jsdom while Garage.ts stays GL-only.
 */

import type { KartDimensions } from "../kart/models/measure";

/** A meter value rounded to 2 decimals with a unit suffix (e.g. "2.43 m"). */
export function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
}

/**
 * Readout lines for the measurement panel, one metric per line, each value in
 * meters rounded to 2 decimals — e.g. `["length 2.43 m", "width 1.62 m", ...]`.
 * Order is stable (length, width, height, wheelbase, track, ride height) so the
 * panel and any snapshot test read the same sequence.
 */
export function formatDimensions(dims: KartDimensions): string[] {
  return [
    `length ${formatMeters(dims.length)}`,
    `width ${formatMeters(dims.width)}`,
    `height ${formatMeters(dims.height)}`,
    `wheelbase ${formatMeters(dims.wheelbase)}`,
    `track ${formatMeters(dims.trackWidth)}`,
    `ride height ${formatMeters(dims.rideHeight)}`,
  ];
}

/**
 * Scale calibration: pixels-per-meter for a reference image, given a measured
 * pixel length spanning a known real-world distance. Guards non-positive input
 * (realMeters <= 0 or refPixelLength <= 0) by returning 0 — callers treat 0 as
 * "not calibrated" and skip the ruler rather than dividing by it.
 */
export function pixelsPerMeter(refPixelLength: number, realMeters: number): number {
  if (realMeters <= 0 || refPixelLength <= 0) return 0;
  return refPixelLength / realMeters;
}

/**
 * Convert a kart measurement (meters) into reference-image pixels at the given
 * scale, for drawing an overlay ruler sized to the kart against the reference.
 * A 0 scale (uncalibrated, per pixelsPerMeter) yields 0.
 */
export function metersToRefPixels(meters: number, pxPerMeter: number): number {
  if (pxPerMeter <= 0) return 0;
  return meters * pxPerMeter;
}
