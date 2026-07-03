/**
 * 012 field lifecycle + AI step. Owns the per-field state (human PlayerViews,
 * AI rivals, RaceManager, per-view RaceHuds, AI tunings/RNG/stuck timers) and
 * the fixed-step that drives humans + rivals + race progress. Built once in
 * Game's ctor and rebuilt in place via build()/dispose() when the mode (1P/2P)
 * changes; Game keeps the stable singletons (renderer, physics, terrain, audio,
 * minimap, results) and passes them in as deps.
 *
 * Mirrors GameAudioDriver: holds plain data + calls into injected audio/physics
 * collaborators. Net-zero relocation of the old in-Game methods; Game delegates.
 */

import * as THREE from "three";
import { splitRects, type Rect } from "./Renderer";
import { zeroInput, type KartInput } from "./Input";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Terrain } from "../terrain/Terrain";
import { Kart } from "../kart/Kart";
import {
  KartVfx,
  makeVfxSample,
  fillKartVfxSample,
  type KartVfxSample,
} from "../kart/KartVfxLayer";
import { SkidMarks } from "../kart/SkidMarksLayer";
import { LifeBar } from "../ui/LifeBar";
import { computeGrid, type GridPath } from "../kart/KartGrid";
import { ChaseCamera } from "../kart/ChaseCamera";
import type { AudioManager, PlayerAudioState } from "../audio/AudioManager";
import type { GameAudioDriver } from "../audio/gameAudio";
import type { ListenerTransform, RivalAudioState } from "../audio/rivalVoices";
import { listenerMidpoint } from "./listenerTransform";
import { RaceHud } from "../ui/RaceHud";
import { type Minimap, type MinimapKart } from "../ui/Minimap";
import { PlayerView, viewHudAnchor } from "./PlayerView";
import { makeRNG, type RNG } from "./rng";
import { wrap01 } from "../race/checkpoints";
import type { Vec3 } from "./math";
import {
  RaceManager,
  DEFAULT_TARGET_LAPS,
  type FinishMode,
  type KartRacePose,
} from "../race/raceManager";
import { produceInput, type AiSplinePoint, type AiRival } from "../race/AiDriver";
import { makeAiTuning, withSpeedScale } from "../race/aiTuning";
import { variantForRival, variantById, type KartVariantId } from "../kart/kartVariants";
import type { GameState } from "./gameState";

export interface FieldBuilderDeps {
  physics: PhysicsWorld;
  scene: THREE.Scene;
  terrain: Terrain;
  container: HTMLElement;
  audio: AudioManager;
  gameAudio: GameAudioDriver;
  minimap: Minimap;
  results: HTMLElement;
}

const TARGET_FIELD = 6; // total karts (humans + rivals)
const TARGET_LAPS = DEFAULT_TARGET_LAPS;
const AI_BASE_SEED = 1337;
const AI_AHEAD_SAMPLES = 16;
const AI_AHEAD_STEP = 0.008; // ~3 m steps along the ~377 m loop
const RESPAWN_AHEAD_T = 0.015; // respawn a bit past the nearest spline point
const CORRIDOR_HALF_WIDTH = 6; // matches trackHalfWidth (003) + AiDriver
const RESPAWN_CLEARANCE = 1.5;
/** px from the viewport corner to the speed readout. */
export const SPEED_OFFSET = 14;
/** px from the viewport corner to the race HUD. */
export const HUD_OFFSET = 58;
/** px from the viewport corner to the life bar (below race HUD). */
export const LIFE_BAR_TOP_OFFSET = 108;

const UP_Y = new THREE.Vector3(0, 1, 0);

export function rectAspect(rect: Rect): number {
  return rect.w / rect.h;
}

