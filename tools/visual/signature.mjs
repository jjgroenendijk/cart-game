/**
 * Pure visual-signature module.
 *
 * Downsamples an RGBA framebuffer into a fixed GRID_W x GRID_H grid of mean
 * RGB cells, then packs the cells into short text rows so the canonical text
 * form (JSON.stringify(sig, null, 2)) keeps every line within the repo's
 * 100-char cap. No browser, no fs, no Three: importable by the Playwright
 * runner and by vitest unit tests alike.
 *
 * Encoding:
 *   - A Signature = { width, height, rows[] }.
 *   - width = GRID_W (32), height = GRID_H (18); rows hold GRID_W*GRID_H cells
 *     in row-major order (cell y=0,x=0..W-1, then y=1, ...).
 *   - Each cell is 6 hex chars (rrggbb). Cells are concatenated with NO
 *     separator into packed runs of CELLS_PER_RUN cells.
 *
 * Line-length budget for stringifySignature output:
 *   A row element sits two indent levels deep inside `rows` (the object key
 *   is level 1, the array element is level 2), so it is prefixed by 4 spaces.
 *   Its rendered line is: 4 (indent) + 2 (quotes) + 6*N (cells) + 1 (comma)
 *   = 6N + 7. For the 100-char cap: 6N + 7 <= 100 -> N <= 15.5 -> N = 15
 *   (line = 97). N = 16 would be 103 > 100, so CELLS_PER_RUN = 15.
 */
export const GRID_W = 32;
export const GRID_H = 18;
export const CELLS_PER_RUN = 15;

/** Per-cell RGB distance threshold below which a cell counts as matching. */
export const DEFAULT_TOLERANCE = 30;
/** Max cells allowed over tolerance before a comparison fails (0 = strict). */
export const DEFAULT_MAX_CELLS_OVER_TOL = 0;

/**
 * @typedef {Object} Signature
 * @property {number} width  Cell columns (GRID_W).
 * @property {number} height Cell rows (GRID_H).
 * @property {string[]} rows Packed hex runs of CELLS_PER_RUN cells each.
 */

/**
 * @typedef {Object} CompareResult
 * @property {number} maxCellDelta  Largest per-cell distance.
 * @property {number} cellsOverTol  Count of cells exceeding tolerance.
 * @property {number} meanCellDelta Mean per-cell distance.
 * @property {boolean} pass         True when cellsOverTol <= maxCellsOverTol.
 */

const HEX = "0123456789abcdef";

function byteHex(v) {
  return HEX[(v >> 4) & 15] + HEX[v & 15];
}

function cellHex(cells, o) {
  return byteHex(cells[o]) + byteHex(cells[o + 1]) + byteHex(cells[o + 2]);
}

function cellsToSignature(cells) {
  const rows = [];
  const total = GRID_W * GRID_H;
  for (let i = 0; i < total; i += CELLS_PER_RUN) {
    let run = "";
    for (let j = 0; j < CELLS_PER_RUN && i + j < total; j += 1) {
      run += cellHex(cells, (i + j) * 3);
    }
    rows.push(run);
  }
  return { width: GRID_W, height: GRID_H, rows };
}

/**
 * Build a Signature from a flat RGBA byte buffer.
 *
 * Each grid cell maps to the source rectangle covering that cell's share of
 * the image (floor-partition of [0,width) x [0,height), so every source pixel
 * contributes to exactly one cell). The cell value is the rounded mean RGB of
 * the pixels that fall in its rectangle; empty rectangles (cannot happen for a
 * non-empty image) default to 0,0,0. Dimension-independent: only the source
 * cell rectangles matter, so the runner's viewport need only be constant
 * run-to-run rather than a magic size.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba Length width*height*4.
 * @param {number} width  Source framebuffer width in pixels.
 * @param {number} height Source framebuffer height in pixels.
 * @returns {Signature}
 */
