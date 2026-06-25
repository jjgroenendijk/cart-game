import { Renderer, splitRects } from "./Renderer";
import { Input, zeroInput, type KartInput } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import type { Kart } from "../kart/Kart";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager } from "../audio/AudioManager";
import { GameAudioDriver } from "../audio/gameAudio";
import { StartMenu, type GameMode } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { type HudState, type RaceHud } from "../ui/RaceHud";
import { Minimap, type MinimapKart } from "../ui/Minimap";
import { viewHudAnchor, type PlayerView } from "./PlayerView";
import type { RaceManager } from "../race/raceManager";
import { transition, type GameState } from "./gameState";
import { clamp } from "./math";
import { FieldBuilder, rectAspect, SPEED_OFFSET, HUD_OFFSET } from "./FieldBuilder";

const STEP = 1 / 60;
/** Scenic point on the spline the menu camera orbits (t = 0.5). */
const MENU_CAM_T = 0.5;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;

export class Game {
  readonly renderer: Renderer;
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
  private readonly field: FieldBuilder;

  private state: GameState = "menu";
  private raf = 0;
  private last = NaN;
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

    // Audio + results overlay exist before the field build (the build sets the
    // voice count + resets the results overlay on a mode rebuild).
    this.audio = new AudioManager();
    this.audio.setEngineActive(false); // engine off until racing
    this.gameAudio = new GameAudioDriver(this.audio);
    this.results = this.createResults();
    this.results.style.display = "none";
    container.appendChild(this.results);

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

    // FieldBuilder owns the per-field state (karts, race, HUDs, AI); built once
    // and rebuilt in place via build()/dispose() when the mode changes.
    this.field = new FieldBuilder({
      physics: this.physics,
      scene: this.renderer.scene,
      terrain: this.terrain,
      container: this.container,
      audio: this.audio,
      gameAudio: this.gameAudio,
      minimap: this.minimap,
      results: this.results,
    });
    this.field.build(1);
    this.resultsShown = false;

    this.startMenu = new StartMenu(container, this.audio, this.onStart);
    this.countdown = new Countdown(container, this.audio);

    window.addEventListener("resize", this.onResize);
  }

  get currentState(): GameState {
    return this.state;
  }

  get views(): PlayerView[] {
    return this.field.views;
  }

  get rivals(): Kart[] {
    return this.field.rivals;
  }

  get race(): RaceManager {
    return this.field.race;
  }

  get raceHuds(): RaceHud[] {
    return this.field.raceHuds;
  }

  get humanCount(): number {
    return this.field.humanCount;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.field.dispose();
    this.startMenu.remove();
    this.countdown.remove();
    this.minimap.remove();
    this.results.remove();
    this.env.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- main loop ------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.running) return;
    if (Number.isNaN(this.last)) this.last = now;
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

    this.time += dt;
    this.env.update(dt, this.time);

    if (racing) {
      for (const v of this.views) v.updateCamera(dt);
      const mid = this.field.humansMidpoint();
      this.renderer.setShadowTarget(mid.x, mid.z);
      this.renderer.renderViews(
        this.views.map((v) => ({ camera: v.chaseCam.camera, rect: v.rect })),
      );
    } else {
      this.menuCamera.update(dt);
      this.renderer.render(this.menuCamera.camera);
    }
    this.audio.updatePlayers(dt, this.field.humanAudioStates(driving, inputs));

    this.updateHudVisibility(racing);
    if (racing) {
      this.updateSpeedHuds();
      this.updateRaceUi();
    }
    this.input.endFrame();
  };

  /** Fixed physics sub-step; delegates to FieldBuilder with loop time/state. */
  private stepWorld(step: number, driving: boolean, inputs: KartInput[]): void {
    this.field.stepWorld(step, driving, inputs, this.time, this.state);
  }

  /** Respawn a rival at the nearest spline-ahead point; delegates to the field. */
  respawnAhead(rival: Kart): void {
    this.field.respawnAhead(rival);
  }

  private onStart = (mode: GameMode): void => {
    const humanCount = mode === "2P" ? 2 : 1;
    if (humanCount !== this.humanCount) {
      this.field.dispose();
      this.field.build(humanCount);
      this.resultsShown = false;
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
    this.field.placeMinimap(w, h);
  };

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
      const lap = Math.min(snap.progress[i]!.lap + 1, this.race.targetLaps);
      const hudState: HudState = {
        lap,
        targetLaps: this.race.targetLaps,
        position: snap.positions[i]!,
        totalKarts: this.race.kartCount,
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
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
