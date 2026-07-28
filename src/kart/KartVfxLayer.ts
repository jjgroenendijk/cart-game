/**
 * 053 commit 2: GL owner for kart action VFX. ONE THREE.Points on layer 0
 * holding ALL karts' particles in a single ring buffer. Mirrors Weather.ts:
 * the CPU writes spawn attributes into the ring via partial buffer updates
 * (addUpdateRange), and the vertex shader ages/moves/fades/grows each particle
 * by the monotonic uTime -> zero per-frame particle sim. The pure math
 * (emission rates, ring wrap, spawn jitter, budgets) lives in kartVfx.ts; this
 * file owns GL only.
 *
 * Filename: the plan named this `KartVfx.ts`, but the pure core ships as
 * `kartVfx.ts` (commit 1). On a case-insensitive FS (this dev box + macOS
 * default; git core.ignorecase=true) those collide, so the GL owner lives here
 * as `KartVfxLayer.ts`. The exported class keeps the spec name `KartVfx`; CI on
 * case-sensitive Linux treats both filenames independently regardless.
 *
 * Dust/drift-smoke/splash emit from the REAR wheels (indices 2,3); poof emits
 * from a caller-supplied world pos (respawn point). Dust tint = the terrain
 * colorAt the rear wheel, lerped toward white by spawnParticle, so it is
 * biome-correct for free. uAmbient is read from the shared lightUniforms ref
 * each frame so particles darken at night (no glowing smoke).
 */

import * as THREE from "three";
import {
  VFX_BUDGET,
  accumulateSpawns,
  emissionRate,
  makeRing,
  ringPush,
  spawnParticle,
  type EmitterKind,
  type EmissionInputs,
  type RingCursor,
  type SpawnAccumulator,
  type SpawnedParticle,
  type VfxBudgetTier,
} from "./kartVfx";
import { hashSeed, makeRNG, type RNG } from "../core/rng";
import { lightUniforms } from "../materials/lightUniforms";
import type { Kart } from "./Kart";
import type { Terrain } from "../terrain/Terrain";
import type { Rgb } from "../terrain/heightSource";

const VFX_LAYER = 0; // kart-space; see Weather.ts + src/AGENTS.md layer numbers
const DEFAULT_SIZE_RANGE = 300; // perspective point-size scale (matches Weather)
const REAR_WHEELS = [2, 3] as const; // dust/splash/driftSmoke emit from the rear
const KINDS: readonly EmitterKind[] = ["dust", "driftSmoke", "splash", "poof"];
const DEAD_BIRTH = -1e9; // init so age = uTime - birth >> life -> shader clips
const DEAD_LIFE = 1;
const BURST_CAP = 64; // queued bursts (respawn poofs) flushed on next update

export interface KartVfxSample {
  x: number;
  y: number;
  z: number; // kart group pos
  /** Length 4 world-space wheel positions (front-L, front-R, rear-L, rear-R). */
  wheels: ReadonlyArray<{ x: number; y: number; z: number }>;
  speed: number;
  grounded: boolean;
  isDrifting: boolean;
  inWater: boolean;
  /** LINEAR rgb 0..1 (terrain colorAt the rear wheel). */
  surfaceTint: { r: number; g: number; b: number };
}

export interface KartVfxOptions {
  kartCount: number;
  tier?: VfxBudgetTier; // default "high"
  seed?: number; // default 0
}

// Pooled VFX sample scratch (053 escape hatch): moved here from FieldBuilder
// to keep FieldBuilder under 600 lines. Module-level singletons are safe
// (single-threaded render loop).
const FILL_WHEEL_SCRATCH: THREE.Vector3[] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];
const FILL_TINT_SCRATCH: Rgb = [0, 0, 0];

/** Allocate one pooled sample slot (4 wheel sub-objects + surfaceTint). */
export function makeVfxSample(): KartVfxSample {
  return {
    x: 0,
    y: 0,
    z: 0,
    wheels: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    speed: 0,
    grounded: false,
    isDrifting: false,
    inWater: false,
    surfaceTint: { r: 0, g: 0, b: 0 },
  };
}

