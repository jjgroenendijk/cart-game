import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Input, zeroInput } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { Kart } from "../kart/Kart";
import { computeGrid, type GridPath, type Spawn } from "../kart/KartGrid";
import { ChaseCamera } from "../kart/ChaseCamera";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager } from "../audio/AudioManager";
import { StartMenu } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { RaceHud, type HudState } from "../ui/RaceHud";
import { Minimap, type MinimapKart } from "../ui/Minimap";
import { transition, type GameState } from "./gameState";
import { clamp } from "./math";
import { makeRNG, type RNG } from "./rng";
import { wrap01 } from "../race/checkpoints";
import { RaceManager, DEFAULT_TARGET_LAPS, type KartRacePose } from "../race/raceManager";
import { produceInput, type AiSplinePoint, type AiRival } from "../race/AiDriver";
import { makeAiTuning, withSpeedScale } from "../race/aiTuning";

const STEP = 1 / 60;
/** Scenic point on the spline the menu camera orbits (t = 0.5). */
const MENU_CAM_T = 0.5;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;

// 007 race configuration.
const RIVAL_COUNT = 5; // 6 karts total (P1 + 5 rivals)
const TARGET_LAPS = DEFAULT_TARGET_LAPS;
const AI_BASE_SEED = 1337;
const AI_AHEAD_SAMPLES = 16;
const AI_AHEAD_STEP = 0.008; // ~3 m steps along the ~377 m loop
const RESPAWN_AHEAD_T = 0.015; // respawn a bit past the nearest spline point
const CORRIDOR_HALF_WIDTH = 6; // matches trackHalfWidth (003) + AiDriver
const RESPAWN_CLEARANCE = 1.5;

export class Game {
  private readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  private readonly input = new Input();
  private readonly terrain: Terrain;
  private readonly env: Environment;
  private readonly kart: Kart;
  private readonly rivals: Kart[] = [];
  private readonly chaseCamera: ChaseCamera;
  private readonly menuCamera: MenuCamera;
  private readonly startMenu: StartMenu;
  private readonly countdown: Countdown;
  private readonly hud: HTMLElement;
  private readonly raceHud: RaceHud;
  private readonly minimap: Minimap;
  private readonly results: HTMLElement;
  private readonly race: RaceManager;
  private readonly aiTunings;
  private readonly aiRngs: RNG[] = [];
  private readonly stuckAccum: number[];
  /** Procedural audio. Public so dev console can drive resume()/beeps. */
  readonly audio: AudioManager;
  private state: GameState = "menu";
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private running = false;
  private resultsShown = false;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld(-24);
    this.terrain = new Terrain(this.physics);
    this.renderer.scene.add(this.terrain.group);

    this.env = new Environment(this.physics, this.terrain, {
      water: { level: this.terrain.waterLevel },
    });
    this.renderer.scene.add(this.env.group);

    // 007 grid: P1 (pole) + RIVAL_COUNT rivals, staged behind the start line.
    const gridPath: GridPath = {
      getPoint: (t, out) => this.terrain.spline.getPoint(t, out),
      getTangent: (t) => this.terrain.spline.curve.getTangent(t),
    };
    const kartCount = 1 + RIVAL_COUNT;
    const grid = computeGrid(gridPath, (x, z) => this.terrain.heightAt(x, z), kartCount);

    const p1Spawn = grid[0] ?? defaultSpawn(this.terrain);
    this.kart = new Kart(this.physics, p1Spawn.pos, p1Spawn.yaw, 0);
    this.renderer.scene.add(this.kart.group);
    for (let i = 1; i < kartCount; i++) {
      const s = grid[i]!;
      const rival = new Kart(this.physics, s.pos, s.yaw, i);
      this.renderer.scene.add(rival.group);
      this.rivals.push(rival);
    }

    // 007 AI personalities (deterministic per seed+index) + per-rival rng.
    this.aiTunings = this.rivals.map((_, i) => makeAiTuning(AI_BASE_SEED, i + 1));
    this.aiRngs = this.rivals.map((_, i) =>
      makeRNG((AI_BASE_SEED ^ Math.imul(i + 2, 0x9e3779b1)) >>> 0),
    );
    this.stuckAccum = this.rivals.map(() => 0);

    // 007 race orchestrator + overlays (hidden until racing).
    this.race = new RaceManager({ kartCount, targetLaps: TARGET_LAPS });
    this.raceHud = new RaceHud(container, TARGET_LAPS, kartCount);
    this.minimap = new Minimap(container, {
      getPoint: (t) => {
        const p = this.terrain.spline.getPoint(t);
        return { x: p.x, z: p.z };
      },
    });
    this.results = this.createResults();
    this.results.style.display = "none";
    container.appendChild(this.results);

