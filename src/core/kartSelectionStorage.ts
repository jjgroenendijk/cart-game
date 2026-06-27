/**
 * 024 versioned localStorage persistence for the kart selection v1. Mirrors
 * storage.ts: every localStorage access is wrapped in try/catch so a
 * missing/corrupt/private-mode store never throws. loadKartSelection falls
 * back to DEFAULT_SELECTION, saveKartSelection is a no-op on failure. Pure
 * except for localStorage I/O; kartSelection.ts owns all validation. Uses a
 * distinct key from settings so the two stores never collide.
 */

import { DEFAULT_SELECTION, validateSelection } from "./kartSelection";
import type { KartVariantId } from "../kart/kartVariants";

const STORAGE_KEY = "gamecart.kartSelection.v1";
const SCHEMA_VERSION = 1;

interface StoredKartSelection {
  version: number;
  selection: unknown;
}

/**
 * Load the persisted kart selection. Returns a fresh DEFAULT_SELECTION copy
 * when the store is missing/corrupt or the schema version differs. Never
 * throws.
 */
export function loadKartSelection(): KartVariantId[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return [...DEFAULT_SELECTION];
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredKartSelection).version === SCHEMA_VERSION
    ) {
      return validateSelection((parsed as StoredKartSelection).selection);
    }
    return [...DEFAULT_SELECTION];
  } catch {
    return [...DEFAULT_SELECTION];
  }
}

/**
 * Persist the kart selection under the v1 schema. Normalizes the input via
 * validateSelection before writing so the store never holds an invalid id.
 * No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveKartSelection(selection: KartVariantId[]): void {
  try {
    const payload: StoredKartSelection = {
      version: SCHEMA_VERSION,
      selection: validateSelection(selection),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
