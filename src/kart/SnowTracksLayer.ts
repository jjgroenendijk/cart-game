/**
 * Snow-realism commit 3: GL owner for living, depth-profiled snow tire tracks.
 * ONE THREE.Mesh (cross-section strip) holding ALL karts' rear-wheel tracks in a
 * single ring buffer. Modelled on SkidMarksLayer.ts (ring wrap via the pure
 * core, terrain-conformed bake at append time, partial buffer uploads,
 * polygonOffset, age-fade fragment) but each segment carries a real
 * cross-section: a shadowed CENTER channel between two raised OUTER berms of
 * displaced snow. Per-vertex world normals + vertex colors (bright lit berms,
 * cool-grey channel) shade the channel darker than the berms, so depth reads as
 * genuine relief. The terrain mesh + collider are UNTOUCHED: the groove is
 * shading, not geometry displacement of the ground.
 *
 * Render layer: layer 0 (kart/prop space), NOT the terrain layer 1. Skid marks
 * sit on layer 1 because they are FLAT — no normal/depth discontinuity for the
 * layer-1 Sobel toon-outline pass to catch. Snow tracks carry raised berms +
 * outward-tilted normals, which that Sobel pass would trace as a hard black
 * cartoon edge around every track. Layer 0 renders them in the same color pass
 * (one shared depth buffer, so they still occlude against terrain + karts via
 * polygonOffset) but stays out of the layer-1-only outline capture -> no outline.
 *
 * Living tracks: the fade uniform is driven each frame by trackFadeTime from the
 * eased shared uSnowCover (a snowfall-rate proxy) -> tracks fade FAST while it
 * snows hard (fresh snow refills the grooves) and stay long on calm/tundra
 * ground. This is a bounded fade-ring, NOT paint-persistent-until-melt: there is
 * no terrain-paint RenderTarget; the oldest segments are recycled on wrap.
 *
 * onSnow trigger (per rear wheel): eased uSnowCover > threshold (snowy weather
 * anywhere) OR a near-white/desaturated rear-wheel surfaceTint (tundra ground
 * even under a clear sky). See snowTracks.trackOnSnow.
 *
 * Filename: the pure core ships as `snowTracks.ts`; on a case-insensitive FS
 * (macOS default) `SnowTracks.ts` would collide, so the GL owner lives here as
 * `SnowTracksLayer.ts`. The exported class keeps the spec name `SnowTracks`.
 */

import * as THREE from "three";
import {
  TRACK_BERM_LIFT,
  TRACK_CHANNEL_LIFT,
  TRACK_FADE_TIME,
  TRACK_HALF_WIDTH,
  TRACK_MIN_STEP,
  TRACK_SEGMENTS,
  makeTrackRing,
  shouldAppendTrack,
  trackFadeTime,
  trackOnSnow,
  trackProfileCorners,
  trackRingPush,
  type TrackRingCursor,
  type TrackSegment,
} from "./snowTracks";
import type { VfxBudgetTier } from "./kartVfx";
import type { KartVfxSample } from "./KartVfxLayer";
import type { Terrain } from "../terrain/Terrain";
import { lightUniforms } from "../materials/lightUniforms";
import { snowUniform } from "../materials/cel";

// Layer 0 (kart/prop space), NOT terrain layer 1 -> the tracks' berms + tilted
// normals stay out of the layer-1 Sobel toon-outline capture (no black edge).
const TRACK_LAYER = 0;
const REAR_WHEELS = [2, 3] as const;
const NORMAL_OFFSET = 0.02; // lift along terrain normal to fight z-fighting
const DEAD_BIRTH = -1e9; // init so age = uTime - birth >> fade -> shader clips
const VERTS_PER_SEG = 6; // prev/curr row * (left berm, channel, right berm)
const BERM_TILT = 0.38; // how far berm normals lean outward -> directional relief
/** Lit berm crest (cool white) + compressed-snow channel (subtle cool grey)
 *  LINEAR colors. The channel is only gently darker than the berm so the rut
 *  reads as pressed snow, not a painted blue stripe; relief comes from the
 *  tilted berm normals catching the sun, not from a high-contrast fill. */
