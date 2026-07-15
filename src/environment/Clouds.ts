import * as THREE from "three";
import { makeCel, type CelMaterial } from "../materials/cel";
import { clusterLayout, farBandLayout } from "./cloudCluster";
import { dayCycleState } from "./dayCycle";
import { CLOUD_BASE_TINT, cloudTintFor, farBandTintFor } from "./cloudTint";

const CLOUD_LAYER = 0;
const PUFF_RADIUS = 6;
const SQUASH = 0.4;
const DRIFT_SPEED = 2; // m/s
const DEFAULT_COUNT = 24;
const DEFAULT_HEIGHT = 60;
const DEFAULT_HALF = 100;
const DEFAULT_PUFFS_PER_CLOUD = 6;
/** Upper bound on the area-scaled default count so a huge domain stays sane. */
const MAX_COUNT = 400;

// Far parallax-free band defaults. The band is a ring of large soft puffs the
// camera drags along by XZ each frame; because it never moves relative to the
// camera it can neither recycle nor pop. Its JOB is to MASK the near field's
// horizon fog-out: near puffs fade to fog colour as they approach the fog-far
// wrap (~250-360 out) and that transition reads as distant clouds winking in/
// out. So the band must sit NEARER than that fade zone (radius 215, well inside
// day fog-far 360 / night 280) and be a TALL, DENSE, CONTINUOUS bank -- big
// overlapping blobs with vertical spread -- so it is actually opaque enough to
// stand in front of the transition rather than hazing away with it. Too far /
// too sparse (the pre-tune 260/16x4) was so fogged it masked nothing.
const FAR_BAND_RADIUS = 240;
const FAR_BAND_CLUSTERS = 28;
const FAR_BAND_PUFFS = 5;
const FAR_BAND_ALT_FACTOR = 1.05; // band rides slightly above the near puffs
const FAR_BAND_SCALE: [number, number] = [9, 13]; // soft blobs, horizon bank
const FAR_BAND_HEIGHT_JITTER = 10; // modest vertical spread -> a band, not a ceiling

export interface CloudsOptions {
  count?: number;
  /** Puffs per cloud cluster. Default 6. */
  puffsPerCloud?: number;
  /** Multiplier on the default cloud count (1.0). Ignored when count is set. */
  density?: number;
  /** Base altitude for cluster centers; alias for cloudHeight (wins if both). */
  altitude?: number;
  cloudHeight?: number;
  worldHalfExtent?: number;
  driftSpeed?: number;
  seed?: number;
  /** sRGB hex cloud tint. */
  color?: number;
  /**
   * Add the parallax-free far cloud band (default true). The band is a ring of
   * large puffs locked to the camera XZ so the far horizon never recycles/pops
   * (see {@link Clouds}). Pass false (e.g. low quality tier) to drop it — the
   * near recycled puffs then render alone (pre-band parity).
   */
  farBand?: boolean;
  /** Far-band ring radius (world units). Default 260, inside the fog horizon. */
  farBandRadius?: number;
  /** Far-band cluster count around the ring. Default 16. */
  farBandClusters?: number;
  /** Far-band puffs per cluster. Default 4. */
  farBandPuffs?: number;
  /** Far-band altitude (world Y). Default cloudHeight * 1.15. */
  farBandAltitude?: number;
}

/**
 * Drifting low-poly cloud layer for 004/014. One InstancedMesh of
 * count*puffsPerCloud squashed-icosahedron puffs (CelMaterial flatShading) on
 * layer 0. Puffs are placed once (deterministic seed) via clusterLayout: each
 * cloud is K jittered puffs around a center -> painted-blob silhouette. Each
 * frame update() recycles every puff's XZ around the moving focus
 * ({@link recycleAxis}, same form as the snow vertex-shader wrap) so the
 * field stays world-stationary (clouds gain correct driving parallax)
 * instead of rigidly translating with the kart; the wind drifts puffs +X.
 * No outline on instanced draws (the 001 inverted-hull shader has no
 * instance-matrix path; soft cel blobs are the accepted fallback). No
 * shadows.
 *
 * A second, parallax-free FAR BAND (a ring of large puffs via
 * {@link farBandLayout}, sharing the near material so it stays biome/sky-tinted
 * identically) is dragged along by the camera XZ each frame — it never moves
 * relative to the camera, so unlike the recycled near puffs it can neither gain
 * parallax nor recycle/pop. It sits inside the fog-far horizon and hazes into
 * the sky via USE_FOG so the seam with the fogged horizon is invisible. The far
 * mesh is `children[1]`; the near mesh stays `children[0]`.
 */