/** Fill a pooled sample slot from a kart + terrain (zero allocation). */
export function fillKartVfxSample(
  s: KartVfxSample,
  kart: Kart,
  terrain: Terrain,
  driving: boolean,
): void {
  const p = kart.group.position;
  s.x = p.x;
  s.y = p.y;
  s.z = p.z;
  const ws = s.wheels;
  for (let w = 0; w < 4; w++) {
    const v = kart.wheelWorldPos(w, FILL_WHEEL_SCRATCH[w]!);
    const o = ws[w]!;
    o.x = v.x;
    o.y = v.y;
    o.z = v.z;
  }
  s.speed = driving ? kart.speed : 0;
  s.grounded = kart.controller.grounded;
  s.isDrifting = driving ? kart.controller.isDrifting : false;
  s.inWater = kart.controller.inWater;
  const rw = ws[2]!; // rear-left world pos (already filled)
  const tint = terrain.colorAt(rw.x, rw.z, FILL_TINT_SCRATCH);
  s.surfaceTint.r = tint[0]!;
  s.surfaceTint.g = tint[1]!;
  s.surfaceTint.b = tint[2]!;
}

interface BurstDesc {
  kind: EmitterKind;
  x: number;
  y: number;
  z: number;
}

const VFX_VERT = /* glsl */ `
  attribute vec3 velocity;
  attribute float birth;
  attribute float life;
  attribute float sizeStart;
  attribute float growth;
  attribute vec3 tint;
  attribute float fadeSteps;
  uniform float uTime;
  uniform float uSizeRange;
  varying float vT;
  varying float vViewZ;
  varying vec3 vTint;
  varying float vFadeSteps;
  void main() {
    float age = uTime - birth;
    if (age < 0.0 || age > life) {
      gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float t = age / life;
    vec3 p = position + velocity * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = sizeStart * (1.0 + (growth - 1.0) * t);
    gl_PointSize = clamp(size * uSizeRange / max(-mv.z, 1.0), 1.0, 48.0);
    gl_Position = projectionMatrix * mv;
    vT = t;
    vViewZ = -mv.z;
    vTint = tint;
    vFadeSteps = fadeSteps;
  }
`;

const VFX_FRAG = /* glsl */ `
  uniform vec3 uAmbient;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying float vT;
  varying float vViewZ;
  varying vec3 vTint;
  varying float vFadeSteps;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.3, 0.5, length(uv));
    if (disc <= 0.0) discard;
    float fade;
    if (vFadeSteps > 0.5) {
      float b = floor(vT * vFadeSteps) / vFadeSteps;
      fade = 1.0 - b;
    } else {
      fade = 1.0 - vT;
    }
    vec3 c = vTint * uAmbient;
    #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vViewZ);
    c = mix(c, fogColor, fogF);
    #endif
    gl_FragColor = vec4(c, disc * fade);
  }
`;

/**
 * ONE THREE.Points (layer 0) holding all karts' action particles in a ring
 * buffer sized to {@link VFX_BUDGET}[tier]. CPU writes spawn attributes
 * (position/velocity/birth/life/sizeStart/growth/tint/fadeSteps) into the ring;
 * the vertex shader advances them by uTime. Output is LINEAR; OutputPass
 * applies ACES + sRGB. Layer 0 + depthWrite:false mirrors Weather: visible
 * through the 039 sky-posterize depth mask (layer 0).
 */
export class KartVfx {
  readonly group = new THREE.Group();
  private tier: VfxBudgetTier;
  private kartCount: number;
  private readonly baseSeed: number;
  private capacity: number;
  private ring: RingCursor;
  private rngs: RNG[] = [];
  private accumulators: SpawnAccumulator[] = [];
  private readonly burstRng: RNG;
  private readonly bursts: BurstDesc[];
  private burstLen = 0;
  /** Pooled emission-inputs scratch (reused per kart; zero per-frame alloc). */
  private readonly emitInputs: EmissionInputs = {
    speed: 0,
    grounded: false,
    isDrifting: false,
    inWater: false,
  };
  private points?: THREE.Points;
  private material?: THREE.ShaderMaterial;
  private attrs: THREE.BufferAttribute[] = [];
  private posArr!: Float32Array;
  private velArr!: Float32Array;
  private birthArr!: Float32Array;
  private lifeArr!: Float32Array;
  private sizeArr!: Float32Array;
  private growthArr!: Float32Array;
  private tintArr!: Float32Array;
  private fadeArr!: Float32Array;
  /** Dirty slot span written this frame (min/max vertex slot). */
  private frameMin = -1;
  private frameMax = -1;

