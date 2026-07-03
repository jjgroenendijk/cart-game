import { describe, expect, it } from "vitest";
import { FLASH_DURATION, activeFlash, makeLightningSchedule } from "./lightning";

describe("makeLightningSchedule determinism", () => {
  it("same seed -> same flashes (byte-for-byte)", () => {
    const a = makeLightningSchedule(42);
    const b = makeLightningSchedule(42);
    expect(b.flashes).toEqual(a.flashes);
  });

  it("different seeds -> different flash sequences", () => {
    const a = makeLightningSchedule(1);
    const b = makeLightningSchedule(2);
    expect(b.flashes).not.toEqual(a.flashes);
  });
});

describe("makeLightningSchedule invariants", () => {
  const sched = makeLightningSchedule(7);

  it("generates 100 flashes", () => {
    expect(sched.flashes).toHaveLength(100);
  });

  it("flashes are sorted ascending by atSec", () => {
    for (let i = 1; i < sched.flashes.length; i++) {
      expect(sched.flashes[i]!.atSec).toBeGreaterThanOrEqual(sched.flashes[i - 1]!.atSec);
    }
  });

  it("min spacing >= 6 across all consecutive flashes", () => {
    for (let i = 1; i < sched.flashes.length; i++) {
      const gap = sched.flashes[i]!.atSec - sched.flashes[i - 1]!.atSec;
      expect(gap).toBeGreaterThanOrEqual(6 - 1e-9);
    }
  });

  it("strength is in [0.4, 1]", () => {
    for (const f of sched.flashes) {
      expect(f.strength).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(f.strength).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("thunderDelaySec is in [2, 6]", () => {
    for (const f of sched.flashes) {
      expect(f.thunderDelaySec).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(f.thunderDelaySec).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it("first flash atSec >= 0 (comfort ramp-in)", () => {
    expect(sched.flashes[0]!.atSec).toBeGreaterThanOrEqual(0);
  });

  it("first flash atSec >= 8 across many seeds", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(makeLightningSchedule(seed).flashes[0]!.atSec).toBeGreaterThanOrEqual(8 - 1e-9);
    }
  });

  it("min spacing >= 6 holds across many seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const fl = makeLightningSchedule(seed).flashes;
      for (let i = 1; i < fl.length; i++) {
        expect(fl[i]!.atSec - fl[i - 1]!.atSec).toBeGreaterThanOrEqual(6 - 1e-9);
      }
    }
  });
});

describe("activeFlash", () => {
  const sched = makeLightningSchedule(11);
  const f0 = sched.flashes[0]!;

  it("returns null before the first flash atSec", () => {
    expect(activeFlash(sched, f0.atSec - 0.001)).toBeNull();
  });

  it("returns the flash within [atSec, atSec + FLASH_DURATION)", () => {
    expect(activeFlash(sched, f0.atSec)).toBe(f0);
    expect(activeFlash(sched, f0.atSec + FLASH_DURATION / 2)).toBe(f0);
  });

  it("returns null at atSec + FLASH_DURATION (half-open upper bound)", () => {
    expect(activeFlash(sched, f0.atSec + FLASH_DURATION)).toBeNull();
  });

  it("returns null between flashes", () => {
    const f1 = sched.flashes[1]!;
    const mid = (f0.atSec + f1.atSec) / 2;
    expect(activeFlash(sched, mid)).toBeNull();
  });

  it("treated t < 0 as 0 (no active flash at the origin)", () => {
    expect(activeFlash(sched, -100)).toBe(activeFlash(sched, 0));
  });

  it("FLASH_DURATION is ~0.08 (about 5 frames)", () => {
    expect(FLASH_DURATION).toBeCloseTo(0.08, 6);
  });
});
