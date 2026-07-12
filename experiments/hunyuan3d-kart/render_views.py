"""Offline flat-shaded render of an OBJ from a few angles -> PNG contact sheet."""

import argparse

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402


def render(ax, mesh, elev, azim, base=(0.78, 0.28, 0.22)):
    tris = mesh.vertices[mesh.faces]
    n = mesh.face_normals
    light = np.array([0.4, 0.6, 0.7])
    light = light / np.linalg.norm(light)
    shade = np.clip(n @ light, 0, 1) * 0.75 + 0.25
    colors = np.array(base)[None, :] * shade[:, None]
    colors = np.clip(colors, 0, 1)
    coll = Poly3DCollection(tris, facecolors=colors, edgecolors=(0, 0, 0, 0.12), linewidths=0.2)
    ax.add_collection3d(coll)
    v = mesh.vertices
    c = (v.max(0) + v.min(0)) / 2
    r = (v.max(0) - v.min(0)).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r)
    ax.set_ylim(c[1] - r, c[1] + r)
    ax.set_zlim(c[2] - r, c[2] + r)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--obj", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mesh = trimesh.load(args.obj, force="mesh")
    # Auto-orient: put the smallest-extent axis (car height) up = matplotlib Z.
    ext = mesh.extents
    up = int(np.argmin(ext))
    order = [i for i in range(3) if i != up] + [up]  # [len, width, height] -> x,y,z
    mesh.vertices = mesh.vertices[:, order]
    mesh.faces = mesh.faces  # unchanged
    mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=False)
    views = [("front-3/4", 22, -55), ("side", 5, 0), ("rear-3/4", 22, 125), ("top-down", 78, -55)]
    fig = plt.figure(figsize=(14, 4), facecolor="#10141c")
    for i, (name, el, az) in enumerate(views, 1):
        ax = fig.add_subplot(1, 4, i, projection="3d", facecolor="#10141c")
        render(ax, mesh, el, az)
        ax.set_title(name, color="#cdd6e4", fontsize=10)
    fig.tight_layout()
    fig.savefig(args.out, dpi=110, facecolor="#10141c")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
