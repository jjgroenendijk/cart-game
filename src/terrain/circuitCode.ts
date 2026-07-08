/**
 * Pure short-code codec for circuit identities (task 058).
 *
 * Encodes a {@link CircuitId} ({seed, biome}) into a 10-symbol human code and
 * back. Pure module: no DOM, no localStorage, no three.js -> runs under jsdom.
 * No legacy decode path -- no codes exist in the wild.
 *
 * Bit layout (50-bit payload = 10 Crockford base32 symbols, 5 bits each):
 *
 *   bits 49..46 (4)  version  (CODEC_VERSION)
 *   bits 45..40 (6)  biome    (0..63)
 *   bits 39.. 8 (32) seed     (uint32)
 *   bits  7.. 0 (8)  CRC-8    (poly 0x07)
 *
 * Built with plain Number arithmetic (2^50 < MAX_SAFE_INTEGER):
 *
 *   data42    = version * 2^38 + biome * 2^32 + seed
 *   crc       = crc8(data42 as 6 big-endian bytes)
 *   payload50 = data42 * 256 + crc
 *
 * Alphabet (Crockford base32): "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
 * (0-9 then A-Z minus I, L, O, U). Decode is case-insensitive with aliases
 * I/L -> 1 and O -> 0.
 */

import { hashSeed } from "../core/rng";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const DECODE_MAP: Partial<Record<string, number>> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
  map["I"] = 1;
  map["L"] = 1;
  map["O"] = 0;
  return map;
})();

/** 2^38. */
const SHIFT_38 = 274877906944;
/** 2^32. */
const SHIFT_32 = 4294967296;

/** Circuit identity: uint32 seed + biome index (0..63). */
export interface CircuitId {
  /** Unsigned 32-bit seed fed to generateCircuit. */
  seed: number;
  /** Stable biome index (see BIOME_ORDER in biomes.ts). 0..63. */
  biome: number;
}

/** Default circuit identity: seed 1 (FALLBACK_SEED), biome 0 (temperate). */
export const DEFAULT_ID: CircuitId = { seed: 1, biome: 0 };

/** Current codec version field value. */
export const CODEC_VERSION = 1;

/** Split `value` into `count` big-endian bytes via division/modulo by 256. */
function toBytesBE(value: number, count: number): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) {
    const divisor = 256 ** (count - 1 - i);
    bytes.push(Math.floor(value / divisor) % 256);
  }
  return bytes;
}

/** CRC-8/SMBus: poly 0x07, init 0x00, no reflection, xorout 0x00. */
function crc8(bytes: ReadonlyArray<number>): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

/**
 * Encode a {@link CircuitId} into its canonical `XXXX-XXXX-XX` display string.
 * Normalizes `seed` to uint32 and clamps out-of-range biome to 0.
 */
export function encodeCircuitCode(id: CircuitId): string {
  const seed = id.seed >>> 0;
  const biomeRaw = Math.floor(id.biome);
  const biome = biomeRaw >= 0 && biomeRaw <= 63 ? biomeRaw : 0;
  const data42 = CODEC_VERSION * SHIFT_38 + biome * SHIFT_32 + seed;
  const crc = crc8(toBytesBE(data42, 6));
  const payload50 = data42 * 256 + crc;
  let symbols = "";
  for (let i = 0; i < 10; i++) {
    const idx = Math.floor(payload50 / 32 ** (9 - i)) % 32;
    symbols += ALPHABET[idx];
  }
  return `${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8, 10)}`;
}

/**
 * Strict parse. Strips dashes/whitespace, accepts case-insensitive input with
 * `I`/`L`/`O` aliases. Returns the decoded id, or `null` on wrong length,
 * unknown symbol, version mismatch, or CRC failure.
 */
export function parseCircuitCode(code: string): CircuitId | null {
  if (typeof code !== "string") return null;
  const stripped = code.replace(/[-\s]/g, "").toUpperCase();
  if (stripped.length !== 10) return null;
  let payload50 = 0;
  for (let i = 0; i < 10; i++) {
    const val = DECODE_MAP[stripped[i]];
    if (val === undefined) return null;
    payload50 = payload50 * 32 + val;
  }
  const crc = payload50 % 256;
  const data42 = Math.floor(payload50 / 256);
  const version = Math.floor(data42 / SHIFT_38);
  if (version !== CODEC_VERSION) return null;
  const biome = Math.floor(data42 / SHIFT_32) % 64;
  const seed = data42 % SHIFT_32;
  if (crc !== crc8(toBytesBE(data42, 6))) return null;
  return { seed: seed >>> 0, biome };
}

/**
 * Lenient decode that never throws. Delegates to {@link parseCircuitCode} and
 * falls back to {@link DEFAULT_ID} on any failure.
 */
export function decodeCircuitCode(code: string): CircuitId {
  return parseCircuitCode(code) ?? DEFAULT_ID;
}

/**
 * Parse a plain numeric seed (078): accepts a decimal integer or a `0x`-prefixed
 * hex integer, both within the uint32 range. Returns the `>>> 0` seed, or `null`
 * for anything else (bare hex, out of range, garbage). Pure: no DOM, no biome.
 *
 * Disambiguates from short codes by SHAPE, not by trying `parseCircuitCode`
 * first: an all-digit or `0x`-hex input is always a plain seed (so a pure-digit
 * string can never accidentally decode as a short code). Bare hex without a
 * `0x` prefix is rejected to avoid ambiguity with a mistyped code.
 */
export function parsePlainSeed(value: string): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) {
    const hex = /^0x[0-9a-f]{1,8}$/i.exec(trimmed);
    if (hex === null) return null;
    return Number.parseInt(trimmed, 16) >>> 0;
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
  return n >>> 0;
}

/**
 * Resolve ANY input to a uint32 seed (078): a decimal or `0x`-hex integer in
 * the uint32 range is used directly; every other string hashes to a stable
 * uint32 via FNV-1a (`hashSeed`). Never returns null -- every input resolves
 * to a seed (Minecraft-style), so the UI has no "invalid seed" state. Pure:
 * no DOM, no biome. Trims first so `" hello "` and `"hello"` collide.
 */
export function resolveSeed(value: string): number {
  const direct = parsePlainSeed(value);
  if (direct !== null) return direct;
  const str = typeof value === "string" ? value.trim() : "";
  return hashSeed(str);
}

/** True iff {@link parseCircuitCode} returns a non-null id for `code`. */
export function isValidCircuitCode(code: string): boolean {
  return parseCircuitCode(code) !== null;
}

/**
 * Normalize an unknown input into a valid {@link CircuitId}. Non-objects,
 * missing/non-finite fields, or out-of-range biome fall back to
 * {@link DEFAULT_ID}. `seed` is coerced to uint32, `biome` clamped to 0..63
 * (out of range -> 0). Never throws; used by circuitStorage to validate the
 * persisted raw object.
 */
export function normalizeCircuitId(input: unknown): CircuitId {
  if (input === null || typeof input !== "object") return { ...DEFAULT_ID };
  const obj = input as { seed?: unknown; biome?: unknown };
  const seed = Number(obj.seed);
  const biome = Number(obj.biome);
  if (!Number.isFinite(seed) || !Number.isFinite(biome)) return { ...DEFAULT_ID };
  const b = Math.floor(biome);
  return { seed: Math.floor(seed) >>> 0, biome: b >= 0 && b <= 63 ? b : 0 };
}
