# Hunyuan3D kart-mesh pipeline

A small `uv` project: turn one car image into a decimated, git-parseable
kart mesh (ASCII OBJ) using [Hunyuan3D-2mini](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
shape generation, ported to MLX by
[ZimengXiong/Hunyuan3D-Swift](https://github.com/ZimengXiong/Hunyuan3D-Swift).
Runs entirely on Apple Silicon (no PyTorch/CUDA in the path).

Status: working pipeline, not a production asset importer — see
`docs/knowledge/kart/imported-mesh-pipeline.md` for the full writeup
(source-image prompt, wiring pattern, caveats). The generated meshes are
shape-only (no texture, no watertight guarantee); a single flat color is
meant to be applied by the game's cel material.

## Setup

```sh
cd experiments/hunyuan3d-kart
uv sync

# Hunyuan3D-2mini weights, bundled DINO+DiT+VAE in one safetensors (~3.8 GB):
uv run hf download zimengxiong/hunyuan3d-mlx-shape-small --local-dir weights/shape-small
```

If Hugging Face is unreachable, use the upstream ModelScope mirror script
instead (`python/shape/scripts/dl_modelscope.py` in Hunyuan3D-Swift), which
fetches the same weights split into DiT/VAE files under a different layout —
point `--weights` at the resulting `hunyuan3d-dit-v2-mini` folder instead.

## Run

```sh
uv run hy3d-kart run --image car.png --out ../../src/kart/models/mycar.obj
```

This chains three stages (each also runnable standalone via
`uv run python -m hy3dpipeline.<stage>`):

1. `bg_remove.py` — border-connected flood fill to an RGBA cutout (no
   `rembg`; its numba pin conflicts with modern numpy). Works for a clean
   white/studio-background source image.
2. `generate.py` — Hunyuan3D-2mini shape generation via the MLX pipeline,
   **4-bit quantized** (`--quantize 4`, the smallest-RAM config: ~2.7 GB,
   fits a 16 GB M-series machine alongside a normal dev environment) with
   FlashVDM octree decode.
3. `decimate.py` — quadric edge-collapse to a ~6k-face mesh, exported as
   ASCII OBJ (text, diffable, not on the repo's binary-asset blocklist —
   unlike the GLB the shape stage emits).

Intermediate `*_rgba.png` and `*.glb` files are gitignored; only the final
`.obj` is meant to be committed.

## Source image

Front three-quarter, whole car in frame, plain white background, low-poly
flat-shaded look. See the full prompt and rationale in
`docs/knowledge/kart/imported-mesh-pipeline.md`.

## Wiring a generated mesh into the game

See "Wiring an imported mesh into the kart system" in
`docs/knowledge/kart/imported-mesh-pipeline.md` — register it like any
`src/kart/models/` entry, with `ownWheels: true` since the generated mesh
includes its own wheels.