export class FieldBuilder {
  views: PlayerView[] = [];
  rivals: Kart[] = [];
  race!: RaceManager;
  raceHuds: RaceHud[] = [];
  private aiTunings: ReturnType<typeof makeAiTuning>[] = [];
  private aiRngs: RNG[] = [];
  private stuckAccum: number[] = [];
  /** Per-rival reusable AiSplinePoint[AI_AHEAD_SAMPLES] buffer (pooled). */
  private aiAheadBuf: AiSplinePoint[][] = [];
  /** Per-rival reusable AiRival[] buffer (pooled; length = kartCount - 1). */
  private aiRivalsBuf: AiRival[][] = [];
  /** Reusable PlayerAudioState[] (pooled; written in place each frame). */
  private audioHumanBuf: PlayerAudioState[] = [];
  /** Reusable RivalAudioState[] with pooled pos/vel Vec3s (written in place). */
  private audioRivalBuf: RivalAudioState[] = [];
  /** Listener input arrays (pooled): stable refs to kart pos/forward Vec3s. */
  private lisPos: Vec3[] = [];
  private lisFwd: Vec3[] = [];
  /** Listener velocity scratch (pooled; linvel() copied in each frame). */
  private lisVel: Vec3[] = [];
  /** Reusable ListenerTransform output (pooled; written in place each frame). */
  private readonly lisOut: ListenerTransform = {
    pos: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    vel: { x: 0, y: 0, z: 0 },
  };
  humanCount = 1;
  private vfx?: KartVfx;
  private skid?: SkidMarks;
  private readonly vfxSamples: KartVfxSample[] = [];
  private readonly tmpV = new THREE.Vector3();
  /** Pooled {dist, t} for cached pose queries (reused each sub-step, no alloc). */
  private readonly poseOut: { dist: number; t: number } = { dist: 0, t: 0 };

  private readonly physics: PhysicsWorld;
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly container: HTMLElement;
  private readonly audio: AudioManager;
  private readonly gameAudio: GameAudioDriver;
  private readonly minimap: Minimap;
  private readonly results: HTMLElement;

  constructor(deps: FieldBuilderDeps) {
    this.physics = deps.physics;
    this.scene = deps.scene;
    this.terrain = deps.terrain;
    this.container = deps.container;
    this.audio = deps.audio;
    this.gameAudio = deps.gameAudio;
    this.minimap = deps.minimap;
    this.results = deps.results;
  }

  private gridPath(): GridPath {
    return {
      getPoint: (t, out) => this.terrain.spline.getPoint(t, out),
      getTangent: (t) => this.terrain.spline.curve.getTangent(t),
    };
  }

