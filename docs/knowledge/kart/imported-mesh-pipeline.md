---
type: Guide
title: Imported Kart Mesh Pipeline
description: Image-to-3D kart mesh via Hunyuan3D on Apple Silicon; prompt, pipeline, and wiring.
tags: [kart, mesh, imported, hunyuan3d, mlx, tooling, experimental]
timestamp: 2026-07-14T00:00:00Z
---

# Scope

Experimental method, not the house style. The karts are procedural, code-native,
and painterly (see [kart-mesh](/kart/kart-mesh.md)); a photoreal imported mesh is
deliberately off-vibe. Three demo karts (`quattro`, `t16white`, `t16red`) ship on
main as a working proof of concept, not a production asset pipeline — expect
messy interior geometry and a single flat paint color (see Caveats). The
reference implementation (a small `uv` project: generation scripts + a CLI) lives
at `experiments/hunyuan3d-kart/`; this doc records the process so it is
reproducible and so the integration pattern is documented for any future
imported mesh.

# Source image prompt

Single-image reconstruction needs a clean, well-framed subject. Generate the car
image (e.g. with an image model) using a prompt like this, swapping the car:

```text
A low-poly 3D render of a Lancia Delta Integrale rally car, front three-quarter
view (camera slightly above, looking down at ~20 degrees), the entire car fully
in frame and centered with clear space around all four wheels. Faceted low-poly
geometry with flat shading, clean readable silhouette, boxy body with flared
wheel arches. Simple matte solid-color paint, no decals, no text, no license
plate. Isolated on a plain flat pure-white background, even soft studio
lighting, no reflections, no motion blur, no ground shadow, no environment,
no people. Square 1:1 composition. Single vehicle only.
```

Why each constraint matters:

- Front three-quarter, slightly elevated — the reconstruction needs front, side,
  and roof at once; a flat side or head-on view collapses depth and yields a bad
  mesh.
- Whole car centered, space around wheels — cropped tyres/bumper become holes or
  stumps in the mesh.
- Plain flat background, no shadow — the pipeline works on a masked cutout; a busy
  background or cast shadow bakes into the geometry.
- Low-poly / flat-shaded — biases the reconstruction toward faceted geometry that
  matches the cel-shaded karts and colorizes cleanly by hand.
- Square 1:1 — the model resizes to a square; a wide shot gets letterboxed and the
  car shrinks.

# Generation pipeline

