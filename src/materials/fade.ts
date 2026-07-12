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
