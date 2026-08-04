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
 * Incoming ("in") geomorph meshes start fully morphed toward the OLD tier
 * (uMorph=1) so they match what the outgoing mesh shows at fade start; "out"
 * meshes start at their own tessellation (uMorph default 0). No-op when the
 * material has no uMorph uniform (geomorph off).
 */
function primeMorph(material: CelMaterial, mode: FadeMode, geomorph: boolean): CelMaterial {
  if (geomorph && mode === "in") material.uniforms.uMorph.value = 1;
  return material;
}

/**
 * Near CelMaterial: per-pixel heightmap normal + tier surface detail. Config is
 * byte-identical to the pre-cross-fade inline builder when `mode` is "off";
 * "in"/"out" add the dither uniform + discard, and `geomorph` the vertex-morph
 * attribute/uniform (see cel.ts `geomorph`).
 */
export function buildNearCel(
  field: HeightMapField,
  tier: QualityTier,
  mode: FadeMode = "off",
  geomorph = false,
  emissiveOutput = false,
): CelMaterial {
  const detail = terrainDetailForTier(tier);
  // Snow sparkle is the priciest snow path (hash glint); gate it off on low.
  // aerial recedes distant near-tiles toward the atmosphere colour.
  const snowSparkle = tier !== "low";
  // 283 sky env ambient: on for med/high (capture runs those tiers); off on low
  // keeps the flat ambient + a null uSkyEnv never gets sampled.
  const skyEnv = tier !== "low";
  const base = {
    vertexColors: true,
    heightMap: field,
    cel: false,
    wetness: true,
    aerial: true,
    snowCover: true,
    snowSparkle,
    skyEnv,
    geomorph,
    tempGrade: true,
    emissiveOutput,
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
  return primeMorph(material, mode, geomorph);
}

/**
 * Far CelMaterial: vertex colours + vertex normals (no heightMap). Snow keys on
 * vWorldNormal; sparkle off (distant tiles don't warrant the glint cost).
 * aerial recedes distant tiles toward the atmosphere colour. skyEnv mirrors the
 * near builder (on for med/high); default false keeps the dormant backdrop + a
 * plain build byte-identical to pre-283.
 */
export function buildFarCel(mode: FadeMode = "off", geomorph = false, skyEnv = false): CelMaterial {
  const opts = {
    vertexColors: true,
    cel: false,
    wetness: true,
    snowCover: true,
    snowSparkle: false,
    aerial: true,
    skyEnv,
    geomorph,
    tempGrade: true,
    ...fadeOpts(mode),
  };
  return primeMorph(makeCel(opts), mode, geomorph);
}