  constructor(opts: KartVfxOptions) {
    this.tier = opts.tier ?? "high";
    this.kartCount = opts.kartCount;
    this.baseSeed = opts.seed ?? 0;
    this.capacity = VFX_BUDGET[this.tier];
    this.ring = makeRing(this.capacity);
    this.burstRng = makeRNG((this.baseSeed ^ hashSeed("kartvfx-burst")) >>> 0);
    this.bursts = Array.from({ length: BURST_CAP }, (): BurstDesc => ({
      kind: "poof",
      x: 0,
      y: 0,
      z: 0,
    }));
    this.rebuildKartState();
    this.buildField();
  }

  /**
   * Per-frame: advance uTime, flush queued bursts (birth = time), sample
   * emission per kart (dust/driftSmoke/splash from rear wheels), spawn into the
   * ring, then push partial buffer updates. `time` is the monotonic elapsed the
   * caller owns (Game.time); it doubles as uTime and the birth stamp.
   */
  update(dt: number, time: number, samples: readonly KartVfxSample[]): void {
    const material = this.material;
    if (material === undefined) return;
    material.uniforms.uTime.value = time;
    // Read the shared ambient each frame (do not cache): the same ref cel/sky
    // materials read, so particles darken at night and never glow.
    (material.uniforms.uAmbient.value as THREE.Color).copy(lightUniforms.uAmbient.value);
    this.frameMin = -1;
    this.frameMax = -1;

    // Flush queued bursts (respawn poofs) before per-kart emission.
    for (let i = 0; i < this.burstLen; i++) {
      const b = this.bursts[i]!;
      this.writeSlot(
        ringPush(this.ring),
        spawnParticle(b.kind, b, time, this.burstRng.next, undefined),
      );
    }
    this.burstLen = 0;

    const n = samples.length < this.kartCount ? samples.length : this.kartCount;
    const emit = this.emitInputs;
    for (let ki = 0; ki < n; ki++) {
      const s = samples[ki]!;
      emit.speed = s.speed;
      emit.grounded = s.grounded;
      emit.isDrifting = s.isDrifting;
      emit.inWater = s.inWater;
      const tint = s.surfaceTint;
      const rng = this.rngs[ki]!.next;
      for (let k = 0; k < KINDS.length; k++) {
        const kind = KINDS[k]!;
        const acc = this.accumulators[ki * KINDS.length + k]!;
        const count = accumulateSpawns(acc, emissionRate(kind, emit), dt);
        for (let sp = 0; sp < count; sp++) {
          const w = s.wheels[REAR_WHEELS[sp & 1]!]!;
          this.writeSlot(ringPush(this.ring), spawnParticle(kind, w, time, rng, tint));
        }
      }
    }
    this.flushUploads();
  }

  /** Queue a burst (poof) at world pos; flushed on next update (birth = time). */
  burst(kind: EmitterKind, pos: { x: number; y: number; z: number }): void {
    if (this.burstLen >= this.bursts.length) return; // drop overflow (rare)
    const b = this.bursts[this.burstLen++]!;
    b.kind = kind;
    b.x = pos.x;
    b.y = pos.y;
    b.z = pos.z;
  }

  /** Resize for a new tier/kartCount (re-allocates buffers, disposes old). */
  setQuality(tier: VfxBudgetTier, kartCount: number): void {
    this.tier = tier;
    this.kartCount = kartCount;
    this.capacity = VFX_BUDGET[tier];
    this.teardownField();
    this.ring = makeRing(this.capacity);
    this.rebuildKartState();
    this.buildField();
  }

  /** Free the Points geometry + material and detach from the group. Idempotent. */
  dispose(): void {
    this.teardownField();
  }