  /**
   * Build the kart field for `humanCount` humans. Slots 0..humanCount-1 are
   * humans (PlayerView[] with chase cam + speed HUD + viewport rect); the rest
   * are AI rivals. `humanVariants[i]` selects the variant for human `i`
   * (defaults to "balanced" when absent); rivals always draw from the variant
   * pool. Rebuilds the RaceManager (mode-dependent finish), per-view RaceHuds,
   * the shared minimap placement, the audio voice count, and hides the results
   * overlay (Game owns the resultsShown flag).
   */
  build(humanCount: number, humanVariants: KartVariantId[] = []): void {
    this.humanCount = humanCount;
    const kartCount = TARGET_FIELD;
    const grid = computeGrid(this.gridPath(), (x, z) => this.terrain.heightAt(x, z), kartCount);
    const [w, h] = [window.innerWidth, window.innerHeight];
    const rects = splitRects(w, h, "horizontal", humanCount);

    this.views = [];
    for (let i = 0; i < humanCount; i++) {
      const s = grid[i]!;
      const id = humanVariants[i] ?? "balanced";
      const variant = variantById(id);
      const kart = new Kart(
        this.physics,
        s.pos,
        s.yaw,
        i,
        variant.colors,
        variant.silhouette,
        variant.tuning,
        this.terrain.waterLevel,
      );
      this.scene.add(kart.group);
      const chaseCam = new ChaseCamera(rectAspect(rects[i]!));
      const speedEl = this.createSpeedEl(rects[i]!, i);
      this.container.appendChild(speedEl);
      const a = viewHudAnchor(rects[i]!, "top-left", w, h);
      const lifeBar = new LifeBar(this.container, {
        left: a.left + SPEED_OFFSET,
        top: a.top + LIFE_BAR_TOP_OFFSET,
      });
      this.views.push(new PlayerView(kart, chaseCam, rects[i]!, speedEl, lifeBar));
    }

    this.rivals = [];
    for (let i = humanCount; i < kartCount; i++) {
      const s = grid[i]!;
      const id = variantForRival(AI_BASE_SEED, i);
      const variant = variantById(id);
      const rival = new Kart(
        this.physics,
        s.pos,
        s.yaw,
        i,
        variant.colors,
        variant.silhouette,
        variant.tuning,
        this.terrain.waterLevel,
      );
      this.scene.add(rival.group);
      this.rivals.push(rival);
    }

    this.aiTunings = this.rivals.map((r, i) => ({
      ...makeAiTuning(AI_BASE_SEED, i + 1),
      refMaxSpeed: r.controller.tuning.maxSpeed,
    }));
    this.aiRngs = this.rivals.map((_, i) =>
      makeRNG((AI_BASE_SEED ^ Math.imul(i + 2, 0x9e3779b1)) >>> 0),
    );
    this.stuckAccum = this.rivals.map(() => 0);
    // Pool per-rival reusable buffers so stepWorld allocates zero objects.
    const rivalSlotCount = this.views.length + this.rivals.length - 1;
    this.aiAheadBuf = this.rivals.map(() =>
      Array.from({ length: AI_AHEAD_SAMPLES }, (): AiSplinePoint => ({ x: 0, z: 0 })),
    );
    this.aiRivalsBuf = this.rivals.map(() =>
      Array.from({ length: rivalSlotCount }, (): AiRival => ({ x: 0, z: 0 })),
    );
    // Pool audio-state + listener buffers so the per-frame audio update path
    // allocates zero objects (consumers read synchronously, no retention).
    this.audioHumanBuf = Array.from(
      { length: humanCount },
      (): PlayerAudioState => ({
        speed: 0,
        throttle: 0,
        drifting: false,
      }),
    );
    this.audioRivalBuf = this.rivals.map(
      (): RivalAudioState => ({
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        speed: 0,
        throttle: 0,
        drifting: false,
      }),
    );
    this.lisPos = this.views.map((v) => v.kart.group.position);
    this.lisFwd = this.views.map((v) => v.kart.forwardDir);
    this.lisVel = this.views.map(() => ({ x: 0, y: 0, z: 0 }));

    const finishWhen: FinishMode = humanCount > 1 ? "allHumans" : "leader";
    this.race = new RaceManager({ kartCount, targetLaps: TARGET_LAPS, finishWhen, humanCount });

    this.raceHuds = [];
    for (let i = 0; i < humanCount; i++) {
      const a = viewHudAnchor(rects[i]!, "top-left", w, h);
      this.raceHuds.push(
        new RaceHud(this.container, TARGET_LAPS, kartCount, {
          left: a.left + SPEED_OFFSET,
          top: a.top + HUD_OFFSET,
        }),
      );
    }

    this.placeMinimap(w, h);
    this.audio.setHumanCount(humanCount);
    this.gameAudio.setSources(this.views, this.rivals, this.humanCount);

    // 053 kart action VFX: one Points for the whole field. Tier defaults high
    // (commit 4 wires the live quality tier). Pooled sample slots for updateVfx.
    this.vfx = new KartVfx({ kartCount, tier: "high", seed: AI_BASE_SEED });
    this.scene.add(this.vfx.group);
    this.vfxSamples.length = 0;
    for (let i = 0; i < kartCount; i++) this.vfxSamples.push(makeVfxSample());

    // 053 commit 3: drift skid marks (layer 1 decals); reuses pooled samples.
    this.skid = new SkidMarks({ kartCount, tier: "high", seed: AI_BASE_SEED });
    this.scene.add(this.skid.group);

    // Prime the broadphase so every kart's first suspension raycast hits.
    this.physics.step();
    this.results.style.display = "none";
  }