    // Menu camera orbits a scenic spline point (sampled once; no per-frame
    // spline cost). ChaseCamera stays separate so it snaps to the kart on the
    // first racing frame instead of lerping from the menu pose.
    const menuTarget = this.terrain.spline.getPoint(MENU_CAM_T);
    this.menuCamera = new MenuCamera({
      aspect: window.innerWidth / window.innerHeight,
      target: menuTarget,
      altitude: MENU_CAM_ALTITUDE,
      radius: MENU_CAM_RADIUS,
    });
    this.chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);

    this.hud = this.createHud();
    this.hud.style.display = "none"; // hidden in menu/countdown
    container.appendChild(this.hud);

    // 005 procedural audio. Built silent: no AudioContext until resume() is
    // called from a user gesture (Start). maxSpeed feeds the engine-curve +
    // wind scaling so audio tracks the kart tuning.
    this.audio = new AudioManager({
      engine: { maxSpeed: this.kart.controller.tuning.maxSpeed },
    });
    this.audio.setEngineActive(false); // engine off until racing

    // 006 menu + countdown overlays sit above the canvas at z 10.
    this.startMenu = new StartMenu(container, this.audio, this.onStart);
    this.countdown = new Countdown(container, this.audio);

    // Prime the broadphase so every kart's first suspension raycast hits
    // (Rapier queries return null until the world has stepped once).
    this.physics.step();

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
    this.startMenu.remove();
    this.countdown.remove();
    this.raceHud.remove();
    this.minimap.remove();
    this.results.remove();
    for (const r of this.rivals) {
      this.physics.world.removeRigidBody(r.controller.body);
      this.renderer.scene.remove(r.group);
    }
    this.env.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const racing = this.state === "racing";
    const driving = racing && this.race.phase === "racing";

    this.input.beginFrame();
    const p1Input = driving ? this.input.sample(0) : zeroInput();

    // Physics only when not in the menu. Countdown settles every kart onto the
    // surface with zero input + zeroed XZ linvel (keeps Y so it can drop) so it
    // reads resting on the grid and avoids a lurch at GO.
    if (this.state !== "menu") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.stepWorld(STEP, driving, p1Input);
        this.acc -= STEP;
        steps++;
      }
    }

    // Drive the countdown timer; enter racing on completion.
    if (this.state === "countdown" && this.countdown.update(dt) === "done") {
      this.onCountdownDone();
    }

    this.kart.sync(1);
    for (const r of this.rivals) r.sync(1);
    const pos = this.kart.group.position;

    // Pick the camera by state: cinematic menu cam until racing, then chase.
    if (racing) {
      this.chaseCamera.update(
        dt,
        pos,
        this.kart.forwardDir,
        this.kart.speed,
        this.kart.controller.isDrifting,
      );
      this.renderer.setShadowTarget(pos.x, pos.z);
      this.renderer.render(this.chaseCamera.camera);
    } else {
      this.menuCamera.update(dt);
      this.renderer.render(this.menuCamera.camera);
    }

    this.time += dt;
    this.env.update(dt, this.time);
    this.audio.update(
      dt,
      driving
        ? {
            speed: this.kart.speed,
            throttle: p1Input.throttle,
            drifting: this.kart.controller.isDrifting,
          }
        : { speed: 0, throttle: 0, drifting: false },
    );

    this.hud.style.display = racing ? "block" : "none";
    if (racing) {
      this.updateHud();
      this.updateRaceUi();
    }
    this.input.endFrame();
  };

  /** One fixed physics sub-step: P1 + rivals + race progress + world step. */
  private stepWorld(step: number, driving: boolean, p1Input: ReturnType<Input["sample"]>): void {
    this.kart.fixedUpdate(step, driving ? p1Input : zeroInput());

    const poses: KartRacePose[] = [];
    poses.push(this.racePose(this.kart));
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
        const tuning = withSpeedScale(this.aiTunings[i]!, this.race.rubberBandScale(i + 1));
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
      this.zeroHorizontalLinvel(this.kart);
      for (const r of this.rivals) this.zeroHorizontalLinvel(r);
    }

    this.physics.step();
  }

  /** Arc-length pose (t + speed) for the race manager. */
  private racePose(kart: Kart): KartRacePose {
    const p = kart.group.position;
    const close = this.terrain.spline.closestPoint(p.x, p.z);
    return { t: close.t, speed: kart.speed };
  }

  /** Accumulate stuck time per rival; reset when conditions clear. */
  private tickStuck(i: number, speed: number, corridorDist: number, step: number): number {
    const tuning = this.aiTunings[i]!;
    if (speed < tuning.stuckSpeed && corridorDist > CORRIDOR_HALF_WIDTH) {
      this.stuckAccum[i] = this.stuckAccum[i]! + step;
    } else {
      this.stuckAccum[i] = 0;
    }
    return this.stuckAccum[i]!;
  }

  /** Sample AI_AHEAD_SAMPLES points along the spline ahead of t (wrapped). */
  private sampleAhead(t: number): AiSplinePoint[] {
    const pts: AiSplinePoint[] = [];
    const out = this.tmpV;
    for (let i = 1; i <= AI_AHEAD_SAMPLES; i++) {
      const p = this.terrain.spline.getPoint(wrap01(t + i * AI_AHEAD_STEP), out);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  }

  /** Other kart positions (P1 + other rivals) for AI avoidance. */
  private rivalPositions(exclude: number): AiRival[] {
    const out: AiRival[] = [];
    out.push({ x: this.kart.group.position.x, z: this.kart.group.position.z });
    for (let i = 0; i < this.rivals.length; i++) {
      if (i === exclude) continue;
      const r = this.rivals[i]!;
      out.push({ x: r.group.position.x, z: r.group.position.z });
    }
    return out;
  }

  /** Reposition a stuck rival ahead on the spline (terrain-aware), zeroed. */
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

  /** Zero XZ linear velocity so a kart can't drift while settling (keeps Y). */
  private zeroHorizontalLinvel(kart: Kart): void {
    const b = kart.controller.body;
    const lv = b.linvel();
    b.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }

  private onStart = (): void => {
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
    this.raceHud.show();
    this.minimap.show();
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.chaseCamera.setAspect(w / h);
    this.menuCamera.setAspect(w / h);
  };

  private createHud(): HTMLElement {
    const hud = document.createElement("div");
    hud.id = "hud";
    hud.style.cssText = [
      "position:absolute",
      "left:14px",
      "top:14px",
      "z-index:5",
      "font-family:system-ui,sans-serif",
      "color:#fff",
      "pointer-events:none",
      "text-shadow:0 2px 6px rgba(0,0,0,0.8)",
      "line-height:1.5",
    ].join(";");
    // 006: speed-only. The controls list now lives on the StartMenu.
    const speed = document.createElement("div");
    speed.id = "hud-speed";
    speed.style.fontSize = "28px";
    speed.style.fontWeight = "700";
    hud.appendChild(speed);
    return hud;
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
      "font-size:clamp(32px,7vw,72px)",
      "color:#fff",
      "text-shadow:0 4px 18px rgba(0,0,0,0.85)",
    ].join(";");
    return el;
  }

  private updateHud(): void {
    const el = this.hud.querySelector("#hud-speed") as HTMLElement | null;
    if (el) {
      const kmh = Math.round(clamp(this.kart.speed, 0, 999) * 3.6);
      el.textContent = `${kmh} km/h`;
    }
  }

  /** Refresh the race HUD + minimap; reveal the results overlay once finished. */
  private updateRaceUi(): void {
    const snap = this.race.snapshot();
    const p1Lap = Math.min(snap.progress[0]!.lap + 1, TARGET_LAPS);
    const hudState: HudState = {
      lap: p1Lap,
      targetLaps: TARGET_LAPS,
      position: snap.positions[0]!,
      totalKarts: 1 + RIVAL_COUNT,
      timer: snap.timer,
    };
    this.raceHud.update(hudState);

    const blips: MinimapKart[] = [];
    blips.push({ x: this.kart.group.position.x, z: this.kart.group.position.z, player: true });
    for (const r of this.rivals) {
      blips.push({ x: r.group.position.x, z: r.group.position.z, player: false });
    }
    this.minimap.update(blips);

    if (snap.phase === "finished" && !this.resultsShown) {
      this.resultsShown = true;
      const pos = snap.positions[0]!;
      this.results.textContent = `FINISHED — ${ordinal(pos)} / ${1 + RIVAL_COUNT}`;
      this.results.style.display = "flex";
    }
  }

  private readonly tmpV = new THREE.Vector3();
}

const UP_Y = new THREE.Vector3(0, 1, 0);

function defaultSpawn(terrain: Terrain): Spawn {
  const p = terrain.startPos();
  return { pos: p.clone(), yaw: terrain.startYaw() };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
