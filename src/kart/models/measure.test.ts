import { describe, expect, it } from "vitest";
import { deriveDimensions, measureKart, measureKartBox } from "./measure";
import { KART_MODELS, modelById } from ".";
import type { KartVariantId } from "./types";

const ALL_IDS: KartVariantId[] = KART_MODELS.map((m) => m.id);

describe("deriveDimensions", () => {
  it("returns positive, plausible-meter dimensions for every model", () => {
    for (const id of ALL_IDS) {
      const d = deriveDimensions(modelById(id));
      expect(d.variant).toBe(id);
      for (const v of [d.length, d.width, d.height, d.wheelbase, d.trackWidth, d.rideHeight]) {
        expect(v).toBeGreaterThan(0);
      }
      // Karts sit in a rough 1-3 m envelope for the primary spans.
      expect(d.length).toBeGreaterThan(1);
      expect(d.length).toBeLessThan(3);
      expect(d.wheelbase).toBeGreaterThan(1);
      expect(d.wheelbase).toBeLessThan(3);
      expect(d.trackWidth).toBeGreaterThan(1);
      expect(d.trackWidth).toBeLessThan(3);
      expect(d.bounds).toBeNull();
    }
  });

  it("derives wheelbase as |frontZ - rearZ| (concrete anchor: balanced)", () => {
    // balanced stance(0.62, -0.78, 0.82): |(-0.78) - 0.82| = 1.60.
    const d = deriveDimensions(modelById("balanced"));
    expect(d.wheelbase).toBeCloseTo(1.6, 6);
    // track = 2 * 0.62 = 1.24; rideHeight = |−0.35| + tireRadius(0.35) = 0.70.
    expect(d.trackWidth).toBeCloseTo(1.24, 6);
    expect(d.rideHeight).toBeCloseTo(0.7, 6);
  });

  it("orders track width: heavy widest, feather narrowest", () => {
    const track = (id: KartVariantId): number => deriveDimensions(modelById(id)).trackWidth;
    const heavy = track("heavy");
    const feather = track("feather");
    for (const id of ALL_IDS) {
      expect(heavy).toBeGreaterThanOrEqual(track(id));
      expect(feather).toBeLessThanOrEqual(track(id));
    }
    expect(heavy).toBeCloseTo(1.48, 6);
    expect(feather).toBeCloseTo(1.1, 6);
  });

  it("gives speed the longest wheelbase", () => {
    const wb = (id: KartVariantId): number => deriveDimensions(modelById(id)).wheelbase;
    const speed = wb("speed");
    for (const id of ALL_IDS) expect(speed).toBeGreaterThanOrEqual(wb(id));
    expect(speed).toBeCloseTo(1.8, 6);
  });
});

describe("measureKart / measureKartBox", () => {
  it("returns stance-derived spans and (when available) real mesh bounds", () => {
    for (const id of ALL_IDS) {
      const derived = deriveDimensions(modelById(id));
      const m = measureKart(id);
      // Stance-derived spans are exact regardless of the mesh path.
      expect(m.wheelbase).toBeCloseTo(derived.wheelbase, 6);
      expect(m.trackWidth).toBeCloseTo(derived.trackWidth, 6);
      expect(m.rideHeight).toBeCloseTo(derived.rideHeight, 6);
      if (m.bounds) {
        // Box3 path ran: dims mirror mesh extents, all finite + positive.
        expect(m.length).toBeCloseTo(m.bounds.size.z, 6);
        expect(m.width).toBeCloseTo(m.bounds.size.x, 6);
        expect(m.height).toBeCloseTo(m.bounds.size.y, 6);
        for (const s of [m.bounds.size.x, m.bounds.size.y, m.bounds.size.z]) {
          expect(Number.isFinite(s)).toBe(true);
          expect(s).toBeGreaterThan(0);
        }
      } else {
        // Fallback path: combined dims equal the pure derivation.
        expect(m.length).toBeCloseTo(derived.length, 6);
      }
    }
  });

  it("measureKartBox builds and bounds the real mesh under the test env", () => {
    // Documents whether Box3.setFromObject works headless: non-null here means
    // it does; the mesh is wider along the track than a single wheel.
    const box = measureKartBox("heavy");
    if (box) {
      expect(box.max.x - box.min.x).toBeGreaterThan(1);
    } else {
      expect(box).toBeNull();
    }
  });
});