const BERM_COLOR = new THREE.Color(0xdfe6f0);
const CHANNEL_COLOR = new THREE.Color(0xb4c0d2);
const SPARKLE = 0.3; // subtle berm-edge glint strength (cheap hash)

const TRACK_VERT = /* glsl */ `
  attribute float birth;
  attribute vec3 vtint;
  attribute vec3 tnormal;
  attribute float berm;
  uniform float uTime;
  varying float vBirth;
  varying float vViewZ;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec2 vWorldXZ;
  varying float vBerm;
  void main() {
    vBirth = birth;
    vColor = vtint;
    vNormalW = tnormal;
    vBerm = berm;
    vWorldXZ = position.xz;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const TRACK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFadeTime;
  uniform vec3 uAmbient;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirWorld;
  uniform float uSparkle;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying float vBirth;
  varying float vViewZ;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec2 vWorldXZ;
  varying float vBerm;
  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    float age = uTime - vBirth;
    float fade = clamp(1.0 - age / uFadeTime, 0.0, 1.0);
    if (fade <= 0.001) discard;
    vec3 N = normalize(vNormalW);
    float lam = clamp(dot(N, normalize(uSunDirWorld)), 0.0, 1.0);
    // Berms catch sun -> bright; channel is dark base color + weak lambert ->
    // reads sunken. Both stay LINEAR; OutputPass applies ACES + sRGB.
    vec3 c = vColor * (uAmbient + uSunColor * lam);
    // Sparse hash glints on lit berm edges only (cheap glitter; kept subtle).
    float glint = step(0.985, hash2(floor(vWorldXZ * 36.0)));
    c += uSparkle * glint * lam * vBerm;
    #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vViewZ);
    c = mix(c, fogColor, fogF);
    #endif
    gl_FragColor = vec4(c, fade);
  }
`;

export interface SnowTracksOptions {
  kartCount: number;
  tier?: VfxBudgetTier; // default "high"
  seed?: number; // API parity with KartVfx; tracks are position-driven (unused)
}

/**
 * ONE THREE.Mesh (layer 1) holding all karts' snow tracks in a ring sized to
 * {@link TRACK_SEGMENTS}[tier]. CPU writes terrain-conformed position + world
 * normal + vertex color + birth; the fragment fades by uTime-birth and shades
 * berms vs channel from the shared lightUniforms. transparent + depthWrite:false
 * + polygonOffset keep the relief flat on the road without z-fighting.
 */
export class SnowTracks {
  readonly group = new THREE.Group();
  private tier: VfxBudgetTier;
  private kartCount: number;
  private capacity: number;
  private ring: TrackRingCursor;
  /** kartCount * 2 (rear-L, rear-R) * 3 (xyz); NaN = no previous segment. */
  private lastPos!: Float32Array;
  private mesh?: THREE.Mesh;
  private material?: THREE.ShaderMaterial;
  private posArr!: Float32Array;
  private colArr!: Float32Array;
  private nrmArr!: Float32Array;
  private bermArr!: Float32Array;
  private birthArr!: Float32Array;
  private frameMin = -1;
  private frameMax = -1;
  private readonly seg: TrackSegment = {
    birth: 0,
    plx: 0,
    ply: 0,
    plz: 0,
    pcx: 0,
    pcy: 0,
    pcz: 0,
    prx: 0,
    pry: 0,
    prz: 0,
    clx: 0,
    cly: 0,
    clz: 0,
    ccx: 0,
    ccy: 0,
    ccz: 0,
    crx: 0,
    cry: 0,
    crz: 0,
  };
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly tiltNormal = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(opts: SnowTracksOptions) {
    this.tier = opts.tier ?? "high";
    this.kartCount = opts.kartCount;
    this.capacity = TRACK_SEGMENTS[this.tier];
    this.ring = makeTrackRing(this.capacity);
    this.buildField();
  }

