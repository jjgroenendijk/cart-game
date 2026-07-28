import { clamp, type Vec3 } from "../core/math";

/** Ray-hit descriptor passed to the clamp (matches PhysicsWorld scratch). */
export interface RayHit {
  toi: number;
  normal: Vec3;
}

export interface ClampOptions {
  /** World-space skin pulled back along the ray so the cam sits off geometry. */
  skin: number;
  /** Minimum camera distance from origin; guards false near-zero toi. */
  minDist: number;
}

export const DEFAULT_CAMERA_CLAMP: ClampOptions = {
  skin: 0.3,
  minDist: 2.0,
};

/**
 * Clamp a chase-camera target so it never sits inside geometry (147). Casts
 * conceptually from `origin` (kart pos) along the unit `dir` toward the desired
 * pose at `desiredDist`. With no hit, or a hit at/ beyond the desired distance,
 * the target is unchanged (written to `out` as origin + dir*desiredDist). With
 * an obstruction, the target is placed at origin + dir*max(minDist, toi - skin)
 * — an along-ray pull-back (stable, no lateral jitter). `out` is mutated and
 * returned so callers reuse a scratch Vector3 with zero allocation. `dir` is
 * assumed already normalized by the caller.
 */
export function clampCameraDistance(
  origin: Vec3,
  dir: Vec3,
  desiredDist: number,
  hit: RayHit | null,
  out: Vec3,
  options: ClampOptions = DEFAULT_CAMERA_CLAMP,
): Vec3 {
  const { skin, minDist } = options;
  const dist =
    hit !== null && hit.toi < desiredDist
      ? clamp(hit.toi - skin, minDist, desiredDist)
      : desiredDist;
  out.x = origin.x + dir.x * dist;
  out.y = origin.y + dir.y * dist;
  out.z = origin.z + dir.z * dist;
  return out;
}
