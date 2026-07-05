/**
 * 063 field-scoped track dressing GL owner. Builds three things at the
 * start/finish pose (spline t=0) and disposes them with the field:
 *
 *  - Decal mesh: the checkered start/finish line on the road. Geometry comes
 *    from the pure {@link buildStartLine} (trackDecals.ts), terrain-conformed
 *    via the 053 heightAt + normalAt lift. CelMaterial + vertexColors, layer 1,
 *    polygonOffset -> crisp Sobel edge, no z-fighting.
 *  - Gantry: two posts + a crossbar spanning the road (merged cel geometry,
 *    layer 0, inverted-hull outline). Two fixed Rapier cylinder colliders sit
 *    at the posts, just outside the racing corridor (PropField createBody
 *    idiom); each collider's half-height matches its post so visual + collision
 *    agree on sloped start lines.
 *  - Flag: one large checkered finish flag hanging from the crossbar centre.
 *    A custom wave ShaderMaterial flutters it (sine of a hang param + uTime,
 *    amplitude ramped 0 at the fixed top edge -> max at the free bottom),
 *    reading lightUniforms so it darkens at night like celWater. Checker via
 *    vertex colors (zero textures).
 *
 * Owns its scene membership: the ctor adds `group` to the scene and dispose()
 * removes it, so FieldBuilder wiring stays under its 600-line cap (just holds
 * the ref + forwards update/dispose). Output is LINEAR; OutputPass applies
 * ACES + sRGB once. All geometry is procedural (zero committed assets).
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Terrain } from "../terrain/Terrain";
import { makeCel } from "../materials/cel";
import { addOutline, removeOutline } from "../materials/outline";
import { lightUniforms } from "../materials/lightUniforms";
import { buildStartLine } from "./trackDecals";

const DECAL_LAYER = 1;
const GANTRY_LAYER = 0;

const POST_HEIGHT = 5;
const POST_RADIUS = 0.18;
/** Posts sit this far outside the road half-width (clear of the race line). */
const POST_MARGIN = 0.8;
const CROSSBAR_THICK = 0.22;
const GANTRY_COLOR = 0x33373e;

const FLAG_W = 3;
const FLAG_H = 1.8;
const FLAG_COLS = 6;
const FLAG_ROWS = 4;
const FLAG_LIGHT: [number, number, number] = [0.9, 0.9, 0.9];
const FLAG_DARK: [number, number, number] = [0.05, 0.05, 0.05];
const FLAG_AMP = 0.12;
const FLAG_FREQ = 6;
const FLAG_SPEED = 2.2;

const X_AXIS = new THREE.Vector3(1, 0, 0);

