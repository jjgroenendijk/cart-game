/**
 * Terrain chunk CelMaterial builders, shared by TerrainChunkManager's steady
 * (solid) materials and the LOD cross-fade's transient dither materials. The
 * near builder mirrors the two-material split: HEIGHT_MAP per-pixel normals +
 * tier-gated surface detail (069). `mode` opts the material into a dither fade
 * so a chunk's old tier dissolves OUT while its new tier dissolves IN through
 * the fog band instead of snapping (see ./fade.ts + cel.ts fade/fadeInvert).
 */

import { makeCel, type CelMaterial, type HeightMapField } from "../materials/cel";
import { terrainDetailForTier } from "../materials/terrainDetail";
import type { QualityTier } from "../core/quality";

/** Cross-fade role: "off" solid, "in" dissolves in (fade), "out" dissolves out. */
export type FadeMode = "off" | "in" | "out";

function fadeOpts(mode: FadeMode): { fade?: boolean; fadeInvert?: boolean } {
  if (mode === "in") return { fade: true };
  if (mode === "out") return { fadeInvert: true };
  return {};
}

/**
 * Near CelMaterial: per-pixel heightmap normal + tier surface detail. Config is
 * byte-identical to the pre-cross-fade inline builder when `mode` is "off";
 * "in"/"out" only add the dither uniform + discard.
 */
export function buildNearCel(
  field: HeightMapField,
  tier: QualityTier,
  mode: FadeMode = "off",
): CelMaterial {
  const detail = terrainDetailForTier(tier);
  // Snow sparkle is the priciest snow path (hash glint); gate it off on low.
  // aerial recedes distant near-tiles toward the atmosphere colour.
  const snowSparkle = tier !== "low";
  const base = {
    vertexColors: true,
    heightMap: field,
    cel: false,
    wetness: true,
    aerial: true,
    snowCover: true,
    snowSparkle,
    ...fadeOpts(mode),
  };
  const material = detail.enabled
    ? makeCel({ ...base, surfaceDetail: true, detailOctaves: detail.octaves })
    : makeCel(base);
  if (detail.enabled) {
    material.uniforms.uDetailStrength.value = detail.strength;
    material.uniforms.uDetailScale.value = detail.scale;
    material.uniforms.uDetailBump.value = detail.bump;
  }
  return material;
}

/**
 * Far CelMaterial: vertex colours + vertex normals (no heightMap). Snow keys on
 * vWorldNormal; sparkle off (distant tiles don't warrant the glint cost).
 * aerial recedes distant tiles toward the atmosphere colour.
 */
export function buildFarCel(mode: FadeMode = "off"): CelMaterial {
  return makeCel({
    vertexColors: true,
    cel: false,
    wetness: true,
    snowCover: true,
    snowSparkle: false,
    aerial: true,
    ...fadeOpts(mode),
  });
}
