/**
 * Pure, WebGL-free silhouette-mask + difference math for the garage compare mode
 * (src/dev/garageCompare.ts). Turns raw RGBA pixel buffers into 1-bit masks — a
 * luminance threshold for the flat white-on-black model render, a background-key
 * for the reference photo — then classifies model-vs-reference overlap so a
 * vision agent sees where the in-game contour diverges. No DOM, no THREE, no
 * canvas; every function takes plain typed arrays, so it is unit-tested under
 * jsdom while the canvas glue stays in Garage.
 */

/** A 1-byte-per-pixel binary mask (0 background, 1 foreground), row-major. */
export interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Tight foreground bounding box in pixels; `empty` when the mask has no pixels. */
export interface MaskBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  empty: boolean;
}

/** An 8-bit RGB color, e.g. an estimated background or a diff-overlay tint. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const EMPTY_BOUNDS: MaskBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };

/** Rec.601 luminance of an 8-bit RGB triple (0..255). */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Foreground = luminance at or above `threshold` (default 24 on 0..255). Built
 * for the model silhouette render (unlit white kart on a black clear color), so
 * even dark chassis parts read as foreground while the background stays out.
 */
export function luminanceMask(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  opts: { threshold?: number } = {},
): Mask {
  const threshold = opts.threshold ?? 24;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[i] = luma(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!) >= threshold ? 1 : 0;
  }
  return { data, w, h };
}

/** Median of four numbers (mean of the two middle values). */
function median4(a: number, b: number, c: number, d: number): number {
  const s = [a, b, c, d].sort((x, y) => x - y);
  return (s[1]! + s[2]!) / 2;
}

/**
 * Estimate the flat background color by taking the per-channel median of the
 * four corner pixels. Robust to a single off-color corner and to reference
 * photos whose background is off-white rather than pure #ffffff.
 */
export function estimateBackground(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): Rgb {
  const corner = (x: number, y: number): number => (y * w + x) * 4;
  const tl = corner(0, 0);
  const tr = corner(w - 1, 0);
  const bl = corner(0, h - 1);
  const br = corner(w - 1, h - 1);
  return {
    r: median4(rgba[tl]!, rgba[tr]!, rgba[bl]!, rgba[br]!),
    g: median4(rgba[tl + 1]!, rgba[tr + 1]!, rgba[bl + 1]!, rgba[br + 1]!),
    b: median4(rgba[tl + 2]!, rgba[tr + 2]!, rgba[bl + 2]!, rgba[br + 2]!),
  };
}

/**
 * Foreground = pixels far enough from the background color, using summed
 * per-channel absolute distance vs `tolerance` (default 40) so anti-aliased
 * edges and slightly off-white backgrounds still key out cleanly. A pixel with
 * alpha below 128 (transparent PNG) is always background.
 */
export function backgroundMask(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  bg: Rgb,
  opts: { tolerance?: number } = {},
): Mask {
  const tolerance = opts.tolerance ?? 40;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3]! < 128) continue;
    const dist =
      Math.abs(rgba[o]! - bg.r) + Math.abs(rgba[o + 1]! - bg.g) + Math.abs(rgba[o + 2]! - bg.b);
    data[i] = dist > tolerance ? 1 : 0;
  }
  return { data, w, h };
}

