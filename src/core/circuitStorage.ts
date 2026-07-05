/**
 * 058 versioned localStorage persistence for the circuit id v1. Mirrors
 * storage.ts: every localStorage access is wrapped in try/catch so a
 * missing/corrupt/private-mode store never throws. loadCircuitId falls
 * back to DEFAULT_ID, saveCircuitId is a no-op on failure. Pure except
 * for localStorage I/O; circuitCode.ts owns all normalization. Uses a
 * distinct key from settings/kartSelection so the stores never collide.
 */

import { DEFAULT_ID, normalizeCircuitId } from "../terrain/circuitCode";
import type { CircuitId } from "../terrain/circuitCode";

const STORAGE_KEY = "gamecart.circuit.v1";
const SCHEMA_VERSION = 1;

interface StoredCircuitId {
  version: number;
  seed: unknown;
  biome: unknown;
}

/**
 * Load the persisted circuit id. Returns a fresh DEFAULT_ID copy when the
 * store is missing/corrupt or the schema version differs. Never throws.
 */
export function loadCircuitId(): CircuitId {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_ID };
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredCircuitId).version === SCHEMA_VERSION
    ) {
      const stored = parsed as StoredCircuitId;
      return normalizeCircuitId({ seed: stored.seed, biome: stored.biome });
    }
    return { ...DEFAULT_ID };
  } catch {
    return { ...DEFAULT_ID };
  }
}

/**
 * Persist the circuit id under the v1 schema. Normalizes the input via
 * normalizeCircuitId before writing so the store never holds an invalid id.
 * No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveCircuitId(id: CircuitId): void {
  try {
    const norm = normalizeCircuitId(id);
    const payload: StoredCircuitId = {
      version: SCHEMA_VERSION,
      seed: norm.seed,
      biome: norm.biome,
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
