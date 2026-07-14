"""Remove a clean/near-white studio background -> RGBA cutout with alpha mask.

Border-connected flood fill: pixels that are bright + near-neutral (white bg and
soft grey shadow) AND connected to an image border become transparent. Bright
neutral regions NOT touching a border (e.g. silver wheels) are kept, and holes
inside the foreground are filled. Good enough for a clean studio-style render;
no rembg (its numba pin conflicts with modern numpy).
"""

from __future__ import annotations

import argparse

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.ndimage import binary_fill_holes, label


def remove_background(image_path: str, out_path: str, bright: int = 200, sat: int = 28) -> float:
    """Cut `image_path` to an RGBA foreground mask at `out_path`.

    Returns the foreground fraction of the frame (0-1), useful as a sanity
    check that the subject wasn't over/under-masked.
    """
    img: NDArray[np.int16] = np.array(Image.open(image_path).convert("RGB")).astype(np.int16)
    mx = img.max(-1)
    channel_spread = mx - img.min(-1)
    light = (mx > bright) & (channel_spread < sat)

    labelled, _ = label(light)
    border_labels = set(labelled[0, :]) | set(labelled[-1, :])
    border_labels |= set(labelled[:, 0]) | set(labelled[:, -1])
    border_labels.discard(0)
    background = np.isin(labelled, list(border_labels))

    foreground = binary_fill_holes(~background)
    alpha = np.where(foreground, 255, 0).astype(np.uint8)

    out = np.dstack([img.astype(np.uint8), alpha])
    Image.fromarray(out, "RGBA").save(out_path)
    return float(foreground.mean())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bright", type=int, default=200, help="min max-channel for 'light'")
    ap.add_argument("--sat", type=int, default=28, help="max (max-min) channel spread for 'neutral'")
    args = ap.parse_args()

    frac = remove_background(args.image, args.out, args.bright, args.sat)
    print(f"[bg] {args.image} -> {args.out} | foreground {frac * 100:.1f}% of frame")


if __name__ == "__main__":
    main()
