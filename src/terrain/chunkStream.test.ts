import { describe, expect, it } from "vitest";
import { planStream, type StreamPolicy } from "./chunkStream";
import { chunkKey, desiredChunks } from "./streamGrid";
import type { Pt } from "../kart/kartLod";

const CS = 25;
const ORIGIN: Pt = { x: 0, y: 0, z: 0 };

function policy(over: Partial<StreamPolicy> = {}): StreamPolicy {
  return { chunkSize: CS, streamRadius: 50, cullRadius: 70, maxActivations: 99, ...over };
}

describe("planStream activation", () => {
  it("empty foci -> empty plan (observerless frame is a no-op)", () => {
    const p = planStream(["0,0", "5,5"], [], policy());
    expect(p.activate).toEqual([]);
    expect(p.deactivate).toEqual([]);
  });

  it("from empty active, activates the whole desired set (no cap)", () => {
    const p = planStream([], [ORIGIN], policy());
    const keys = new Set(p.activate.map((c) => chunkKey(c.gx, c.gz)));
    expect(keys).toEqual(desiredChunks([ORIGIN], 50, CS));
  });

  it("skips chunks already active", () => {
    const all = [...desiredChunks([ORIGIN], 50, CS)];
    const p = planStream(all, [ORIGIN], policy());
    expect(p.activate).toEqual([]);
  });

  it("orders activations nearest-first", () => {
    const p = planStream([], [ORIGIN], policy());
    // First activation is the origin chunk (distance 0); each step is monotonic.
    expect(chunkKey(p.activate[0]!.gx, p.activate[0]!.gz)).toBe("0,0");
    const dist = (c: { gx: number; gz: number }) => Math.hypot(c.gx * CS, c.gz * CS);
    for (let i = 1; i < p.activate.length; i++) {
      expect(dist(p.activate[i]!)).toBeGreaterThanOrEqual(dist(p.activate[i - 1]!));
    }
  });

  it("caps activations at maxActivations, keeping the nearest", () => {
    const full = planStream([], [ORIGIN], policy());
    const capped = planStream([], [ORIGIN], policy({ maxActivations: 3 }));
    expect(capped.activate).toHaveLength(3);
    // The capped set is exactly the 3 nearest of the full set (same prefix).
    expect(capped.activate).toEqual(full.activate.slice(0, 3));
  });

  it("maxActivations 0 -> no activations", () => {
    expect(planStream([], [ORIGIN], policy({ maxActivations: 0 })).activate).toEqual([]);
  });

  it("is deterministic across calls (stable tie-break order)", () => {
    const a = planStream([], [ORIGIN], policy());
    const b = planStream([], [ORIGIN], policy());
    expect(a.activate).toEqual(b.activate);
  });
});

describe("planStream union over foci", () => {
  it("activates chunks near either focus (2P split)", () => {
    const b: Pt = { x: 200, y: 0, z: 0 };
    const p = planStream([], [ORIGIN, b], policy());
    const keys = new Set(p.activate.map((c) => chunkKey(c.gx, c.gz)));
    expect(keys.has("0,0")).toBe(true);
    expect(keys.has(chunkKey(Math.round(b.x / CS), 0))).toBe(true);
  });
});

describe("planStream culling + hysteresis", () => {
  it("deactivates active chunks past cullRadius of every focus", () => {
    // Chunk (4,0) center is 100m out: past cullRadius 70 -> culled.
    const p = planStream(["0,0", "4,0"], [ORIGIN], policy());
    const dead = new Set(p.deactivate.map((c) => chunkKey(c.gx, c.gz)));
    expect(dead.has("4,0")).toBe(true);
    expect(dead.has("0,0")).toBe(false);
  });

  it("keeps chunks between streamRadius and cullRadius active (hysteresis)", () => {
    // Chunk (2,0) center is 50m out: inside cull 70 but... choose radii so it
    // sits in the hysteresis band (stream 40, cull 70). It stays active and is
    // NOT re-activated (already active).
    const pol = policy({ streamRadius: 40, cullRadius: 70 });
    const p = planStream(["2,0"], [ORIGIN], pol);
    expect(p.deactivate).toEqual([]);
    expect(p.activate.some((c) => chunkKey(c.gx, c.gz) === "2,0")).toBe(false);
  });

  it("a fresh chunk in the hysteresis band is NOT activated (must be inside streamRadius)", () => {
    const pol = policy({ streamRadius: 40, cullRadius: 70 });
    const p = planStream([], [ORIGIN], pol);
    // (2,0) at 50m is outside streamRadius 40, so it never enters the plan.
    expect(p.activate.some((c) => chunkKey(c.gx, c.gz) === "2,0")).toBe(false);
  });

  it("keeps a distant chunk active while a second focus still covers it", () => {
    const far: Pt = { x: 100, y: 0, z: 0 };
    // (4,0) center is 0m from `far` -> covered; not culled despite being 100m
    // from the origin focus.
    const p = planStream(["4,0"], [ORIGIN, far], policy());
    expect(p.deactivate.some((c) => chunkKey(c.gx, c.gz) === "4,0")).toBe(false);
  });

  it("accepts a Set of active keys as well as an array", () => {
    const p = planStream(new Set(["4,0"]), [ORIGIN], policy());
    expect(p.deactivate.map((c) => chunkKey(c.gx, c.gz))).toContain("4,0");
  });
});
