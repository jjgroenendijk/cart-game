/**
 * Seeded 2D simplex noise (Gustavson). Pure, deterministic, WebGL-free -> runs
 * under jsdom. A mulberry32 PRNG seeds a Fisher-Yates shuffle of the 256-entry
 * permutation table; the same seed always reproduces the same field (003
 * determinism requirement). Output range is approximately [-1, 1].
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 gradient directions (z unused for 2D eval).
const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

/** Minimal deterministic PRNG (mulberry32) used to seed the permutation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimplexNoise2D {
  private readonly perm: Uint8Array;
  private readonly permMod12: Uint8Array;

  constructor(seed = 1337) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rng = mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Single-octave noise at (x, y). Range ~[-1, 1]. */
  noise(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod12[ii + this.perm[jj]];
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt >= 0) {
      tt *= tt;
      n0 = tt * tt * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt >= 0) {
      tt *= tt;
      n1 = tt * tt * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt >= 0) {
      tt *= tt;
      n2 = tt * tt * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }
}
