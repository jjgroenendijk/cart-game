"""Convert a GLB (from Hunyuan3D-Swift) to a decimated ASCII OBJ for git.

trimesh loads the GLB, we merge any scene into one mesh, optionally decimate to a
target face budget via pymeshlab (quadric edge collapse), then export OBJ (text).
"""

import argparse
import os

import trimesh


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--faces", type=int, default=6000)  # 0 = keep raw
    args = ap.parse_args()

    loaded = trimesh.load(args.glb, force="mesh")
    if isinstance(loaded, trimesh.Scene):
        loaded = trimesh.util.concatenate(tuple(loaded.geometry.values()))
    mesh = loaded
    print(f"[conv] raw: {len(mesh.vertices)} verts / {len(mesh.faces)} faces")

    if args.faces and len(mesh.faces) > args.faces:
        import pymeshlab

        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(mesh.vertices, mesh.faces))
        ms.meshing_decimation_quadric_edge_collapse(
            targetfacenum=args.faces, preservenormal=True, preservetopology=False
        )
        m = ms.current_mesh()
        mesh = trimesh.Trimesh(vertices=m.vertex_matrix(), faces=m.face_matrix(), process=False)
        print(f"[conv] decimated: {len(mesh.vertices)} verts / {len(mesh.faces)} faces")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    mesh.export(args.out)
    print(f"[conv] wrote {args.out} ({os.path.getsize(args.out) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
