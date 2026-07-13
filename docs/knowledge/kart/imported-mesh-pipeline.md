---
type: Guide
title: Imported Kart Mesh Pipeline
description: Image-to-3D kart mesh via Hunyuan3D on Apple Silicon; prompt and wiring.
tags: [kart, mesh, imported, hunyuan3d, mlx, tooling, experimental]
timestamp: 2026-07-13T00:00:00Z
---

# Scope

Experimental method, not the house style. The karts are procedural, code-native,
and painterly (see [kart-mesh](/kart/kart-mesh.md)); a photoreal imported mesh is
deliberately off-vibe and is kept as a spike, not merged to main. The reference
implementation (generation scripts, a sample Lancia Delta OBJ, and the game
wiring) lives on the `experiment/hunyuan3d-kart-mesh` branch under
`experiments/hunyuan3d-kart/`. This doc records the process so it is reproducible
and so the integration pattern is documented for any future imported mesh.

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

Three stages, each a small script under `experiments/hunyuan3d-kart/`:

1. Background removal to an RGBA cutout. The shape model wants a foreground mask,
   not a full photo. For a clean studio/white background a border-connected flood
   fill (bright + near-neutral pixels reachable from an image edge become
   transparent; interior bright regions like silver wheels are kept) is enough —
   no rembg, which pulls an ancient numba that conflicts with modern numpy.
2. Shape generation, shape-only (no texture — colorize by hand). Hunyuan3D-2
   `mini` produces the mesh; skip the texture stage, which is the heaviest,
   most CUDA-bound part.
3. GLB to decimated ASCII OBJ. The shape stage emits a dense mesh (hundreds of
   thousands of faces); decimate to a few thousand (quadric edge collapse) and
   export OBJ. OBJ is chosen because it is text — diffable, git-parseable, and
   not on the pre-commit asset blocklist (which rejects `.glb`/`.fbx`/`.bin`).

# What runs where (Apple Silicon)

The only path that fits a 16 GB M-series machine is the MLX port, not PyTorch:

- MLX (the `hunyuan3d-mlx` python port) runs the `mini` weights on Metal in
  ~120 s / ~3 GB with 8-bit quantization + octree decode. This is the working
  path. The pip `mlx` package ships a working Metal backend.
- PyTorch + MPS (the official Hunyuan3D-2 pipeline) loads the fp16 model (~3.6 GB)
  and the octree-256 marching-cubes grid exhausts RAM and swap-thrashes. Use only
  with more RAM or a lower octree resolution.
- The native Swift MLX target fails from a command-line build: it never produces
  its Metal shader library (`default.metallib`), so the runtime aborts. Use the
  python port, whose Metal backend is prebuilt.

"Turbo" variants are step-distilled (fewer inference steps), not weight-quantized;
there is no separate quantized shape checkpoint — the MLX runtime quantizes the
DiT + DINO linears on load.

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
- The generated mesh already includes wheels, so the experiment adds an
  `ownWheels` flag to the `KartModelDef` and to `buildKartVisual`: when set, the
  builder skips the four procedural wheel rigs. Physics is unaffected — the wheel
  `stance` still drives suspension raycasts and action VFX contact points.
- Register like any kart: one model file, one id in the union, one entry in
  `src/kart/models/index.ts`. Everything derived (variants, select overlay, rival
  assignment, preview) then follows from the registry, so the imported kart is
  selectable and drivable with no other changes.

The procedural design-language tests (rounded volumes, three materials,
outline/part counts) assert the painterly vocabulary, so they exempt `ownWheels`
models; the variant-count and select-cycle tests count the imported kart as one
more variant.

# Caveats

- A single cel material paints the whole car (glass, wheels, and body share the
  colorway body color); distinct materials need the mesh segmented by region.
- Shape-only output is not watertight and reconstructs the cabin interior through
  the windows, leaving messy internal geometry; a roof cap or remesh is needed for
  a clean result.
- Registered as a normal variant, rivals can also spawn it, and it renders a touch
  larger than the karts.

# Citations

- [kart-mesh](/kart/kart-mesh.md)
- [kart-variants](/kart/kart-variants.md)
