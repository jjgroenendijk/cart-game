"""Convert a GLB mesh to a decimated ASCII OBJ, small enough to commit as text.

OBJ is text (diffable, git-parseable) and isn't on the repo's asset/binary
blocklist (which rejects `.glb`/`.fbx`/`.bin`); GLB is a binary container and
must never be committed.
"""

from __future__ import annotations

import argparse
import os

import trimesh


def decimate_to_obj(glb_path: str, out_obj: str, faces: int = 6000) -> None:
    loaded = trimesh.load(glb_path, force="mesh")
    mesh = trimesh.util.concatenate(tuple(loaded.geometry.values())) if isinstance(
        loaded, trimesh.Scene
    ) else loaded
    print(f"[decimate] raw: {len(mesh.vertices)} verts / {len(mesh.faces)} faces")

    if faces and len(mesh.faces) > faces:
        mesh = mesh.simplify_quadric_decimation(face_count=faces)
        print(f"[decimate] decimated: {len(mesh.vertices)} verts / {len(mesh.faces)} faces")

    out_dir = os.path.dirname(os.path.abspath(out_obj))
    os.makedirs(out_dir, exist_ok=True)
    mesh.export(out_obj)
    print(f"[decimate] wrote {out_obj} ({os.path.getsize(out_obj) / 1024:.0f} KB)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--faces", type=int, default=6000, help="0 = keep raw face count")
    args = ap.parse_args()

    decimate_to_obj(args.glb, args.out, args.faces)


if __name__ == "__main__":
    main()
