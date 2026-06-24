import { describe, expect, it } from "vitest";
import { rate, classify, FrameMsEwma, DEFAULT_BUDGET_1P, type PerfSample } from "./stats";

const OK_SAMPLE: PerfSample = {
  frameMs: 10,
  fps: 100,
  drawCalls: 30,
  tris: 100000,
  geometries: 20,
  textures: 10,
  shadowCasters: 5,
};

const BAD_SAMPLE: PerfSample = {
  frameMs: 20,
  fps: 50,
  drawCalls: 200,
  tris: 700000,
  geometries: 80,
  textures: 40,
  shadowCasters: 100,
};

describe("rate (pure)", () => {
  it("is ok below the warn threshold", () => {
    expect(rate(10, { warn: 14, bad: 16.6 })).toBe("ok");
  });

  it("is warn exactly at the warn threshold", () => {
    expect(rate(14, { warn: 14, bad: 16.6 })).toBe("warn");
  });

  it("is warn strictly between warn and bad", () => {
    expect(rate(15, { warn: 14, bad: 16.6 })).toBe("warn");
  });

  it("is bad exactly at the bad threshold", () => {
    expect(rate(16.6, { warn: 14, bad: 16.6 })).toBe("bad");
  });

  it("is bad above the bad threshold", () => {
    expect(rate(30, { warn: 14, bad: 16.6 })).toBe("bad");
  });
});

describe("classify (pure)", () => {
  it("rates a clean sample as all ok", () => {
    const c = classify(OK_SAMPLE, DEFAULT_BUDGET_1P);
    expect(c).toEqual({
      frameMs: "ok",
      drawCalls: "ok",
      shadowCasters: "ok",
      tris: "ok",
    });
  });

  it("rates a heavy sample as all bad", () => {
    const c = classify(BAD_SAMPLE, DEFAULT_BUDGET_1P);
    expect(c).toEqual({
      frameMs: "bad",
      drawCalls: "bad",
      shadowCasters: "bad",
      tris: "bad",
    });
  });

  it("defaults shadowCasters to ok when undefined", () => {
    const sample: PerfSample = { ...OK_SAMPLE, shadowCasters: undefined };
    expect(classify(sample, DEFAULT_BUDGET_1P).shadowCasters).toBe("ok");
  });
});

describe("DEFAULT_BUDGET_1P (sane)", () => {
  it("has bad strictly greater than warn for every metric", () => {
    const b = DEFAULT_BUDGET_1P;
    expect(b.frameMs.bad).toBeGreaterThan(b.frameMs.warn);
    expect(b.drawCalls.bad).toBeGreaterThan(b.drawCalls.warn);
    expect(b.shadowCasters.bad).toBeGreaterThan(b.shadowCasters.warn);
    expect(b.tris.bad).toBeGreaterThan(b.tris.warn);
  });

  it("sets the bad frameMs at the 60fps boundary (~1000/60, within 0.5ms)", () => {
    expect(DEFAULT_BUDGET_1P.frameMs.bad).toBeCloseTo(1000 / 60, 0);
  });
});

describe("FrameMsEwma (pure)", () => {
  it("seeds the value on the first push and exposes it via smoothed", () => {
    const e = new FrameMsEwma();
    expect(Number.isNaN(e.smoothed)).toBe(true);
    expect(e.push(16)).toBe(16);
    expect(e.smoothed).toBe(16);
  });

  it("converges toward a steady input", () => {
    const e = new FrameMsEwma(0.5);
    e.push(0);
    for (let i = 0; i < 50; i++) e.push(16);
    expect(e.smoothed).toBeGreaterThan(15);
    expect(e.smoothed).toBeLessThan(16);
    expect(16 - e.smoothed).toBeLessThan(1);
  });

  it("reset() forces the next push to reseed", () => {
    const e = new FrameMsEwma();
    e.push(30);
    e.push(30);
    expect(e.smoothed).toBe(30);
    e.reset();
    expect(Number.isNaN(e.smoothed)).toBe(true);
    expect(e.push(16)).toBe(16);
    expect(e.smoothed).toBe(16);
  });

  it("honours a custom alpha (alpha=1 fully adopts the pushed value after seed)", () => {
    const e = new FrameMsEwma(1);
    e.push(5);
    expect(e.push(100)).toBe(100);
    expect(e.smoothed).toBe(100);
  });
});
