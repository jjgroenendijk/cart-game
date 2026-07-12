# Hunyuan3D kart-mesh experiment

Exploration: turn a single car image into a 3D kart mesh with
[Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) (mini, shape-only),
running entirely on Apple Silicon, and export a git-parseable mesh.

Status: throwaway spike, not for merge. It deliberately conflicts with the repo's
zero-asset / procedural / "Painted Wilds" identity — a generated realistic car
mesh is the opposite of the code-native karts in `src/kart/models/`. Kept on this
branch as a record of what the pipeline can do and how to reproduce it.

## Result

`lancia-delta.obj` — a low-poly Lancia Delta Integrale, reconstructed from one
front-3/4 render. Raw output was 203k verts / 407k faces; decimated to 6k faces
(2975 verts) and exported as ASCII OBJ so it is diffable and needs no binary
asset (the pre-commit asset guard rejects `.glb`, allows `.obj`). Text mesh, no
texture — colorization is meant to be done by hand.

Caveats: the mesh is not watertight; the cabin has messy internal geometry where
the model reconstructed the interior through the windows. Fine as a visual test,
not production-clean. A solid-roof pass or remesh would be needed to actually
drive it.

## What runs where

The one path that works on a 16GB M1 is the MLX port, not PyTorch:

- PyTorch + MPS (`gen_shape.py`) runs the official mini-turbo pipeline but the
  fp16/fp32 model (~3.6GB) plus the octree-256 marching-cubes grid exhausts RAM
  and swap-thrashes. Kept for reference; use a machine with more RAM or a lower
  `--octree`.
- MLX (`ZimengXiong/Hunyuan3D-Swift`, python port) runs the same mini weights on
  Metal in ~120s / ~3GB with `--quantize 8 --octree-decode`. This produced
  `lancia-delta.obj`. The native Swift target fails to build its Metal shader
  library from a CLI `swift build` ("Failed to load the default metallib"); the
  pip `mlx` backend in the python port ships a working metallib, so use that.

## Reproduce

```sh
# 0. car image: front three-quarter, whole car framed, plain background.
# 1. background removal -> RGBA cutout (clean white/studio bg only):
python bg_remove.py --image car.png --out car_rgba.png

# 2. shape gen via the MLX python port (clone Hunyuan3D-Swift, `uv sync` in
#    python/shape, download the mini weights), then:
uv run python -m hy3dmlx.pipeline car_rgba.png --out car.glb \
    --weights weights/shape-small \
    --steps 30 --guidance 5.0 --octree 256 --dtype float16 --quantize 8 --octree-decode

# 3. GLB -> decimated ASCII OBJ (git-parseable):
python glb_to_obj.py --glb car.glb --out car.obj --faces 6000

# 4. quick offline preview (contact sheet PNG):
python render_views.py --obj car.obj --out car_views.png
```

`bg_remove.py`, `glb_to_obj.py`, `render_views.py` need `numpy pillow scipy
trimesh pymeshlab matplotlib`. `gen_shape.py` is the (RAM-heavy) PyTorch
alternative for step 2.
