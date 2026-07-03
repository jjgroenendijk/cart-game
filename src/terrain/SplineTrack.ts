import { CatmullRomCurve3, Vector3 } from "three";

export interface ClosestPathPoint {
  /** Horizontal (XZ) distance from the query to the nearest path point. */
  dist: number;
  /** Path height (Y) at the nearest path point (the corridor surface). */
  pathY: number;
  /** Spaced-parameter (arc-length, i/N) of the nearest sample. */
  t: number;
  /** Nearest path point (world). */
  x: number;
  y: number;
  z: number;
}

/**
 * Authored closed-loop control points. ~12 points on a near-circle of radius
 * ~60 (cardinals 62; diagonals 54/31 ~ 62) with gentle Y variation +-2.5m.
 * Even ~31m spacing keeps the centripetal Catmull-Rom loop fat and
 * non-self-intersecting (guarded by the non-adjacent distance test). Y stays
 * within the arcade-suspension grade budget (see 003 risks).
 */
const DEFAULT_CONTROL: ReadonlyArray<readonly [number, number, number]> = [
  [62, 0.0, 0],
  [54, 1.5, 31],
  [31, -1.0, 54],
  [0, 2.0, 62],
  [-31, 0.8, 54],
  [-54, -1.5, 31],
  [-62, 1.0, 0],
  [-54, -0.5, -31],
  [-31, 1.8, -54],
  [0, -1.2, -62],
  [31, 0.6, -54],
  [54, -0.8, -31],
];

const DEFAULT_SAMPLES = 1024;

/**
 * Closed Catmull-Rom circuit (the race path). Centripetal type avoids cusps
 * and overshoot -> no corridor self-intersection. A one-time arc-length
 * sample table backs closestPoint(x,z) (build-time O(N) scan per query); the
 * heightmap's SplineFieldCache then turns that into O(1) per-vertex queries.
 *
 * Pure geometry (no WebGL) so it runs under jsdom for unit tests.
 */
export class SplineTrack {
  readonly control: ReadonlyArray<Vector3>;
  readonly curve: CatmullRomCurve3;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly st: Float32Array;
  private readonly length: number;

  constructor(
    control: ReadonlyArray<readonly [number, number, number]> = DEFAULT_CONTROL,
    samples = DEFAULT_SAMPLES,
  ) {
    this.control = control.map((c) => new Vector3(c[0], c[1], c[2]));
    this.curve = new CatmullRomCurve3(this.control as Vector3[], true, "centripetal");
    // Match the curve's arc-length LUT to the sample count so getSpacedPoints
    // and getLength share a fine, consistent resolution (default 200 would
    // quantise metres to ~2m on a long loop).
    this.curve.arcLengthDivisions = samples;
    // Arc-length-even samples (getSpacedPoints uses the curve's internal
    // arc-length LUT). Point[N] == point[0] for a closed curve, so take N.
    const pts = this.curve.getSpacedPoints(samples).slice(0, samples);
    this.length = this.curve.getLength();
    const n = pts.length;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sz = new Float32Array(n);
    this.st = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.sx[i] = pts[i].x;
      this.sy[i] = pts[i].y;
      this.sz[i] = pts[i].z;
      this.st[i] = i / n;
    }
  }

  /** Point on the path at parameter t (0..1, wraps for the closed loop). */
  getPoint(t: number, out = new Vector3()): Vector3 {
    return this.curve.getPoint(t, out);
  }

  /** Total arc length of the closed loop (metres). */
  get loopLength(): number {
    return this.length;
  }

  /**
   * Position on the loop at `meters` arc-length distance. Wraps the closed
   * loop and accepts any real value (negative or > loop length). Writes into
   * `out` and returns it, like getPoint.
   */
  pointAtArc(meters: number, out = new Vector3()): Vector3 {
    const n = this.sx.length;
    const f = ((((meters / this.length) * n) % n) + n) % n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const frac = f - Math.floor(f);
    out.set(
      this.sx[i0] + (this.sx[i1] - this.sx[i0]) * frac,
      this.sy[i0] + (this.sy[i1] - this.sy[i0]) * frac,
      this.sz[i0] + (this.sz[i1] - this.sz[i0]) * frac,
    );
    return out;
  }

  /** Spawn position: the first control point (path start). */
  startPos(out = new Vector3()): Vector3 {
    return this.curve.getPoint(0, out);
  }

  /**
   * Spawn yaw (radians) so the kart's forward (local -Z) aligns with the
   * path tangent at the start. Derived from forward = (-sin yaw, 0, -cos yaw).
   */
  startYaw(): number {
    const tan = this.curve.getTangent(0).normalize();
    return Math.atan2(-tan.x, -tan.z);
  }

  /**
   * Nearest path point to a world (x,z) by XZ distance. Linear scan over the
   * arc-length table (O(samples) per query) — fine for build-time cache
   * construction and spawn; runtime height queries go through the
   * SplineFieldCache (O(1) bilinear), not here.
   */
  closestPoint(
    x: number,
    z: number,
    out: ClosestPathPoint = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 },
  ): ClosestPathPoint {
    let best = 0;
    const dx0 = x - this.sx[0];
    const dz0 = z - this.sz[0];
    let bestD = dx0 * dx0 + dz0 * dz0;
    for (let i = 1; i < this.sx.length; i++) {
      const dx = x - this.sx[i];
      const dz = z - this.sz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    out.dist = Math.sqrt(bestD);
    out.pathY = this.sy[best];
    out.t = this.st[best];
    out.x = this.sx[best];
    out.y = this.sy[best];
    out.z = this.sz[best];
    return out;
  }
}
