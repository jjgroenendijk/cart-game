"""Shape-only mesh generation via Hunyuan3D-2mini-Turbo on Apple Silicon (MPS).

No texture stage (skips the CUDA-only custom_rasterizer / differentiable_renderer).
Exports ASCII OBJ so the result is git-parseable (no binary .glb).
"""

import argparse
import os
import sys
import time

# Let unsupported MPS ops fall back to CPU instead of hard-erroring.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

REPO = os.path.join(os.path.dirname(__file__), "repo")
sys.path.insert(0, REPO)

import torch  # noqa: E402
from PIL import Image  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=5)  # turbo default
    ap.add_argument("--octree", type=int, default=128)  # 128 fits in 16GB RAM; 256 OOM-thrashes
    ap.add_argument("--guidance", type=float, default=5.0)
    ap.add_argument("--faces", type=int, default=6000)  # decimation target; 0 = keep raw
    ap.add_argument("--device", default="mps")
    ap.add_argument("--dtype", default="float32", choices=["float32", "float16"])
    args = ap.parse_args()

    dtype = torch.float32 if args.dtype == "float32" else torch.float16

    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    print(f"[gen] loading mini-turbo on {args.device}/{args.dtype} ...", flush=True)
    t0 = time.time()
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        "tencent/Hunyuan3D-2mini",
        subfolder="hunyuan3d-dit-v2-mini-turbo",
        device=args.device,
        dtype=dtype,
    )
    print(f"[gen] model ready in {time.time() - t0:.1f}s", flush=True)

    image = Image.open(args.image)
    print(f"[gen] input image: mode={image.mode} size={image.size}")
    image = image.convert("RGBA")
    # Report whether the image actually carries a foreground mask.
    alpha = image.getchannel("A")
    lo, hi = alpha.getextrema()
    print(f"[gen] alpha range: {lo}..{hi} ({'has mask' if lo < hi else 'OPAQUE - no mask'})")

    t0 = time.time()
    outputs = pipe(
        image=image,
        num_inference_steps=args.steps,
        octree_resolution=args.octree,
        guidance_scale=args.guidance,
        output_type="trimesh",
    )
    mesh = outputs[0]
    print(f"[gen] generated in {time.time() - t0:.1f}s")
    print(f"[gen] raw mesh: {len(mesh.vertices)} verts / {len(mesh.faces)} faces", flush=True)

    if args.faces and len(mesh.faces) > args.faces:
        from hy3dgen.shapegen import DegenerateFaceRemover, FaceReducer, FloaterRemover

        t0 = time.time()
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        mesh = FaceReducer()(mesh, max_facenum=args.faces)
        print(
            f"[gen] decimated to {len(mesh.vertices)} verts / {len(mesh.faces)} faces "
            f"in {time.time() - t0:.1f}s"
        )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    mesh.export(args.out)  # .obj -> ASCII
    size_kb = os.path.getsize(args.out) / 1024
    print(f"[gen] wrote {args.out} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