  dispose(): void {
    for (const v of this.views) {
      this.physics.world.removeRigidBody(v.kart.controller.body);
      this.scene.remove(v.kart.group);
      v.removeHud();
    }
    for (const r of this.rivals) {
      this.physics.world.removeRigidBody(r.controller.body);
      this.scene.remove(r.group);
    }
    for (const hud of this.raceHuds) hud.remove();
    this.views = [];
    this.rivals = [];
    this.raceHuds = [];
    this.aiAheadBuf = [];
    this.aiRivalsBuf = [];
    this.audioHumanBuf = [];
    this.audioRivalBuf = [];
    this.lisPos = [];
    this.lisFwd = [];
    this.lisVel = [];
    this.vfx?.dispose();
    if (this.vfx !== undefined) {
      this.scene.remove(this.vfx.group);
      this.vfx = undefined;
    }
    this.vfxSamples.length = 0;
    this.skid?.dispose();
    if (this.skid !== undefined) {
      this.scene.remove(this.skid.group);
      this.skid = undefined;
    }
  }

  /** 2P centers the minimap on the seam; 1P keeps the default bottom-right. */
  placeMinimap(w: number, h: number): void {
    if (this.humanCount <= 1) return;
    const size = 160;
    this.minimap.place({ left: w / 2 - size / 2, top: h / 2 - size / 2 });
  }

  /** Push minimap blips from the live kart grid (humans + rivals). */
  updateMinimap(): void {
    const blips: MinimapKart[] = [];
    for (let i = 0; i < this.views.length; i++) {
      const k = this.views[i]!.kart;
      blips.push({ x: k.group.position.x, z: k.group.position.z, player: i === 0 });
    }
    for (const r of this.rivals) {
      blips.push({ x: r.group.position.x, z: r.group.position.z, player: false });
    }
    this.minimap.update(blips);
  }

  /** One fixed physics sub-step: humans + rivals + race progress + world step. */
  stepWorld(
    step: number,
    driving: boolean,
    inputs: KartInput[],
    time: number,
    state: GameState,
  ): void {
    const poses: KartRacePose[] = [];
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!;
      const finished = this.race.progressOf(i).finished;
      const inp = driving && !finished ? inputs[i]! : zeroInput();
      v.kart.fixedUpdate(step, inp, driving && !finished);
      if (inp.reset) this.gameAudio.onRespawn();
      if (v.kart.controller.life <= 0) {
        this.respawnAhead(v.kart);
        v.kart.controller.resetLife();
      }
      poses.push(this.racePose(v.kart));
    }

    for (let i = 0; i < this.rivals.length; i++) {
      const rival = this.rivals[i]!;
      const close = this.terrain.closestPose(
        rival.group.position.x,
        rival.group.position.z,
        this.poseOut,
      );
      poses.push({ t: close.t, speed: rival.speed });

      if (driving) {
        const stuckSec = this.tickStuck(i, rival.speed, close.dist, step);
        const fwd = rival.forwardDir;
        const tuning = withSpeedScale(
          this.aiTunings[i]!,
          this.race.rubberBandScale(this.humanCount + i),
        );
        const ai = produceInput(
          {
            pos: { x: rival.group.position.x, z: rival.group.position.z },
            forward: { x: fwd.x, z: fwd.z },
            speed: rival.speed,
            corridorDist: close.dist,
            stuckSeconds: stuckSec,
          },
          this.sampleAhead(close.t, this.aiAheadBuf[i]!),
          this.rivalPositions(i, this.aiRivalsBuf[i]!),
          tuning,
          this.aiRngs[i]!,
        );
        if (ai.reset) {
          this.respawnAhead(rival);
          rival.fixedUpdate(step, zeroInput());
        } else {
          rival.fixedUpdate(step, ai, driving);
        }
      } else {
        rival.fixedUpdate(step, zeroInput());
      }
      if (driving && rival.controller.life <= 0) {
        this.respawnAhead(rival);
        rival.controller.resetLife();
      }
    }

