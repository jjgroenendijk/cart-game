import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial, makeCel, snowUniform, wetnessUniform } from "./cel";
import { celGradient } from "./gradient";
import { DETAIL_DEFAULTS } from "./terrainDetail";
import { AERIAL_DEFAULTS } from "./aerial";

describe("CelMaterial", () => {
  it("applies plan defaults (bands 3, rim on, specular off, no FLAT define)", () => {
    const m = new CelMaterial();
    expect(m.uniforms.uBands.value).toBe(3);
    expect(m.uniforms.uBandEdge.value).toBeCloseTo(0.12, 6);
    expect(m.uniforms.uRimIntensity.value).toBeCloseTo(0.3, 6);
    expect(m.uniforms.uRimPower.value).toBeCloseTo(2.0, 6);
    expect(m.uniforms.uColor.value).toBeInstanceOf(THREE.Color);
    expect(m.flatShading).toBe(false);
    expect(m.defines.SPECULAR).toBeUndefined();
    expect(m.defines.FLAT).toBeUndefined();
  });

  it("honors opts (color, bands, bandEdge, flatShading, specular)", () => {
    const m = makeCel({
      color: 0xff5252,
      bands: 4,
      bandEdge: 0.2,
      flatShading: true,
      specular: true,
    });
    expect((m.uniforms.uColor.value as THREE.Color).getHex()).toBe(0xff5252);
    expect(m.uniforms.uBands.value).toBe(4);
    expect(m.uniforms.uBandEdge.value).toBeCloseTo(0.2, 6);
    expect(m.flatShading).toBe(true);
    expect(m.defines.FLAT).toBe("");
    expect(m.defines.SPECULAR).toBe("");
    expect(m.uniforms.uSpecularShininess.value).toBe(32);
  });

  it("defaults fog ON: fog uniforms + USE_FOG-guarded haze so world geometry hazes", () => {
    const m = new CelMaterial();
    expect(m.fog).toBe(true);
    expect(m.uniforms.fogColor.value).toBeInstanceOf(THREE.Color);
    expect(m.uniforms.fogNear.value).toBe(90);
    expect(m.uniforms.fogFar.value).toBe(360);
    expect(m.fragmentShader).toContain("#ifdef USE_FOG");
    expect(m.fragmentShader).toContain("smoothstep(fogNear, fogFar, -vViewPos.z)");
    expect(m.fragmentShader).toContain("mix(color, fogColor, fogFactor)");
  });

  it("fog:false drops the fog uniforms (unfogged scene / no haze)", () => {
    const m = makeCel({ fog: false });
    expect(m.fog).toBe(false);
    expect(m.uniforms.fogColor).toBeUndefined();
    expect(m.uniforms.fogNear).toBeUndefined();
    expect(m.uniforms.fogFar).toBeUndefined();
  });

  it("default drops the AERIAL define + uAerial uniforms (opt-in only)", () => {
    const m = makeCel();
    expect(m.defines.AERIAL).toBeUndefined();
    expect(m.uniforms.uAerialNear).toBeUndefined();
    expect(m.uniforms.uAerialFar).toBeUndefined();
    expect(m.uniforms.uAerialDesat).toBeUndefined();
    expect(m.uniforms.uAerialTint).toBeUndefined();
  });

  it("aerial:true adds the AERIAL define + uAerial uniforms from AERIAL_DEFAULTS", () => {
    const m = makeCel({ aerial: true });
    expect(m.defines.AERIAL).toBe("");
    expect(m.uniforms.uAerialNear.value).toBe(AERIAL_DEFAULTS.near);
    expect(m.uniforms.uAerialFar.value).toBe(AERIAL_DEFAULTS.far);
    expect(m.uniforms.uAerialDesat.value).toBe(AERIAL_DEFAULTS.desat);
    expect(m.uniforms.uAerialTint.value).toBe(AERIAL_DEFAULTS.tint);
    expect(m.fragmentShader).toContain("#ifdef AERIAL");
    expect(m.fragmentShader).toContain("smoothstep(uAerialNear, uAerialFar, -vViewPos.z)");
    expect(m.fragmentShader).toContain("mix(color, vec3(aerialLum), aerial * uAerialDesat)");
    expect(m.fragmentShader).toContain("mix(color, fogColor, aerial * uAerialTint)");
  });

  it("aerial requires fog: aerial:true + fog:false is a no-op (no define/uniforms)", () => {
    const m = makeCel({ aerial: true, fog: false });
    expect(m.defines.AERIAL).toBeUndefined();
    expect(m.uniforms.uAerialNear).toBeUndefined();
  });

  it("cel band math uses AA edges (smoothstep), not a hard floor", () => {
    const m = new CelMaterial();
    expect(m.fragmentShader).toContain("uBandEdge");
    expect(m.fragmentShader).toContain("smoothstep(1.0 - uBandEdge, 1.0, f)");
    expect(m.fragmentShader).not.toMatch(/floor\(NdL \* uBands\) \/ uBands/);
  });

  it("toggling flatShading flips the FLAT define and marks the shader for recompile", () => {
    const m = new CelMaterial();
    expect(m.flatShading).toBe(false);
    expect(m.defines.FLAT).toBeUndefined();

    const v0 = m.version;
    m.flatShading = true;
    expect(m.defines.FLAT).toBe("");
    expect(m.version).toBeGreaterThan(v0); // needsUpdate -> version bumped

    const v1 = m.version;
    m.flatShading = false;
    expect(m.defines.FLAT).toBeUndefined();
    expect(m.version).toBeGreaterThan(v1);
  });

  it("shares module-level light uniforms by reference (one write fans out)", () => {
    const a = new CelMaterial();
    const b = new CelMaterial();
    expect(a.uniforms.uSunDir).toBe(b.uniforms.uSunDir);
    expect(a.uniforms.uSunColor).toBe(b.uniforms.uSunColor);
    expect(a.uniforms.uAmbient).toBe(b.uniforms.uAmbient);
  });

  it("dispose() frees GPU resources without throwing", () => {
    const m = new CelMaterial();
    expect(() => m.dispose()).not.toThrow();
  });

  it("vertexColors adds VERTEX_COLORS define, sets the flag, and emits vColor plumbing", () => {
    const m = makeCel({ vertexColors: true });
    expect(m.vertexColors).toBe(true);
    expect(m.defines.VERTEX_COLORS).toBe("");
    // Vertex shader assigns into vColor (the color attribute itself is
    // injected by three.js under USE_COLOR); fragment multiplies the base.
    expect(m.vertexShader).toContain("vColor = color;");
    expect(m.vertexShader).toContain("varying vec3 vColor;");
    expect(m.fragmentShader).toContain("base *= vColor;");
    expect(m.fragmentShader).toContain("varying vec3 vColor;");
  });

  it("vertexColors defaults off (no define; preprocessor strips guarded code)", () => {
    const m = new CelMaterial();
    expect(m.vertexColors).toBe(false);
    expect(m.defines.VERTEX_COLORS).toBeUndefined();
  });

  it("vertex shader applies instanceMatrix under USE_INSTANCING (InstancedMesh)", () => {
    const m = new CelMaterial();
    // Guarded block present + references instanceMatrix on position and normal.
    expect(m.vertexShader).toContain("#ifdef USE_INSTANCING");
    expect(m.vertexShader).toMatch(/instanceMatrix \* vec4\(position/);
    expect(m.vertexShader).toMatch(/mat3\(instanceMatrix\) \* normal/);
    // Non-instanced fallback: transformed initialised from position/normal
    // before the guarded block, so plain meshes are unaffected.
    expect(m.vertexShader).toContain("vec3 transformed = position;");
  });

  it("is lit (lights:true) and includes the three shadow chunks", () => {
    const m = new CelMaterial();
    expect(m.lights).toBe(true);
    // Shadow coord plumbing (vertex) + getShadow/struct (fragment).
    expect(m.vertexShader).toContain("#include <shadowmap_pars_vertex>");
    expect(m.vertexShader).toContain("NUM_DIR_LIGHT_SHADOWS");
    expect(m.fragmentShader).toContain("#include <shadowmap_pars_fragment>");
    expect(m.fragmentShader).toContain("getShadow(");
    // Sun term multiplied by the shadow mask (guarded so it compiles out).
    expect(m.fragmentShader).toContain("#ifdef USE_SHADOWMAP");
    // Shared day-cycle shadow fade uniform: default 1 keeps non-day-cycle
    // paths bit-identical; the cast-shadow term multiplies by it.
    expect(m.uniforms.uShadowFade.value).toBe(1);
    expect(m.fragmentShader).toContain("uniform float uShadowFade;");
    expect(m.fragmentShader).toContain("* uShadowFade");
  });

  it("heightMap opts switch to the per-pixel heightmap normal path", () => {
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const m = makeCel({
      vertexColors: true,
      heightMap: { texture: tex, origin: [-100, -100], size: 200, texels: 256 },
    });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.uniforms.uHeightMap.value).toBe(tex);
    expect((m.uniforms.uHeightOrigin.value as THREE.Vector2).x).toBe(-100);
    expect(m.uniforms.uHeightSize.value).toBe(200);
    // world units per texel = size / texels.
    expect(m.uniforms.uHeightTexelWorld.value).toBeCloseTo(200 / 256, 6);
    // Vertex passes world x,z; fragment reconstructs the normal from 4
    // neighbour taps (no per-vertex normal fold -> no diagonal cel banding).
    expect(m.vertexShader).toContain("varying vec2 vWorldXZ;");
    expect(m.fragmentShader).toContain("texture2D(uHeightMap");
    // HEIGHT_MAP takes precedence over the default vViewNormal path.
    expect(m.fragmentShader).toContain("#ifdef HEIGHT_MAP");
    // three's fragment prefix omits `normalMatrix`; the HEIGHT_MAP block
    // declares it itself to map the world normal -> view. Without this the
    // fragment fails to compile and the terrain renders as nothing.
    expect(m.fragmentShader).toContain("uniform mat3 normalMatrix;");
    tex.dispose();
  });

  it("heightSmooth defaults on when heightMap is set", () => {
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const m = makeCel({
      heightMap: { texture: tex, origin: [-100, -100], size: 200, texels: 256 },
    });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.defines.HEIGHT_SMOOTH).toBe("");
    tex.dispose();
  });

  it("heightSmooth: false omits HEIGHT_SMOOTH and keeps the 4-tap nearest path", () => {
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const m = makeCel({
      heightMap: { texture: tex, origin: [-100, -100], size: 200, texels: 256 },
      heightSmooth: false,
    });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.defines.HEIGHT_SMOOTH).toBeUndefined();
    // Nearest 4-tap path intact (bit-identical fallback); no bilinear helper.
    expect(m.fragmentShader).toContain("hUV + vec2(-hOff, 0.0)");
    expect(m.fragmentShader).not.toContain("sampleH");
    tex.dispose();
  });

  it("heightSmooth on emits the sampleH bilinear helper and calls it for the height taps", () => {
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const m = makeCel({
      heightMap: { texture: tex, origin: [-100, -100], size: 200, texels: 256 },
    });
    expect(m.defines.HEIGHT_SMOOTH).toBe("");
    // sampleH helper defined + the HEIGHT_SMOOTH-guarded central-difference
    // calls (16 NearestFilter taps total, bilinearly mixed).
    expect(m.fragmentShader).toContain("float sampleH(");
    expect(m.fragmentShader).toContain("#ifdef HEIGHT_SMOOTH");
    expect(m.fragmentShader).toMatch(/sampleH\(vWorldXZ \+ vec2\(-uHeightTexelWorld, 0\.0\)\)/);
    // Bilinear mix present in the height block (nested mix -> distinguishes
    // from the single band-edge mix in the cel-band math).
    expect(m.fragmentShader).toContain("mix(mix(");
    // Half-texel phase correction: knots align with texel centres (hp-0.5)
    // so the reconstructed normal tracks the mesh geometry, not half a texel
    // ahead of it.
    expect(m.fragmentShader).toContain("hp - 0.5");
    expect(m.fragmentShader).toContain("fract(c)");
    // Height uniform set stays stable.
    expect(m.uniforms.uHeightMap.value).toBe(tex);
    expect(m.uniforms.uHeightOrigin).toBeDefined();
    expect(m.uniforms.uHeightSize).toBeDefined();
    expect(m.uniforms.uHeightTexelWorld).toBeDefined();
    tex.dispose();
  });

  it("cel defaults on (SMOOTH_DIFFUSE undefined; band math compiles in)", () => {
    const m = new CelMaterial();
    expect(m.defines.SMOOTH_DIFFUSE).toBeUndefined();
    // Cel path present in source (selected at compile since the define is off).
    expect(m.fragmentShader).toContain("smoothstep(1.0 - uBandEdge, 1.0, f)");
  });

  it("cel: false switches terrain to smooth lambert (no band quantization)", () => {
    const m = makeCel({ vertexColors: true, cel: false });
    expect(m.defines.SMOOTH_DIFFUSE).toBe("");
    // Smooth path: band takes raw lambert; the cel floor/snapping is compiled
    // out under the guard so contour bands can't read as terrain stripes.
    expect(m.fragmentShader).toContain("#ifdef SMOOTH_DIFFUSE");
    expect(m.fragmentShader).toContain("band = NdL");
    expect(m.fragmentShader).toContain("#else");
    // Karts/props keep the cel path in source (guard selects per-material).
    expect(m.fragmentShader).toContain("smoothstep(1.0 - uBandEdge, 1.0, f)");
  });

  it("default CelMaterial has NO uWetness path (byte-identical, no wetness)", () => {
    const m = new CelMaterial();
    expect(m.defines.WETNESS).toBeUndefined();
    expect(m.uniforms.uWetness).toBeUndefined();
    expect(m.fragmentShader).not.toContain("uWetness");
  });

  it("wetness:true adds WETNESS define + uWetness shader plumbing", () => {
    const m = makeCel({ wetness: true });
    expect(m.defines.WETNESS).toBe("");
    expect(m.fragmentShader).toContain("uWetness");
    expect(m.fragmentShader).toContain("#ifdef WETNESS");
    expect(m.fragmentShader).toContain("(1.0 - 0.25 * uWetness)");
  });

  it("wetness material binds the SHARED wetnessUniform.uWetness reference", () => {
    const m = makeCel({ wetness: true });
    expect(m.uniforms.uWetness).toBe(wetnessUniform.uWetness);
  });

  it("two wetness materials share one uniform object (one write updates both)", () => {
    const m1 = makeCel({ wetness: true });
    const m2 = makeCel({ wetness: true });
    expect(m1.uniforms.uWetness).toBe(m2.uniforms.uWetness);
    wetnessUniform.uWetness.value = 0.7;
    expect((m1.uniforms.uWetness as { value: number }).value).toBe(0.7);
    expect((m2.uniforms.uWetness as { value: number }).value).toBe(0.7);
    wetnessUniform.uWetness.value = 0; // reset shared ref for other tests
  });
});

