/**
 * 053 commit 3: GL owner for drift skid marks. ONE THREE.Mesh (quad strip)
 * on layer 1 (terrain-space, Sobel outline pass territory) holding ALL
 * karts' rear-wheel skid segments in a single ring buffer. The CPU bakes
 * terrain-conformed vertex positions (heightAt + a small normalAt offset)
 * at append time, so the GPU only fades by age from uTime -> zero per-frame
 * vertex work. Mirrors KartVfxLayer.ts: ring wrap via the pure core, partial
 * buffer updates (addUpdateRange), fog via #ifdef USE_FOG, uAmbient read
 * each frame so marks darken at night (never glow brighter than the road).
 *
 * Layer 1 + polygonOffset keeps the flat decals on the road through the
 * Sobel outline pass and avoids z-fighting with the terrain. Reset-on-gap
 * (NaN sentinel in lastSkidPos) prevents streaks across teleports, airborne
 * transitions, and water entry/exit.
 *
 * Filename: the plan named this `SkidMarks.ts`, but the pure core ships as
 * `skidMarks.ts`. On a case-insensitive FS (this dev box + macOS default;
 * git core.ignorecase=true) those collide, so the GL owner lives here as
 * `SkidMarksLayer.ts`. The exported class keeps the spec name `SkidMarks`;
 * CI on case-sensitive Linux treats both filenames independently regardless.
 */

import * as THREE from "three";
import {
  SKID_FADE_TIME,
  SKID_HALF_WIDTH,
  SKID_MIN_STEP,
  SKID_SEGMENTS,
  makeSkidRing,
  segmentCorners,
  shouldAppendSkid,
  skidRingPush,
  type SkidRingCursor,
  type SkidSegment,
} from "./skidMarks";
import type { VfxBudgetTier } from "./kartVfx";
import type { KartVfxSample } from "./KartVfxLayer";
import type { Terrain } from "../terrain/Terrain";
import { lightUniforms } from "../materials/lightUniforms";

const SKID_LAYER = 1;
const REAR_WHEELS = [2, 3] as const;
const NORMAL_OFFSET = 0.02; // lift along terrain normal to fight z-fighting
const DEAD_BIRTH = -1e9; // init so age = uTime - birth >> fade -> shader clips

const SKID_VERT = /* glsl */ `
  attribute float birth;
  uniform float uTime;
  varying float vBirth;
  varying float vViewZ;
  void main() {
    vBirth = birth;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SKID_FRAG = /* glsl */ `
  uniform float uFadeTime;
  uniform vec3 uAmbient;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying float vBirth;
  varying float vViewZ;
  void main() {
    float age = uTime - vBirth;
    float fade = clamp(1.0 - age / uFadeTime, 0.0, 1.0);
    if (fade <= 0.001) discard;
    vec3 c = vec3(0.06, 0.05, 0.04) * uAmbient;
    #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vViewZ);
    c = mix(c, fogColor, fogF);
    #endif
    gl_FragColor = vec4(c, fade);
  }
