"""Remove a clean/near-white studio background -> RGBA cutout with alpha mask.

Border-connected flood fill: pixels that are bright + near-neutral (white bg and
soft grey shadow) AND connected to an image border become transparent. Bright
neutral regions NOT touching a border (e.g. silver wheels) are kept, and holes
inside the foreground are filled. Good enough for the clean ChatGPT-style render;
no rembg/numba needed.
"""

import argparse

import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes, label


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bright", type=int, default=200)  # min max-channel for "light"
    ap.add_argument("--sat", type=int, default=28)  # max (max-min) for "neutral"
    args = ap.parse_args()

    img = np.array(Image.open(args.image).convert("RGB")).astype(np.int16)
    mx = img.max(-1)
    sat = mx - img.min(-1)
    light = (mx > args.bright) & (sat < args.sat)

    lbl, _ = label(light)
    border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border.discard(0)
    bg = np.isin(lbl, list(border))

    fg = binary_fill_holes(~bg)
    alpha = np.where(fg, 255, 0).astype(np.uint8)

    out = np.dstack([img.astype(np.uint8), alpha])
    Image.fromarray(out, "RGBA").save(args.out)

    frac = fg.mean() * 100
    print(f"[bg] {args.image} -> {args.out} | foreground {frac:.1f}% of frame")


if __name__ == "__main__":
    main()