describe("surfaceDetail", () => {
  function hmOpts() {
    return {
      texture: new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType),
      origin: [-100, -100] as [number, number],
      size: 200,
      texels: 256,
    };
  }

  it("off-path fragment is byte-identical whether surfaceDetail is absent or false", () => {
    // Snapshot the no-detail heightMap fragment, then assert a fresh no-detail
    // material (surfaceDetail absent AND surfaceDetail:false) produces the
    // exact same string + no detail define/uniforms. This is the 069
    // "byte-identical when off" contract other cel tests rely on.
    const baseline = makeCel({
      vertexColors: true,
      heightMap: hmOpts(),
    }).fragmentShader;
    const absent = makeCel({ vertexColors: true, heightMap: hmOpts() });
    expect(absent.fragmentShader).toBe(baseline);
    expect(absent.defines.SURFACE_DETAIL).toBeUndefined();
    expect(absent.uniforms.uDetailStrength).toBeUndefined();
    expect(absent.uniforms.uDetailScale).toBeUndefined();
    expect(absent.uniforms.uDetailBump).toBeUndefined();

    const off = makeCel({
      vertexColors: true,
      heightMap: hmOpts(),
      surfaceDetail: false,
    });
    expect(off.fragmentShader).toBe(baseline);
    expect(off.defines.SURFACE_DETAIL).toBeUndefined();
    expect(off.uniforms.uDetailStrength).toBeUndefined();
    // No detail text leaks into the off-path source.
    expect(off.fragmentShader).not.toContain("SURFACE_DETAIL");
    expect(off.fragmentShader).not.toContain("uDetailStrength");
    expect(off.fragmentShader).not.toContain("DETAIL_OCTAVES");
  });

  it("surfaceDetail + heightMap adds the define, uniforms, and shader plumbing", () => {
    const m = makeCel({
      vertexColors: true,
      heightMap: hmOpts(),
      surfaceDetail: true,
    });
    expect(m.defines.SURFACE_DETAIL).toBe("");
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.uniforms.uDetailStrength.value).toBeCloseTo(DETAIL_DEFAULTS.strength, 6);
    expect(m.uniforms.uDetailScale.value).toBeCloseTo(DETAIL_DEFAULTS.scale, 6);
    expect(m.uniforms.uDetailBump.value).toBeCloseTo(DETAIL_DEFAULTS.bump, 6);
    // Noise fns inlined under SURFACE_DETAIL.
    expect(m.fragmentShader).toContain("float hash2(");
    expect(m.fragmentShader).toContain("float vnoise(");
    expect(m.fragmentShader).toContain("float fbm(");
    // Both apply sites present + reference the detail uniforms.
    expect(m.fragmentShader).toContain("uDetailStrength");
    expect(m.fragmentShader).toContain("uDetailBump");
    expect(m.fragmentShader).toContain("#ifdef SURFACE_DETAIL");
    // Octave compile constant defaults to DETAIL_DEFAULTS.octaves.
    expect(m.fragmentShader).toContain("#define DETAIL_OCTAVES 3");
  });

  it("surfaceDetail without heightMap is ignored (no define, no uniforms)", () => {
    const m = makeCel({ surfaceDetail: true });
    expect(m.defines.SURFACE_DETAIL).toBeUndefined();
    expect(m.defines.HEIGHT_MAP).toBeUndefined();
    expect(m.uniforms.uDetailStrength).toBeUndefined();
    expect(m.uniforms.uDetailScale).toBeUndefined();
    expect(m.uniforms.uDetailBump).toBeUndefined();
    expect(m.fragmentShader).not.toContain("SURFACE_DETAIL");
    expect(m.fragmentShader).not.toContain("uDetailStrength");
    expect(m.fragmentShader).not.toContain("DETAIL_OCTAVES");
  });

  it("detailOctaves opt bakes the compile constant into the shader", () => {
    const m = makeCel({
      heightMap: hmOpts(),
      surfaceDetail: true,
      detailOctaves: 2,
    });
    expect(m.fragmentShader).toContain("#define DETAIL_OCTAVES 2");
    expect(m.fragmentShader).not.toContain("#define DETAIL_OCTAVES 3");
  });

  it("runtime setter flips the SURFACE_DETAIL define and bumps version", () => {
    const m = makeCel({ vertexColors: true, heightMap: hmOpts() });
    expect(m.surfaceDetail).toBe(false);
    expect(m.defines.SURFACE_DETAIL).toBeUndefined();

    const v0 = m.version;
    m.surfaceDetail = true;
    expect(m.defines.SURFACE_DETAIL).toBe("");
    expect(m.version).toBeGreaterThan(v0); // needsUpdate -> version bumped

    const v1 = m.version;
    m.surfaceDetail = false;
    expect(m.defines.SURFACE_DETAIL).toBeUndefined();
    expect(m.version).toBeGreaterThan(v1);
  });

  it("detail albedo mottle multiplies the LINEAR base before the wetness term", () => {
    const m = makeCel({
      vertexColors: true,
      heightMap: hmOpts(),
      surfaceDetail: true,
      wetness: true,
    });
    const fs = m.fragmentShader;
    // Locate the actual multiplies (not the uniform declarations): the detail
    // albedo tap and the wetness darkening. Detail must come first so it folds
    // into the linear base, not the post-tonemap result.
    const detailMul = fs.indexOf("uDetailStrength * (fbm");
    const wetMul = fs.indexOf("1.0 - 0.25 * uWetness");
    expect(detailMul).toBeGreaterThan(-1);
    expect(wetMul).toBeGreaterThan(-1);
    expect(detailMul).toBeLessThan(wetMul);
  });
});

