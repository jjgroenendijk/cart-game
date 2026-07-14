"""Shape generation: RGBA cutout -> mesh, via the Hunyuan3D-2mini MLX pipeline.

Thin wrapper around `hy3dmlx.pipeline.Hunyuan3DShapePipeline` (see
`hunyuan3d-shape-mlx`, pulled in as a git dependency in pyproject.toml).
Defaults to 4-bit quantization: the smallest-RAM config (~2.7 GB) and the
only one that comfortably fits a 16 GB Apple Silicon machine alongside the
rest of a dev environment.
"""

from __future__ import annotations

import argparse

import mlx.core as mx
from hy3dmlx.pipeline import Hunyuan3DShapePipeline

DEFAULT_WEIGHTS = "weights/shape-small"


def generate_shape(
    rgba_path: str,
    out_glb: str,
    weights: str = DEFAULT_WEIGHTS,
    quantize: int | None = 4,
    steps: int = 30,
    guidance: float = 5.0,
    octree: int = 256,
    octree_decode: bool = True,
    seed: int = 0,
) -> None:
    pipe = Hunyuan3DShapePipeline.from_pretrained(weights, dtype=mx.float16, quantize=quantize)
    mesh = pipe.generate(
        rgba_path,
        num_inference_steps=steps,
        guidance_scale=guidance,
        octree_resolution=octree,
        octree_decode=octree_decode,
        seed=seed,
    )
    mesh.export(out_glb)
    print(f"[shape] {rgba_path} -> {out_glb} | {len(mesh.vertices)} verts / {len(mesh.faces)} faces")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image", required=True, help="RGBA cutout (see bg_remove.py)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--weights", default=DEFAULT_WEIGHTS)
    ap.add_argument("--quantize", type=int, default=4, choices=[0, 4, 8], help="0 = fp16, no quantization")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--guidance", type=float, default=5.0)
    ap.add_argument("--octree", type=int, default=256)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    generate_shape(
        args.image,
        args.out,
        weights=args.weights,
        quantize=args.quantize or None,
        steps=args.steps,
        guidance=args.guidance,
        octree=args.octree,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
