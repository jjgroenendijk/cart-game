import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";
import { AERIAL_DEFAULTS } from "./aerial";
import { DETAIL_DEFAULTS } from "./terrainDetail";
import { snowUniforms } from "./snowCover";
import { CEL_VERT, celFragmentShader } from "./celShader";

/** Shared terrain-wetness uniform (054). Terrain CelMaterials opt in via
 *  wetness:true; Environment writes .value once/frame. Default 0 = no effect. */
export const wetnessUniform = { uWetness: { value: 0 } };

// Shared snow-cover channel (cover level + wind dir); defined in ./snowCover.
export { snowUniform } from "./snowCover";

export interface CelOpts {
  /** Linear base color. */
  color?: number;
  /** Use dFdx/dFdy face normals (WebGL2) — no geometry de-indexing needed. */
  flatShading?: boolean;
  /** Opt-in hard specular band (off by default). */
  specular?: boolean;
  /** Number of discrete diffuse bands. */
  bands?: number;
  /** Band-edge AA width in band-fraction units (0 = hard floor). Default 0.12. */
  bandEdge?: number;
  rimColor?: number;
  rimPower?: number;
  rimIntensity?: number;
  /**
   * Multiply uColor by the per-vertex `color` attribute. Required for painted
   * terrain (road/grass/rock via vertex colors). The geometry must carry a
   * `color` BufferAttribute; this flag declares the attribute + varying.
   */
  vertexColors?: boolean;
  /**
   * Per-pixel normal from a height texture (terrain). When set, the fragment
   * reconstructs the world-space surface normal by finite-differencing the
   * heightmap at the fragment's world (x,z), independent of mesh
   * triangulation. Eliminates the diagonal/diamond cel-band artifacts that
   * appear when cel-quantizing a per-vertex normal linearly interpolated
   * across each quad's diagonal fold. Used by TerrainChunkManager.
   */
  heightMap?: HeightMapField;
  /**
   * Discrete diffuse banding (toon shading). Defaults on. Set false for
   * smooth lambert: terrain uses a smooth height normal, so cel-quantising
   * its N.L renders the contour lines as visible stripes across the
   * landscape. Smooth (no bands) reads as soft terrain shading.
   */
  cel?: boolean;
  /**
   * Bilinearly interpolate the heightmap neighbour taps so the per-pixel
   * normal is continuous (C0) instead of piecewise-constant per texel,
   * eliminating the ~texel-size square shade grid. Defaults on when
   * heightMap is set. Off reverts to the 4-tap nearest path.
   */
  heightSmooth?: boolean;
  /**
   * Opt terrain into the shared uWetness darkening channel (054). When set,
   * adds the WETNESS define + binds the shared {@link wetnessUniform}.uWetness
   * reference so a single Environment write fans out to every terrain chunk's
   * material. Default off => no uWetness uniform + no WETNESS define (the
   * shader never references it -> byte-identical to the pre-054 path).
   */
  wetness?: boolean;
  /** Opt into the shared uSnowCover channel (see ./snowCover): whiten terrain +
   *  props with weather-driven, blue-shadowed, wind-drifted patchy snow. Off =>
   *  no SNOW_COVER define, no snow uniforms, fragment byte-identical. */
  snowCover?: boolean;
  /** Add the SNOW_SPARKLE lit-snow glint on top of snowCover. Defaults on; low
   *  tier passes false so weak GPUs compile the glint out entirely. */
  snowSparkle?: boolean;
  /**
   * Procedural fbm surface detail (069): mottle the LINEAR albedo and perturb
   * the per-pixel heightmap normal with the fbm gradient. Only meaningful when
   * heightMap is set (the detail GLSL lives inside the HEIGHT_MAP block and
   * keys on vWorldXZ); ignored otherwise. Off => no SURFACE_DETAIL define, no
   * uDetail* uniforms, fragment shader byte-identical to pre-069.
   */
  surfaceDetail?: boolean;
  /**
   * Compile-time octave count for the surface-detail fbm loop (only used when
   * surfaceDetail + heightMap are set). Baked into the shader as
   * `#define DETAIL_OCTAVES`; changing it requires a material rebuild
   * (needsUpdate on the existing material is not enough). A tier change that
   * alters octaves must rebuild the material, not use the surfaceDetail
   * setter. Defaults to DETAIL_DEFAULTS.octaves (3).
   */
  detailOctaves?: number;
  /**
   * Apply linear distance fog toward the scene fog colour (mirrors celWater).
   * Defaults ON: world geometry (terrain/props/clouds) must haze into the
   * horizon so the streamed-terrain edge dissolves instead of ending in a hard
   * cutoff. `fog:true` makes three.js push scene fog (color/near/far, already
   * capped to the bounded world by the Renderer) into the shared uniforms and
   * define `USE_FOG`. Pass false for materials in an unfogged scene or that
   * must never haze; the `USE_FOG`-guarded block then compiles out
   * (byte-identical to the pre-fog fragment).
   */
  fog?: boolean;
  /**
   * Ordered-dither fade (see ./fade.ts): adds a `uFade` uniform (default 1 =
   * solid) and discards Bayer-thresholded fragments when uFade < 1, so opaque
   * geometry dissolves in/out without alpha blending. Streamed dressing
   * writes uFade per bundle to hide activation/cull pops. Off (default) =>
   * no uniform, no dither GLSL, fragment byte-identical to the pre-fade
   * source (the discard would disable early-Z, so only opt-in draws pay it).
   */
  fade?: boolean;
  /**
   * Aerial (atmospheric) perspective: desaturate distant fragments and pull
   * them toward the atmosphere colour (`fogColor`), so the landscape recedes
   * cold and blue-grey while the foreground stays saturated (see ./aerial.ts).
   * Requires fog — it reuses `fogColor` + view-space depth, so it is silently
   * ignored when `fog:false` (no atmosphere without haze). Adds the `AERIAL`
   * define + uAerial* uniforms nested inside the `USE_FOG` block; off (default)
   * => no define, no uniforms, fragment byte-identical to the pre-aerial path.
   * Opt in on WORLD surfaces (terrain, scenery), never on karts: the colour law
   * keeps saturated liveries as a gameplay read that pops against the muted,
   * receding world.
   */
  aerial?: boolean;
}