describe("snowCover", () => {
  it("default material has NO snow path (byte-identical, no snow uniforms)", () => {
    const m = makeCel({});
    expect(m.defines.SNOW_COVER).toBeUndefined();
    expect(m.defines.SNOW_SPARKLE).toBeUndefined();
    expect(m.uniforms.uSnowCover).toBeUndefined();
    // Fragment snow header/apply are "" when off (no snow text splices in). The
    // vertex #ifdef SNOW_COVER guards stay in source but compile out (define off).
    expect(m.fragmentShader).not.toContain("uSnowCover");
    expect(m.fragmentShader).not.toContain("snowAlbedo");
  });

  it("snowCover:true adds the define, snow uniforms, and shader plumbing", () => {
    const m = makeCel({ snowCover: true });
    expect(m.defines.SNOW_COVER).toBe("");
    // Cover level + wind dir are the shared channel; the rest are tuning.
    expect(m.uniforms.uSnowCover).toBeDefined();
    expect(m.uniforms.uSnowWindDir).toBeDefined();
    expect(m.uniforms.uSnowColor).toBeDefined();
    expect(m.uniforms.uSnowShadowColor).toBeDefined();
    // Fragment carries the accumulation + realism terms.
    expect(m.fragmentShader).toContain("#ifdef SNOW_COVER");
    expect(m.fragmentShader).toContain("if (uSnowCover > 0.0)");
    expect(m.fragmentShader).toContain("uSnowWindBias * windward"); // wind drift
    expect(m.fragmentShader).toContain("uSnowShadowColor"); // blue shadows
    expect(m.fragmentShader).toContain("float fbm("); // patch noise shared
    // Vertex exports the world normal for the up-facing + windward terms.
    expect(m.vertexShader).toContain("varying vec3 vWorldNormal;");
    expect(m.vertexShader).toContain("vWorldNormal = mat3(modelMatrix)");
  });

  it("binds the SHARED snowUniform.uSnowCover + uSnowWindDir references", () => {
    const m1 = makeCel({ snowCover: true });
    const m2 = makeCel({ snowCover: true });
    expect(m1.uniforms.uSnowCover).toBe(snowUniform.uSnowCover);
    expect(m1.uniforms.uSnowCover).toBe(m2.uniforms.uSnowCover);
    expect(m1.uniforms.uSnowWindDir).toBe(snowUniform.uSnowWindDir);
    snowUniform.uSnowCover.value = 0.5;
    expect((m2.uniforms.uSnowCover as { value: number }).value).toBe(0.5);
    snowUniform.uSnowCover.value = 0; // reset shared ref for other tests
  });

  it("sparkle defaults on but compiles out when snowSparkle:false", () => {
    const on = makeCel({ snowCover: true });
    expect(on.defines.SNOW_SPARKLE).toBe("");
    expect(on.uniforms.uSnowSparkle).toBeDefined();
    expect(on.fragmentShader).toContain("uSnowSparkle");

    const off = makeCel({ snowCover: true, snowSparkle: false });
    // Define off + uniform unbound => the #ifdef SNOW_SPARKLE glint compiles
    // out (the guarded source text stays, gated by the missing define).
    expect(off.defines.SNOW_SPARKLE).toBeUndefined();
    expect(off.uniforms.uSnowSparkle).toBeUndefined();
    // Base snow path still present without sparkle.
    expect(off.defines.SNOW_COVER).toBe("");
  });

  it("snow whitening folds in after the wetness darkening (LINEAR base order)", () => {
    const fs = makeCel({ snowCover: true, wetness: true }).fragmentShader;
    const wet = fs.indexOf("1.0 - 0.25 * uWetness");
    const snow = fs.indexOf("base = mix(base, snowAlbedo");
    expect(wet).toBeGreaterThan(0);
    expect(snow).toBeGreaterThan(wet);
  });
});

