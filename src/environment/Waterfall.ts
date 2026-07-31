import * as THREE from "three";
import { makeRNG } from "../core/rng";
import { makeCel } from "../materials/cel";

/**
 * Atmospheric waterfall landmark (autumn-forest only). Unlike {@link Weather}
 * this is a WORLD-FIXED landmark: it sits at `opts.position` and never follows
 * the focus. It mirrors the Weather module contract (`group`, `update(dt,
 * focusX, focusZ)`, `dispose()`) so Environment can wire it into the same
 * per-frame cascade.
 *
 * Four cel-faithful, fog/aerial-aware layers, all self-contained (no terrain
 * relief required — the cliff supplies its own vertical rock):
 *
 *  1. A tall dark WET CLIFF FACE — cel-shaded low-poly rock (makeCel, flat
 *     facets, aerial perspective) the water pours over. Built from a few
 *     seed-jittered boxes so the massif reads craggy, not a clean slab.
 *  2. An animated FALLING-WATER SHEET — vertical plane(s) with a raw
 *     ShaderMaterial scrolling a value-noise pattern DOWNWARD by `uTime`,
 *     quantized into a few cel brightness bands (bright white-cyan) with foam
 *     at the side edges + the splash base. Respects scene fog (USE_FOG).
 *  3. Billowing MIST/SPRAY — a soft GPU Points field at the base (mirrors
 *     Weather.buildField's soft-flake approach: depthWrite:false, round
 *     sprites, gentle sway, uTime-driven wrap) that RISES and fades near the
 *     top of its column.
 *  4. A POOL/FOAM ring — a cel disc where the water lands plus a shader foam
 *     band that breathes with `uTime`.
 *
 * All geometry/material construction is WebGL-free (jsdom-safe): only rendering
 * needs a GL context, and `update()` merely advances scalar uniforms.
 */

const MIST_LAYER = 0; // same reasoning as Weather: visible, layer 0

/** Compact hash + value-noise, shared by the sheet + foam shaders. */
const GLSL_NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;

const SHEET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SHEET_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uBands;
  uniform vec3 uColor;
  uniform vec3 uFoam;
  uniform float uOpacity;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec2 vUv;
  varying vec3 vViewPos;
  ${GLSL_NOISE}
  void main() {
    // Scroll the pattern DOWNWARD: a fixed feature drifts toward lower y as
    // uTime grows, so the water reads as falling. Two octaves give ropey
    // streaks over a broad flow.
    float y = vUv.y - uTime * uSpeed;
    float n = vnoise(vec2(vUv.x * 6.0, y * 4.0)) * 0.6
            + vnoise(vec2(vUv.x * 15.0, y * 11.0)) * 0.4;
    // Quantize brightness into cel bands (bright, never neon).
    float b = 0.55 + 0.5 * n;
    b = floor(b * uBands) / uBands + 0.5 / uBands;
    vec3 c = uColor * b;
    // Foam: soft side edges + the splash base where the sheet meets the pool.
    float sides = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
    float base = smoothstep(0.16, 0.0, vUv.y);
    float foam = clamp((1.0 - sides) + base * 0.9, 0.0, 1.0);
    c = mix(c, uFoam, foam);
    float a = uOpacity * mix(0.55, 1.0, sides);
    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    c = mix(c, fogColor, fogFactor);
    #endif
    gl_FragColor = vec4(c, a);
  }