`experiments/hunyuan3d-kart/` is a small `uv` project (`pyproject.toml` +
`hy3dpipeline/`). It pulls shape generation in as a git dependency —
`hunyuan3d-shape-mlx` from
[ZimengXiong/Hunyuan3D-Swift](https://github.com/ZimengXiong/Hunyuan3D-Swift)
(`python/shape` subdirectory) — rather than vendoring that repo, so the pipeline
itself stays a handful of small scripts:

```sh
cd experiments/hunyuan3d-kart
uv sync
uv run hf download zimengxiong/hunyuan3d-mlx-shape-small --local-dir weights/shape-small
uv run hy3d-kart run --image car.png --out ../../src/kart/models/mycar.obj
```

Three stages, chained by `hy3dpipeline/cli.py run` (each also runnable alone via
`uv run python -m hy3dpipeline.<stage>`):

1. `bg_remove.py` — background removal to an RGBA cutout. The shape model wants
   a foreground mask, not a full photo. For a clean studio/white background a
   border-connected flood fill (bright + near-neutral pixels reachable from an
   image edge become transparent; interior bright regions like silver wheels
   are kept) is enough — no rembg, which pulls an ancient numba that conflicts
   with modern numpy.
2. `generate.py` — shape generation, shape-only (no texture — colorize by
   hand). Hunyuan3D-2 `mini` produces the mesh; skip the texture stage, which
   is the heaviest, most CUDA-bound part.
3. `decimate.py` — GLB to decimated ASCII OBJ. The shape stage emits a dense
   mesh (hundreds of thousands of faces); decimate to a few thousand (quadric
   edge collapse, via trimesh + `fast-simplification`) and export OBJ. OBJ is
   chosen because it is text — diffable, git-parseable, and not on the
   pre-commit asset blocklist (which rejects `.glb`/`.fbx`/`.bin`). The
   intermediate RGBA cutout and GLB are gitignored; only the final `.obj` is
   committed.

# What runs where (Apple Silicon)

The only path that fits a 16 GB M-series machine is the MLX port, not PyTorch:

- MLX (`hunyuan3d-shape-mlx`) runs the `mini` weights on Metal with
  **4-bit quantization** (`--quantize 4`) + octree decode in ~115 s / ~2.7 GB —
  the smallest-RAM config, and the one the pipeline defaults to. 8-bit is also
  supported (`--quantize 8`, near-lossless, ~3 GB) if quality matters more than
  headroom; the 3 shipped demo karts all used 4-bit. The pip `mlx` package
  ships a working Metal backend.
- PyTorch + MPS (the official Hunyuan3D-2 pipeline) loads the fp16 model (~3.6 GB)
  and the octree-256 marching-cubes grid exhausts RAM and swap-thrashes. Use only
  with more RAM or a lower octree resolution.
- The native Swift MLX target fails from a command-line build: it never produces
  its Metal shader library (`default.metallib`), so the runtime aborts. Use the
  python port, whose Metal backend is prebuilt.

"Turbo" variants are step-distilled (fewer inference steps), not weight-quantized;
quantization is a separate runtime flag — the MLX runtime quantizes the DiT +
DINO linears on load, independent of which checkpoint is loaded.

# Wiring an imported mesh into the kart system

The kart visual is built by `buildKartVisual` in `src/kart/kartVisual.ts`, shared
by racing karts and the select preview; models are registered per-file under
`src/kart/models/` via `src/kart/models/index.ts`, and the id union lives in
`src/kart/models/types.ts`. An imported mesh reuses all of this:

- Ship the OBJ as a code-native asset: inline it as text via a Vite `?raw` import
  and parse it synchronously with `OBJLoader.parse` inside the model's
  `build(ctx)`. Sync parse keeps the builder synchronous like the procedural
  models; no async load and no separate served asset file.
- The Hunyuan OBJ export carries no normals, so `build` runs
  `computeVertexNormals` (cel shading and the inverted-hull outline both need
  them), applies the caller's `bodyMat`, and adds a `BODY_OUTLINE` hull from
  `src/kart/models/parts.ts`. Then center the mesh, uniform-scale it to the
  silhouette depth, seat its lowest point on the shared ground plane, and rotate
  it 180 about up so the nose points -Z (game forward; the chase camera sits at
  +Z behind the kart). Verify nose direction from the mesh: a true top-down
  projection shows which end carries the side mirrors (front).
- The generated mesh already includes wheels, so `KartModelDef` and
  `buildKartVisual` carry an `ownWheels` flag: when set, the builder skips the
  four procedural wheel rigs. Physics is unaffected — the wheel `stance` still
  drives suspension raycasts and action VFX contact points.
- Register like any kart: one model file, one id in the union, one entry in
  `src/kart/models/index.ts`. Everything derived (variants, select overlay, rival
  assignment, preview) then follows from the registry, so the imported kart is
  selectable and drivable with no other changes.

The procedural design-language tests (rounded volumes, three materials,
outline/part counts) assert the painterly vocabulary, so they exempt `ownWheels`
models; the variant-count and select-cycle tests count each imported kart as one
more variant.

# Shipped demo karts

`quattro`, `t16white`, and `t16red` (`src/kart/models/quattro.ts` /
`t16white.ts` / `t16red.ts`) are three Group-B-style rally cars generated this
way — `t16white`/`t16red` are the same source body in two liveries, generated
as two separate runs (shape-only generation carries no texture, so paint comes
entirely from the colorway, not the source image's color).

# Caveats

- A single cel material paints the whole car (glass, wheels, and body share the
  colorway body color); distinct materials need the mesh segmented by region.
- Shape-only output is not watertight and reconstructs the cabin interior through
  the windows, leaving messy internal geometry; a roof cap or remesh is needed for
  a clean result.
- Registered as a normal variant, rivals can also spawn it, and it renders a touch
  larger than the karts.
- Not aimed at production quality — this is a working demo of the pipeline, not
  an asset-import workflow ready for a full roster.

# Citations

- [kart-mesh](/kart/kart-mesh.md)
- [kart-variants](/kart/kart-variants.md)
