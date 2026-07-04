import { Renderer, splitRects, type ViewDescriptor } from "./Renderer";
import { Input, zeroInput, type KartInput } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain, type TerrainOptions } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { resolveBiome, biomeTerrain, type BiomeId, type BiomeDefinition } from "../terrain/biomes";
import { generateCircuit, type GeneratedCircuit } from "../terrain/circuit";
import { daytimeStartSeconds } from "../environment/dayCycle";
import type { Kart } from "../kart/Kart";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager } from "../audio/AudioManager";
import { GameAudioDriver } from "../audio/gameAudio";
import { type RaceHud } from "../ui/RaceHud";
import { Minimap } from "../ui/Minimap";
import type { KartVariantId } from "../kart/kartVariants";
import { type PlayerView } from "./PlayerView";
import type { RaceManager } from "../race/raceManager";
import { type GameState } from "./gameState";
import { updateHudVisibility, updateLifeBars, updateRaceUi, updateSpeedHuds } from "./hudSync";
import { clamp } from "./math";
import { syncViewDescs } from "./viewDescriptors";
import { FieldBuilder, SPEED_OFFSET, HUD_OFFSET, LIFE_BAR_TOP_OFFSET } from "./FieldBuilder";
import { createResultsEl } from "../ui/resultsDisplay";
import { timeOfDayToEnvParams, type TimeOfDayConfig } from "./timeOfDayConfig";
import { type WeatherChoice } from "./weatherConfig";
import { GameFlow, type FlowHost } from "./GameFlow";
import type { QualityTier } from "./quality";

const STEP = 1 / 60;
/** Max fixed sub-steps per frame; leftover beyond this is dropped. */
const MAX_STEPS = 5;
/** Scenic point on the spline the menu camera orbits (t = 0.5). */
const MENU_CAM_T = 0.5;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;
/**
 * Fixed showcase seed for the default world (temporary until 058 seed UI).
 * seed=8: 1066 m loop, worldSize 439, minRadius ~16, 25 control pts; a deep
 * radial-profile shape that validates after local de-kinking (non-fallback).
 * Mid-length, comfortably under the 768 world cap.
 */
const SHOWCASE_SEED = 8;

export interface GameOptions {
  /** Terrain/streaming knobs forwarded to Terrain (streamRadius/cullRadius/maxActivations/etc). */
  terrain?: Partial<TerrainOptions>;
}

export class Game implements FlowHost {
  readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  private readonly input = new Input();
  private terrain!: Terrain;
  private env!: Environment;
  /** Caller streaming opts forwarded to Terrain on every (re)build. */
  private readonly gameTerrainOpts: Partial<TerrainOptions>;
  /**
   * Showcase circuit computed once (same shape across biome swaps in
   * rebuildWorld -> same track, different dressing). Read by buildWorld +
   * the minimap; not re-derived per rebuild.
   */
  private readonly circuit: GeneratedCircuit = generateCircuit(SHOWCASE_SEED);
  private readonly menuCamera: MenuCamera;
  /** Static XZ of the menu orbit target (env focus in menu state). */
  private menuFocusX = 0;
  private menuFocusZ = 0;
  readonly minimap: Minimap;
  private readonly results: HTMLElement;
  private readonly container: HTMLElement;
  /** Procedural audio. Public so dev console can drive resume()/beeps. */
  readonly audio: AudioManager;
  private readonly gameAudio: GameAudioDriver;
  private field!: FieldBuilder;
  /** Biome id of the currently built world (temperate baseline). */
  currentBiome: BiomeId = "temperate";
  builtVariants: KartVariantId[] = ["balanced", "balanced"];
  private resultsShown = false;
  private raf = 0;
  private last = NaN;
  private acc = 0;
  private time = 0;
  private running = false;
  private readonly flow: GameFlow;
  /** Pooled ViewDescriptor[] for renderViews (grown/truncated as views change). */
  private readonly _viewDescs: ViewDescriptor[] = [];

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld(-24);
    this.gameTerrainOpts = opts.terrain ?? {};

    this.audio = new AudioManager();
    this.audio.setEngineActive(false); // engine off until racing
    this.gameAudio = new GameAudioDriver(this.audio);

    this.results = createResultsEl();
    this.results.style.display = "none";
    container.appendChild(this.results);

    this.menuCamera = new MenuCamera({
      aspect: window.innerWidth / window.innerHeight,
      altitude: MENU_CAM_ALTITUDE,
      radius: MENU_CAM_RADIUS,
    });

