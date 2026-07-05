/**
 * 059/060 route-aware helpers over the track graph. Pure (no Game/physics/
 * DOM; plain {x,y,z} points) -> jsdom-testable. FieldBuilder applies the
 * returned poses to Rapier bodies.
 */

import { wrap01 } from "./checkpoints";

/** Respawn distance past the nearest centerline point (m). */
export const RESPAWN_AHEAD_M = 5.6;

/** Minimal terrain surface the respawn helper needs (Terrain satisfies it). */
export interface RespawnWorld {
  closestPose(
    x: number,
    z: number,
  ): {
    t: number;
  };
  spline: {
    getPoint(t: number, out?: { x: number; y: number; z: number }): { x: number; z: number };
    curve: { getTangent(t: number): { x: number; z: number } };
  };
  heightAt(x: number, z: number): number;
}

export interface RespawnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * On-corridor respawn pose a bit AHEAD of the kart's nearest centerline
 * point, facing along the path (yaw such that kart forward -Z aligns with
 * the tangent). `clearance` lifts the pose off the surface.
 */
export function respawnPose(
  world: RespawnWorld,
  x: number,
  z: number,
  aheadT: number,
  clearance: number,
): RespawnPose {
  const close = world.closestPose(x, z);
  const t = wrap01(close.t + aheadT);
  const point = world.spline.getPoint(t);
  const tan = world.spline.curve.getTangent(t);
  const yaw = Math.atan2(-tan.x, -tan.z);
  return {
    x: point.x,
    y: world.heightAt(point.x, point.z) + clearance,
    z: point.z,
    yaw,
  };
}