`;

export interface SkidMarksOptions {
  kartCount: number;
  tier?: VfxBudgetTier; // default "high"
  seed?: number; // API parity with KartVfx; marks are position-driven (unused)
}

/**
 * ONE THREE.Mesh (layer 1) holding all karts' skid segments in a ring sized
 * to {@link SKID_SEGMENTS}[tier]. CPU writes terrain-conformed position +
 * birth attributes; the fragment shader fades by uTime-birth. Output LINEAR;
 * OutputPass applies ACES + sRGB. transparent + depthWrite:false +
 * polygonOffset keep the decals flat on the road without z-fighting.
 */
export class SkidMarks {
  readonly group = new THREE.Group();
  private tier: VfxBudgetTier;
  private kartCount: number;
  private capacity: number;
  private ring: SkidRingCursor;
  /** kartCount * 2 (rear-L, rear-R) * 3 (xyz); NaN = no previous segment. */
  private lastSkidPos!: Float32Array;
  private mesh?: THREE.Mesh;
  private material?: THREE.ShaderMaterial;
  private posArr!: Float32Array;
  private birthArr!: Float32Array;
  private frameMin = -1;
  private frameMax = -1;
  private readonly seg: SkidSegment = {
    birth: 0,
    ax: 0,
    ay: 0,
    az: 0,
    bx: 0,
    by: 0,
    bz: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    dx: 0,
    dy: 0,
    dz: 0,
  };
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(opts: SkidMarksOptions) {
    this.tier = opts.tier ?? "high";
    this.kartCount = opts.kartCount;
    this.capacity = SKID_SEGMENTS[this.tier];
    this.ring = makeSkidRing(this.capacity);
    this.buildField();
  }

  /**
   * Per-frame: advance uTime, then for each kart's two rear wheels either
   * reset (NaN) on a gap, seed on first append, or push a terrain-conformed
   * segment once travel exceeds {@link SKID_MIN_STEP}. `samples[i]` is the
   * pooled KartVfxSample FieldBuilder fills (isDrifting is already false
   * while not driving, so the reset fires automatically off-race).
   */
  update(dt: number, time: number, samples: readonly KartVfxSample[], terrain: Terrain): void {
    void dt;
    const material = this.material;
    if (material === undefined) return;
    material.uniforms.uTime.value = time;
    (material.uniforms.uAmbient.value as THREE.Color).copy(lightUniforms.uAmbient.value);
    this.frameMin = -1;
    this.frameMax = -1;

    const last = this.lastSkidPos;
    const seg = this.seg;
    const n = samples.length < this.kartCount ? samples.length : this.kartCount;
    for (let ki = 0; ki < n; ki++) {
      const s = samples[ki]!;
      const active = s.isDrifting && !s.inWater && s.grounded;
      for (let wi = 0; wi < 2; wi++) {
        const slot = (ki * 2 + wi) * 3;
        if (!active) {
          last[slot] = NaN; // next drift start seeds fresh (no streak)
          continue;
        }
        const w = s.wheels[REAR_WHEELS[wi]!]!;
        const cx = w.x;
        const cz = w.z;
        const px = last[slot]!;
        const pz = last[slot + 2]!;
        if (Number.isNaN(px)) {
          last[slot] = cx;
          last[slot + 1] = w.y;
          last[slot + 2] = cz;
          continue; // seed; no segment drawn this frame
        }
        const ddx = cx - px;
        const ddz = cz - pz;
        if (!shouldAppendSkid(true, true, Math.hypot(ddx, ddz), SKID_MIN_STEP)) {
          continue; // wait for more travel
        }
        this.dir.set(ddx, 0, ddz);
        const len = this.dir.length();
        if (len < 1e-6) continue;
        this.dir.multiplyScalar(1 / len);
        this.right.crossVectors(this.dir, this.up); // perpendicular in XZ
        segmentCorners(px, pz, cx, cz, this.right.x, this.right.z, SKID_HALF_WIDTH, seg);
        seg.birth = time;
        this.writeSegment(skidRingPush(this.ring), seg, terrain);
        last[slot] = cx; // advance prev -> curr
        last[slot + 1] = w.y;
        last[slot + 2] = cz;
      }
    }
    this.flushUploads();
  }

  /** Resize for a new tier/kartCount (re-allocates buffers, disposes old). */
  setQuality(tier: VfxBudgetTier, kartCount: number): void {
    this.tier = tier;
    this.kartCount = kartCount;
    this.capacity = SKID_SEGMENTS[tier];
    this.teardownField();
    this.ring = makeSkidRing(this.capacity);
    this.buildField();
  }

  /** Free the mesh geometry + material and detach from the group. Idempotent. */
  dispose(): void {
    this.teardownField();
  }

  private teardownField(): void {
    if (this.mesh !== undefined) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = undefined;
    }
    this.material?.dispose();
    this.material = undefined;
  }

  private buildField(): void {
    const cap = this.capacity;
    this.posArr = new Float32Array(cap * 4 * 3);
    this.birthArr = new Float32Array(cap * 4);
    this.birthArr.fill(DEAD_BIRTH);

    const indices = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      const b = i * 4;
      const o = i * 6;
      // CCW from above -> front faces point +normal (up); triangles (a,c,b)
      // and (b,c,d) tile the quad, sharing the prevR->currL diagonal.
      indices[o] = b;
      indices[o + 1] = b + 2;
      indices[o + 2] = b + 1;
      indices[o + 3] = b + 1;
      indices[o + 4] = b + 2;
      indices[o + 5] = b + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute("birth", new THREE.BufferAttribute(this.birthArr, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFadeTime: { value: SKID_FADE_TIME },
        uAmbient: { value: new THREE.Color(1, 1, 1) },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false; // ring verts span the whole track
    mesh.layers.set(SKID_LAYER);
    this.mesh = mesh;
    this.material = material;
    this.group.add(mesh);

    this.lastSkidPos = new Float32Array(this.kartCount * 2 * 3);
    this.lastSkidPos.fill(NaN);
  }

  /** Bake terrain-conformed XYZ for each corner, then write 4 verts + birth. */
  private writeSegment(idx: number, seg: SkidSegment, terrain: Terrain): void {
    const v0 = idx * 4;
    this.bakeVertex(v0, seg.ax, seg.az, seg.birth, terrain);
    this.bakeVertex(v0 + 1, seg.bx, seg.bz, seg.birth, terrain);
    this.bakeVertex(v0 + 2, seg.cx, seg.cz, seg.birth, terrain);
    this.bakeVertex(v0 + 3, seg.dx, seg.dz, seg.birth, terrain);
  }

  private bakeVertex(vi: number, x: number, z: number, birth: number, terrain: Terrain): void {
    const n = terrain.normalAt(x, z, this.normal);
    const y = terrain.heightAt(x, z);
    const o = vi * 3;
    this.posArr[o] = x + n.x * NORMAL_OFFSET;
    this.posArr[o + 1] = y + n.y * NORMAL_OFFSET;
    this.posArr[o + 2] = z + n.z * NORMAL_OFFSET;
    this.birthArr[vi] = birth;
    if (this.frameMin < 0 || vi < this.frameMin) this.frameMin = vi;
    if (this.frameMax < 0 || vi > this.frameMax) this.frameMax = vi;
  }

  private flushUploads(): void {
    if (this.frameMin < 0 || this.mesh === undefined) return;
    const min = this.frameMin;
    const count = this.frameMax - this.frameMin + 1;
    const posAttr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const birthAttr = this.mesh.geometry.getAttribute("birth") as THREE.BufferAttribute;
    posAttr.clearUpdateRanges();
    birthAttr.clearUpdateRanges();
    posAttr.addUpdateRange(min * 3, count * 3);
    birthAttr.addUpdateRange(min, count);
    posAttr.needsUpdate = true;
    birthAttr.needsUpdate = true;
  }
}