/** Tight foreground bounding box (inclusive), or an empty box when blank. */
export function maskBounds(m: Mask): MaskBounds {
  let minX = m.w;
  let minY = m.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.data[y * m.w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { ...EMPTY_BOUNDS };
  return { minX, minY, maxX, maxY, empty: false };
}

/** Per-pixel diff class: 0 none, 1 overlap, 2 model-only, 3 reference-only. */
export type DiffClass = 0 | 1 | 2 | 3;

/** Classified diff grid plus the raw pixel counts feeding the summary stats. */
export interface DiffResult {
  classes: Uint8Array;
  w: number;
  h: number;
  modelOnly: number;
  refOnly: number;
  overlap: number;
  modelTotal: number;
  refTotal: number;
}

/**
 * Classify two aligned masks pixelwise into overlap / model-only / ref-only.
 * Both masks must share dimensions (they do by construction: the reference is
 * resampled into the model's pixel grid before this call).
 */
export function classifyDiff(model: Mask, ref: Mask): DiffResult {
  if (model.w !== ref.w || model.h !== ref.h) {
    throw new Error(`classifyDiff size mismatch: ${model.w}x${model.h} vs ${ref.w}x${ref.h}`);
  }
  const n = model.w * model.h;
  const classes = new Uint8Array(n);
  let modelOnly = 0;
  let refOnly = 0;
  let overlap = 0;
  for (let i = 0; i < n; i++) {
    const m = model.data[i];
    const r = ref.data[i];
    if (m && r) {
      classes[i] = 1;
      overlap++;
    } else if (m) {
      classes[i] = 2;
      modelOnly++;
    } else if (r) {
      classes[i] = 3;
      refOnly++;
    }
  }
  return {
    classes,
    w: model.w,
    h: model.h,
    modelOnly,
    refOnly,
    overlap,
    modelTotal: overlap + modelOnly,
    refTotal: overlap + refOnly,
  };
}

/** Compact mismatch summary the harness writes to JSON and the agent minimizes. */
export interface DiffStats {
  /** Model-only pixels as a percent of the union (0..100). */
  modelOnlyPct: number;
  /** Reference-only pixels as a percent of the union (0..100). */
  refOnlyPct: number;
  /** Intersection-over-union of the two silhouettes (0..1; 1 = identical). */
  iou: number;
  /** Union area as a fraction of the whole panel (0..1). */
  coverage: number;
}

/** Round to `dp` decimals (keeps JSON stable + readable). */
function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** Derive percent-of-union mismatch + IoU + panel coverage from a DiffResult. */
export function diffStats(d: DiffResult): DiffStats {
  const union = d.overlap + d.modelOnly + d.refOnly;
  if (union === 0) return { modelOnlyPct: 0, refOnlyPct: 0, iou: 0, coverage: 0 };
  return {
    modelOnlyPct: round((d.modelOnly / union) * 100, 2),
    refOnlyPct: round((d.refOnly / union) * 100, 2),
    iou: round(d.overlap / union, 4),
    coverage: round(union / (d.w * d.h), 4),
  };
}

/** Tints for the three diff classes; `none` pixels stay transparent. */
export interface DiffPalette {
  modelOnly: Rgb;
  refOnly: Rgb;
  overlap: Rgb;
}

/** Cyan = model past reference, magenta = reference past model, gray = agree. */
export const DEFAULT_DIFF_PALETTE: DiffPalette = {
  modelOnly: { r: 0, g: 220, b: 220 },
  refOnly: { r: 230, g: 0, b: 200 },
  overlap: { r: 120, g: 120, b: 128 },
};

/**
 * Paint a classified diff into an RGBA overlay: each class gets its palette tint
 * at `alpha` (0..1, default 0.6); `none` pixels are fully transparent so the
 * shaded model render shows through underneath.
 */
export function paintDiff(
  d: DiffResult,
  palette: DiffPalette = DEFAULT_DIFF_PALETTE,
  alpha = 0.6,
): Uint8ClampedArray {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  const out = new Uint8ClampedArray(d.w * d.h * 4);
  for (let i = 0; i < d.classes.length; i++) {
    const cls = d.classes[i];
    if (!cls) continue;
    const tint = cls === 1 ? palette.overlap : cls === 2 ? palette.modelOnly : palette.refOnly;
    const o = i * 4;
    out[o] = tint.r;
    out[o + 1] = tint.g;
    out[o + 2] = tint.b;
    out[o + 3] = a;
  }
  return out;
}
