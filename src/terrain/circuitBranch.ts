/**
 * 060 branch (split/rejoin) generation + validation. A branch is an OPEN
 * alternative path between two mainline params tA -> tB: a narrow Hermite
 * shortcut cutting across a curved window, or a wide scenic detour bowing
 * outward from a straight-ish window. Everything here is pure +
 * deterministic in (seed, control, traits); the TrackGraph consumes the
 * emitted BranchSpec as a BranchEdgeInit.
 *
 * Guardrails that keep the single-t race model valid (060 plan):
 * - window confined to t in [BRANCH_T_MIN, BRANCH_T_MAX] and <= 0.22 of the
 *   lap (< checkpoints FORWARD_CUT=0.34: a physical cross-route hop degrades
 *   to a sector move, never a false teleport);
 * - separation: every branch point is either >= SEP_MIN_BRANCH from the
 *   mainline (unambiguous nearest-edge for on-road karts; carve influence is
 *   halfWidth+blend <= 17 m), or inside a junction RAMP with its nearest
 *   mainline point in the branch's OWN window (routes agree on t there, so a
 *   nearest-edge flip is harmless). A plateau-coverage floor rejects
 *   branches that never genuinely diverge, and a foreign mainline section
 *   approaching a ramp rejects the draw outright;
 * - junction tangents match within BRANCH_TANGENT_MAX so both mouths are
 *   drivable at speed (both constructions meet the mainline tangentially by
 *   construction; validation re-checks).
 *
 * Placement SCANS windows deterministically (see scanForBranch); a loop
 * with no qualifying window ships branchless — never a hard failure.
 */

import { CatmullRomCurve3, Vector3 } from "three";
import { makeRNG, type RNG } from "../core/rng";
import { SampleIndex } from "./trackGraph";
import { DEFAULT_TRACK_TRAITS, type TrackTraits } from "./trackTraits";

export interface BranchSpec {
  kind: "shortcut" | "scenic";
  /** Mainline params of the split/merge anchors (branch runs tA -> tB). */
  tA: number;
  tB: number;
  /** Dense sampled centerline (~2 m spacing), endpoints ON the mainline. */
  points: ReadonlyArray<readonly [number, number, number]>;
  /** Constant corridor half-width for the branch (m). */
  halfWidth: number;
}

/** Branch window stays clear of the start/finish straight + grid. */
export const BRANCH_T_MIN = 0.08;
export const BRANCH_T_MAX = 0.92;
/** Max branch window as a fraction of the lap (< FORWARD_CUT 0.34). */
export const BRANCH_SPAN_MAX = 0.22;
/** Min XZ separation branch <-> any centerline outside junction ramps (m). */
export const SEP_MIN_BRANCH = 26;
/** Fraction of the branch arc at EACH end treated as junction ramp. */
export const RAMP_FRACTION = 0.38;
/** Nearest-mainline t must sit within the window +- this pad inside ramps. */
export const WINDOW_OWN_PAD = 0.05;
/** Min fraction of branch points that must reach full separation. */
export const PLATEAU_MIN_COVER = 0.15;
/** Max junction tangent mismatch (rad). */
export const BRANCH_TANGENT_MAX = (30 * Math.PI) / 180;
/** Full-validation budget per branch scan (construction stays cheap). */
export const MAX_VALIDATIONS = 60;
/** Window scan step along the lap (m). */
export const SCAN_STEP_M = 7;
/** Kind-specific curvature floors (m), checked on a ~6 m resample. */
export const SHORTCUT_RADIUS_FLOOR = 12.5;
export const SCENIC_RADIUS_FLOOR = 25;
/** Branch length as a fraction of its window arc, per kind. */
const SHORTCUT_RATIO = [0.5, 0.95] as const;
const SCENIC_RATIO = [1.04, 1.7] as const;
/** Max |dy/ds| along a branch (well under the kart's 0.25 wall). */
const BRANCH_GRADE_MAX = 0.2;
/** Shortcut windows must curve this much (arc/chord) to actually cut. */
const SHORTCUT_ARC_CHORD = [1.08, 2.0] as const;
/** Max angle between a junction tangent and the shortcut chord (rad). */
const SHORTCUT_CHORD_ALIGN = (40 * Math.PI) / 180;
/** Scenic windows must be straight-ish (min Menger radius, m). */
const SCENIC_WINDOW_RADIUS_MIN = 45;
/** Scenic bow curvature budget (m); depth adapts to the ramp length. */
const SCENIC_BOW_RADIUS = 34;
/** Scenic bow depth band (m); below min the window is too short. */
const SCENIC_DEPTH = [28, 60] as const;
/** Scenic detours need long windows (smooth 26 m bow at radius >= 25). */
const SCENIC_WIN_MIN = 170;
/** Gap kept between two branch windows (lap fraction). */
const WINDOW_GAP = 0.04;