/**
 * Recycle an axis value around a moving focus so the point holds a fixed
 * world position and only wraps when it drifts past `focus +/- half`.
 * `motion` is the point's own world-space drift on that axis (e.g. wind).
 * `world = focus + mod(base + motion - focus + half, 2*half) - half`. With
 * `focus` 0 this reduces to the origin-anchored wrap. Pure: mirrors the
 * snow vertex-shader XZ wrap (see Weather.advancePosition) so the cloud
 * field stays world-stationary under focus translation, not rigidly glued.
 */
export function recycleAxis(base: number, motion: number, focus: number, half: number): number {
  const span = 2 * half;
  const m = (((base + motion - focus + half) % span) + span) % span;
  return focus + m - half;
}

export class Clouds {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly farMesh?: THREE.InstancedMesh;
  private readonly material: CelMaterial;
  private readonly farMaterial?: CelMaterial;
  private readonly wrap: number;
  private readonly drift: number;
  private readonly baseTint: THREE.Color;
  private readonly tintOut = new THREE.Color();
  private readonly farTintOut = new THREE.Color();
  private readonly baseMatrices: THREE.Matrix4[];
  private readonly baseX: Float32Array;
  private readonly baseZ: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();
  private driftX = 0;
  /**
   * Wind multiplier on the base drift speed (054 commit 3). Default 1 =>
   * drift byte-identical (parity). Environment's weather channel writes it
   * once/frame so cloud wind tracks the weather envelope.
   */
  private windMultiplier = 1;

