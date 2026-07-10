/**
 * 024/083 versioned localStorage persistence for the kart selection. Mirrors
 * storage.ts: every localStorage access is wrapped in try/catch so a
 * missing/corrupt/private-mode store never throws. loadKartSelection falls
 * back to DEFAULT_SELECTION, saveKartSelection is a no-op on failure. Pure
 * except for localStorage I/O; kartSelection.ts owns all validation. Schema
 * v2 stores `{ variant, colorway }` picks; v1 payloads (bare variant-id
 * strings) load through the same validator, which upgrades them to the
 * variant's stock colorway. Saves always write v2. Uses a distinct key from
 * settings so the two stores never collide.
 */

import { DEFAULT_SELECTION, validateSelection, type KartPick } from "./kartSelection";

const STORAGE_KEY = "gamecart.kartSelection.v1";
const SCHEMA_VERSION = 2;
/** v1 stored bare variant-id strings; still readable (forward-migrated). */
const LEGACY_VERSION = 1;

interface StoredKartSelection {
  version: number;
  selection: unknown;
}

/**
 * Load the persisted kart selection. Returns a fresh DEFAULT_SELECTION copy
 * when the store is missing/corrupt or the schema version is unknown. A v1
 * payload is migrated in-memory (stock colorway per variant). Never throws.
 */
export function loadKartSelection(): KartPick[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return validateSelection(undefined);
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const stored = parsed as StoredKartSelection;
      if (stored.version === SCHEMA_VERSION || stored.version === LEGACY_VERSION) {
        return validateSelection(stored.selection);
      }
    }
    return validateSelection(undefined);
  } catch {
    return DEFAULT_SELECTION.map((p) => ({ ...p }));
  }
}

/**
 * Persist the kart selection under the v2 schema. Normalizes the input via
 * validateSelection before writing so the store never holds an invalid pick.
 * No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveKartSelection(selection: readonly KartPick[]): void {
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