const FLAG_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aHang;
  uniform float uTime;
  uniform float uAmp;
  uniform float uFreq;
  uniform float uSpeed;
  uniform vec2 uFlutterDir;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec3 pos = position;
    float wave = sin(uTime * uSpeed + aHang * uFreq) * aHang * uAmp;
    pos.x += uFlutterDir.x * wave;
    pos.z += uFlutterDir.y * wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FLAG_FRAG = /* glsl */ `
  uniform vec3 uAmbient;
  uniform vec3 uSunColor;
  varying vec3 vColor;
  void main() {
    vec3 base = vColor;
    // Cloth read: ambient keeps the checker visible at night; a flat sun tint
    // lifts it by day. No normal attribute (flat cloth) -> skip true lambert.
    vec3 color = base * uAmbient + base * uSunColor * 0.35;
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface StartPose {
  cx: number;
  cz: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  halfWidth: number;
}

interface Post {
  x: number;
  z: number;
  baseY: number;
  /** Visual + collider height (reaches the level crossbar). */
  height: number;
}

/**
 * Field-scoped track dressing. `scene`/`terrain`/`physics` are the live deps
 * FieldBuilder already holds; `halfWidth` is the configured road half-width
 * (TRACK_HALF_WIDTH) so procedural/variable-width circuits dress correctly.
 */
export class TrackDressing {
  readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly physics: PhysicsWorld;
  private readonly outlines: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly bodies: RAPIER.RigidBody[] = [];
  private flagMaterial?: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, terrain: Terrain, physics: PhysicsWorld, halfWidth: number) {
    this.scene = scene;
    this.physics = physics;
    this.build(terrain, halfWidth);
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
    scene.add(this.group);
  }

  /** Advance the flag wave. No-op before/after dispose. */
  update(time: number): void {
    if (this.flagMaterial !== undefined) this.flagMaterial.uniforms.uTime.value = time;
  }

  /** Free GL + outline + both post colliders and detach from the scene. */
  dispose(): void {
    for (const o of this.outlines) removeOutline(o);
    this.outlines.length = 0;
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    for (const b of this.bodies) this.physics.world.removeRigidBody(b);
    this.bodies.length = 0;
    this.group.clear();
    this.scene.remove(this.group);
    this.flagMaterial = undefined;
  }

  private build(terrain: Terrain, halfWidth: number): void {
    const pose = this.startPose(terrain, halfWidth);
    const { posts, topY } = this.computePosts(terrain, pose);
    this.buildDecal(terrain, pose);
    this.buildGantry(posts, pose, topY);
    this.buildFlag(pose, topY);
    this.buildPostBodies(posts);
  }

  /** Centre, XZ unit tangent, XZ unit right at the start line (t=0). */
  private startPose(terrain: Terrain, halfWidth: number): StartPose {
    const p = terrain.spline.getPoint(0, new THREE.Vector3());
    const tan = terrain.spline.curve.getTangent(0).normalize();
    // Project the tangent to XZ and renormalise (the start line spans the
    // road, not the slope). right = XZ perpendicular of forward.
    const tlen = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / tlen;
    const tz = tan.z / tlen;
    return { cx: p.x, cz: p.z, tx, tz, rx: tz, rz: -tx, halfWidth };
  }

  /**
   * Left + right posts just outside the corridor. The crossbar is level at
   * topY = highest base + POST_HEIGHT, so the lower post grows taller to meet
   * it; each post's stored height feeds BOTH the visual cylinder and the
   * collider so they agree on sloped start lines.
   */
  private computePosts(terrain: Terrain, pose: StartPose): { posts: Post[]; topY: number } {
    const offset = pose.halfWidth + POST_MARGIN;
    let topY = -Infinity;
    const posts: Post[] = [];
    for (const s of [-1, 1]) {
      const x = pose.cx + pose.rx * offset * s;
      const z = pose.cz + pose.rz * offset * s;
      const baseY = terrain.heightAt(x, z);
      topY = Math.max(topY, baseY + POST_HEIGHT);
      posts.push({ x, z, baseY, height: 0 });
    }
    for (const p of posts) p.height = topY - p.baseY;
    return { posts, topY };
  }

  private buildDecal(terrain: Terrain, pose: StartPose): void {
    const probe = {
      heightAt: (x: number, z: number) => terrain.heightAt(x, z),
      normalAt: (x: number, z: number): [number, number, number] => {
        const n = terrain.normalAt(x, z);
        return [n.x, n.y, n.z];
      },
    };
    const decal = buildStartLine(
      { cx: pose.cx, cz: pose.cz, tx: pose.tx, tz: pose.tz, halfWidth: pose.halfWidth },
      probe,
    );
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(decal.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(decal.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(decal.indices, 1));
    geo.computeVertexNormals();

    const mat = makeCel({ vertexColors: true });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
    this.materials.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.layers.set(DECAL_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
  }

  /** Merged posts + crossbar cel mesh + outline. `topY` is the crossbar Y. */
  private buildGantry(posts: Post[], pose: StartPose, topY: number): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const p of posts) parts.push(this.postGeo(p.x, p.baseY, topY, p.z));
    parts.push(this.crossbarGeo(pose, topY, (pose.halfWidth + POST_MARGIN) * 2));

    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) throw new Error("TrackDressing: gantry merge returned null");
    const mat = makeCel({ flatShading: true, color: GANTRY_COLOR });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(GANTRY_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.outlines.push(addOutline(mesh, 0.02));
  }

  /** Cylinder from the post base up to the crossbar top (centred at mid-Y). */
  private postGeo(x: number, baseY: number, topY: number, z: number): THREE.BufferGeometry {
    const height = topY - baseY;
    const g = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, height, 8);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, baseY + height / 2, z));
    return g;
  }

  /** Box crossbar spanning the road, length axis aligned to the right vector. */
  private crossbarGeo(pose: StartPose, topY: number, span: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(span, CROSSBAR_THICK, CROSSBAR_THICK);
    const right = new THREE.Vector3(pose.rx, 0, pose.rz);
    const q = new THREE.Quaternion().setFromUnitVectors(X_AXIS, right);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pose.cx, topY, pose.cz),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    return g;
  }

  private buildFlag(pose: StartPose, topY: number): void {
    const cells = FLAG_COLS * FLAG_ROWS;
    const cellW = FLAG_W / FLAG_COLS;
    const cellH = FLAG_H / FLAG_ROWS;
    const positions = new Float32Array(cells * 4 * 3);
    const colors = new Float32Array(cells * 4 * 3);
    const hang = new Float32Array(cells * 4);
    const indices = new Uint16Array(cells * 6);

    for (let i = 0; i < FLAG_ROWS; i++) {
      const vLo = i * cellH;
      const vHi = vLo + cellH;
      for (let j = 0; j < FLAG_COLS; j++) {
        const uLo = -FLAG_W / 2 + j * cellW;
        const uHi = uLo + cellW;
        const cell = i * FLAG_COLS + j;
        const v0 = cell * 4;
        const c: [number, number, number] = (i + j) % 2 === 0 ? FLAG_LIGHT : FLAG_DARK;
        this.flagVert(positions, colors, hang, v0, pose, topY, uLo, vLo, c);
        this.flagVert(positions, colors, hang, v0 + 1, pose, topY, uHi, vLo, c);
        this.flagVert(positions, colors, hang, v0 + 2, pose, topY, uHi, vHi, c);
        this.flagVert(positions, colors, hang, v0 + 3, pose, topY, uLo, vHi, c);
        const o = cell * 6;
        indices[o] = v0;
        indices[o + 1] = v0 + 2;
        indices[o + 2] = v0 + 1;
        indices[o + 3] = v0;
        indices[o + 4] = v0 + 3;
        indices[o + 5] = v0 + 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aHang", new THREE.BufferAttribute(hang, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...lightUniforms,
        uTime: { value: 0 },
        uAmp: { value: FLAG_AMP },
        uFreq: { value: FLAG_FREQ },
        uSpeed: { value: FLAG_SPEED },
        uFlutterDir: { value: new THREE.Vector2(pose.tx, pose.tz) },
      },
      vertexShader: FLAG_VERT,
      fragmentShader: FLAG_FRAG,
      side: THREE.DoubleSide,
    });
    this.materials.push(mat);
    this.flagMaterial = mat;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.layers.set(GANTRY_LAYER);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
  }

  /** One flag-grid vertex: world pos = crossbar centre + right*u - up*v. */
  private flagVert(
    positions: Float32Array,
    colors: Float32Array,
    hang: Float32Array,
    v: number,
    pose: StartPose,
    topY: number,
    u: number,
    vertV: number,
    c: [number, number, number],
  ): void {
    const o = v * 3;
    positions[o] = pose.cx + pose.rx * u;
    positions[o + 1] = topY - vertV;
    positions[o + 2] = pose.cz + pose.rz * u;
    colors[o] = c[0];
    colors[o + 1] = c[1];
    colors[o + 2] = c[2];
    hang[v] = vertV / FLAG_H;
  }

  /** Fixed cylinder per post; half-height matches the post so slopes align. */
  private buildPostBodies(posts: Post[]): void {
    for (const p of posts) {
      const halfH = p.height / 2;
      const desc = RAPIER.ColliderDesc.cylinder(halfH, POST_RADIUS);
      desc.setFriction(0.8).setRestitution(0.1);
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.baseY + halfH, p.z),
      );
      this.physics.world.createCollider(desc, body);
      this.bodies.push(body);
    }
  }
}
