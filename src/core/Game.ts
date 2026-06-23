import * as THREE from "three";
import { Renderer, splitRects, type Rect } from "./Renderer";
import { Input, zeroInput } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { Kart } from "../kart/Kart";
import { computeGrid, type GridPath } from "../kart/KartGrid";
import { ChaseCamera } from "../kart/ChaseCamera";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager, type PlayerAudioState } from "../audio/AudioManager";
import { GameAudioDriver } from "../audio/gameAudio";
import { StartMenu, type GameMode } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { RaceHud, type HudState } from "../ui/RaceHud";
import { Minimap, type MinimapKart } from "../ui/Minimap";
import { PlayerView, viewHudAnchor } from "./PlayerView";
import { transition, type GameState } from "./gameState";
import { clamp } from "./math";
import { makeRNG, type RNG } from "./rng";
import { wrap01 } from "../race/checkpoints";
import {
  RaceManager,
  DEFAULT_TARGET_LAPS,
  type FinishMode,
  type KartRacePose,
} from "../race/raceManager";
import { produceInput, type AiSplinePoint, type AiRival } from "../race/AiDriver";
import { makeAiTuning, withSpeedScale } from "../race/aiTuning";

const STEP = 1 / 60;
/** Scenic point on the spline the menu camera orbits (t = 0.5). */
const MENU_CAM_T = 0.5;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;

// Race configuration.
const TARGET_FIELD = 6; // total karts (humans + rivals)
const TARGET_LAPS = DEFAULT_TARGET_LAPS;
const AI_BASE_SEED = 1337;
const AI_AHEAD_SAMPLES = 16;
const AI_AHEAD_STEP = 0.008; // ~3 m steps along the ~377 m loop
const RESPAWN_AHEAD_T = 0.015; // respawn a bit past the nearest spline point
const CORRIDOR_HALF_WIDTH = 6; // matches trackHalfWidth (003) + AiDriver
const RESPAWN_CLEARANCE = 1.5;
const SPEED_OFFSET = 14; // px from the viewport corner to the speed readout
const HUD_OFFSET = 58; // px from the viewport corner to the race HUD

export class Game {
  private readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  private readonly input = new Input();
  private readonly terrain: Terrain;
  private readonly env: Environment;
  private readonly menuCamera: MenuCamera;
  private readonly startMenu: StartMenu;
  private readonly countdown: Countdown;
  private readonly minimap: Minimap;
  private readonly results: HTMLElement;
  private readonly container: HTMLElement;
  /** Procedural audio. Public so dev console can drive resume()/beeps. */
  readonly audio: AudioManager;
  private readonly gameAudio: GameAudioDriver;

  // Per-field state (rebuilt when the mode changes at onStart).
  private views: PlayerView[] = [];
  private rivals: Kart[] = [];
  private race!: RaceManager;
  private raceHuds: RaceHud[] = [];
  private aiTunings: ReturnType<typeof makeAiTuning>[] = [];
  private aiRngs: RNG[] = [];
  private stuckAccum: number[] = [];
  private humanCount = 1;

  private state: GameState = "menu";
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private running = false;
  private resultsShown = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld(-24);
    this.terrain = new Terrain(this.physics);
    this.renderer.scene.add(this.terrain.group);

    this.env = new Environment(this.physics, this.terrain, {
      water: { level: this.terrain.waterLevel },
    });
    this.renderer.scene.add(this.env.group);

    // Audio + results overlay exist before buildField (buildField sets the
    // voice count + resets the results overlay on a mode rebuild).
    this.audio = new AudioManager();
    this.audio.setEngineActive(false); // engine off until racing
    this.gameAudio = new GameAudioDriver(this.audio);
    this.results = this.createResults();
    this.results.style.display = "none";
    container.appendChild(this.results);

    this.buildField(1);

    const menuTarget = this.terrain.spline.getPoint(MENU_CAM_T);
    this.menuCamera = new MenuCamera({
      aspect: window.innerWidth / window.innerHeight,
      target: menuTarget,
      altitude: MENU_CAM_ALTITUDE,
      radius: MENU_CAM_RADIUS,
    });