interface MainSamples {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  n: number;
  length: number;
}

/** Arc-length-even 3D samples of the closed mainline (~3 m spacing). */
export function sampleMainline(
  control: ReadonlyArray<readonly [number, number, number]>,
): MainSamples {
  const pts = control.map((c) => new Vector3(c[0], c[1], c[2]));
  const curve = new CatmullRomCurve3(pts, true, "centripetal");
  curve.arcLengthDivisions = 512;
  const length = curve.getLength();
  const n = Math.min(512, Math.max(224, Math.round(length / 3)));
  const sp = curve.getSpacedPoints(n).slice(0, n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = sp[i]!.x;
    y[i] = sp[i]!.y;
    z[i] = sp[i]!.z;
  }
  return { x, y, z, n, length };
}

function pointAtT(m: MainSamples, t: number, out: Vector3): Vector3 {
  const f = (((t % 1) + 1) % 1) * m.n;
  const i0 = Math.floor(f) % m.n;
  const i1 = (i0 + 1) % m.n;
  const fr = f - Math.floor(f);
  return out.set(
    m.x[i0]! + (m.x[i1]! - m.x[i0]!) * fr,
    m.y[i0]! + (m.y[i1]! - m.y[i0]!) * fr,
    m.z[i0]! + (m.z[i1]! - m.z[i0]!) * fr,
  );
}

/** Smoothed XZ tangent (central difference over ~9 m of arc). */
function tangentAtT(m: MainSamples, t: number, out: Vector3): Vector3 {
  const d = 4.5 / m.length;
  const a = pointAtT(m, t - d, new Vector3());
  const b = pointAtT(m, t + d, new Vector3());
  out.set(b.x - a.x, 0, b.z - a.z);
  return out.normalize();
}

/** Signed area of the sampled loop (XZ); > 0 = CCW. */
function loopSignedArea(m: MainSamples): number {
  let a = 0;
  for (let i = 0; i < m.n; i++) {
    const j = (i + 1) % m.n;
    a += m.x[i]! * m.z[j]! - m.x[j]! * m.z[i]!;
  }
  return a / 2;
}

/** Min Menger circumradius over a ~6 m resample of the polyline (XZ). */
function minRadiusCoarse(pts: ReadonlyArray<readonly [number, number, number]>): number {
  const total = lengthXZ(pts);
  const stride = Math.max(1, Math.round(pts.length / Math.max(4, total / 6)));
  const coarse: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < pts.length; i += stride) coarse.push(pts[i]!);
  if (coarse[coarse.length - 1] !== pts[pts.length - 1]) coarse.push(pts[pts.length - 1]!);
  let minR = Infinity;
  for (let i = 1; i < coarse.length - 1; i++) {
    const a = coarse[i - 1]!;
    const b = coarse[i]!;
    const c = coarse[i + 1]!;
    const ux = b[0] - a[0];
    const uz = b[2] - a[2];
    const vx = c[0] - b[0];
    const vz = c[2] - b[2];
    const cross = ux * vz - uz * vx;
    const dab = Math.hypot(ux, uz);
    const dbc = Math.hypot(vx, vz);
    const dca = Math.hypot(a[0] - c[0], a[2] - c[2]);
    if (dab < 1e-9 || dbc < 1e-9 || dca < 1e-9) continue;
    const area2 = Math.abs(cross);
    if (area2 < 1e-9) continue;
    const r = (dab * dbc * dca) / (2 * area2);
    if (r < minR) minR = r;
  }
  return minR;
}

/** XZ polyline length. */
function lengthXZ(pts: ReadonlyArray<readonly [number, number, number]>): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
  }
  return len;
}

