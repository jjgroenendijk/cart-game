import { describe, it, expect } from "vitest";
import {
  GRID_W,
  GRID_H,
  CELLS_PER_RUN,
  signatureFromRgba,
  stringifySignature,
  parseSignature,
  compareSignatures,
} from "./signature.mjs";

function uniformRgba(w, h, r, g, b) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = 255;
  }
  return buf;
}

function variedRgba(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      buf[o] = ((x * 255) / (w - 1)) | 0;
      buf[o + 1] = ((y * 255) / (h - 1)) | 0;
      buf[o + 2] = (((x + y) * 255) / (w + h - 2)) | 0;
      buf[o + 3] = 255;
    }
  }
  return buf;
}

function shiftedRgba(w, h, dr) {
  const buf = variedRgba(w, h);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = Math.min(255, buf[i] + dr);
  }
  return buf;
}

describe("signatureFromRgba", () => {
  it("downsamples a uniform fill to that color in every cell", () => {
    const sig = signatureFromRgba(uniformRgba(960, 540, 100, 150, 200), 960, 540);
    const fullRun = "6496c8".repeat(CELLS_PER_RUN);
    const lastRun = "6496c8".repeat((GRID_W * GRID_H) % CELLS_PER_RUN);
    expect(sig.rows[0]).toBe(fullRun);
    expect(sig.rows[sig.rows.length - 1]).toBe(lastRun);
    expect(sig.rows.every((run) => run === fullRun || run === lastRun)).toBe(true);
  });

  it("emits a GRID_W x GRID_H grid regardless of input dimensions", () => {
    for (const [w, h] of [
      [960, 540],
      [100, 100],
      [1, 1],
      [33, 19],
    ]) {
      const sig = signatureFromRgba(uniformRgba(w, h, 0, 0, 0), w, h);
      expect(sig.width).toBe(GRID_W);
      expect(sig.height).toBe(GRID_H);
    }
  });
});

describe("stringify / parse round-trip", () => {
  it("parse(stringify(sig)) deep-equals the original signature", () => {
    const sig = signatureFromRgba(variedRgba(960, 540), 960, 540);
    const parsed = parseSignature(stringifySignature(sig));
    expect(parsed).toEqual(sig);
  });

  it("keeps every output line <= 100 chars (repo line cap)", () => {
    const sig = signatureFromRgba(variedRgba(960, 540), 960, 540);
    const text = stringifySignature(sig);
    const lines = text.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("compareSignatures", () => {
  it("passes identical signatures with zero delta", () => {
    const sig = signatureFromRgba(variedRgba(960, 540), 960, 540);
    const r = compareSignatures(sig, sig);
    expect(r.pass).toBe(true);
    expect(r.maxCellDelta).toBe(0);
    expect(r.cellsOverTol).toBe(0);
  });

  it("fails on a uniform channel shift and reports over-tolerance cells", () => {
    const a = signatureFromRgba(variedRgba(960, 540), 960, 540);
    const b = signatureFromRgba(shiftedRgba(960, 540, 40), 960, 540);
    const r = compareSignatures(a, b);
    expect(r.pass).toBe(false);
    expect(r.cellsOverTol).toBeGreaterThan(0);
    expect(r.maxCellDelta).toBeGreaterThan(0);
  });

  it("fails with infinite delta on mismatched grid dimensions", () => {
    const a = { width: GRID_W, height: GRID_H, rows: [] };
    const b = { width: 16, height: 9, rows: [] };
    const r = compareSignatures(a, b);
    expect(r.pass).toBe(false);
    expect(r.maxCellDelta).toBe(Infinity);
  });

  it("honors a relaxed maxCellsOverTol override", () => {
    const a = signatureFromRgba(variedRgba(960, 540), 960, 540);
    const b = signatureFromRgba(shiftedRgba(960, 540, 40), 960, 540);
    const strict = compareSignatures(a, b);
    const relaxed = compareSignatures(a, b, { maxCellsOverTol: strict.cellsOverTol });
    expect(relaxed.pass).toBe(true);
  });
});
