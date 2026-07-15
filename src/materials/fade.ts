/**
 * Dither fade: screen-space ordered-dither discard that fades OPAQUE cel
 * geometry in/out without alpha blending. Fading via `transparent` would
 * break depth sorting and the inverted-hull outline pass; discarding a
 * Bayer-thresholded fragment subset keeps the material opaque (depth writes
 * intact) while the eye reads the dissolve as a soft fade — especially
 * inside the distance-fog band where streamed props appear/disappear.
 *
 * The 4x4 Bayer matrix is generated arithmetically (no GLSL array init):
 *   B2(x,y)  = 2x + 3y - 4xy            -> [[0,2],[3,1]]
 *   M4(x,y)  = 4*B2(x%2,y%2) + B2(x/2,y/2)
 * Thresholds are (M4 + 0.5)/16, i.e. (0,1) EXCLUSIVE at both ends, so
 * uFade=1 keeps every fragment and uFade=0 discards every fragment.
 *
 * `fadeThreshold` is the WebGL-free TS mirror of the GLSL fn so jsdom tests
 * can pin the matrix without a GL context (mirrors terrainDetail's pattern).
 */

/** GLSL uniform declaration consumers splice next to their other uniforms. */
export const FADE_UNIFORM_GLSL = `uniform float uFade;`;

/** GLSL helper fns; splice at file scope, before main(). */
export const FADE_GLSL = `
  float fadeBayer2(vec2 p) {
    return 2.0 * p.x + 3.0 * p.y - 4.0 * p.x * p.y;
  }
  float fadeThreshold(vec2 fragCoord) {
    vec2 p = floor(mod(fragCoord, 4.0));
    float fine = fadeBayer2(mod(p, 2.0));
    float coarse = fadeBayer2(floor(p * 0.5));
    return (4.0 * fine + coarse + 0.5) / 16.0;
  }
`;

/** GLSL discard statement; splice as the FIRST statement of main(). */
export const FADE_DISCARD_GLSL = `if (fadeThreshold(gl_FragCoord.xy) > uFade) discard;`;

/**
 * Complementary discard: keeps EXACTLY the fragments {@link FADE_DISCARD_GLSL}
 * drops at the same `uFade`. Splicing this on one mesh and the normal discard
 * on another, both driven by a shared `uFade=t`, partitions every pixel between
 * them (one keeps threshold<=t, the other threshold>t) — a gap-free, overlap-
 * free cross-dissolve with no depth fight. At t=0 the inverse keeps every
 * fragment (fully solid); at t=1 it discards every fragment (fully gone). Used
 * for the OUT (old-tier) half of a terrain LOD cross-fade.
 */
export const FADE_DISCARD_INV_GLSL = `if (fadeThreshold(gl_FragCoord.xy) <= uFade) discard;`;

/**
 * Haze-in reveal (NO discard): lerp the already-fogged colour UP from full
 * `fogColor` as `uFade` 0->1, so a streamed prop MATERIALISES OUT OF THE HAZE
 * instead of dither-stippling against the bright horizon sky. At `uFade=0` the
 * fragment is pure atmosphere colour (invisible against the fogged horizon); at
 * `uFade=1` it is the normal fogged colour. Splice INSIDE the `USE_FOG` block
 * AFTER the fog mix (it reuses `fogColor` + needs the fogged colour as the
 * target). Keeps the material opaque (depth writes intact) — unlike the dither
 * dissolve it never shows the bright background through holes, so a dark tree
 * silhouette no longer reads as a white sparkle while it fades in.
 */
export const FADE_HAZE_GLSL = `color = mix(fogColor, color, clamp(uFade, 0.0, 1.0));`;

function bayer2(x: number, y: number): number {
  return 2 * x + 3 * y - 4 * x * y;
}

/**
 * TS mirror of the GLSL `fadeThreshold`: ordered-dither threshold in (0,1)
 * for pixel (px,py). Pure; exact same arithmetic as the shader.
 */
export function fadeThreshold(px: number, py: number): number {
  const x = ((Math.floor(px) % 4) + 4) % 4;
  const y = ((Math.floor(py) % 4) + 4) % 4;
  const fine = bayer2(x % 2, y % 2);
  const coarse = bayer2(Math.floor(x / 2), Math.floor(y / 2));
  return (4 * fine + coarse + 0.5) / 16;
}