/** Min Menger radius of the mainline WINDOW itself (straight-ish check). */
function windowMinRadius(m: MainSamples, tA: number, tB: number): number {
  const pts: Array<readonly [number, number, number]> = [];
  const steps = Math.max(8, Math.round(((tB - tA) * m.length) / 6));
  const v = new Vector3();
  for (let i = 0; i <= steps; i++) {
    pointAtT(m, tA + ((tB - tA) * i) / steps, v);
    pts.push([v.x, v.y, v.z]);
  }
  return minRadiusCoarse(pts);
}

/** Expected branch count from the trait chance (integer + fractional roll). */
function branchCount(rng: RNG, chance: number): number {
  const base = Math.floor(chance);
  const extra = rng.next() < chance - base ? 1 : 0;
  return Math.min(2, base + extra);
}

function pickKind(rng: RNG, bias: TrackTraits["branchBias"]): BranchSpec["kind"] {
  const pShortcut = bias === "shortcut" ? 0.8 : bias === "scenic" ? 0.2 : 0.5;
  return rng.next() < pShortcut ? "shortcut" : "scenic";
}

/** Smoothstep of x over [0, edge]. */
function riseTo(edge: number, x: number): number {
  const t = x <= 0 ? 0 : x >= edge ? 1 : x / edge;
  return t * t * (3 - 2 * t);
}

/**
 * Reject reason for one candidate branch against the mainline + earlier
 * branches; null = valid. Exported for the sweep test + generator tuning.
 */
export function branchRejectReason(
  m: MainSamples,
  index: SampleIndex,
  spec: BranchSpec,
  others: ReadonlyArray<BranchSpec>,
): string | null {
  const pts = spec.points;
  if (pts.length < 8) return "too-few-points";

  // Window bounds + span cap.
  const span = spec.tB - spec.tA;
  if (spec.tA < BRANCH_T_MIN || spec.tB > BRANCH_T_MAX || span <= 0) return "window";
  if (span > BRANCH_SPAN_MAX) return "span";

  // Endpoints sit on the mainline.
  const a = pointAtT(m, spec.tA, new Vector3());
  const b = pointAtT(m, spec.tB, new Vector3());
  const p0 = pts[0]!;
  const pn = pts[pts.length - 1]!;
  if (Math.hypot(p0[0] - a.x, p0[2] - a.z) > 1.5) return "endpoint-a";
  if (Math.hypot(pn[0] - b.x, pn[2] - b.z) > 1.5) return "endpoint-b";

  // Junction tangent match (compare first/last sampled segment directions).
  const tanA = tangentAtT(m, spec.tA, new Vector3());
  const tanB = tangentAtT(m, spec.tB, new Vector3());
  const dirIn = new Vector3(pts[1]![0] - p0[0], 0, pts[1]![2] - p0[2]).normalize();
  const prev = pts[pts.length - 2]!;
  const dirOut = new Vector3(pn[0] - prev[0], 0, pn[2] - prev[2]).normalize();
  if (Math.acos(clamp11(dirIn.dot(tanA))) > BRANCH_TANGENT_MAX) return "tangent-a";
  if (Math.acos(clamp11(dirOut.dot(tanB))) > BRANCH_TANGENT_MAX) return "tangent-b";

  // Curvature floor + length-ratio band per kind.
  const floor = spec.kind === "shortcut" ? SHORTCUT_RADIUS_FLOOR : SCENIC_RADIUS_FLOOR;
  if (minRadiusCoarse(pts) < floor) return "radius";
  const winLen = span * m.length;
  const ratio = lengthXZ(pts) / winLen;
  const band = spec.kind === "shortcut" ? SHORTCUT_RATIO : SCENIC_RATIO;
  if (ratio < band[0] || ratio > band[1]) return "ratio";

  // Grade cap along the branch.
  for (let i = 1; i < pts.length; i++) {
    const ds = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
    if (ds < 1e-6) continue;
    if (Math.abs(pts[i]![1] - pts[i - 1]![1]) / ds > BRANCH_GRADE_MAX) return "grade";
  }

  // Separation: full SEP_MIN_BRANCH outside the junction ramps; inside a
  // ramp the nearest mainline point must belong to the branch's OWN window
  // (foreign sections must never thread a junction mouth).
  const total = lengthXZ(pts);
  const rampArc = RAMP_FRACTION * total;
  let arc = 0;
  let plateau = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) arc += Math.hypot(p[0] - pts[i - 1]![0], p[2] - pts[i - 1]![2]);
    const k = index.nearestSample(p[0], p[2]);
    const d = Math.sqrt(index.sampleDistSq(k, p[0], p[2]));
    if (d >= SEP_MIN_BRANCH) {
      plateau++;
      continue;
    }
    const tK = k / m.n;
    if (tK < spec.tA - WINDOW_OWN_PAD || tK > spec.tB + WINDOW_OWN_PAD) return "foreign-approach";
    if (arc > rampArc && arc < total - rampArc) return "separation";
  }
  if (plateau / pts.length < PLATEAU_MIN_COVER) return "plateau";

  // Separation vs earlier branches (windows are disjoint, so no ramps).
  for (const o of others) {
    for (const p of pts) {
      for (const q of o.points) {
        if (Math.hypot(p[0] - q[0], p[2] - q[2]) < SEP_MIN_BRANCH) return "branch-separation";
      }
    }
  }
  return null;
}

