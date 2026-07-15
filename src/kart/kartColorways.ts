/**
 * 083 kart colorway (paint) registry. Named body+accent pairs the
 * player picks independently of the chassis model. The first six are the
 * legacy variant colors, so every variant's stock look maps 1:1 onto a
 * colorway; two extras (midnight, pearl) widen the field. Pure + WebGL-free
 * (only imports the KartColors type and makeRNG) so tests run under jsdom.
 */

import type { KartColors } from "./Kart";
import { makeRNG } from "../core/rng";

export type KartColorwayId =
  "ember" | "glacier" | "moss" | "violet" | "amber" | "lagoon" | "midnight" | "pearl" | "rally";

export interface KartColorway {
  id: KartColorwayId;
  name: string;
  colors: KartColors;
}

export const KART_COLORWAYS: KartColorway[] = [
  { id: "ember", name: "Ember", colors: { body: 0xff5252, accent: 0xffd23f } },
  { id: "glacier", name: "Glacier", colors: { body: 0x4fc3f7, accent: 0xffffff } },
  { id: "moss", name: "Moss", colors: { body: 0x66bb6a, accent: 0x222222 } },
  { id: "violet", name: "Violet", colors: { body: 0xab47bc, accent: 0xffd23f } },
  { id: "amber", name: "Amber", colors: { body: 0xff9800, accent: 0xfff3e0 } },
  { id: "lagoon", name: "Lagoon", colors: { body: 0x26a69a, accent: 0xc6ff00 } },
  { id: "midnight", name: "Midnight", colors: { body: 0x37474f, accent: 0xff7043 } },
  { id: "pearl", name: "Pearl", colors: { body: 0xf5f0e6, accent: 0xd32f2f } },
  { id: "rally", name: "Rally Red", colors: { body: 0xe52f32, accent: 0xd8d7cf } },
];

export function colorwayById(id: KartColorwayId): KartColorway {
  const c = KART_COLORWAYS.find((x) => x.id === id);
  if (!c) throw new Error(`colorwayById: unknown colorway id "${id}"`);
  return c;
}

/**
 * Deterministic rival paint via makeRNG. The hash constant differs from
 * variantForRival's so a rival's model and paint decorrelate — the same
 * (seed, index) never pins paint to model.
 */
export function colorwayForRival(seed: number, index: number): KartColorwayId {
  const rng = makeRNG((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
  return rng.pick(KART_COLORWAYS).id;
}
