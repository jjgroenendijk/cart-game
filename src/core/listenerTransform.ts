/**
 * 015 listener transform helper. Pure midpoint over human karts for the single
 * Web Audio listener (1P = that kart; 2P = midpoint of the two humans).
 * No THREE/Rapier/DOM deps so it is unit-testable under jsdom without init.
 */
import type { Vec3 } from "./math";
import type { ListenerTransform } from "../audio/rivalVoices";

/**
 * Average pos/forward/vel across the given vectors and normalize the forward.
 * Empty input -> origin pos, forward {0,0,-1}, zero vel. Deterministic +
 * side-effect free; does not mutate inputs.
 */
export function listenerMidpoint(
  positions: readonly Vec3[],
  forwards: readonly Vec3[],
  velocities: readonly Vec3[],
): ListenerTransform {
  const n = positions.length;
  if (n === 0) {
    return {
      pos: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      vel: { x: 0, y: 0, z: 0 },
    };
  }
  let px = 0;
  let py = 0;
  let pz = 0;
  let fx = 0;
  let fy = 0;
  let fz = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let i = 0; i < n; i++) {
    const p = positions[i]!;
    const f = forwards[i]!;
    const v = velocities[i]!;
    px += p.x;
    py += p.y;
    pz += p.z;
    fx += f.x;
    fy += f.y;
    fz += f.z;
    vx += v.x;
    vy += v.y;
    vz += v.z;
  }
  const inv = 1 / n;
  const fxm = fx * inv;
  const fym = fy * inv;
  const fzm = fz * inv;
  const len = Math.hypot(fxm, fym, fzm) || 1;
  return {
    pos: { x: px * inv, y: py * inv, z: pz * inv },
    forward: { x: fxm / len, y: fym / len, z: fzm / len },
    vel: { x: vx * inv, y: vy * inv, z: vz * inv },
  };
}