/**
 * Construct one branch candidate for a GIVEN kind + window. Returns null
 * when the window fails the kind's cheap prechecks. Exported for
 * generator-tuning diagnostics.
 *
 * Shortcut: cubic Hermite from A to B whose end tangents ARE the mainline
 * tangents — drivable mouths by construction; the lateral gap comes from the
 * WINDOW curving away, so a pre-check demands the window arc/chord ratio and
 * junction-tangent/chord alignment that make a genuine cut possible.
 *
 * Scenic: the window's own centerline offset outward by a smooth
 * rise-plateau-fall profile; depth adapts to the ramp length so the bow
 * respects the scenic curvature floor, and the window itself must be
 * straight-ish so the offset does not fight mainline curvature.
 */
export function buildBranch(
  rng: RNG,
  m: MainSamples,
  kind: BranchSpec["kind"],
  tA: number,
  tB: number,
  taken: ReadonlyArray<BranchSpec>,
): BranchSpec | null {
  const L = m.length;
  const winLen = (tB - tA) * L;
  const halfWidth = kind === "shortcut" ? rng.range(3.5, 4.5) : rng.range(7.5, 9);

  // Window disjointness vs already-placed branches.
  for (const o of taken) {
    if (tA < o.tB + WINDOW_GAP && o.tA < tB + WINDOW_GAP) return null;
  }

  const a = pointAtT(m, tA, new Vector3());
  const b = pointAtT(m, tB, new Vector3());
  const tanA = tangentAtT(m, tA, new Vector3());
  const tanB = tangentAtT(m, tB, new Vector3());
  const count = Math.max(32, Math.round(winLen / 2));
  const points: Array<readonly [number, number, number]> = [];

  if (kind === "shortcut") {
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    if (chord < 30) return null;
    const arcChord = winLen / chord;
    if (arcChord < SHORTCUT_ARC_CHORD[0] || arcChord > SHORTCUT_ARC_CHORD[1]) return null;
    const cd = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    if (Math.acos(clamp11(cd.dot(tanA))) > SHORTCUT_CHORD_ALIGN) return null;
    if (Math.acos(clamp11(cd.dot(tanB))) > SHORTCUT_CHORD_ALIGN) return null;
    const mLen = 0.4 * chord;
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      const x = h00 * a.x + h10 * mLen * tanA.x + h01 * b.x + h11 * mLen * tanB.x;
      const z = h00 * a.z + h10 * mLen * tanA.z + h01 * b.z + h11 * mLen * tanB.z;
      const y = a.y + (b.y - a.y) * (u * u * (3 - 2 * u));
      points.push([x, y, z]);
    }
  } else {
    if (winLen < SCENIC_WIN_MIN) return null;
    if (windowMinRadius(m, tA, tB) < SCENIC_WINDOW_RADIUS_MIN) return null;
    const rampM = RAMP_FRACTION * winLen;
    const depthCap = Math.min(SCENIC_DEPTH[1], (rampM * rampM) / (6 * SCENIC_BOW_RADIUS));
    if (depthCap < SCENIC_DEPTH[0]) return null; // window too short to bow out
    const depth = rng.range(SCENIC_DEPTH[0], depthCap);
    const ccw = loopSignedArea(m) > 0;
    const base = new Vector3();
    const tan = new Vector3();
    const spanT = tB - tA;
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      const t = tA + spanT * u;
      pointAtT(m, t, base);
      tangentAtT(m, t, tan);
      // CCW loop: interior is LEFT of travel -> outward = right = (tz, -tx).
      const ox = ccw ? tan.z : -tan.z;
      const oz = ccw ? -tan.x : tan.x;
      const off = depth * riseTo(RAMP_FRACTION, u) * riseTo(RAMP_FRACTION, 1 - u);
      points.push([base.x + ox * off, base.y, base.z + oz * off]);
    }
  }
  return { kind, tA, tB, points, halfWidth };
}