    // Build temperate world first, then minimap (caches its spline polyline),
    // then field (needs the minimap ref + rebuilt terrain).
    this.buildWorld(resolveBiome("temperate"));

    this.minimap = new Minimap(
      container,
      {
        getPoint: (t) => {
          const p = this.terrain.spline.getPoint(t);
          return { x: p.x, z: p.z };
        },
      },
      { halfExtent: this.circuit.worldSize / 2 },
    );

    this.buildField();

    this.flow = new GameFlow({ host: this, container, audio: this.audio });

    this.applyTimeOfDay(this.flow.timeOfDayConfig);
    this.env.setWeatherMode(this.flow.weatherMode);

    window.addEventListener("resize", this.onResize);
  }

  /** Build terrain + env for a biome; reset menu-cam target + focus. */
  private buildWorld(biome: BiomeDefinition): void {
    this.terrain = new Terrain(this.physics, {
      config: biomeTerrain(biome),
      waterLevel: biome.waterLevel,
      control: this.circuit.control,
      worldSize: this.circuit.worldSize,
      ...this.gameTerrainOpts,
    });
    this.renderer.scene.add(this.terrain.group);
    this.renderer.terrain = this.terrain;

    this.env = new Environment(this.physics, this.terrain, {
      biome,
      water: { level: this.terrain.waterLevel },
      dynamicSky: { dayStartSeconds: daytimeStartSeconds() },
    });
    this.renderer.scene.add(this.env.group);

    const menuTarget = this.terrain.spline.getPoint(MENU_CAM_T);
    this.menuCamera.setTarget(menuTarget);
    this.menuFocusX = menuTarget.x;
    this.menuFocusZ = menuTarget.z;
    this.currentBiome = biome.id;
  }

  /**
   * (Re)create FieldBuilder against the current terrain; build the 1P menu
   * field. Recreated on rebuild so karts/AI/respawn read the rebuilt world.
   */
  private buildField(): void {
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
    this.field.build(this.humanCount, this.builtVariants);
    this.resultsShown = false;
  }

  /** Rebuild world (terrain + env + field) for a biome. Menu-time only. */
  rebuildWorld(biome: BiomeId | BiomeDefinition): void {
    const def = typeof biome === "string" ? resolveBiome(biome) : biome;
    this.field.dispose();
    this.renderer.scene.remove(this.env.group);
    this.renderer.scene.remove(this.terrain.group);
    this.env.dispose();
    this.terrain.dispose();
    this.buildWorld(def);
    this.buildField();
    this.env.setWeatherMode(this.flow.weatherMode);
  }

  rebuildField(humanCount: number, variants: readonly KartVariantId[]): void {
    this.field.dispose();
    this.field.build(humanCount, [...variants]);
    this.builtVariants = [...variants];
    this.resultsShown = false;
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
    this.flow.dispose();
    this.field.dispose();
    this.minimap.remove();
    this.results.remove();
    this.env.dispose();
    this.terrain.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    if (Number.isNaN(this.last)) this.last = now;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const racing = this.flow.state === "racing";
    const paused = this.flow.state === "paused";
    const driving = racing && this.race.phase === "racing";

    this.input.beginFrame();
    const inputs = this.views.map((_, i) => (driving ? this.input.sample(i) : zeroInput()));

    if (this.flow.state !== "menu" && this.flow.state !== "paused") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        // Snapshot prev pose pre-step so sync() interpolates by acc/STEP.
        for (const v of this.views) v.kart.capturePrevPose();
        for (const r of this.rivals) r.capturePrevPose();
        this.stepWorld(STEP, driving, inputs);
        this.acc -= STEP;
        steps++;
      }
      if (this.acc > STEP * MAX_STEPS) this.acc = STEP * MAX_STEPS;
    }

    if (this.flow.state === "countdown" && this.flow.countdown.update(dt) === "done") {
      this.flow.onCountdownDone();
    }

    const syncAlpha = clamp(this.acc / STEP, 0, 1);
    for (const v of this.views) v.sync(syncAlpha);
    for (const r of this.rivals) r.sync(syncAlpha);

    this.time += dt;

    const mid = this.field.humansMidpoint();
    // Menu/select/countdown use the MenuCamera; env/water follow its target
    // (not the kart grid start, else the bounded plane is culled out of view).
    const menuFocus = this.flow.state !== "racing" && this.flow.state !== "paused";
    this.env.update(
      dt,
      this.time,
      menuFocus ? this.menuFocusX : mid.x,
      menuFocus ? this.menuFocusZ : mid.z,
    );
    this.gameAudio.updateWeather(this.env.weatherInfo);
    this.field.updateVfx(dt, this.time, driving);

    if (racing || paused) {
      if (racing) {
        for (const v of this.views) v.updateCamera(dt);
        this.renderer.setShadowTarget(mid.x, mid.z);
      }
      this.renderer.renderViews(this.viewDescriptors(), racing);
    } else {
      this.menuCamera.update(dt);
      this.renderer.render(this.menuCamera.camera, false);
    }
    this.audio.updatePlayers(dt, this.field.humanAudioStates(driving, inputs));
    this.audio.updateRivals(
      dt,
      this.field.rivalAudioStates(driving),
      this.field.listenerTransform(),
    );

    updateHudVisibility(this.views, racing || paused);
    if (racing) {
      updateSpeedHuds(this.views);
      updateLifeBars(this.views);
      this.resultsShown = updateRaceUi({
        views: this.views,
        rivals: this.rivals,
        raceHuds: this.raceHuds,
        race: this.race,
        minimap: this.minimap,
        resultsEl: this.results,
        resultsShown: this.resultsShown,
      });
    }
    this.input.endFrame();
  };

  /** Fixed physics sub-step; delegates to FieldBuilder with loop time/state. */
  private stepWorld(step: number, driving: boolean, inputs: KartInput[]): void {
    this.field.stepWorld(step, driving, inputs, this.time, this.flow.state);
  }

  /** Sync the pooled ViewDescriptor[] to live views (no per-frame allocation). */
  private viewDescriptors(): ViewDescriptor[] {
    return syncViewDescs(this._viewDescs, this.views);
  }

  /** Respawn a rival at the nearest spline-ahead point; delegates to the field. */
  respawnAhead(rival: Kart): void {
    this.field.respawnAhead(rival);
  }

  /** Apply a quality tier to renderer + VFX layers. */
  setQuality(tier: QualityTier): void {
    this.renderer.setQuality(tier);
    this.field.setQuality(tier);
  }

  /** 042: push the persisted time-of-day config onto the live sky (no rebuild). */
  applyTimeOfDay(config: TimeOfDayConfig): void {
    this.env.setTimeOfDay(timeOfDayToEnvParams(config));
  }

  /** 054: push the weather mode onto the live env (no world rebuild). */
  applyWeatherMode(mode: WeatherChoice): void {
    this.env.setWeatherMode(mode);
  }
  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.menuCamera.setAspect(w / h);
    const rects = splitRects(w, h, "horizontal", this.humanCount);
    for (let i = 0; i < this.views.length; i++) {
      this.views[i]!.applyLayout(rects[i]!, w, h, SPEED_OFFSET, LIFE_BAR_TOP_OFFSET);
    }
    for (let i = 0; i < this.raceHuds.length; i++) {
      this.raceHuds[i]!.applyLayout(rects[i]!, w, h, SPEED_OFFSET, HUD_OFFSET);
    }
    this.field.placeMinimap(w, h);
  };

  // GameFlow facade: flow owns screen state/overlays/handlers; these thin
  // getters keep the existing Game.*.test.ts casts (which reach a mix of Game
  // internals + flow handlers on one object) working unmodified.
  get currentState(): GameState {
    return this.flow.state;
  }
  get state(): GameState {
    return this.flow.state;
  }
  get onStart() {
    return this.flow.onStart;
  }
  get onRaceConfigConfirm() {
    return this.flow.onRaceConfigConfirm;
  }
  get onSelectConfirm() {
    return this.flow.onSelectConfirm;
  }
  get onSelectBack() {
    return this.flow.onSelectBack;
  }
  get onCountdownDone() {
    return this.flow.onCountdownDone;
  }
  get onPause() {
    return this.flow.onPause;
  }
  get onResume() {
    return this.flow.onResume;
  }
  get onQuit() {
    return this.flow.onQuit;
  }
  get onBiomeChange() {
    return this.flow.onBiomeChange;
  }
  get openSettingsFromMenu() {
    return this.flow.openSettingsFromMenu;
  }
  get openSettingsFromPause() {
    return this.flow.openSettingsFromPause;
  }
  get onSettingsChange() {
    return this.flow.onSettingsChange;
  }
  get onSettingsBack() {
    return this.flow.onSettingsBack;
  }
  get onKeydown() {
    return this.flow.onKeydown;
  }
  get applySettings() {
    return this.flow.applySettings;
  }
  get startMenu() {
    return this.flow.startMenu;
  }
  get countdown() {
    return this.flow.countdown;
  }
  get pauseOverlay() {
    return this.flow.pauseOverlay;
  }
  get settingsOverlay() {
    return this.flow.settingsOverlay;
  }
}