`;

const MIST_VERT = /* glsl */ `
  attribute vec3 velocity;
  uniform float uTime;
  uniform float uHalf;
  uniform float uRise;
  uniform float uSize;
  uniform float uSizeRange;
  varying vec3 vViewPos;
  varying float vLife;
  void main() {
    float span = 2.0 * uHalf;
    float px = mod(position.x + velocity.x * uTime + uHalf, span) - uHalf;
    float pz = mod(position.z + velocity.z * uTime + uHalf, span) - uHalf;
    // Rise + recycle: vel.y > 0 lifts the spray, wrap keeps the column full.
    float py = mod(position.y + velocity.y * uTime, uRise);
    vLife = py / uRise; // 0 at the pool, 1 near the top -> fade out
    px += 0.6 * sin(uTime * 0.7 + position.z);
    pz += 0.5 * cos(uTime * 0.6 + position.x);
    vec4 mvPos = modelViewMatrix * vec4(vec3(px, py, pz), 1.0);
    vViewPos = mvPos.xyz;
    gl_PointSize = clamp(uSize * uSizeRange / max(-mvPos.z, 1.0), 2.0, 96.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec3 vViewPos;
  varying float vLife;
  void main() {
    // Soft round sprite: radial falloff from the point centre.
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.0, d) * uOpacity;
    // Billow: densest low, thinning as it rises.
    a *= 1.0 - smoothstep(0.4, 1.0, vLife);
    vec3 c = uColor;
    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    c = mix(c, fogColor, fogFactor);
    #endif
    gl_FragColor = vec4(c, a);
  }
`;

const FOAM_VERT = /* glsl */ `
  varying vec2 vWorldXZ;
  varying vec3 vViewPos;
  void main() {
    vWorldXZ = position.xz;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FOAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;
  uniform vec3 uColor;
  uniform vec3 uFoam;
  uniform float uOpacity;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec2 vWorldXZ;
  varying vec3 vViewPos;
  ${GLSL_NOISE}
  void main() {
    float r = length(vWorldXZ);
    // Foam ring hugs the outer rim; a breathing noise band ripples it.
    float ring = smoothstep(uInner, uOuter, r);
    float ripple = vnoise(vWorldXZ * 0.9 + vec2(uTime * 0.4, -uTime * 0.3));
    float foam = clamp(ring + ripple * 0.4 * ring, 0.0, 1.0);
    vec3 c = mix(uColor, uFoam, foam);
    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    c = mix(c, fogColor, fogFactor);
    #endif
    gl_FragColor = vec4(c, uOpacity);
  }
`;

export interface WaterfallOptions {
  /** World anchor of the pool centre / cliff base (default [40, 0, -40]). */
  position?: [number, number, number];
  /** Cliff + sheet height in metres (default 30). */
  height?: number;
  /** Cliff + sheet width in metres (default 12). */
  width?: number;
  /** Uniform scale multiplier applied to the whole landmark (default 1). */
  scale?: number;
  /** Mist particle count (default 700). */
  mistCount?: number;
  /** Layout seed for the cliff jitter + mist field (default 0). */
  seed?: number;
}

const DEFAULTS = {
  position: [40, 0, -40] as [number, number, number],
  height: 30,
  width: 12,
  scale: 1,
  mistCount: 700,
  seed: 0,
};

// Palette: dark WET rock, bright white-cyan water + foam, cyan pool. Muted,
// painterly — never neon (art-direction "Painted Wilds").
const ROCK_COLOR = 0x3a4550;
const WATER_COLOR = 0xd6f0f4;
const FOAM_COLOR = 0xf2fbfd;
const MIST_COLOR = 0xe6f2f4;
const POOL_COLOR = 0x6fb0be;

/**
 * World-fixed cel waterfall landmark. See the module doc for the four layers.
 * Public API: `group`, `update(dt, focusX?, focusZ?)`, `dispose()`, plus the
 * `elapsed` getter (monotonic uTime, asserted in tests).
 */
export class Waterfall {
  readonly group = new THREE.Group();
  private elapsedTime = 0;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly animated: THREE.ShaderMaterial[] = [];

  /** Monotonic elapsed time fed to the animated shader uTime uniforms. */
  get elapsed(): number {
    return this.elapsedTime;
  }

  constructor(opts: WaterfallOptions = {}) {
    const position = opts.position ?? DEFAULTS.position;
    const height = opts.height ?? DEFAULTS.height;
    const width = opts.width ?? DEFAULTS.width;
    const scale = opts.scale ?? DEFAULTS.scale;
    const mistCount = opts.mistCount ?? DEFAULTS.mistCount;
    const seed = opts.seed ?? DEFAULTS.seed;

    this.group.position.set(position[0], position[1], position[2]);
    this.group.scale.setScalar(scale);

    // Front face of the cliff sits at +z; the sheet + pool live just in front.
    const frontZ = width * 0.5;
    this.buildCliff(width, height, frontZ, seed);
    this.buildSheet(width, height, frontZ);
    this.buildPool(width, frontZ);
    this.buildMist(width, height, frontZ, mistCount, seed);
  }

  /**
   * Advance the animated uTime accumulator by dt. World-fixed: focusX/focusZ
   * are accepted for the Weather-compatible contract but intentionally unused
   * (the landmark never follows the camera). Safe to call with dt 0.
   */
  update(dt: number, _focusX = 0, _focusZ = 0): void {
    this.elapsedTime += dt;
    for (const mat of this.animated) {
      mat.uniforms.uTime.value = this.elapsedTime;
    }
  }

  /** Free every geometry + material and empty the group. Idempotent. */
  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.animated.length = 0;
    this.group.clear();
  }

  /**
   * Craggy cel rock massif the water pours over. A few seed-jittered boxes
   * share one cel material (flat facets + aerial perspective). The base
   * extends below y=0 so the cliff never floats on relief-free terrain.
   */
  private buildCliff(width: number, height: number, frontZ: number, seed: number): void {
    const rng = makeRNG(seed ^ 0x9e37);
    const mat = makeCel({
      color: ROCK_COLOR,
      flatShading: true,
      specular: true,
      roughness: 0.85,
      rimIntensity: 0.15,
      fog: true,
      aerial: true,
      tempGrade: true,
    });
    this.materials.push(mat);
    const depth = width * 0.9;
    const buried = 4; // metres below y=0 so the base is grounded
    // Main massif: one tall block from below ground to the lip.
    const main = new THREE.BoxGeometry(width, height + buried, depth, 4, 6, 2);
    this.jitter(main, rng, width * 0.06);
    main.translate(0, (height - buried) / 2, -depth / 2 + frontZ - width * 0.15);
    this.addMesh(main, mat);
    // Two offset ledges break the silhouette + frame the spill lip.
    for (let i = 0; i < 2; i++) {
      const lw = width * rng.range(0.4, 0.7);
      const lh = height * rng.range(0.18, 0.34);
      const ledge = new THREE.BoxGeometry(lw, lh, depth * 0.5, 2, 2, 1);
      this.jitter(ledge, rng, width * 0.05);
      const ly = height * rng.range(0.35, 0.85);
      const lx = width * rng.range(-0.3, 0.3);
      ledge.translate(lx, ly, -depth * 0.25 + frontZ - width * 0.2);
      this.addMesh(ledge, mat);
    }
  }

  /**
   * Falling-water sheet: two stacked planes at slightly different depth +
   * opacity for parallax, sharing the downward-scroll shader. Positioned at the
   * cliff front, spanning the pool up to just under the lip.
   */
  private buildSheet(width: number, height: number, frontZ: number): void {
    const sheetW = width * 0.72;
    const sheetH = height * 0.98;
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: i === 0 ? 0.85 : 1.15 },
          uBands: { value: 4 },
          uColor: { value: new THREE.Color(WATER_COLOR) },
          uFoam: { value: new THREE.Color(FOAM_COLOR) },
          uOpacity: { value: i === 0 ? 0.95 : 0.55 },
          fogColor: { value: new THREE.Color(0xb6ad9e) },
          fogNear: { value: 90 },
          fogFar: { value: 360 },
        },
        vertexShader: SHEET_VERT,
        fragmentShader: SHEET_FRAG,
        transparent: true,
        depthWrite: i === 0,
        side: THREE.DoubleSide,
        fog: true,
      });
      const geo = new THREE.PlaneGeometry(sheetW * (i === 0 ? 1 : 1.06), sheetH);
      geo.translate(0, sheetH / 2, frontZ + 0.05 + i * 0.12);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.geometries.push(geo);
      this.materials.push(mat);
      this.animated.push(mat);
    }
  }

  /** Pool: a cel disc + a shader foam ring that breathes with uTime. */
  private buildPool(width: number, frontZ: number): void {
    const radius = width * 0.75;
    // Cel disc — the calm cyan water body.
    const discMat = makeCel({
      color: POOL_COLOR,
      specular: true,
      roughness: 0.15,
      rimIntensity: 0.2,
      fog: true,
      aerial: true,
      tempGrade: true,
    });
    const disc = new THREE.CircleGeometry(radius, 32);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, 0.05, frontZ + radius * 0.5);
    this.addMesh(disc, discMat);
    this.materials.push(discMat);
    // Foam ring — animated rim where the sheet churns the pool.
    const foamMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: radius * 0.55 },
        uOuter: { value: radius * 0.98 },
        uColor: { value: new THREE.Color(POOL_COLOR) },
        uFoam: { value: new THREE.Color(FOAM_COLOR) },
        uOpacity: { value: 0.85 },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: FOAM_VERT,
      fragmentShader: FOAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const ring = new THREE.CircleGeometry(radius, 32);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.08, frontZ + radius * 0.5);
    const ringMesh = new THREE.Mesh(ring, foamMat);
    ringMesh.renderOrder = 1;
    this.group.add(ringMesh);
    this.geometries.push(ring);
    this.materials.push(foamMat);
    this.animated.push(foamMat);
  }

  /**
   * Billowing mist column: a soft GPU Points field (round sprites, upward
   * drift + gentle sway, uTime wrap) hanging around the base. Mirrors
   * Weather.buildField's soft-flake material (depthWrite:false, no cull).
   */
  private buildMist(
    width: number,
    height: number,
    frontZ: number,
    count: number,
    seed: number,
  ): void {
    const rng = makeRNG(seed ^ 0x51ed);
    const half = width * 0.7;
    const rise = height * 0.5;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      positions[o] = rng.range(-half, half);
      positions[o + 1] = rng.range(0, rise);
      positions[o + 2] = frontZ * rng.range(0.0, 1.3);
      velocities[o] = rng.unit() * 0.4;
      velocities[o + 1] = rng.range(0.6, 1.6); // rise
      velocities[o + 2] = rng.unit() * 0.3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("velocity", new THREE.BufferAttribute(velocities, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHalf: { value: half },
        uRise: { value: rise },
        uSize: { value: 26 },
        uSizeRange: { value: 300 },
        uColor: { value: new THREE.Color(MIST_COLOR) },
        uOpacity: { value: 0.32 },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const points = new THREE.Points(geo, mat);
    points.layers.set(MIST_LAYER);
    points.frustumCulled = false;
    this.group.add(points);
    this.geometries.push(geo);
    this.materials.push(mat);
    this.animated.push(mat);
  }

  /** Seed-jitter the non-lowest vertices of a box for a craggy face. */
  private jitter(geo: THREE.BufferGeometry, rng: ReturnType<typeof makeRNG>, amt: number): void {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let minY = Infinity;
    for (let i = 1; i < arr.length; i += 3) minY = Math.min(minY, arr[i]!);
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1]! <= minY + 1e-3) continue; // keep the base flat + grounded
      arr[i] = arr[i]! + rng.unit() * amt;
      arr[i + 1] = arr[i + 1]! + rng.unit() * amt * 0.6;
      arr[i + 2] = arr[i + 2]! + rng.unit() * amt;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /** Add a mesh for `geo` with `mat`, tracking the geometry for disposal. */
  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    this.group.add(new THREE.Mesh(geo, mat));
    this.geometries.push(geo);
  }
}