/** Kind preference order from the biome bias (balanced -> rng picks). */
function kindOrder(rng: RNG, bias: TrackTraits["branchBias"]): Array<BranchSpec["kind"]> {
  const first = pickKind(rng, bias);
  return first === "shortcut" ? ["shortcut", "scenic"] : ["scenic", "shortcut"];
}

/** Window length candidates, longest first (long windows fit both kinds). */
function winLenCandidates(cap: number): number[] {
  const out: number[] = [];
  for (const w of [cap, 0.85 * cap, 0.7 * cap, 130, 100]) {
    if (w >= 90 && w <= cap && !out.some((v) => Math.abs(v - w) < 8)) out.push(w);
  }
  return out;
}

/**
 * Deterministic window SCAN for one branch: step tA around the lap (from an
 * rng phase so seeds vary), longest windows and the biome-preferred kind
 * first; the first candidate that passes full validation wins. Scanning
 * (not random draws) matters: valid windows are sparse — a fixed draw
 * budget misses them on most seeds, a scan finds every one that exists.
 * MAX_VALIDATIONS caps the expensive full-validation calls.
 */
function scanForBranch(
  rng: RNG,
  m: MainSamples,
  index: SampleIndex,
  traits: TrackTraits,
  taken: ReadonlyArray<BranchSpec>,
): BranchSpec | null {
  const L = m.length;
  const cap = Math.min(250, BRANCH_SPAN_MAX * L);
  const phase = rng.next();
  let budget = MAX_VALIDATIONS;
  for (const kind of kindOrder(rng, traits.branchBias)) {
    for (const winLen of winLenCandidates(cap)) {
      const spanT = winLen / L;
      const range = BRANCH_T_MAX - BRANCH_T_MIN - spanT;
      if (range <= 0) continue;
      const steps = Math.max(1, Math.floor((range * L) / SCAN_STEP_M));
      for (let i = 0; i < steps && budget > 0; i++) {
        const tA = BRANCH_T_MIN + ((phase + i / steps) % 1) * range;
        const spec = buildBranch(rng, m, kind, tA, tA + spanT, taken);
        if (!spec) continue;
        budget--;
        if (branchRejectReason(m, index, spec, taken) === null) return spec;
      }
    }
  }
  return null;
}

/**
 * Seed -> up to two validated branches for a mainline (possibly none: a
 * loop without a qualifying window stays branchless — drop, never a hard
 * failure). Deterministic in (seed, control, traits); independent of the
 * mainline attempt loop.
 */
export function generateBranches(
  seed: number,
  control: ReadonlyArray<readonly [number, number, number]>,
  traits: TrackTraits = DEFAULT_TRACK_TRAITS,
): BranchSpec[] {
  const rng = makeRNG(Math.imul((seed >>> 0) ^ 0x7f4a7c15, 0x85ebca77) >>> 0 || 1);
  const want = branchCount(rng, traits.branchChance);
  if (want === 0) return [];
  const m = sampleMainline(control);
  const index = new SampleIndex(m.x, m.z);
  const specs: BranchSpec[] = [];
  for (let k = 0; k < want; k++) {
    const spec = scanForBranch(rng, m, index, traits, specs);
    if (spec) specs.push(spec);
  }
  return specs;
}

function clamp11(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