    this.minimap = new Minimap(container, {
      getPoint: (t) => {
        const p = this.terrain.spline.getPoint(t);
        return { x: p.x, z: p.z };
      },
    });

    this.startMenu = new StartMenu(container, this.audio, this.onStart);
    this.countdown = new Countdown(container, this.audio);

    window.addEventListener("resize", this.onResize);
  }

  get currentState(): GameState {
    return this.state;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.disposeField();
    this.startMenu.remove();
    this.countdown.remove();
    this.minimap.remove();
    this.results.remove();
    this.env.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- field build/teardown (mode-dependent) -------------------------------

  private gridPath(): GridPath {
    return {
      getPoint: (t, out) => this.terrain.spline.getPoint(t, out),
      getTangent: (t) => this.terrain.spline.curve.getTangent(t),
    };
  }

  /**
   * Build the kart field for `humanCount` humans. Slots 0..humanCount-1 are
   * humans (PlayerView[] with chase cam + speed HUD + viewport rect); the rest
   * are AI rivals. Rebuilds the RaceManager (mode-dependent finish), per-view
   * RaceHuds, the shared minimap placement, and the audio voice count.
   */
  private buildField(humanCount: number): void {
    this.humanCount = humanCount;
    const kartCount = TARGET_FIELD;
    const grid = computeGrid(this.gridPath(), (x, z) => this.terrain.heightAt(x, z), kartCount);
    const [w, h] = [window.innerWidth, window.innerHeight];
    const rects = splitRects(w, h, "horizontal", humanCount);

    this.views = [];
    for (let i = 0; i < humanCount; i++) {
      const s = grid[i]!;
      const kart = new Kart(this.physics, s.pos, s.yaw, i);
      this.renderer.scene.add(kart.group);
      const chaseCam = new ChaseCamera(rectAspect(rects[i]!));
      const speedEl = this.createSpeedEl(rects[i]!, i);
      this.container.appendChild(speedEl);
      this.views.push(new PlayerView(kart, chaseCam, rects[i]!, speedEl));
    }

    this.rivals = [];
    for (let i = humanCount; i < kartCount; i++) {
      const s = grid[i]!;
      const rival = new Kart(this.physics, s.pos, s.yaw, i);
      this.renderer.scene.add(rival.group);
      this.rivals.push(rival);
    }

    this.aiTunings = this.rivals.map((_, i) => makeAiTuning(AI_BASE_SEED, i + 1));
    this.aiRngs = this.rivals.map((_, i) =>
      makeRNG((AI_BASE_SEED ^ Math.imul(i + 2, 0x9e3779b1)) >>> 0),
    );
    this.stuckAccum = this.rivals.map(() => 0);

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
    this.gameAudio.setSources(this.views, this.rivals, this.humanCount); // 009 impacts

    // Prime the broadphase so every kart's first suspension raycast hits.
    this.physics.step();
    this.resultsShown = false;
    this.results.style.display = "none";
  }

  private disposeField(): void {
    for (const v of this.views) {
      this.physics.world.removeRigidBody(v.kart.controller.body);
      this.renderer.scene.remove(v.kart.group);
      v.removeHud();
    }
    for (const r of this.rivals) {
      this.physics.world.removeRigidBody(r.controller.body);
      this.renderer.scene.remove(r.group);
    }
    for (const hud of this.raceHuds) hud.remove();
    this.views = [];
    this.rivals = [];
    this.raceHuds = [];
  }

  /** 2P centers the minimap on the seam; 1P keeps the default bottom-right. */
  private placeMinimap(w: number, h: number): void {
    if (this.humanCount <= 1) return;
    const size = 160;
    this.minimap.place({ left: w / 2 - size / 2, top: h / 2 - size / 2 });
  }

  // --- main loop ------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const racing = this.state === "racing";
    const driving = racing && this.race.phase === "racing";

    this.input.beginFrame();
    const inputs = this.views.map((_, i) => (driving ? this.input.sample(i) : zeroInput()));

    if (this.state !== "menu") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.stepWorld(STEP, driving, inputs);
        this.acc -= STEP;
        steps++;
      }
    }

    if (this.state === "countdown" && this.countdown.update(dt) === "done") {
      this.onCountdownDone();
    }

    for (const v of this.views) v.sync(1);
    for (const r of this.rivals) r.sync(1);

    if (racing) {
      for (const v of this.views) v.updateCamera(dt);
      const mid = this.humansMidpoint();
      this.renderer.setShadowTarget(mid.x, mid.z);
      this.renderer.renderViews(
        this.views.map((v) => ({ camera: v.chaseCam.camera, rect: v.rect })),
      );
    } else {
      this.menuCamera.update(dt);
      this.renderer.render(this.menuCamera.camera);
    }

    this.time += dt;
    this.env.update(dt, this.time);
    this.audio.updatePlayers(dt, this.humanAudioStates(driving, inputs));

    this.updateHudVisibility(racing);
    if (racing) {
      this.updateSpeedHuds();
      this.updateRaceUi();
    }
    this.input.endFrame();
  };

  /** One fixed physics sub-step: humans + rivals + race progress + world step. */
  private stepWorld(step: number, driving: boolean, inputs: ReturnType<Input["sample"]>[]): void {
    const poses: KartRacePose[] = [];
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!;
      const finished = this.race.progressOf(i).finished;
      const inp = driving && !finished ? inputs[i]! : zeroInput();
      v.kart.fixedUpdate(step, inp);
      poses.push(this.racePose(v.kart));
    }

    for (let i = 0; i < this.rivals.length; i++) {
      const rival = this.rivals[i]!;
      const close = this.terrain.spline.closestPoint(
        rival.group.position.x,
        rival.group.position.z,
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
          this.sampleAhead(close.t),
          this.rivalPositions(i),
          tuning,
          this.aiRngs[i]!,
        );
        if (ai.reset) {
          this.respawnAhead(rival);
          rival.fixedUpdate(step, zeroInput());
        } else {
          rival.fixedUpdate(step, ai);
        }
      } else {
        rival.fixedUpdate(step, zeroInput());
      }
    }

    if (driving) this.race.update(step, poses);

    // Countdown: zero XZ velocity so the whole grid settles (keeps Y to drop).
    if (this.state === "countdown") {
      for (const v of this.views) this.zeroHorizontalLinvel(v.kart);
      for (const r of this.rivals) this.zeroHorizontalLinvel(r);
    }

    this.physics.step();
    this.gameAudio.flush(this.physics, this.time); // 009 impact SFX
  }

  /** Per-human audio states (zeros while not driving). */
  private humanAudioStates(
    driving: boolean,
    inputs: ReturnType<Input["sample"]>[],
  ): PlayerAudioState[] {
    return this.views.map((v, i) =>
      driving
        ? {
            speed: v.kart.speed,
            throttle: inputs[i]!.throttle,
            drifting: v.kart.controller.isDrifting,
          }
        : { speed: 0, throttle: 0, drifting: false },
    );
  }

  /** World-space midpoint of all human karts (shadow target). */
  private humansMidpoint(): THREE.Vector3 {
    const p = this.tmpV.set(0, 0, 0);
    for (const v of this.views) p.add(v.kart.group.position);
    if (this.views.length > 0) p.multiplyScalar(1 / this.views.length);
    return p;
  }

  private racePose(kart: Kart): KartRacePose {
    const p = kart.group.position;
    const close = this.terrain.spline.closestPoint(p.x, p.z);
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

  private sampleAhead(t: number): AiSplinePoint[] {
    const pts: AiSplinePoint[] = [];
    const out = this.tmpV;
    for (let i = 1; i <= AI_AHEAD_SAMPLES; i++) {
      const p = this.terrain.spline.getPoint(wrap01(t + i * AI_AHEAD_STEP), out);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  }

  /** All other kart positions (humans + other rivals) for AI avoidance. */
  private rivalPositions(exclude: number): AiRival[] {
    const out: AiRival[] = [];
    for (const v of this.views) {
      out.push({ x: v.kart.group.position.x, z: v.kart.group.position.z });
    }
    for (let i = 0; i < this.rivals.length; i++) {
      if (i === exclude) continue;
      const r = this.rivals[i]!;
      out.push({ x: r.group.position.x, z: r.group.position.z });
    }
    return out;
  }

  private respawnAhead(rival: Kart): void {
    const p = rival.group.position;
    const close = this.terrain.spline.closestPoint(p.x, p.z);
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
  }

  private zeroHorizontalLinvel(kart: Kart): void {
    const b = kart.controller.body;
    const lv = b.linvel();
    b.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }

  private onStart = (mode: GameMode): void => {
    const humanCount = mode === "2P" ? 2 : 1;
    if (humanCount !== this.humanCount) {
      this.disposeField();
      this.buildField(humanCount);
    }
    this.audio.resume();
    this.state = transition(this.state, "start"); // menu -> countdown
    this.audio.setEngineActive(false);
    this.startMenu.hide();
    this.countdown.show();
  };

  private onCountdownDone = (): void => {
    this.state = transition(this.state, "countdownDone"); // countdown -> racing
    this.audio.setEngineActive(true);
    this.countdown.hide();
    this.race.startRace();
    for (const hud of this.raceHuds) hud.show();
    this.minimap.show();
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.menuCamera.setAspect(w / h);
    const rects = splitRects(w, h, "horizontal", this.humanCount);
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!;
      v.rect = rects[i]!;
      v.chaseCam.setAspect(rectAspect(rects[i]!));
      const a = viewHudAnchor(rects[i]!, "top-left", w, h);
      v["speedEl"]!.style.left = `${a.left + SPEED_OFFSET}px`;
      v["speedEl"]!.style.top = `${a.top + SPEED_OFFSET}px`;
    }
    for (let i = 0; i < this.raceHuds.length; i++) {
      const a = viewHudAnchor(rects[i]!, "top-left", w, h);
      const root = this.raceHuds[i]!["root"] as HTMLElement;
      root.style.left = `${a.left + SPEED_OFFSET}px`;
      root.style.top = `${a.top + HUD_OFFSET}px`;
    }
    this.placeMinimap(w, h);
  };

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

  private createResults(): HTMLElement {
    const el = document.createElement("div");
    el.className = "gc-results";
    el.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:10",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "pointer-events:none",
      "font-family:system-ui,sans-serif",
      "font-weight:800",
      "font-size:clamp(28px,5vw,56px)",
      "color:#fff",
      "text-shadow:0 4px 18px rgba(0,0,0,0.85)",
      "text-align:center",
    ].join(";");
    return el;
  }

  private updateHudVisibility(racing: boolean): void {
    for (const v of this.views) {
      (v["speedEl"] as HTMLElement).style.display = racing ? "block" : "none";
    }
  }

  private updateSpeedHuds(): void {
    for (const v of this.views) {
      const kmh = Math.round(clamp(v.kart.speed, 0, 999) * 3.6);
      v.setSpeed(kmh);
    }
  }

  /** Refresh per-view race HUDs + minimap; reveal results once finished. */
  private updateRaceUi(): void {
    const snap = this.race.snapshot();
    for (let i = 0; i < this.raceHuds.length; i++) {
      const lap = Math.min(snap.progress[i]!.lap + 1, TARGET_LAPS);
      const hudState: HudState = {
        lap,
        targetLaps: TARGET_LAPS,
        position: snap.positions[i]!,
        totalKarts: TARGET_FIELD,
        timer: snap.timer,
      };
      this.raceHuds[i]!.update(hudState);
    }

    const blips: MinimapKart[] = [];
    for (let i = 0; i < this.views.length; i++) {
      const k = this.views[i]!.kart;
      blips.push({ x: k.group.position.x, z: k.group.position.z, player: i === 0 });
    }
    for (const r of this.rivals) {
      blips.push({ x: r.group.position.x, z: r.group.position.z, player: false });
    }
    this.minimap.update(blips);

    if (snap.phase === "finished" && !this.resultsShown) {
      this.resultsShown = true;
      this.results.textContent = this.resultsText(snap);
      this.results.style.display = "flex";
    }
  }

  private resultsText(snap: ReturnType<RaceManager["snapshot"]>): string {
    const parts = this.views.map((_, i) => {
      const pos = snap.positions[i]!;
      return `P${i + 1}: ${ordinal(pos)}`;
    });
    return parts.join("   ");
  }

  private readonly tmpV = new THREE.Vector3();
}

function rectAspect(rect: Rect): number {
  return rect.w / rect.h;
}

const UP_Y = new THREE.Vector3(0, 1, 0);

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
