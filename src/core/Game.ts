import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Input, zeroInput } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { Kart } from "../kart/Kart";
import { ChaseCamera } from "../kart/ChaseCamera";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager } from "../audio/AudioManager";
import { StartMenu } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { transition, type GameState } from "./gameState";
import { clamp } from "./math";

const STEP = 1 / 60;
const SPAWN_CLEARANCE = 1.5;
/** Scenic point on the spline the menu camera orbits (t = 0.5). */
const MENU_CAM_T = 0.5;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;

export class Game {
  private readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  private readonly input = new Input();
  private readonly terrain: Terrain;
  private readonly env: Environment;
  private readonly kart: Kart;
  private readonly chaseCamera: ChaseCamera;
  private readonly menuCamera: MenuCamera;
  private readonly startMenu: StartMenu;
  private readonly countdown: Countdown;
  private readonly hud: HTMLElement;
  /** Procedural audio. Public so dev console can drive resume()/beeps. */
  readonly audio: AudioManager;
  private state: GameState = "menu";
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private running = false;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld(-24);
    this.terrain = new Terrain(this.physics);
    this.renderer.scene.add(this.terrain.group);

    this.env = new Environment(this.physics, this.terrain, {
      water: { level: this.terrain.waterLevel },
    });
    this.renderer.scene.add(this.env.group);

    const start = this.terrain.startPos();
    const spawn = new THREE.Vector3(
      start.x,
      this.terrain.heightAt(start.x, start.z) + SPAWN_CLEARANCE,
      start.z,
    );
    this.kart = new Kart(this.physics, spawn, this.terrain.startYaw(), 0);
    this.renderer.scene.add(this.kart.group);

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

    // Prime the broadphase so the kart's first suspension raycast hits
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

    this.input.beginFrame();
    const kartInput = racing ? this.input.sample(0) : zeroInput();

    // Physics only when not in the menu. Countdown settles the kart onto the
    // surface with zero input + zeroed XZ linvel (keeps Y so it can drop) so it
    // reads resting at spawn and avoids a lurch at GO.
    if (this.state !== "menu") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.kart.fixedUpdate(STEP, racing ? kartInput : zeroInput());
        if (this.state === "countdown") this.zeroHorizontalLinvel();
        this.physics.step();
        this.acc -= STEP;
        steps++;
      }
    }

    // Drive the countdown timer; enter racing on completion.
    if (this.state === "countdown" && this.countdown.update(dt) === "done") {
      this.onCountdownDone();
    }

    this.kart.sync(1);
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
      racing
        ? {
            speed: this.kart.speed,
            throttle: kartInput.throttle,
            drifting: this.kart.controller.isDrifting,
          }
        : { speed: 0, throttle: 0, drifting: false },
    );

    this.hud.style.display = racing ? "block" : "none";
    if (racing) this.updateHud();
    this.input.endFrame();
  };

  /** Zero XZ linear velocity so the kart can't drift while settling (keeps Y). */
  private zeroHorizontalLinvel(): void {
    const b = this.kart.controller.body;
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

  private updateHud(): void {
    const el = this.hud.querySelector("#hud-speed") as HTMLElement | null;
    if (el) {
      const kmh = Math.round(clamp(this.kart.speed, 0, 999) * 3.6);
      el.textContent = `${kmh} km/h`;
    }
  }
}
