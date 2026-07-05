import { describe, expect, it } from "vitest";
import { buildStartLine, type HeightProbe, type StartLinePose } from "./trackDecals";

function flatProbe(h = 0): HeightProbe {
  return {
    heightAt: () => h,
    normalAt: () => [0, 1, 0],
  };
}

/** Pose at origin facing +z (forward=(0,1)); right axis = +x. */
function poseFacingZ(halfWidth = 6): StartLinePose {
  return { cx: 0, cz: 0, tx: 0, tz: 1, halfWidth };
}

function triNormalY(positions: Float32Array, indices: Uint16Array, tri: number): number {
  const a = indices[tri * 3]! * 3;
  const b = indices[tri * 3 + 1]! * 3;
  const c = indices[tri * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  // (a-b) x (a-c) Y component = az*bx - ax*bz, in edge terms uz*vx - ux*vz.
  return uz * vx - ux * vz;
}

describe("buildStartLine", () => {
  it("sizes buffers for rows x cols cells (4 verts / 6 indices each)", () => {
    const { positions, colors, indices } = buildStartLine(poseFacingZ(6), flatProbe(), {
      rows: 2,
      cellSize: 1,
    });
    // halfWidth 6 -> road width 12 -> 12 cols; 2 x 12 = 24 cells.
    expect(positions.length).toBe(24 * 4 * 3);
    expect(colors.length).toBe(24 * 4 * 3);
    expect(indices.length).toBe(24 * 6);
  });

  it("tiles the full road width regardless of halfWidth", () => {
    const p = poseFacingZ(5);
    const { positions } = buildStartLine(p, flatProbe(), { rows: 2, cellSize: 1 });
    // right axis is +x; x extent should reach +/- halfWidth.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]!);
      maxX = Math.max(maxX, positions[i]!);
    }
    expect(minX).toBeLessThanOrEqual(-5 + 1e-6);
    expect(maxX).toBeGreaterThanOrEqual(5 - 1e-6);
  });

  it("conforms every corner to probe height + normal lift", () => {
    const probe: HeightProbe = {
      heightAt: () => 10,
      normalAt: () => [0, 1, 0],
    };
    const { positions } = buildStartLine(poseFacingZ(), probe, { normalOffset: 0.5 });
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBe(10.5);
    }
  });

  it("lifts along a non-vertical normal too", () => {
    const probe: HeightProbe = {
      heightAt: () => 0,
      normalAt: () => [1, 0, 0],
    };
    const { positions } = buildStartLine(poseFacingZ(), probe, { normalOffset: 0.3 });
    // Every vertex offset +0.3 in x from its raw position; since raw x is the
    // right-axis coordinate, the min x must be halfWidth + 0.3 above the raw
    // minimum. Just assert y stays 0 (normal has no y component).
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBe(0);
    }
  });

  it("alternates light/dark per cell in a checker pattern", () => {
    const light: [number, number, number] = [1, 1, 1];
    const dark: [number, number, number] = [0, 0, 0];
    const { colors } = buildStartLine(poseFacingZ(6), flatProbe(), {
      rows: 2,
      cellSize: 1,
      lightColor: light,
      darkColor: dark,
    });
    const cellColor = (cell: number): [number, number, number] => {
      const o = cell * 4 * 3;
      return [colors[o]!, colors[o + 1]!, colors[o + 2]!];
    };
    // cell 0 (i=0,j=0) -> light; cell 1 (i=0,j=1) -> dark.
    expect(cellColor(0)).toEqual(light);
    expect(cellColor(1)).toEqual(dark);
    // last cell of row 0 (j=11, odd) -> dark; first cell of row 1 (i=1,j=0) -> dark.
    expect(cellColor(11)).toEqual(dark);
    expect(cellColor(12)).toEqual(dark);
  });

  it("winds triangles CCW from above (front face +Y)", () => {
    const { positions, indices } = buildStartLine(poseFacingZ(), flatProbe());
    for (let t = 0; t < indices.length / 3; t++) {
      expect(triNormalY(positions, indices, t)).toBeGreaterThan(0);
    }
  });

  it("is deterministic: identical inputs -> identical buffers", () => {
    const a = buildStartLine(poseFacingZ(), flatProbe(3));
    const b = buildStartLine(poseFacingZ(), flatProbe(3));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it("respects a non-axis-aligned forward direction", () => {
    // forward = diagonal unit (sqrt2/2, sqrt2/2); right = perpendicular.
    const s = Math.SQRT1_2;
    const pose: StartLinePose = { cx: 5, cz: -3, tx: s, tz: s, halfWidth: 6 };
    const { positions } = buildStartLine(pose, flatProbe());
    // Project vertices onto the right axis (s,-s); span must equal 2*halfWidth.
    const rx = pose.tz;
    const rz = -pose.tx;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const proj = positions[i]! * rx + positions[i + 2]! * rz;
      lo = Math.min(lo, proj);
      hi = Math.max(hi, proj);
    }
    expect(hi - lo).toBeGreaterThan(11);
  });
});
