---
type: Subsystem
title: Circuit code
description: "Shareable circuit-code codec: Crockford base32, CRC-8, biome index."
tags: [terrain, circuits, codec, seed]
timestamp: 2026-07-08T00:00:00Z
---

# Schema

## CircuitId

A circuit identity is `{ seed: number; biome: number }` (`src/terrain/circuitCode.ts`):
a uint32 seed fed to `generateCircuit`, plus a stable biome index (see
[biomes.md](biomes.md), `BIOME_ORDER`). The biome is STORED, never re-derived
from the seed, so adding a biome never silently changes an existing code's
world.

## Codec (50-bit payload)

10 Crockford base32 symbols, shown `XXXX-XXXX-XX`. Bit layout:

| Bits   | Field       | Notes                          |
| ------ | ----------- | ------------------------------ |
| 49..46 | version     | `CODEC_VERSION = 1`            |
| 45..40 | biome index | 0..63 (see `BIOME_ORDER`)      |
| 39..8  | uint32 seed | fed to `generateCircuit`       |
| 7..0   | CRC-8       | poly 0x07 over the top 42 bits |

Built with plain Number arithmetic (`2^50 < MAX_SAFE_INTEGER`, no BigInt).
Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (0-9 A-Z minus I L O U). Decode is
case-insensitive with aliases `I`/`L` -> `1`, `O` -> `0`; dashes/spaces stripped.

## API

- `encodeCircuitCode(id): string` — canonical display form; clamps biome to
  0..63, coerces seed to uint32.
- `parseCircuitCode(code): CircuitId | null` — strict; `null` on wrong length,
  unknown symbol, version mismatch, or CRC failure.
- `decodeCircuitCode(code): CircuitId` — lenient, never throws; falls back to
  `DEFAULT_ID` (`{ seed: 1, biome: 0 }`).
- `isValidCircuitCode(code): boolean`.
- `normalizeCircuitId(input): CircuitId` — raw `{seed, biome}` object
  normalizer used by `src/core/circuitStorage.ts`; never throws.
- `parsePlainSeed(value): number | null` (078) — parses a plain numeric seed
  (decimal, or `0x`-prefixed hex, within uint32) into `>>> 0`, else `null`.
  Disambiguates from short codes by shape: an all-digit or `0x`-hex value is
  always a plain seed. Bare hex without `0x` returns null. No biome coupling.
- `resolveSeed(value): number` (078) — resolves ANY input to a uint32 seed and
  never returns null. A decimal/`0x`-hex integer in range is used directly;
  every other string is hashed via FNV-1a (`hashSeed`, `src/core/rng.ts`).
  Minecraft-style: there is no "invalid" seed. Trims first. The UI uses
  `parsePlainSeed` (numbers before codes) then falls back to this.

## Persistence + UI

`src/core/circuitStorage.ts` (`gamecart.circuit.v1`) stores the raw
`{ version, seed, biome }` object; never throws, falls back to `DEFAULT_ID`.
`Game.current: CircuitId` loads at boot and persists on player-driven rebuilds.
The `src/ui/SeedPicker.ts` menu surface edits the identity. `commit()` order:
a plain number (`parsePlainSeed`) is always a seed; otherwise a valid short
code (`parseCircuitCode`) decodes its frozen biome; otherwise the string
hashes to a seed (`resolveSeed`) and the biome is derived via `selectBiome`.
Every input resolves to a world (no reject state). COPY writes the canonical
code; RANDOM draws a fresh uint32 seed + derives the biome. The seed drives
the whole world — terrain relief + dressing + clouds + wildlife + weather —
not just the track (see [height-pipeline.md](height-pipeline.md)).

# Citations

- [circuits](circuits.md) — `generateCircuit` consumes the seed
- [biomes](biomes.md) — `BIOME_ORDER` / `biomeByIndex` stable index registry
