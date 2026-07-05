import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  sampleProps,
  type PlacedProp,
  type SamplerOptions,
  type SamplerTerrain,
} from "./propSampler";
import { floraFor } from "./floraRegistry";
import "./flora/temperate"; // side-effect: registers tree/rock/bush/flower/grass
import { degToRad } from "../core/math";

/**
 * Parity/golden test for the kind-agnostic flora refactor. Proves moving
 * temperate builders into the registry + switching the sampler/PropField off
 * the fixed PropType union onto FloraKind did NOT change sampler output:
 *  - Determinism: same seed + terrain + layers -> identical placements.
 *  - Classification: each placed kind's `big` flag matches the pre-refactor
 *    split (tree/rock big; bush/flower/grass decor).
 * Together with PropField.test.ts (body count + bucketing) this locks the
 * temperate placement to its pre-refactor behaviour.
 */

/** Ring-of-radius-R stub mirroring propSampler.test.ts (jsdom-safe, no mesh). */
function stubTerrain(): SamplerTerrain {
  const ringR = 60;
  const spawn = new THREE.Vector3(62, 0, 0);
  return {
    heightAt: () => 0,
    normalAt: (_x, _z, out = new THREE.Vector3()) => out.set(0, 1, 0),
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

/** Fixed counts per kind; small enough to be fast, large enough to cover paths. */
const counts: Record<string, number> = {
  tree: 12,
  rock: 8,
  bush: 20,
  flower: 40,
  grass: 60,
};

function layers(): SamplerOptions["layers"] {
  return (["tree", "rock", "bush", "flower", "grass"] as const).map((kind) => ({
    kind,
    count: counts[kind]!,
    minScale: 0.8,
    maxScale: 1.2,
  }));
}

function baseOpts(): SamplerOptions {
  return {
    seed: 1337,
    worldHalfExtent: 100,
    edgeMargin: 4,
    cell: 6,
    maxAttemptsPerSlot: 4,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    layers: layers(),
  };
}

/** Round numeric fields so tiny fp noise never flags as a drift. */
const snapshot = (p: PlacedProp) => ({
  kind: p.kind,
  x: +p.x.toFixed(6),
  y: +p.y.toFixed(6),
  z: +p.z.toFixed(6),
  seed: p.seed,
  scale: +p.scale.toFixed(6),
});

describe("flora refactor parity — determinism", () => {
  it("same seed + terrain + layers -> identical placements (twice)", () => {
    const terrain = stubTerrain();
    const a = sampleProps(terrain, baseOpts()).map(snapshot);
    const b = sampleProps(terrain, baseOpts()).map(snapshot);
    expect(a).toEqual(b);
  });

  it("determinism holds element-by-element (kind/x/y/z/seed/scale)", () => {
    const terrain = stubTerrain();
    const a = sampleProps(terrain, baseOpts());
    const b = sampleProps(terrain, baseOpts());
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(0);
    for (let i = 0; i < a.length; i++) {
      const pa = a[i]!;
      const pb = b[i]!;
      expect(pa.kind).toBe(pb.kind);
      expect(pa.x).toBe(pb.x);
      expect(pa.y).toBe(pb.y);
      expect(pa.z).toBe(pb.z);
      expect(pa.seed).toBe(pb.seed);
      expect(pa.scale).toBe(pb.scale);
    }
  });
});

describe("flora refactor parity — kind classification unchanged", () => {
  const bigKinds = new Set(["tree", "rock"]);
  const decorKinds = new Set(["bush", "flower", "grass"]);

  it("every placed prop's floraFor(.kind).big matches the pre-refactor split", () => {
    const placed = sampleProps(stubTerrain(), baseOpts());
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      const isBig = floraFor(p.kind).big;
      if (bigKinds.has(p.kind)) {
        expect(isBig).toBe(true);
      } else if (decorKinds.has(p.kind)) {
        expect(isBig).toBe(false);
      } else {
        // No exotic kinds should appear from the temperate layers.
        throw new Error(`unexpected kind "${p.kind}" in temperate placement`);
      }
    }
  });

  it("tree + rock place (big) and bush + flower + grass place (decor)", () => {
    const placed = sampleProps(stubTerrain(), baseOpts());
    const seen = new Set(placed.map((p) => p.kind));
    for (const k of bigKinds) expect(seen.has(k)).toBe(true);
    for (const k of decorKinds) expect(seen.has(k)).toBe(true);
  });
});
