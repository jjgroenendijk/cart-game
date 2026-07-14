"""End-to-end CLI: car image -> decimated ASCII OBJ.

    uv run hy3d-kart run --image car.png --out car.obj

Chains bg_remove -> generate (Q4 MLX shape gen) -> decimate. Intermediate
RGBA cutout and GLB are written next to `--out` and left on disk for
inspection; neither is committed (see .gitignore in this directory).
"""

from __future__ import annotations

import argparse
import os

from .bg_remove import remove_background
from .decimate import decimate_to_obj
from .generate import DEFAULT_WEIGHTS, generate_shape


def run(
    image: str,
    out: str,
    weights: str = DEFAULT_WEIGHTS,
    quantize: int | None = 4,
    faces: int = 6000,
    steps: int = 30,
    guidance: float = 5.0,
    octree: int = 256,
) -> None:
    stem = os.path.splitext(out)[0]
    rgba_path = f"{stem}_rgba.png"
    glb_path = f"{stem}.glb"

    frac = remove_background(image, rgba_path)
    print(f"[run] background removed, foreground {frac * 100:.1f}% of frame")

    generate_shape(
        rgba_path,
        glb_path,
        weights=weights,
        quantize=quantize,
        steps=steps,
        guidance=guidance,
        octree=octree,
    )
    decimate_to_obj(glb_path, out, faces)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="bg-remove + generate + decimate in one shot")
    p_run.add_argument("--image", required=True)
    p_run.add_argument("--out", required=True, help="final .obj path")
    p_run.add_argument("--weights", default=DEFAULT_WEIGHTS)
    p_run.add_argument("--quantize", type=int, default=4, choices=[0, 4, 8])
    p_run.add_argument("--faces", type=int, default=6000)
    p_run.add_argument("--steps", type=int, default=30)
    p_run.add_argument("--guidance", type=float, default=5.0)
    p_run.add_argument("--octree", type=int, default=256)

    args = ap.parse_args()
    if args.command == "run":
        run(
            args.image,
            args.out,
            weights=args.weights,
            quantize=args.quantize or None,
            faces=args.faces,
            steps=args.steps,
            guidance=args.guidance,
            octree=args.octree,
        )


if __name__ == "__main__":
    main()
