import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { makeToon, addOutline, flatGeometry } from "../materials/toon";

interface BoxOpts {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY?: number;
  color: number;
}

const GRASS = 0x6aa84f;
const DIRT = 0x8a6d3b;
const STONE = 0x7d8a96;

export class TestArena {
  readonly group = new THREE.Group();

  constructor(physics: PhysicsWorld) {
    this.addGround(physics);
    this.addBoundaryWalls(physics);
    this.addBox(physics, {
      x: 14,
      y: 0.6,
      z: -6,
      sx: 6,
      sy: 1.2,
      sz: 8,
      rotY: -0.35,
      color: 0xc0392b,
    });
    this.addBox(physics, { x: -18, y: 0.5, z: 8, sx: 5, sy: 1, sz: 5, rotY: 0.5, color: 0x2980b9 });
    this.addRamp(physics, 0, -22, 1.0);
    this.addRamp(physics, -28, -10, -0.7);
    this.addTrees(physics);
    this.addRocks(physics);
  }

  private addGround(physics: PhysicsWorld): void {
    const groundBody = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 1, 200).setFriction(1.0).setRestitution(0),
      groundBody,
    );
    const mat = makeToon({ color: GRASS });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(400, 2, 400), mat);
    mesh.position.y = -1;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Subtle grid stripes for sense of speed
    const stripeMat = makeToon({ color: 0x5d9144 });
    for (let i = -8; i <= 8; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(400, 0.02, 2), stripeMat);
      stripe.position.set(0, 0.02, i * 16);
      stripe.receiveShadow = true;
      this.group.add(stripe);
    }
  }

  private addBoundaryWalls(physics: PhysicsWorld): void {
    const half = 95;
    const t = 2;
    const wallMat = makeToon({ color: DIRT });
    const defs: BoxOpts[] = [
      { x: 0, y: 2, z: -half, sx: half * 2, sy: 4, sz: t, color: DIRT },
      { x: 0, y: 2, z: half, sx: half * 2, sy: 4, sz: t, color: DIRT },
      { x: -half, y: 2, z: 0, sx: t, sy: 4, sz: half * 2, color: DIRT },
      { x: half, y: 2, z: 0, sx: t, sy: 4, sz: half * 2, color: DIRT },
    ];
    for (const d of defs) {
      this.addBox(physics, d, wallMat);
    }
  }

  private addBox(physics: PhysicsWorld, opts: BoxOpts, mat?: THREE.Material): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY ?? 0);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(opts.x, opts.y, opts.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(opts.sx / 2, opts.sy / 2, opts.sz / 2)
        .setFriction(0.9)
        .setRestitution(0),
      body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(opts.sx, opts.sy, opts.sz),
      mat ?? makeToon({ color: opts.color }),
    );
    mesh.position.set(opts.x, opts.y, opts.z);
    mesh.quaternion.copy(q);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addOutline(mesh, 0.04);
    this.group.add(mesh);
  }

  private addRamp(physics: PhysicsWorld, x: number, z: number, rotY: number): void {
    // A thin wedge approximated by a rotated box; gives a jump.
    const sx = 10;
    const sy = 2.4;
    const sz = 8;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.32);
    const full = q.clone().multiply(tilt);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, sy / 2, z)
        .setRotation({ x: full.x, y: full.y, z: full.z, w: full.w }),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setFriction(0.8)
        .setRestitution(0),
      body,
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), makeToon({ color: 0xc0392b }));
    mesh.position.set(x, sy / 2, z);
    mesh.quaternion.copy(full);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addOutline(mesh, 0.05);
    this.group.add(mesh);
  }

  private addTrees(physics: PhysicsWorld): void {
    const trunkMat = makeToon({ color: 0x6b4f2a });
    const leafMat = makeToon({ color: 0x2f7d32 });
    const positions: Array<[number, number]> = [
      [30, 20],
      [-34, -18],
      [40, -30],
      [-40, 28],
      [22, -40],
      [-20, 38],
      [50, 6],
      [-52, -6],
    ];
    for (const [x, z] of positions) {
      const tree = new THREE.Group();
      const trunkGeo = flatGeometry(new THREE.CylinderGeometry(0.4, 0.6, 3, 8));
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.5;
      trunk.castShadow = true;
      addOutline(trunk, 0.04);
      tree.add(trunk);
      const foliage = new THREE.Mesh(flatGeometry(new THREE.IcosahedronGeometry(2.2, 0)), leafMat);
      foliage.position.y = 4.2;
      foliage.castShadow = true;
      addOutline(foliage, 0.06);
      tree.add(foliage);
      const foliage2 = new THREE.Mesh(flatGeometry(new THREE.IcosahedronGeometry(1.5, 0)), leafMat);
      foliage2.position.set(1, 3.4, 0.5);
      foliage2.castShadow = true;
      addOutline(foliage2, 0.06);
      tree.add(foliage2);
      tree.position.set(x, 0, z);
      this.group.add(tree);

      // Trunk collider
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, 1.5, z),
      );
      physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(1.5, 0.6).setFriction(0.8).setRestitution(0.1),
        body,
      );
    }
  }

  private addRocks(physics: PhysicsWorld): void {
    const rockMat = makeToon({ color: STONE });
    const positions: Array<[number, number, number]> = [
      [8, 10, 1.2],
      [-12, 14, 1.6],
      [24, 4, 1],
      [-6, -30, 1.8],
      [16, 22, 1.3],
    ];
    for (const [x, z, r] of positions) {
      const mesh = new THREE.Mesh(flatGeometry(new THREE.DodecahedronGeometry(r, 0)), rockMat);
      mesh.position.set(x, r * 0.6, z);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addOutline(mesh, 0.04);
      this.group.add(mesh);
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, r * 0.6, z),
      );
      physics.world.createCollider(
        RAPIER.ColliderDesc.ball(r * 0.85)
          .setFriction(0.8)
          .setRestitution(0.1),
        body,
      );
    }
  }
}
