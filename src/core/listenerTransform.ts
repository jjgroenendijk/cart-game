/**
 * 015 listener transform helper. Pure midpoint over human karts for the single
 * Web Audio listener (1P = that kart; 2P = midpoint of the two humans).
 * No THREE/Rapier/DOM deps so it is unit-testable under jsdom without init.
 */
import type { Vec3 } from "./math";
import type { ListenerTransform } from "../audio/rivalVoices";

/**
 * Average pos/forward/vel across the given vectors and normalize the forward.
 * Empty input -> origin pos, forward {0,0,-1}, zero vel. Deterministic; does
 * not mutate inputs. When `out` is omitted a fresh ListenerTransform is
 * returned; when supplied it is written in place (lets callers pool the
 * output and avoid per-frame allocs).
 */
export function listenerMidpoint(
  positions: readonly Vec3[],
  forwards: readonly Vec3[],
  velocities: readonly Vec3[],
  out?: ListenerTransform,
): ListenerTransform {
  const o = out ?? {
    pos: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    vel: { x: 0, y: 0, z: 0 },
  };
  const n = positions.length;
  if (n === 0) {
    o.pos.x = 0;
    o.pos.y = 0;
    o.pos.z = 0;
    o.forward.x = 0;
    o.forward.y = 0;
    o.forward.z = -1;
    o.vel.x = 0;
    o.vel.y = 0;
    o.vel.z = 0;
    return o;
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
  o.pos.x = px * inv;
  o.pos.y = py * inv;
  o.pos.z = pz * inv;
  o.forward.x = fxm / len;
  o.forward.y = fym / len;
  o.forward.z = fzm / len;
  o.vel.x = vx * inv;
  o.vel.y = vy * inv;
  o.vel.z = vz * inv;
  return o;
}
