// 235 GTAO ambient occlusion shaders. Standard full-screen quad (mirrors
// groundMist MIST_VERT) + a GLSL1-portable GTAO fragment that reads shared
// depth + shared view-space normals and darkens toward an ambient floor.

export const AO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 235 GTAO fragment. Constant loop bounds (GLSL ES1 needs them); the uniform
// slice count early-breaks. Composites toward uAoFloor (skylight base), never
// to black, and is byte-identical at uAoStrength = 0.
export const AO_FRAG = /* glsl */ `
  #define GTAO_MAX_SLICES 6
  #define GTAO_MAX_STEPS 4

  // 235: LINEAR pre-tonemap color from the composer readBuffer (before
  // OutputPass). AO multiplies here so the falloff is physically motivated.
  uniform sampler2D tColor;
  // 235: shared layers-0+1 depth (DepthCapturePass). Sky clears to 1.0.
  // DepthFormat/UnsignedIntType window depth: THREE NDC z in [0,1].
  uniform sampler2D tDepth;
  // 235: shared view-space normals (NormalCapturePass), packed N*0.5+0.5 RGB.
  uniform sampler2D tViewNormal;
  uniform mat4 uProjection;      // camera.projectionMatrix
  uniform mat4 uInvProjection;   // camera.projectionMatrixInverse
  uniform vec2 uResolution;      // depth/normal tex size in pixels
  // 235: master gain 0..1 (tier strength x user enable). DEFAULT 0 ->
  // byte-identical identity: color sampled then returned unchanged before
  // any per-pixel work (see identity early-out in main).
  uniform float uAoStrength;
  uniform int uSlices;           // slice directions 3..6
  uniform float uRadius;         // view-space sample radius (world units)
  // 235: ambient/skylight floor. Darkest a pixel gets is uAoFloor*color;
  // never crushes to flat black so lit surfaces keep a skylight base.
  uniform float uAoFloor;
  uniform float uDepthEps;       // depth == 1.0 tolerance (matches other passes)
  uniform float uFrameIndex;     // per-frame rotating dither on slice dirs

  varying vec2 vUv;

  const float PI = 3.14159265359;

  // 235: unproject a depth sample to view space. THREE NDC z in [0,1], so
  // the z term is depth*2.0 - 1.0. Shared by P and each sample reconstruction.
  vec3 viewPosFromDepth(vec2 uv, float d) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = uInvProjection * ndc;
    return v.xyz / v.w;
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float depth = texture2D(tDepth, vUv).r;

    // 235: identity early-out. uAoStrength <= 0 (low tier / user off) ->
    // exact pre-235 frame, no per-pixel work past the two texture fetches.
    if (uAoStrength <= 0.0) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    // 235: sky skip. Shared depth clears sky to 1.0; AO never darkens the
    // sky. Matches SkyPosterize / GroundMist sky-mask tolerance.
    if (depth >= 1.0 - uDepthEps) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    // 235: surface view position + unpacked view normal (N*0.5+0.5 -> N).
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uInvProjection * ndc;
    view.xyz /= view.w;
    vec3 P = view.xyz;
    vec3 N = normalize(texture2D(tViewNormal, vUv).rgb * 2.0 - 1.0);

    // 235: project the view radius into screen space (perspective-correct).
    // NDC = proj_diag * xv / |z|; uv = ndc*0.5. vec2 keeps aspect honest.
    float invZ = 1.0 / max(abs(P.z), 1e-4);
    vec2 radiusUV = 0.5 * vec2(uProjection[0][0], uProjection[1][1]) * uRadius * invZ;

    // 235: per-frame slice rotation dither (cheap quality boost, no TAA).
    float dither = mod(uFrameIndex, 4.0) * (PI / 8.0);

    // 235: GTAO accumulation. ao in [0,1], 1 = fully occluded. Constant loop
    // bounds (GLSL ES1 needs them); break early at the uniform slice count.
    float ao = 0.0;
    for (int s = 0; s < GTAO_MAX_SLICES; s++) {
      if (s >= uSlices) break;

      float sliceAngle = (float(s) + 0.5) * (PI / float(uSlices)) + dither;
      vec2 sdir = vec2(cos(sliceAngle), sin(sliceAngle));
      vec2 stepUV = vec2(sdir.x * radiusUV.x, sdir.y * radiusUV.y);

      // 235: track max elevation (tan) on each side of the slice.
      float horizonP = -1.0;
      float horizonN = -1.0;
      for (int t = 0; t < GTAO_MAX_STEPS; t++) {
        float frac = (float(t) + 1.0) / float(GTAO_MAX_STEPS);
        vec2 off = stepUV * frac;

        float dp = texture2D(tDepth, vUv + off).r;
        if (dp < 1.0 - uDepthEps) {
          vec3 Sp = viewPosFromDepth(vUv + off, dp);
          vec3 Vp = Sp - P;
          float fall = clamp(1.0 - length(Vp) / uRadius, 0.0, 1.0);
          horizonP = max(horizonP, (Vp.z / max(length(Vp.xy), 1e-6)) * fall);
        }

        float dn = texture2D(tDepth, vUv - off).r;
        if (dn < 1.0 - uDepthEps) {
          vec3 Sn = viewPosFromDepth(vUv - off, dn);
          vec3 Vn = Sn - P;
          float fall = clamp(1.0 - length(Vn) / uRadius, 0.0, 1.0);
          horizonN = max(horizonN, (Vn.z / max(length(Vn.xy), 1e-6)) * fall);
        }
      }

      // 235: elevation angles of the two horizons.
      float ha = atan(horizonP);
      float hb = atan(horizonN);

      // 235: surface-normal elevation projected into the slice plane.
      // Slice basis: e_horiz = screen tangent (view xy), e_vert = view +Z.
      float nAlong = dot(N, vec3(sdir.x, sdir.y, 0.0));
      float nElev = atan(N.z, nAlong);

      // 235: clamp the occluded arc [-hb, +ha] to the normal's hemisphere,
      // then integrate cos(theta - nElev) over it (closed-form GTAO).
      float h1 = max(-hb, nElev - 1.5707963);
      float h2 = min(ha, nElev + 1.5707963);
      if (h2 > h1) {
        ao += clamp((sin(h2 - nElev) - sin(h1 - nElev)) * 0.5, 0.0, 1.0);
      }
    }
    ao = clamp(ao / float(uSlices), 0.0, 1.0);

    // 235: composite toward the ambient floor (never to black). ao=1 ->
    // visibility = uAoFloor (skylight base); ao=0 -> 1.0 (unoccluded).
    // uAoStrength blends between identity and the full AO multiply.
    float visibility = mix(uAoFloor, 1.0, 1.0 - ao);
    color *= mix(1.0, visibility, uAoStrength);
    gl_FragColor = vec4(color, 1.0);
  }
`;
