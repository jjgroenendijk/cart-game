import * as THREE from "three";

let gradientCache: THREE.DataTexture | null = null;

/**
 * Stepped 1D gradient map that gives MeshToonMaterial its banded lighting.
 * `bands` discrete brightness steps; NearestFilter produces hard cel edges.
 * Sampled by three's toon shader as `.r` at u = dotNL*0.5+0.5.
 */
export function toonGradient(bands = 3): THREE.DataTexture {
  if (gradientCache && (gradientCache.image as { width: number }).width === bands) {
    return gradientCache;
  }
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
  gradientCache = tex;
  return tex;
}

export interface ToonOpts {
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  vertexColors?: boolean;
}

/** Create a cel-shaded MeshToonMaterial with banded lighting. */
export function makeToon(opts: ToonOpts = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    gradientMap: toonGradient(3),
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors ?? false,
  });
  if (opts.emissive !== undefined) {
    mat.emissive = new THREE.Color(opts.emissive);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return mat;
}

/**
 * Return a copy of `geo` with true per-face (flat) normals, by de-indexing
 * and recomputing. MeshToonMaterial has no flatShading flag, so we bake the
 * faceted look into the geometry. Flat vertex normals also give crisper
 * outline displacement on faceted shapes.
 */
export function flatGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo.clone();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Inverted-hull outline: render the same geometry with BackSide, expanded
 * along vertex normals in the vertex shader. Returns a black silhouette
 * that peeks out around the mesh edges.
 */
export function makeOutline(thickness = 0.04): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness } },
    vertexShader: /* glsl */ `
      uniform float thickness;
      void main() {
        vec3 transformed = position + normal * thickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
    `,
    side: THREE.BackSide,
  });
}

/**
 * Attach an inverted-hull outline as a child of `mesh`. The outline shares the
 * source geometry and inherits the mesh transform. Returns the outline mesh.
 */
export function addOutline(mesh: THREE.Mesh, thickness = 0.04): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, makeOutline(thickness));
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}