export function signatureFromRgba(rgba, width, height) {
  const cells = new Array(GRID_W * GRID_H * 3);
  for (let cy = 0; cy < GRID_H; cy += 1) {
    const y0 = Math.floor((cy * height) / GRID_H);
    const y1 = Math.floor(((cy + 1) * height) / GRID_H);
    for (let cx = 0; cx < GRID_W; cx += 1) {
      const x0 = Math.floor((cx * width) / GRID_W);
      const x1 = Math.floor(((cx + 1) * width) / GRID_W);
      const o = (cy * GRID_W + cx) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = (y * width + x) * 4;
          r += rgba[p];
          g += rgba[p + 1];
          b += rgba[p + 2];
          count += 1;
        }
      }
      if (count > 0) {
        cells[o] = Math.round(r / count);
        cells[o + 1] = Math.round(g / count);
        cells[o + 2] = Math.round(b / count);
      } else {
        cells[o] = 0;
        cells[o + 1] = 0;
        cells[o + 2] = 0;
      }
    }
  }
  return cellsToSignature(cells);
}

/**
 * Canonical, line-safe text form of a signature (what baseline files store).
 * @param {Signature} sig
 * @returns {string}
 */
export function stringifySignature(sig) {
  return JSON.stringify(sig, null, 2);
}

/**
 * Parse a baseline text blob back into a Signature. Light validation: requires
 * numeric width/height and a rows[] array. Never throws on well-formed output
 * of stringifySignature.
 * @param {string} text
 * @returns {Signature}
 */
export function parseSignature(text) {
  const sig = JSON.parse(text);
  if (typeof sig.width !== "number" || typeof sig.height !== "number") {
    throw new Error("signature missing numeric width/height");
  }
  if (!Array.isArray(sig.rows)) {
    throw new Error("signature missing rows[] array");
  }
  return { width: sig.width, height: sig.height, rows: sig.rows };
}

function signatureCells(sig) {
  const cells = new Array(sig.width * sig.height * 3);
  let i = 0;
  for (const run of sig.rows) {
    for (let j = 0; j + 6 <= run.length; j += 6) {
      cells[i] = parseInt(run.slice(j, j + 2), 16);
      cells[i + 1] = parseInt(run.slice(j + 2, j + 4), 16);
      cells[i + 2] = parseInt(run.slice(j + 4, j + 6), 16);
      i += 3;
    }
  }
  return cells;
}

/**
 * Compare two signatures cell-by-cell.
 *
 * Metric: per-cell Euclidean RGB distance sqrt(dr^2 + dg^2 + db^2). A cell is
 * "over tolerance" when its distance exceeds opts.tolerance. The comparison
 * passes when the count of over-tolerance cells is <= opts.maxCellsOverTol.
 * Mismatched grid dimensions are an automatic failure with infinite delta.
 *
 * @param {Signature} a
 * @param {Signature} b
 * @param {{tolerance?: number, maxCellsOverTol?: number}} [opts]
 * @returns {CompareResult}
 */
export function compareSignatures(a, b, opts = {}) {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const maxCellsOverTol = opts.maxCellsOverTol ?? DEFAULT_MAX_CELLS_OVER_TOL;
  if (a.width !== b.width || a.height !== b.height) {
    return {
      maxCellDelta: Infinity,
      cellsOverTol: Infinity,
      meanCellDelta: Infinity,
      pass: false,
    };
  }
  const ca = signatureCells(a);
  const cb = signatureCells(b);
  const n = ca.length / 3;
  let maxDelta = 0;
  let over = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * 3;
    const dr = ca[o] - cb[o];
    const dg = ca[o + 1] - cb[o + 1];
    const db = ca[o + 2] - cb[o + 2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist > maxDelta) maxDelta = dist;
    if (dist > tolerance) over += 1;
    sum += dist;
  }
  const meanCellDelta = n > 0 ? sum / n : 0;
  return {
    maxCellDelta: maxDelta,
    cellsOverTol: over,
    meanCellDelta,
    pass: over <= maxCellsOverTol,
  };
}