  /**
   * Per-frame: refresh uTime + shared light + the living fade time, then for
   * each kart's two rear wheels either reset (NaN) on a gap, seed on the first
   * append, or push a terrain-conformed profiled segment once travel exceeds
   * {@link TRACK_MIN_STEP}. `onSnow` derives from the eased shared uSnowCover OR
   * a white rear-wheel surfaceTint, so tracks appear in snowy weather AND on
   * tundra ground even under a clear sky.
   */
  update(dt: number, time: number, samples: readonly KartVfxSample[], terrain: Terrain): void {
    void dt;
    const material = this.material;
    if (material === undefined) return;
    const cover = snowUniform.uSnowCover.value; // eased snowfall proxy
    material.uniforms.uTime.value = time;
    material.uniforms.uFadeTime.value = trackFadeTime(TRACK_FADE_TIME, cover);
    (material.uniforms.uAmbient.value as THREE.Color).copy(lightUniforms.uAmbient.value);
    (material.uniforms.uSunColor.value as THREE.Color).copy(lightUniforms.uSunColor.value);
    (material.uniforms.uSunDirWorld.value as THREE.Vector3).copy(lightUniforms.uSunDirWorld.value);
    this.frameMin = -1;
    this.frameMax = -1;

    const last = this.lastPos;
    const seg = this.seg;
    const n = samples.length < this.kartCount ? samples.length : this.kartCount;
    for (let ki = 0; ki < n; ki++) {
      const s = samples[ki]!;
      const t = s.surfaceTint;
      const onSnow = trackOnSnow(cover, t.r, t.g, t.b);
      const active = onSnow && !s.inWater && s.grounded;
      for (let wi = 0; wi < 2; wi++) {
        const slot = (ki * 2 + wi) * 3;
        if (!active) {
          last[slot] = NaN; // next contact seeds fresh (no streak across gaps)
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
        const moved = Math.hypot(ddx, ddz);
        if (!shouldAppendTrack(onSnow, s.grounded, s.inWater, moved, TRACK_MIN_STEP)) {
          continue; // wait for more travel
        }
        this.dir.set(ddx, 0, ddz);
        const len = this.dir.length();
        if (len < 1e-6) continue;
        this.dir.multiplyScalar(1 / len);
        this.right.crossVectors(this.dir, this.up); // perpendicular in XZ
        trackProfileCorners(
          px,
          pz,
          cx,
          cz,
          this.right.x,
          this.right.z,
          TRACK_HALF_WIDTH,
          TRACK_BERM_LIFT,
          TRACK_CHANNEL_LIFT,
          seg,
        );
        seg.birth = time;
        this.writeSegment(trackRingPush(this.ring), seg, terrain);
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
    this.capacity = TRACK_SEGMENTS[tier];
    this.teardownField();
    this.ring = makeTrackRing(this.capacity);
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
    this.posArr = new Float32Array(cap * VERTS_PER_SEG * 3);
    this.colArr = new Float32Array(cap * VERTS_PER_SEG * 3);
    this.nrmArr = new Float32Array(cap * VERTS_PER_SEG * 3);
    this.bermArr = new Float32Array(cap * VERTS_PER_SEG);
    this.birthArr = new Float32Array(cap * VERTS_PER_SEG);
    this.birthArr.fill(DEAD_BIRTH);

    // Two quads per segment (left half berm->channel, right half channel->berm),
    // each split into 2 triangles. Vertices per seg: 0 pL,1 pC,2 pR,3 cL,4 cC,5 cR.
    const indices = new Uint32Array(cap * 12);
    for (let i = 0; i < cap; i++) {
      const b = i * VERTS_PER_SEG;
      const o = i * 12;
      // left quad (pL,pC,cL,cC): CCW from above -> up-facing front
      indices[o] = b; // pL
      indices[o + 1] = b + 3; // cL
      indices[o + 2] = b + 1; // pC
      indices[o + 3] = b + 1; // pC
      indices[o + 4] = b + 3; // cL
      indices[o + 5] = b + 4; // cC
      // right quad (pC,pR,cC,cR)
      indices[o + 6] = b + 1; // pC
      indices[o + 7] = b + 4; // cC
      indices[o + 8] = b + 2; // pR
      indices[o + 9] = b + 2; // pR
      indices[o + 10] = b + 4; // cC
      indices[o + 11] = b + 5; // cR
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute("vtint", new THREE.BufferAttribute(this.colArr, 3));
    geo.setAttribute("tnormal", new THREE.BufferAttribute(this.nrmArr, 3));
    geo.setAttribute("berm", new THREE.BufferAttribute(this.bermArr, 1));
    geo.setAttribute("birth", new THREE.BufferAttribute(this.birthArr, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFadeTime: { value: TRACK_FADE_TIME },
        uAmbient: { value: new THREE.Color().copy(lightUniforms.uAmbient.value) },
        uSunColor: { value: new THREE.Color().copy(lightUniforms.uSunColor.value) },
        uSunDirWorld: { value: new THREE.Vector3().copy(lightUniforms.uSunDirWorld.value) },
        uSparkle: { value: SPARKLE },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: TRACK_VERT,
      fragmentShader: TRACK_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false; // ring verts span the whole track
    mesh.layers.set(TRACK_LAYER);
    this.mesh = mesh;
    this.material = material;
    this.group.add(mesh);

    this.lastPos = new Float32Array(this.kartCount * 2 * 3);
    this.lastPos.fill(NaN);
  }

  /** Bake terrain-conformed XYZ + normal + color for each of the 6 rails. */
  private writeSegment(idx: number, seg: TrackSegment, terrain: Terrain): void {
    const v0 = idx * VERTS_PER_SEG;
    // rail order matches index layout: pL,pC,pR,cL,cC,cR. tiltSign: +1 left
    // berm (lean outward-left), -1 right berm, 0 channel. berm flag: 1|0.
    this.bakeRail(v0, seg.plx, seg.plz, seg.ply, 1, 1, seg.birth, terrain);
    this.bakeRail(v0 + 1, seg.pcx, seg.pcz, seg.pcy, 0, 0, seg.birth, terrain);
    this.bakeRail(v0 + 2, seg.prx, seg.prz, seg.pry, -1, 1, seg.birth, terrain);
    this.bakeRail(v0 + 3, seg.clx, seg.clz, seg.cly, 1, 1, seg.birth, terrain);
    this.bakeRail(v0 + 4, seg.ccx, seg.ccz, seg.ccy, 0, 0, seg.birth, terrain);
    this.bakeRail(v0 + 5, seg.crx, seg.crz, seg.cry, -1, 1, seg.birth, terrain);
  }

  private bakeRail(
    vi: number,
    x: number,
    z: number,
    lift: number,
    tiltSign: number,
    berm: number,
    birth: number,
    terrain: Terrain,
  ): void {
    const nb = terrain.normalAt(x, z, this.normal);
    const y = terrain.heightAt(x, z);
    const o = vi * 3;
    this.posArr[o] = x + nb.x * NORMAL_OFFSET;
    this.posArr[o + 1] = y + nb.y * NORMAL_OFFSET + lift;
    this.posArr[o + 2] = z + nb.z * NORMAL_OFFSET;
    // Berm normal leans outward (along +/- the lateral right vector) so one side
    // of the ridge catches the sun and the other shades -> directional relief.
    // The channel keeps the terrain normal; its dark color carries the depth.
    const t = this.tiltNormal.copy(nb);
    if (tiltSign !== 0) {
      t.x += this.right.x * tiltSign * BERM_TILT;
      t.z += this.right.z * tiltSign * BERM_TILT;
      t.normalize();
    }
    this.nrmArr[o] = t.x;
    this.nrmArr[o + 1] = t.y;
    this.nrmArr[o + 2] = t.z;
    const col = berm === 1 ? BERM_COLOR : CHANNEL_COLOR;
    this.colArr[o] = col.r;
    this.colArr[o + 1] = col.g;
    this.colArr[o + 2] = col.b;
    this.bermArr[vi] = berm;
    this.birthArr[vi] = birth;
    if (this.frameMin < 0 || vi < this.frameMin) this.frameMin = vi;
    if (this.frameMax < 0 || vi > this.frameMax) this.frameMax = vi;
  }

  private flushUploads(): void {
    if (this.frameMin < 0 || this.mesh === undefined) return;
    const min = this.frameMin;
    const count = this.frameMax - this.frameMin + 1;
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("vtint") as THREE.BufferAttribute;
    const nrm = geo.getAttribute("tnormal") as THREE.BufferAttribute;
    const berm = geo.getAttribute("berm") as THREE.BufferAttribute;
    const birth = geo.getAttribute("birth") as THREE.BufferAttribute;
    for (const a of [pos, col, nrm, berm, birth]) {
      a.clearUpdateRanges();
      a.addUpdateRange(min * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
