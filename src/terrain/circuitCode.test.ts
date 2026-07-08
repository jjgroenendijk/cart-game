import { describe, expect, it } from "vitest";
import {
  CODEC_VERSION,
  DEFAULT_ID,
  decodeCircuitCode,
  encodeCircuitCode,
  isValidCircuitCode,
  normalizeCircuitId,
  parseCircuitCode,
  parsePlainSeed,
  resolveSeed,
} from "./circuitCode";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("circuitCode", () => {
  it("CODEC_VERSION is 1", () => {
    expect(CODEC_VERSION).toBe(1);
  });

  it("DEFAULT_ID round-trips through encode then decode", () => {
    expect(decodeCircuitCode(encodeCircuitCode(DEFAULT_ID))).toEqual(DEFAULT_ID);
  });

  it("encodeCircuitCode emits canonical XXXX-XXXX-XX form", () => {
    const re = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/;
    expect(encodeCircuitCode(DEFAULT_ID)).toMatch(re);
    for (let i = 0; i < 100; i++) {
      expect(encodeCircuitCode({ seed: i, biome: i % 64 }), `i=${i}`).toMatch(re);
    }
  });

  it("round-trips 10000 random {seed, biome} pairs", () => {
    for (let i = 0; i < 10000; i++) {
      const seed = (i * 2654435761) >>> 0;
      const biome = i % 64;
      const parsed = parseCircuitCode(encodeCircuitCode({ seed, biome }));
      expect(parsed, `i=${i} seed=${seed} biome=${biome}`).not.toBeNull();
      expect(parsed!.seed, `i=${i} seed`).toBe(seed);
      expect(parsed!.biome, `i=${i} biome`).toBe(biome);
    }
  });

  it("CRC rejects every single-symbol mutation", () => {
    const code = encodeCircuitCode(DEFAULT_ID).replace(/-/g, "");
    for (let pos = 0; pos < 10; pos++) {
      for (let s = 0; s < 32; s++) {
        const sym = ALPHABET[s];
        if (sym === code[pos]) continue;
        const mutated = code.substring(0, pos) + sym + code.substring(pos + 1);
        expect(isValidCircuitCode(mutated), `pos=${pos} sym=${sym}`).toBe(false);
      }
    }
  });

  it("parses case-insensitively, applies I/L/O aliases, and ignores dashes/spaces", () => {
    let code = encodeCircuitCode(DEFAULT_ID);
    for (let s = 0; s < 2000; s++) {
      const candidate = encodeCircuitCode({ seed: s, biome: s % 64 });
      if (candidate.includes("1") && candidate.includes("0")) {
        code = candidate;
        break;
      }
    }
    const parsed = parseCircuitCode(code);
    expect(parsed, "baseline").not.toBeNull();
    expect(parseCircuitCode(code.toLowerCase()), "lowercase").toEqual(parsed);
    const aliased = code.replaceAll("1", "I").replaceAll("0", "O").toLowerCase();
    expect(parseCircuitCode(aliased), "aliased+lowercase").toEqual(parsed);
    const spaced = ` ${code.replaceAll("-", " - ")} `;
    expect(parseCircuitCode(spaced), "spaced+dashes").toEqual(parsed);
  });

  it("parseCircuitCode returns null for invalid input", () => {
    const stripped = encodeCircuitCode(DEFAULT_ID).replace(/-/g, "");
    expect(parseCircuitCode(""), "empty").toBeNull();
    expect(parseCircuitCode(stripped.slice(0, 9)), "9 symbols").toBeNull();
    expect(parseCircuitCode(`${stripped}0`), "11 symbols").toBeNull();
    expect(parseCircuitCode("!!!!-!!!!-!!"), "bangs").toBeNull();
    expect(parseCircuitCode(`U${stripped.slice(1)}`), "U").toBeNull();
    expect(parseCircuitCode(`u${stripped.slice(1)}`), "lower u").toBeNull();
    const lastSym = stripped[9];
    let flip = ALPHABET[0];
    if (flip === lastSym) flip = ALPHABET[1];
    expect(parseCircuitCode(`${stripped.slice(0, 9)}${flip}`), "crc corrupted").toBeNull();
  });

  it("decodeCircuitCode never throws and returns DEFAULT_ID", () => {
    const cases: unknown[] = ["", "garbage", "!!!!!!!!!!", undefined];
    for (const c of cases) {
      expect(() => decodeCircuitCode(c as string), `no-throw input=${String(c)}`).not.toThrow();
      expect(decodeCircuitCode(c as string), `result input=${String(c)}`).toEqual(DEFAULT_ID);
    }
  });

  it("isValidCircuitCode mirrors parseCircuitCode", () => {
    const good = encodeCircuitCode(DEFAULT_ID);
    const stripped = good.replace(/-/g, "");
    expect(isValidCircuitCode(good), "good").toBe(true);
    expect(isValidCircuitCode(""), "empty").toBe(false);
    expect(isValidCircuitCode(stripped.slice(0, 9)), "9 symbols").toBe(false);
    expect(isValidCircuitCode("!!!!-!!!!-!!"), "bangs").toBe(false);
    expect(isValidCircuitCode(`U${stripped.slice(1)}`), "U").toBe(false);
    const lastSym = stripped[9];
    let flip = ALPHABET[0];
    if (flip === lastSym) flip = ALPHABET[1];
    expect(isValidCircuitCode(`${stripped.slice(0, 9)}${flip}`), "crc corrupted").toBe(false);
  });

  it("clamps out-of-range biome to 0", () => {
    const high = parseCircuitCode(encodeCircuitCode({ seed: 1, biome: 99 }));
    expect(high?.biome, "biome 99").toBe(0);
    const neg = parseCircuitCode(encodeCircuitCode({ seed: 1, biome: -1 }));
    expect(neg?.biome, "biome -1").toBe(0);
  });

  it("round-trips the full uint32 seed range", () => {
    const parsed = parseCircuitCode(encodeCircuitCode({ seed: 0xffffffff, biome: 0 }));
    expect(parsed, "parses").not.toBeNull();
    expect(parsed!.seed, "seed").toBe(0xffffffff);
  });

  it("normalizeCircuitId coerces seed to uint32 and clamps out-of-range biome", () => {
    expect(normalizeCircuitId({ seed: -1, biome: 0 })).toEqual({ seed: 4294967295, biome: 0 });
    expect(normalizeCircuitId({ seed: 1, biome: 99 })).toEqual({ seed: 1, biome: 0 });
    expect(normalizeCircuitId({ seed: 1, biome: -1 })).toEqual({ seed: 1, biome: 0 });
    expect(normalizeCircuitId({ seed: 7, biome: 3 })).toEqual({ seed: 7, biome: 3 });
  });

  it("normalizeCircuitId falls back to DEFAULT_ID for non-objects + bad fields", () => {
    expect(normalizeCircuitId(null)).toEqual(DEFAULT_ID);
    expect(normalizeCircuitId(undefined)).toEqual(DEFAULT_ID);
    expect(normalizeCircuitId("nope")).toEqual(DEFAULT_ID);
    expect(normalizeCircuitId({ seed: "x", biome: 0 })).toEqual(DEFAULT_ID);
    expect(normalizeCircuitId({ seed: 1, biome: NaN })).toEqual(DEFAULT_ID);
  });

  it("parsePlainSeed accepts decimal integers in the uint32 range", () => {
    expect(parsePlainSeed("0")).toBe(0);
    expect(parsePlainSeed("12345")).toBe(12345);
    expect(parsePlainSeed("4294967295")).toBe(0xffffffff);
  });

  it("parsePlainSeed accepts 0x-prefixed hex (any case) in the uint32 range", () => {
    expect(parsePlainSeed("0xff")).toBe(0xff);
    expect(parsePlainSeed("0xDEADBEEF")).toBe(0xdeadbeef);
    expect(parsePlainSeed("0x00000000")).toBe(0);
    expect(parsePlainSeed("0xFFFFFFFF")).toBe(0xffffffff);
  });

  it("parsePlainSeed trims surrounding whitespace", () => {
    expect(parsePlainSeed("  42 ")).toBe(42);
    expect(parsePlainSeed("\t0x10\n")).toBe(0x10);
  });

  it("parsePlainSeed rejects out-of-range, bare hex, codes, and garbage", () => {
    expect(parsePlainSeed("4294967296"), "uint32 overflow").toBeNull();
    expect(parsePlainSeed("9999999999"), "10-digit overflow").toBeNull();
    expect(parsePlainSeed("deadbeef"), "bare hex").toBeNull();
    expect(parsePlainSeed("0x100000000"), "hex overflow").toBeNull();
    expect(parsePlainSeed("KX7Q-2M9F-P4"), "short code").toBeNull();
    expect(parsePlainSeed(""), "empty").toBeNull();
    expect(parsePlainSeed("1.5"), "fraction").toBeNull();
    expect(parsePlainSeed("-1"), "negative").toBeNull();
    expect(parsePlainSeed("0xGHIJKL"), "bad hex").toBeNull();
    expect(parsePlainSeed("hello"), "garbage").toBeNull();
  });

  it("parsePlainSeed returns null for non-string input", () => {
    expect(parsePlainSeed(undefined as unknown as string)).toBeNull();
    expect(parsePlainSeed(null as unknown as string)).toBeNull();
  });

  it("resolveSeed uses an in-range decimal/hex integer directly", () => {
    expect(resolveSeed("12345")).toBe(12345);
    expect(resolveSeed("0xDEADBEEF")).toBe(0xdeadbeef);
    expect(resolveSeed("  42 ")).toBe(42);
  });

  it("resolveSeed always returns a uint32 (never null/NaN) for any input", () => {
    const cases = ["hello", "deadbeef", "-1", "1.5", "0xGHIJKL", "4294967296", ""];
    for (const c of cases) {
      const s = resolveSeed(c);
      expect(Number.isInteger(s), `${JSON.stringify(c)} integer`).toBe(true);
      expect(s, `${JSON.stringify(c)} range`).toBeGreaterThanOrEqual(0);
      expect(s, `${JSON.stringify(c)} range`).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("resolveSeed is deterministic + stable (same string -> same seed)", () => {
    expect(resolveSeed("hello")).toBe(resolveSeed("hello"));
    expect(resolveSeed("My Cool Track")).toBe(resolveSeed("My Cool Track"));
    // Trimming: surrounding whitespace does not change the hash.
    expect(resolveSeed("  hello  ")).toBe(resolveSeed("hello"));
  });

  it("resolveSeed distinguishes different strings (no constant hash)", () => {
    expect(resolveSeed("hello")).not.toBe(resolveSeed("world"));
    expect(resolveSeed("deadbeef")).not.toBe(0xdeadbeef); // bare hex -> hash, not the number
  });
});