describe("geomorph (LOD vertex morph)", () => {
  it("geomorph:true adds GEOMORPH define, uMorph uniform (default 0), + morph term", () => {
    const m = makeCel({ geomorph: true });
    expect(m.defines.GEOMORPH).toBe("");
    expect(m.uniforms.uMorph.value).toBe(0);
    // Vertex shader declares the attribute + uniform and lerps the vertex HEIGHT
    // only (position.y) toward aMorphTarget by uMorph; XZ + normal untouched.
    expect(m.vertexShader).toContain("attribute float aMorphTarget;");
    expect(m.vertexShader).toContain("uniform float uMorph;");
    expect(m.vertexShader).toContain("transformed.y = mix(position.y, aMorphTarget, uMorph);");
  });

  it("uMorph is per-material so old + new cross-fade meshes morph independently", () => {
    const a = makeCel({ geomorph: true });
    const b = makeCel({ geomorph: true });
    expect(a.uniforms.uMorph).not.toBe(b.uniforms.uMorph);
  });

  it("geomorph off (default) has no define/uniform; morph term compiles out", () => {
    const m = new CelMaterial();
    expect(m.defines.GEOMORPH).toBeUndefined();
    expect(m.uniforms.uMorph).toBeUndefined();
    // The guarded vertex block is present in source (like HEIGHT_MAP) but the
    // preprocessor strips it without the define; the morph never runs.
    expect(m.vertexShader).toContain("#ifdef GEOMORPH");
  });

  it("geomorph pairs with fadeInvert without disturbing the fade uniform", () => {
    const m = makeCel({ fadeInvert: true, geomorph: true });
    expect(m.uniforms.uFade.value).toBe(1);
    expect(m.uniforms.uMorph.value).toBe(0);
    expect(m.defines.GEOMORPH).toBe("");
  });
});

describe("celGradient", () => {
  it("produces N nearest-sampled steps matching the shader's floor(NdL*bands)/bands math", () => {
    const tex = celGradient(3);
    const data = tex.image.data as Uint8Array;
    // step i = round((i+1)/bands * 255) -> [85, 170, 255] for bands=3
    expect(Array.from(data)).toEqual([85, 170, 255]);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
  });
});