  constructor(opts: CloudsOptions = {}) {
    const half = opts.worldHalfExtent ?? DEFAULT_HALF;
    // Cloud count scales with domain AREA so the areal density (puff spacing)
    // holds constant as the field grows to fill a larger sky. A bigger
    // worldHalfExtent then covers more sky with the same look (not sparser),
    // and every puff recycles far past the fog horizon rather than popping in
    // at a near boundary. worldHalfExtent == DEFAULT_HALF reproduces the
    // pre-scale count (parity for direct/unit construction).
    const areaScale = (half / DEFAULT_HALF) ** 2;
    const count =
      opts.count ??
      Math.min(MAX_COUNT, Math.round(DEFAULT_COUNT * (opts.density ?? 1) * areaScale));
    const puffsPerCloud = opts.puffsPerCloud ?? DEFAULT_PUFFS_PER_CLOUD;
    const height = opts.altitude ?? opts.cloudHeight ?? DEFAULT_HEIGHT;
    this.wrap = half + 20;
    this.drift = opts.driftSpeed ?? DRIFT_SPEED;
    this.baseTint = new THREE.Color(opts.color ?? CLOUD_BASE_TINT);

    const geo = new THREE.IcosahedronGeometry(PUFF_RADIUS, 0);
    geo.scale(1, SQUASH, 1);
    this.material = makeCel({
      flatShading: true,
      color: opts.color ?? CLOUD_BASE_TINT,
    });

    const matrices = clusterLayout({
      clouds: count,
      puffsPerCloud,
      worldHalfExtent: half,
      cloudHeight: height,
      seed: opts.seed ?? 1337,
      puffRadius: PUFF_RADIUS,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, matrices.length);
    this.mesh.layers.set(CLOUD_LAYER);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // The puff field recentres around the moving focus every update, but an
    // InstancedMesh bounding sphere is computed ONCE (lazily, from the
    // instance matrices at the first cull test) and never re-derived, so once
    // the focus travels the stale sphere wrongly culls the WHOLE field (all
    // clouds blink out whenever the camera looks away from where the sphere
    // was baked). The field surrounds every camera by construction — culling
    // can never win — so skip the test outright.
    this.mesh.frustumCulled = false;

    const n = matrices.length;
    this.baseMatrices = matrices;
    this.baseX = new Float32Array(n);
    this.baseZ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const el = matrices[i].elements;
      this.baseX[i] = el[12];
      this.baseZ[i] = el[14];
      this.mesh.setMatrixAt(i, matrices[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);

    // Parallax-free far band: a ring of large puffs the camera drags along by
    // XZ each frame (update). Owns farMaterial, tinted HARD toward the horizon
    // color each frame so it reads as haze on the horizon, not a white ridge.
    // Kept cheap (clusters*puffs large blobs). Added AFTER the near mesh so the
    // near mesh stays children[0].
    if (opts.farBand ?? true) {
      const farAlt = opts.farBandAltitude ?? height * FAR_BAND_ALT_FACTOR;
      const bandMatrices = farBandLayout({
        clusters: opts.farBandClusters ?? FAR_BAND_CLUSTERS,
        puffsPerCluster: opts.farBandPuffs ?? FAR_BAND_PUFFS,
        radius: opts.farBandRadius ?? FAR_BAND_RADIUS,
        altitude: farAlt,
        heightJitter: FAR_BAND_HEIGHT_JITTER,
        scaleRange: FAR_BAND_SCALE,
        seed: (opts.seed ?? 1337) ^ 0x5eed,
      });
      // Smoother (subdiv 1) large blobs read better at the horizon than the
      // near facet count; still one squashed icosahedron, scale baked in the
      // instance matrices.
      const farGeo = new THREE.IcosahedronGeometry(PUFF_RADIUS, 1);
      farGeo.scale(1, SQUASH, 1);
      // Own material (not this.material): the band tints HARD toward the horizon
      // color every frame (farBandTintFor) so it dissolves into the sky as haze
      // rather than a white ridge, while the high near puffs stay white.
      this.farMaterial = makeCel({ flatShading: true, color: opts.color ?? CLOUD_BASE_TINT });
      const far = new THREE.InstancedMesh(farGeo, this.farMaterial, bandMatrices.length);
      far.layers.set(CLOUD_LAYER);
      far.castShadow = false;
      far.receiveShadow = false;
      // The mesh recentres on the camera via mesh.position each frame (a rigid
      // world translation), so its baked bounding sphere transforms correctly —
      // but the ring surrounds every camera by construction, so culling can
      // never usefully win; skip the test outright (mirrors the near field).
      far.frustumCulled = false;
      for (let i = 0; i < bandMatrices.length; i++) far.setMatrixAt(i, bandMatrices[i]);
      far.instanceMatrix.needsUpdate = true;
      this.farMesh = far;
      this.group.add(far);
    }
  }

  /** Set the wind multiplier on the base drift speed (054). Default 1 = parity. */
  setWindMultiplier(m: number): void {
    this.windMultiplier = m;
  }

  /** Advance the drift + re-derive the day-cycle cloud tint from the singleton. */
  update(dt: number, focusX = 0, focusZ = 0): void {
    const span = 2 * this.wrap;
    const adv = this.drift * this.windMultiplier * dt;
    this.driftX = (((this.driftX + adv) % span) + span) % span;
    const baseMatrices = this.baseMatrices;
    const baseX = this.baseX;
    const baseZ = this.baseZ;
    const scratch = this.scratchMatrix;
    for (let i = 0; i < baseMatrices.length; i++) {
      scratch.copy(baseMatrices[i]);
      scratch.elements[12] = recycleAxis(baseX[i], this.driftX, focusX, this.wrap);
      scratch.elements[14] = recycleAxis(baseZ[i], 0, focusZ, this.wrap);
      this.mesh.setMatrixAt(i, scratch);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    // Parallax-free lock: drag the far band along by the camera XZ (not the
    // per-instance recycle the near field uses). The band thus holds a fixed
    // camera-relative position -> zero parallax, and no instance ever wraps, so
    // it cannot recycle or pop. Y stays 0: the band's world altitude is baked
    // in its matrices and vertical parallax at this range is imperceptible.
    if (this.farMesh) this.farMesh.position.set(focusX, 0, focusZ);
    cloudTintFor(dayCycleState.phase, dayCycleState.skyHorizon, this.baseTint, this.tintOut);
    this.material.uniforms.uColor.value.copy(this.tintOut);
    if (this.farMaterial) {
      farBandTintFor(dayCycleState.phase, dayCycleState.skyHorizon, this.baseTint, this.farTintOut);
      this.farMaterial.uniforms.uColor.value.copy(this.farTintOut);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.farMesh?.geometry.dispose();
    this.material.dispose();
    this.farMaterial?.dispose();
  }
}