/**
 * Heightmap descriptor for the {@link CelMaterial} per-pixel normal path.
 * The texture covers a square world region; texel [0,0] sits at `origin`.
 */
export interface HeightMapField {
  texture: THREE.Texture;
  /** World (x, z) at the texture's [0,0] texel corner (min corner). */
  origin: [number, number];
  /** World span the texture covers along BOTH axes (square). */
  size: number;
  /** Texels per axis (texels are square). */
  texels: number;
}

/**
 * Custom cel ShaderMaterial: lambert snapped to N bands, rim term, and an
 * optional hard specular band. flatShading toggles per-face normals via
 * fragment derivatives (no flatGeometry de-indexing -> no 3x VRAM). Shares
 * the module-level lightUniforms so the Renderer fans a single per-frame
 * sun/ambient write out to every CelMaterial instance.
 *
 * Outputs LINEAR color; tone mapping + output color space are applied by the
 * composer's OutputPass (Renderer), not here.
 */
export class CelMaterial extends THREE.ShaderMaterial {
  constructor(opts: CelOpts = {}) {
    const defines: Record<string, string> = {};
    if (opts.flatShading) defines["FLAT"] = "";
    if (opts.specular) defines["SPECULAR"] = "";
    if (opts.vertexColors) defines["VERTEX_COLORS"] = "";
    if (opts.cel === false) defines["SMOOTH_DIFFUSE"] = "";
    // heightSmooth defaults on when heightMap is set; off reverts to the
    // 4-tap nearest path (bit-identical fallback, no sampleH in source).
    const useSmooth = !!opts.heightMap && opts.heightSmooth !== false;
    if (opts.heightMap) {
      defines["HEIGHT_MAP"] = "";
      if (useSmooth) defines["HEIGHT_SMOOTH"] = "";
    }
    if (opts.wetness) defines["WETNESS"] = "";
    // surfaceDetail is only meaningful with heightMap (detail GLSL lives inside
    // the HEIGHT_MAP block + keys on vWorldXZ). Guarded here so the off-path
    // (no heightMap, or surfaceDetail false) emits no define + no uniforms +
    // a byte-identical fragment shader.
    const useDetail = !!(opts.surfaceDetail && opts.heightMap);
    if (useDetail) defines["SURFACE_DETAIL"] = "";
    // Snow: SNOW_SPARKLE is nested so low tier (snowSparkle:false) drops the
    // glint; snowCover off => no define, byte-identical fragment. See ./snowCover.
    const useSparkle = !!(opts.snowCover && opts.snowSparkle !== false);
    if (opts.snowCover) defines["SNOW_COVER"] = "";
    if (useSparkle) defines["SNOW_SPARKLE"] = "";
    // Distance fog defaults ON so world geometry hazes into the horizon; the
    // Renderer's scene fog (day-cycle color/near/far, capped to the bounded
    // world) is pushed into fogColor/fogNear/fogFar by three.js each frame. An
    // unfogged scene (e.g. KartPreview) leaves USE_FOG undefined -> no haze.
    const useFog = opts.fog ?? true;
    // Aerial perspective (see ./aerial.ts) reuses fogColor + view depth, so it
    // only takes effect on a fogged material; requested without fog it is a
    // no-op (no AERIAL define, no uAerial* uniforms -> byte-identical fragment).
    const useAerial = useFog && !!opts.aerial;
    if (useAerial) defines["AERIAL"] = "";

    const uniforms: Record<string, THREE.IUniform> = {
      ...lightUniforms,
      // Light + shadow uniforms (directionalShadowMatrix/Map,
      // directionalLightShadows) so the renderer can bind the sun shadow map.
      // `lights` below makes three add the USE_SHADOWMAP + NUM_DIR_LIGHT_SHADOWS
      // defines; the cel shading itself still reads the custom uSunDir/uSunColor.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uBands: { value: opts.bands ?? 3 },
      uBandEdge: { value: opts.bandEdge ?? 0.12 },
      uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xffffff) },
      uRimPower: { value: opts.rimPower ?? 2.0 },
      uRimIntensity: { value: opts.rimIntensity ?? 0.3 },
    };
    if (opts.specular) {
      uniforms.uSpecularShininess = { value: 32 };
      uniforms.uSpecularIntensity = { value: 0.6 };
    }
    if (opts.heightMap) {
      const hm = opts.heightMap;
      uniforms.uHeightMap = { value: hm.texture };
      uniforms.uHeightOrigin = { value: new THREE.Vector2(hm.origin[0], hm.origin[1]) };
      uniforms.uHeightSize = { value: hm.size };
      uniforms.uHeightTexelWorld = { value: hm.size / hm.texels };
    }
    if (opts.wetness) {
      // Bind the SHARED reference (not a spread copy): the value is a number
      // primitive, so spreading would copy it and one Environment write would
      // NOT fan out. Mirrors the lightUniforms by-reference pattern.
      uniforms.uWetness = wetnessUniform.uWetness;
    }
    if (useDetail) {
      // Detail uniforms default to DETAIL_DEFAULTS; commit 3 (tier wiring)
      // overlays terrainDetailForTier(...) here. Octaves is a compile constant
      // (DETAIL_OCTAVES), not a uniform.
      uniforms.uDetailStrength = { value: DETAIL_DEFAULTS.strength };
      uniforms.uDetailScale = { value: DETAIL_DEFAULTS.scale };
      uniforms.uDetailBump = { value: DETAIL_DEFAULTS.bump };
    }
    // uSnowCover + uSnowWindDir SHARED by-ref (one write fans out); rest is fixed
    // per-material tuning. See ./snowCover snowUniforms().
    if (opts.snowCover) Object.assign(uniforms, snowUniforms(useSparkle));
    if (useFog) {
      // three.js refreshFogUniforms writes these each frame from scene.fog when
      // the material is rendered in a fogged scene; the keys must exist for that
      // to land. Defaults match the Renderer's day fog until the first write.
      uniforms.fogColor = { value: new THREE.Color(0xb6ad9e) };
      uniforms.fogNear = { value: 90 };
      uniforms.fogFar = { value: 360 };
    }
    if (useAerial) {
      // Static tuning from AERIAL_DEFAULTS; the atmosphere tint target is the
      // day-cycle/biome fogColor three.js writes each frame (no extra upload).
      uniforms.uAerialNear = { value: AERIAL_DEFAULTS.near };
      uniforms.uAerialFar = { value: AERIAL_DEFAULTS.far };
      uniforms.uAerialDesat = { value: AERIAL_DEFAULTS.desat };
      uniforms.uAerialTint = { value: AERIAL_DEFAULTS.tint };
    }
    if (opts.fade) {
      // Per-material (NOT shared): each streamed bundle fades independently.
      uniforms.uFade = { value: 1 };
    }

    super({
      defines,
      uniforms,
      vertexShader: CEL_VERT,
      fragmentShader: celFragmentShader(
        useSmooth,
        !!opts.wetness,
        useDetail,
        opts.detailOctaves ?? DETAIL_DEFAULTS.octaves,
        !!opts.fade,
        !!opts.snowCover,
      ),
      // Lights ON so three injects the USE_SHADOWMAP / NUM_DIR_SHADOWS
      // defines and binds the sun's shadow map; the cel shading itself still
      // reads the custom uSunDir/uSunColor (no three light chunks included).
      lights: true,
      // Fog ON pushes scene fog into fogColor/fogNear/fogFar + defines USE_FOG
      // (only when the render scene has fog); world geometry then hazes.
      fog: useFog,
    });
    // Keep three.js's own bookkeeping in sync (buffer binding path).
    this.vertexColors = opts.vertexColors ?? false;
  }

  /** Toggle face-normal (flat) shading at runtime; recompiles on change. */
  get flatShading(): boolean {
    return "FLAT" in this.defines;
  }

  set flatShading(v: boolean) {
    if (v) this.defines["FLAT"] = "";
    else delete this.defines["FLAT"];
    this.needsUpdate = true;
  }

  /**
   * Runtime toggle for the SURFACE_DETAIL branch (mirrors flatShading): flips
   * the define + needsUpdate so the fragment recompiles. Only meaningful on a
   * material constructed with heightMap; toggling does NOT change the baked
   * DETAIL_OCTAVES compile constant or the injected GLSL body. A tier change
   * that alters octaves must rebuild the material (commit 3's job), not use
   * this setter.
   */
  get surfaceDetail(): boolean {
    return "SURFACE_DETAIL" in this.defines;
  }

  set surfaceDetail(v: boolean) {
    if (v) this.defines["SURFACE_DETAIL"] = "";
    else delete this.defines["SURFACE_DETAIL"];
    this.needsUpdate = true;
  }
}

/** Factory matching the plan's makeCel({flatShading}) call sites. */
export function makeCel(opts: CelOpts = {}): CelMaterial {
  return new CelMaterial(opts);
}
