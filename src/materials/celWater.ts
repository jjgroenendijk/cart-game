import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";

/**
 * Cel-shaded water ShaderMaterial for 004. Vertex displaces the plane by the
 * sum of two directional sines (low amplitude -> visual ripples, no collider).
 * Fragment snaps a facing-ratio term (N dot V) into N cel bands, tints from
 * deep (grazing) to shallow (looking down), adds a subtle sun lambert, the
 * shared ambient, and a fresnel rim. Consumes the module-level lightUniforms
 * (single per-frame write from the Renderer fans out to every cel material).
 *
 * Output is LINEAR; ACES + sRGB land in the composer's OutputPass. On layer 1
 * the water edges pick up 001's post Sobel outline. fog:true + the manual
 * USE_FOG mix fade distant water into the horizon haze (scene fog is fixed at
 * #b6ad9e 90..360). No backtick chars inside the GLSL (template literal).
 */

const CEL_WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  void main() {
    vec3 pos = position;
    float w = sin(pos.x * 0.6 + uTime * 1.1) + sin(pos.z * 0.5 + uTime * 0.9);
    pos.y += w * uAmp;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = mvPos.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CEL_WATER_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uBands;
  // fog:true defines USE_FOG but a raw ShaderMaterial gets no auto-injected fog
  // uniform declarations, so declare them here; the renderer pushes scene-fog
  // values into these locations each frame.
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec3 vViewPos;
  varying vec3 vViewNormal;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(-vViewPos);
    float facing = clamp(dot(N, V), 0.0, 1.0);

    vec3 base = mix(uDeep, uShallow, facing);
    float band = floor(facing * uBands) / uBands;
    band = clamp(band, 1.0 / uBands, 1.0);
    vec3 color = base * band;

    vec3 L = normalize(uSunDir);
    float NdL = clamp(dot(N, L), 0.0, 1.0);
    color += base * uSunColor * NdL * 0.25;
    color += base * uAmbient;

    float fres = pow(1.0 - facing, 3.0);
    color += vec3(1.0) * fres * 0.35;

    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    color = mix(color, fogColor, fogFactor);
    #endif

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface CelWaterOpts {
  /** sRGB hex for the shallow (looking-down) tint. */
  shallow?: number;
  /** sRGB hex for the deep (grazing) tint. */
  deep?: number;
  /** Cel band count on the facing ratio. */
  bands?: number;
  /** Wave amplitude (metres). */
  amp?: number;
}

export class CelWaterMaterial extends THREE.ShaderMaterial {
  constructor(opts: CelWaterOpts = {}) {
    super({
      uniforms: {
        ...lightUniforms,
        uTime: { value: 0 },
        uAmp: { value: opts.amp ?? 0.15 },
        uShallow: { value: new THREE.Color(opts.shallow ?? 0x2a6a8a) },
        uDeep: { value: new THREE.Color(opts.deep ?? 0x123a52) },
        uBands: { value: opts.bands ?? 2 },
        // fog:true makes three.js push scene-fog values here each frame; the
        // entries must exist so uniform upload can read .value.
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: CEL_WATER_VERT,
      fragmentShader: CEL_WATER_FRAG,
      fog: true,
    });
  }

  get uTime(): number {
    return this.uniforms.uTime.value as number;
  }

  set uTime(v: number) {
    this.uniforms.uTime.value = v;
  }
}
