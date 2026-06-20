import * as THREE from "three";

/**
 * Stepped 1D gradient DataTexture: `bands` discrete brightness steps mapped
 * via NearestFilter to hard cel edges. Kept as a tuning/reference helper —
 * CelMaterial does equivalent banding in-shader (floor(NdL*bands)/bands) and
 * does NOT sample this texture by default. The values it produces are the
 * reference used by the cel unit tests to assert the shader's band math.
 */
export function celGradient(bands = 3): THREE.DataTexture {
  const data = new Uint8Array(bands);
  for (let i = 0; i < bands; i++) {
    data[i] = Math.round(((i + 1) / bands) * 255);
  }
  const tex = new THREE.DataTexture(data, bands, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
