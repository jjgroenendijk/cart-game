/**
 * 063 pure start-line decal builder. No THREE/WebGL/DOM: emits typed arrays
 * the GL owner (TrackDressing.ts) wraps in a BufferGeometry + CelMaterial.
 * The checkered start/finish line is a 2 x N grid of independent quads
 * (cells do NOT share vertices) so each cell can carry a uniform light/dark
 * vertex color -> a crisp checker from `vertexColors` alone (zero textures).
 * Every corner is terrain-conformed via the injected probe (heightAt +
 * normalAt lift), the exact recipe 053's SkidMarks uses to lie flat on the
 * road through the layer-1 Sobel pass without z-fighting.
 *
 * Local frame at the start pose: `forward` is the unit track tangent (XZ);
 * `right` is its XZ perpendicular (right of forward). The grid spans the
 * full road width (2 x halfWidth) across `right` and `rows x cellSize` along
 * `forward`. Winding is CCW from above so the front face points +Y (up).
 */

export interface StartLinePose {
  /** Road centre at the start line (world XZ). */
  cx: number;
  cz: number;
  /** Unit track tangent at the start (forward direction, XZ). */
  tx: number;
  tz: number;
  /** Road half-width (world units); grid spans [-halfWidth, +halfWidth]. */
  halfWidth: number;
}

export interface HeightProbe {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
}

export interface DecalBuffers {
  /** World-space XYZ per vertex, terrain-conformed (with normal lift). */
  positions: Float32Array;
  /** LINEAR rgb per vertex (sRGB->LINEAR lives at the call site). */
  colors: Float32Array;
  /** Triangle indices, CCW from above (front face +Y). */
  indices: Uint16Array;
}

export interface StartLineOpts {
  /** Cells along the track depth (forward axis). Default 2. */
  rows?: number;
  /** Approx cell edge length (world units); width-axis cells are sized to
   *  tile the road evenly, depth cells use this directly. Default 1.0. */
  cellSize?: number;
  /** Lift along the terrain normal to fight z-fighting (053 uses 0.02). */
  normalOffset?: number;
  /** LINEAR light-square colour. Default near-white. */
  lightColor?: [number, number, number];
  /** LINEAR dark-square colour. Default near-black. */
  darkColor?: [number, number, number];
}

const DEFAULT_LIGHT: [number, number, number] = [0.9, 0.9, 0.9];
const DEFAULT_DARK: [number, number, number] = [0.04, 0.04, 0.04];

/**
 * Build the checkered start/finish line. `cols` is derived from
 * `halfWidth / cellSize` (rounded, min 1) so the checker tiles the full road
 * width regardless of the circuit's configured width (057/059 variable-width
 * ready: pass the live halfWidth per build). Deterministic from `pose` +
 * `probe`: identical inputs yield byte-identical buffers.
 */
export function buildStartLine(
  pose: StartLinePose,
  probe: HeightProbe,
  opts: StartLineOpts = {},
): DecalBuffers {
  const rows = opts.rows ?? 2;
  const cellSize = opts.cellSize ?? 1.0;
  const offset = opts.normalOffset ?? 0.02;
  const light = opts.lightColor ?? DEFAULT_LIGHT;
  const dark = opts.darkColor ?? DEFAULT_DARK;

  const cols = Math.max(1, Math.round((2 * pose.halfWidth) / cellSize));
  const cellW = (2 * pose.halfWidth) / cols;
  const cellD = cellSize;
  const depth = rows * cellD;

  // right = XZ perpendicular of forward (right of travel direction).
  const rx = pose.tz;
  const rz = -pose.tx;

  const cells = rows * cols;
  const positions = new Float32Array(cells * 4 * 3);
  const colors = new Float32Array(cells * 4 * 3);
  const indices = new Uint16Array(cells * 6);

  for (let i = 0; i < rows; i++) {
    const vLo = -depth / 2 + i * cellD;
    const vHi = vLo + cellD;
    for (let j = 0; j < cols; j++) {
      const uLo = -pose.halfWidth + j * cellW;
      const uHi = uLo + cellW;
      const cell = i * cols + j;
      const v0 = cell * 4; // BL
      // v0+1 = BR, v0+2 = TR, v0+3 = TL
      writeCorner(
        positions,
        v0,
        pose.cx,
        pose.cz,
        rx,
        rz,
        pose.tx,
        pose.tz,
        uLo,
        vLo,
        probe,
        offset,
      );
      writeCorner(
        positions,
        v0 + 1,
        pose.cx,
        pose.cz,
        rx,
        rz,
        pose.tx,
        pose.tz,
        uHi,
        vLo,
        probe,
        offset,
      );
      writeCorner(
        positions,
        v0 + 2,
        pose.cx,
        pose.cz,
        rx,
        rz,
        pose.tx,
        pose.tz,
        uHi,
        vHi,
        probe,
        offset,
      );
      writeCorner(
        positions,
        v0 + 3,
        pose.cx,
        pose.cz,
        rx,
        rz,
        pose.tx,
        pose.tz,
        uLo,
        vHi,
        probe,
        offset,
      );

      const c = (i + j) % 2 === 0 ? light : dark;
      for (let k = 0; k < 4; k++) {
        const ci = (v0 + k) * 3;
        colors[ci] = c[0];
        colors[ci + 1] = c[1];
        colors[ci + 2] = c[2];
      }

      // CCW from above: (BL, TR, BR) + (BL, TL, TR) -> front face +Y.
      const o = cell * 6;
      indices[o] = v0;
      indices[o + 1] = v0 + 2;
      indices[o + 2] = v0 + 1;
      indices[o + 3] = v0;
      indices[o + 4] = v0 + 3;
      indices[o + 5] = v0 + 2;
    }
  }

  return { positions, colors, indices };
}

function writeCorner(
  positions: Float32Array,
  v: number,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  tx: number,
  tz: number,
  u: number,
  w: number,
  probe: HeightProbe,
  offset: number,
): void {
  const x = cx + rx * u + tx * w;
  const z = cz + rz * u + tz * w;
  const n = probe.normalAt(x, z);
  const y = probe.heightAt(x, z);
  const o = v * 3;
  positions[o] = x + n[0] * offset;
  positions[o + 1] = y + n[1] * offset;
  positions[o + 2] = z + n[2] * offset;
}
