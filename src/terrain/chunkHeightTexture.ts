import * as THREE from "three";
import type { HeightSource } from "./heightSource";

/**
 * Bake the world heightfield into a square float DataTexture for the
 * CelMaterial per-pixel normal path. Texel (i,j) centre sits at world
 * (origin + (i+0.5)/N*size, origin + (j+0.5)/N*size); height is stored in the
 * red channel (rgba float so any single-channel format quirk is avoided).
 * Nearest filtering: the shader finite-differences neighbours itself, so no
 * float-linear filtering support is required.
 */
export function buildHeightTexture(
  src: HeightSource,
  worldSize: number,
  texels: number,
): THREE.DataTexture {
  const data = new Float32Array(texels * texels * 4);
  const origin = -worldSize / 2;
  const step = worldSize / texels;
  let p = 0;
  for (let j = 0; j < texels; j++) {
    const z = origin + (j + 0.5) * step;
    for (let i = 0; i < texels; i++) {
      const x = origin + (i + 0.5) * step;
      const h = src.heightAt(x, z);
      data[p] = h;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 1;
      p += 4;
    }
  }
  const tex = new THREE.DataTexture(data, texels, texels, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
