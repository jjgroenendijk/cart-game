import { describe, expect, it } from "vitest";
import {
  routeImpacts,
  DEFAULT_IMPACT_ROUTE,
  type RawImpact,
  type ImpactRouteOptions,
} from "./impactRouting";

const OPTS: ImpactRouteOptions = { threshold: 300, cooldown: 0.08 };

function impact(c1: number, c2: number, force: number): RawImpact {
  return { collider1: c1, collider2: c2, force };
}

describe("routeImpacts (pure)", () => {
  it("exports sensible defaults (threshold + 80ms cooldown)", () => {
    expect(DEFAULT_IMPACT_ROUTE.threshold).toBeGreaterThan(0);
    expect(DEFAULT_IMPACT_ROUTE.cooldown).toBeCloseTo(0.08, 5);
  });

  it("skips events below the threshold", () => {
    const map = new Map([[10, 0]]);
    const r = routeImpacts([impact(10, 99, 100)], map, [], 1, OPTS);
    expect(r.hits).toHaveLength(0);
  });

  it("fires for a qualifying kart-kart hit and stamps lastImpactAt", () => {
    const map = new Map([
      [10, 0],
      [11, 1],
    ]);
    const r = routeImpacts([impact(10, 11, 1000)], map, [0, 0], 5, OPTS);
    expect(r.hits).toEqual([
      { index: 0, force: 1000 },
      { index: 1, force: 1000 },
    ]);
    expect(r.lastImpactAt).toEqual([5, 5]);
  });

  it("fires only the kart side of a kart-prop hit (prop not in map)", () => {
    const map = new Map([[10, 0]]);
    const r = routeImpacts([impact(10, 777, 500)], map, [0], 2, OPTS);
    expect(r.hits).toEqual([{ index: 0, force: 500 }]);
  });

  it("drops events between two non-karts (neither handle mapped)", () => {
    const map = new Map([[10, 0]]);
    const r = routeImpacts([impact(700, 701, 5000)], map, [0], 2, OPTS);
    expect(r.hits).toHaveLength(0);
    expect(r.lastImpactAt).toEqual([0]);
  });

  it("dedupes within cooldown (same kart, second hit suppressed)", () => {
    const map = new Map([[10, 0]]);
    const r1 = routeImpacts([impact(10, 99, 1000)], map, [0], 1.0, OPTS);
    expect(r1.hits).toHaveLength(1);
    const r2 = routeImpacts([impact(10, 99, 2000)], map, r1.lastImpactAt, 1.04, OPTS);
    expect(r2.hits).toHaveLength(0); // 0.04s < 0.08s cooldown
    expect(r2.lastImpactAt).toEqual(r1.lastImpactAt); // unchanged
  });

  it("fires again once the cooldown has elapsed", () => {
    const map = new Map([[10, 0]]);
    const r1 = routeImpacts([impact(10, 99, 1000)], map, [0], 1.0, OPTS);
    const r2 = routeImpacts([impact(10, 99, 800)], map, r1.lastImpactAt, 1.09, OPTS);
    expect(r2.hits).toHaveLength(1); // 0.09s >= 0.08s
  });

  it("keeps the strongest force when a kart has several events in one step", () => {
    const map = new Map([
      [10, 0],
      [11, 1],
    ]);
    const events = [impact(10, 50, 400), impact(10, 11, 9000), impact(11, 60, 500)];
    const r = routeImpacts(events, map, [0, 0], 1, OPTS);
    expect(r.hits).toContainEqual({ index: 0, force: 9000 });
    expect(r.hits).toContainEqual({ index: 1, force: 9000 }); // kart-kart shares the max
  });

  it("emits hits in ascending kart-index order (deterministic)", () => {
    const map = new Map([
      [10, 2],
      [11, 0],
      [12, 1],
    ]);
    const r = routeImpacts(
      [impact(10, 99, 400), impact(11, 99, 500), impact(12, 99, 600)],
      map,
      [0, 0, 0],
      1,
      OPTS,
    );
    expect(r.hits.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it("treats a missing lastImpactAt entry as never-fired (always eligible)", () => {
    const map = new Map([[10, 3]]);
    const r = routeImpacts([impact(10, 99, 400)], map, [], 100, OPTS);
    expect(r.hits).toEqual([{ index: 3, force: 400 }]);
  });

  it("does not mutate the input lastImpactAt array", () => {
    const map = new Map([[10, 0]]);
    const last = [0];
    routeImpacts([impact(10, 99, 1000)], map, last, 5, OPTS);
    expect(last).toEqual([0]);
  });
});
