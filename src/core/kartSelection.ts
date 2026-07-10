/**
 * 024/083 persisted kart selection v2. Pure (no DOM, no localStorage) so it
 * runs under jsdom. A selection is 2 per-player picks of `{ variant,
 * colorway }`; validateSelection normalizes any input into that shape.
 * Bare variant-id strings (the v1 schema) are accepted and upgraded to the
 * variant's stock colorway, so storage migration is free. Unknown variants
 * fall back to "balanced"; unknown colorways fall back to the picked
 * variant's stock paint. kartSelectionStorage.ts consumes these. Mirrors
 * the settings.ts pure-validation split.
 */

import { KART_VARIANTS, variantById, type KartVariantId } from "../kart/kartVariants";
import { KART_COLORWAYS, type KartColorwayId } from "../kart/kartColorways";

/** One player's kart choice: chassis model (variant) + paint (colorway). */
export interface KartPick {
  variant: KartVariantId;
  colorway: KartColorwayId;
}

/** v2 defaults: both players on the stock balanced kart. */
export const DEFAULT_SELECTION: KartPick[] = [
  { variant: "balanced", colorway: "ember" },
  { variant: "balanced", colorway: "ember" },
];

const VALID_VARIANTS: ReadonlySet<string> = new Set(KART_VARIANTS.map((v) => v.id));
const VALID_COLORWAYS: ReadonlySet<string> = new Set(KART_COLORWAYS.map((c) => c.id));

/**
 * Coerce any input into a valid 2-element KartPick[]. Never throws.
 * Non-array or empty -> fresh DEFAULT_SELECTION copy. Each of the first two
 * slots accepts a v1 variant-id string or a v2 pick object; anything else
 * falls back to the default pick. Elements beyond slot 1 are ignored. Always
 * returns fresh picks, so mutating the result never affects later calls or
 * DEFAULT_SELECTION.
 */
export function validateSelection(input: unknown): KartPick[] {
  if (!Array.isArray(input) || input.length === 0) {
    return DEFAULT_SELECTION.map((p) => ({ ...p }));
  }
  return [pick(input[0]), pick(input[1])];
}

function pick(value: unknown): KartPick {
  // v1 shape: a bare variant-id string -> upgrade with the stock colorway.
  if (typeof value === "string") return fromVariant(value);
  if (value !== null && typeof value === "object") {
    const v = value as { variant?: unknown; colorway?: unknown };
    const base = fromVariant(v.variant);
    if (typeof v.colorway === "string" && VALID_COLORWAYS.has(v.colorway)) {
      base.colorway = v.colorway as KartColorwayId;
    }
    return base;
  }
  return { ...DEFAULT_SELECTION[0]! };
}

/** Valid variant id -> that variant in its stock paint; else default pick. */
function fromVariant(value: unknown): KartPick {
  if (typeof value === "string" && VALID_VARIANTS.has(value)) {
    const id = value as KartVariantId;
    return { variant: id, colorway: variantById(id).colorway };
  }
  return { ...DEFAULT_SELECTION[0]! };
}