    if (driving) this.race.update(step, poses);

    // Countdown: zero XZ velocity so the whole grid settles (keeps Y to drop).
    if (state === "countdown") {
      for (const v of this.views) this.zeroHorizontalLinvel(v.kart);
      for (const r of this.rivals) this.zeroHorizontalLinvel(r);
    }

    this.physics.step();
    this.gameAudio.flush(this.physics, time, state, this.race.phase);
  }

  /**
   * Per-human audio states (zeros while not driving). Writes into a pooled
   * PlayerAudioState[] (built in build()); consumers read synchronously.
   */
  humanAudioStates(driving: boolean, inputs: KartInput[]): PlayerAudioState[] {
    const buf = this.audioHumanBuf;
    for (let i = 0; i < this.views.length; i++) {
      const s = buf[i]!;
      if (driving) {
        const v = this.views[i]!;
        s.speed = v.kart.speed;
        s.throttle = inputs[i]!.throttle;
        s.drifting = v.kart.controller.isDrifting;
      } else {
        s.speed = 0;
        s.throttle = 0;
        s.drifting = false;
      }
    }
    return buf;
  }

  /**
   * Per-rival audio states. Rivals are AI always-on-throttle while racing ->
   * throttle 1 + live pos/vel/speed; zeros otherwise (mirrors humanAudioStates
   * gating). Drift is unused by the engine-only rival voice but kept for shape
   * parity with RivalAudioState. Writes into a pooled RivalAudioState[].
   */
  rivalAudioStates(driving: boolean): RivalAudioState[] {
    const buf = this.audioRivalBuf;
    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i]!;
      const p = r.group.position;
      const lv = r.controller.body.linvel();
      const s = buf[i]!;
      s.pos.x = p.x;
      s.pos.y = p.y;
      s.pos.z = p.z;
      s.vel.x = lv.x;
      s.vel.y = lv.y;
      s.vel.z = lv.z;
      s.speed = driving ? r.speed : 0;
      s.throttle = driving ? 1 : 0;
      s.drifting = driving ? r.controller.isDrifting : false;
    }
    return buf;
  }

  /** World-space midpoint of all human karts (shadow target). */
  humansMidpoint(): THREE.Vector3 {
    const p = this.tmpV.set(0, 0, 0);
    for (const v of this.views) p.add(v.kart.group.position);
    if (this.views.length > 0) p.multiplyScalar(1 / this.views.length);
    return p;
  }

  /**
   * Listener transform for 015 positional audio: human midpoint pos/forward/vel.
   * 1P = the single human kart; 2P = midpoint of both humans (documented
   * single-listener compromise). THREE.Vector3 + Rapier linvel() both expose
   * x/y/z -> structurally compatible with the pure helper's Vec3. Writes into
   * pooled arrays + a pooled ListenerTransform output (built in build()).
   */
  listenerTransform(): ListenerTransform {
    const vel = this.lisVel;
    for (let i = 0; i < this.views.length; i++) {
      const lv = this.views[i]!.kart.controller.body.linvel();
      const slot = vel[i]!;
      slot.x = lv.x;
      slot.y = lv.y;
      slot.z = lv.z;
    }
    return listenerMidpoint(this.lisPos, this.lisFwd, this.lisVel, this.lisOut);
  }

  private racePose(kart: Kart): KartRacePose {
    const p = kart.group.position;
    const close = this.terrain.closestPose(p.x, p.z, this.poseOut);
    return { t: close.t, speed: kart.speed };
  }

  private tickStuck(i: number, speed: number, corridorDist: number, step: number): number {
    const tuning = this.aiTunings[i]!;
    if (speed < tuning.stuckSpeed && corridorDist > CORRIDOR_HALF_WIDTH) {
      this.stuckAccum[i] = this.stuckAccum[i]! + step;
    } else {
      this.stuckAccum[i] = 0;
    }
    return this.stuckAccum[i]!;
  }

  private sampleAhead(t: number, buf: AiSplinePoint[]): AiSplinePoint[] {
    const out = this.tmpV;
    for (let i = 0; i < AI_AHEAD_SAMPLES; i++) {
      const p = this.terrain.spline.getPoint(wrap01(t + (i + 1) * AI_AHEAD_STEP), out);
      const slot = buf[i]!;
      slot.x = p.x;
      slot.z = p.z;
    }
    return buf;
  }

  /** All other kart positions (humans + other rivals) for AI avoidance. */
  private rivalPositions(exclude: number, buf: AiRival[]): AiRival[] {
    let k = 0;
    for (const v of this.views) {
      const slot = buf[k]!;
      slot.x = v.kart.group.position.x;
      slot.z = v.kart.group.position.z;
      k++;
    }
    for (let i = 0; i < this.rivals.length; i++) {
      if (i === exclude) continue;
      const r = this.rivals[i]!;
      const slot = buf[k]!;
      slot.x = r.group.position.x;
      slot.z = r.group.position.z;
      k++;
    }
    return buf;
  }

  respawnAhead(rival: Kart): void {
    const p = rival.group.position;
    const close = this.terrain.closestPose(p.x, p.z, this.poseOut);
    const t = wrap01(close.t + RESPAWN_AHEAD_T);
    const point = this.terrain.spline.getPoint(t, this.tmpV);
    const tan = this.terrain.spline.curve.getTangent(t).normalize();
    const y = this.terrain.heightAt(point.x, point.z) + RESPAWN_CLEARANCE;
    const yaw = Math.atan2(-tan.x, -tan.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP_Y, yaw);
    const body = rival.controller.body;
    body.setTranslation({ x: point.x, y, z: point.z }, true);
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // Snap the interpolation source to the teleported pose so the next sync()
    // doesn't lerp across the respawn gap (022 physics->visual interpolation).
    rival.capturePrevPose();
    this.gameAudio.onRespawn();
    this.vfx?.burst("poof", point);
  }

  private zeroHorizontalLinvel(kart: Kart): void {
    const b = kart.controller.body;
    const lv = b.linvel();
    b.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }

  /**
   * Per-frame kart action VFX (053): fill pooled samples from views + rivals,
   * then advance the GPU particle ring. `driving` zeros emission inputs while
   * the race is not active (menu/countdown/finish) so idle karts stay clean.
   */
  updateVfx(dt: number, time: number, driving: boolean): void {
    const vfx = this.vfx;
    if (vfx === undefined) return;
    const samples = this.vfxSamples;
    let i = 0;
    for (const v of this.views) fillKartVfxSample(samples[i++]!, v.kart, this.terrain, driving);
    for (const r of this.rivals) fillKartVfxSample(samples[i++]!, r, this.terrain, driving);
    vfx.update(dt, time, samples);
    this.skid?.update(dt, time, samples, this.terrain);
  }

  private createSpeedEl(rect: Rect, playerIndex: number): HTMLElement {
    const a = viewHudAnchor(rect, "top-left", window.innerWidth, window.innerHeight);
    const el = document.createElement("div");
    el.className = "gc-speed";
    el.dataset.player = String(playerIndex);
    el.style.cssText =
      "position:absolute;" +
      `left:${a.left + SPEED_OFFSET}px;top:${a.top + SPEED_OFFSET}px;z-index:5;` +
      "font-family:system-ui,sans-serif;color:#fff;pointer-events:none;" +
      "text-shadow:0 2px 6px rgba(0,0,0,0.8);font-size:28px;font-weight:700";
    el.style.display = "none";
    el.textContent = "0 km/h";
    return el;
  }
}