  private teardownField(): void {
    if (this.points !== undefined) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points = undefined;
    }
    this.material?.dispose();
    this.material = undefined;
  }

  /** Per-kart RNG (seed = baseSeed ^ kartIndex) + per-kind spawn accumulators. */
  private rebuildKartState(): void {
    this.rngs = [];
    this.accumulators = [];
    for (let i = 0; i < this.kartCount; i++) {
      this.rngs.push(makeRNG((this.baseSeed ^ i) >>> 0));
      for (let k = 0; k < KINDS.length; k++) this.accumulators.push({ remainder: 0 });
    }
  }

  private buildField(): void {
    const cap = this.capacity;
    this.posArr = new Float32Array(cap * 3);
    this.velArr = new Float32Array(cap * 3);
    this.birthArr = new Float32Array(cap);
    this.lifeArr = new Float32Array(cap);
    this.sizeArr = new Float32Array(cap);
    this.growthArr = new Float32Array(cap);
    this.tintArr = new Float32Array(cap * 3);
    this.fadeArr = new Float32Array(cap);
    this.birthArr.fill(DEAD_BIRTH);
    this.lifeArr.fill(DEAD_LIFE);

    const geo = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(this.posArr, 3);
    const velocityAttr = new THREE.BufferAttribute(this.velArr, 3);
    const birthAttr = new THREE.BufferAttribute(this.birthArr, 1);
    const lifeAttr = new THREE.BufferAttribute(this.lifeArr, 1);
    const sizeAttr = new THREE.BufferAttribute(this.sizeArr, 1);
    const growthAttr = new THREE.BufferAttribute(this.growthArr, 1);
    const tintAttr = new THREE.BufferAttribute(this.tintArr, 3);
    const fadeAttr = new THREE.BufferAttribute(this.fadeArr, 1);
    geo.setAttribute("position", positionAttr);
    geo.setAttribute("velocity", velocityAttr);
    geo.setAttribute("birth", birthAttr);
    geo.setAttribute("life", lifeAttr);
    geo.setAttribute("sizeStart", sizeAttr);
    geo.setAttribute("growth", growthAttr);
    geo.setAttribute("tint", tintAttr);
    geo.setAttribute("fadeSteps", fadeAttr);
    geo.setDrawRange(0, cap);
    this.attrs = [
      positionAttr,
      velocityAttr,
      birthAttr,
      lifeAttr,
      sizeAttr,
      growthAttr,
      tintAttr,
      fadeAttr,
    ];

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSizeRange: { value: DEFAULT_SIZE_RANGE },
        uAmbient: { value: new THREE.Color().copy(lightUniforms.uAmbient.value) },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: VFX_VERT,
      fragmentShader: VFX_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    // Particles move in-shader; the ring positions do not bound them, so the
    // lazy bounding sphere would cull the field -> disable frustum culling.
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.layers.set(VFX_LAYER);
    this.points = points;
    this.material = material;
    this.group.add(points);
  }

  private writeSlot(slot: number, p: SpawnedParticle): void {
    const o = slot * 3;
    this.posArr[o] = p.x;
    this.posArr[o + 1] = p.y;
    this.posArr[o + 2] = p.z;
    this.velArr[o] = p.vx;
    this.velArr[o + 1] = p.vy;
    this.velArr[o + 2] = p.vz;
    this.birthArr[slot] = p.birth;
    this.lifeArr[slot] = p.life;
    this.sizeArr[slot] = p.sizeStart;
    this.growthArr[slot] = p.growth;
    this.tintArr[o] = p.tintR;
    this.tintArr[o + 1] = p.tintG;
    this.tintArr[o + 2] = p.tintB;
    this.fadeArr[slot] = p.fadeSteps;
    if (this.frameMin < 0) {
      this.frameMin = slot;
      this.frameMax = slot;
    } else {
      if (slot < this.frameMin) this.frameMin = slot;
      if (slot > this.frameMax) this.frameMax = slot;
    }
  }

  /**
   * Push the dirty slot span to GL. start/count are raw array-element units
   * (not vertices; see WebGLAttributes.updateBuffer), so the slot span is
   * scaled by itemSize. Writes within one update are sequential ring pushes;
   * on a wrap the min..max span covers the whole buffer, which is a harmless
   * full re-upload (dead slots re-send identical bytes).
   */
  private flushUploads(): void {
    if (this.frameMin < 0) return;
    const min = this.frameMin;
    const count = this.frameMax - this.frameMin + 1;
    for (const attr of this.attrs) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(min * attr.itemSize, count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
