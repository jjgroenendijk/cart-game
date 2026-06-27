/**
 * 024 persisted kart selection v1. Pure (no DOM, no localStorage) so it runs
 * under jsdom. Owns the default per-player variant ids + validateSelection,
 * which normalizes any input into a 2-element KartVariantId[] (unknown ids
 * fall back to "balanced"). kartSelectionStorage.ts consumes these. Mirrors
 * the settings.ts pure-validation split.
 */

import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";

/** v1 defaults: both players on "balanced". */
export const DEFAULT_SELECTION: KartVariantId[] = ["balanced", "balanced"];

const VALID_IDS: ReadonlySet<string> = new Set(KART_VARIANTS.map((v) => v.id));

/**
 * Coerce any input into a valid 2-element KartVariantId[]. Never throws.
 * Non-array or empty -> fresh DEFAULT_SELECTION copy. Each of the first two
 * slots keeps its value only when it is a known variant id; otherwise the
 * slot falls back to "balanced". Elements beyond slot 1 are ignored. Always
 * returns a fresh array, so mutating the result never affects later calls or
 * DEFAULT_SELECTION.
 */
export function validateSelection(input: unknown): KartVariantId[] {
  if (!Array.isArray(input) || input.length === 0) return [...DEFAULT_SELECTION];
  return [pick(input[0]), pick(input[1])];
}

/** Keep value only when it is a known variant id; else default to balanced. */
function pick(value: unknown): KartVariantId {
  return typeof value === "string" && VALID_IDS.has(value) ? (value as KartVariantId) : "balanced";
}
