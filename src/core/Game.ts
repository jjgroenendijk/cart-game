import { Renderer } from "./Renderer";
import { Input, type KartInput } from "./Input";
import { TouchControls } from "../ui/TouchControls";
import { isTouchDevice } from "./deviceInput";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain, type TerrainOptions } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { lightUniforms } from "../materials/lightUniforms";
import {
  biomeTerrain,
  biomeByIndex,
  biomeGroundTint,
  type BiomeId,
} from "../environment/biomes/registry";
import { generateCircuit, type GeneratedCircuit } from "../terrain/circuit";
import { type CircuitId } from "../terrain/circuitCode";
import { loadCircuitId, saveCircuitId } from "./circuitStorage";
import { resolveTrackTraits } from "../terrain/trackTraits";
import { hashSeed } from "./rng";
import { daytimeStartSeconds } from "../environment/dayCycle";
import { FrameMsEwma } from "./stats";
import { type DebugSnapshot } from "./debugSnapshot";
import { gameDebugSnapshot, applyDevRuntime } from "./gameDev";
import { runGameFrame } from "./gameFrame";
import { buildMinimapShape } from "./minimapShape";
import type { Kart } from "../kart/Kart";
import { MenuCamera } from "../kart/MenuCamera";
import { FreeFlyCamera } from "../kart/FreeFlyCamera";
import { FreeFlyHud } from "../ui/FreeFlyHud";
import { yawPitchFromQuaternion } from "./freeFly";
import type { CameraMode } from "./cameraModeConfig";
import { AudioManager } from "../audio/AudioManager";
import { GameAudioDriver } from "../audio/gameAudio";
import { type RaceHud } from "../ui/RaceHud";
import { Minimap, type MinimapShape } from "../ui/Minimap";
import { DEFAULT_SELECTION, validateSelection, type KartPick } from "./kartSelection";
import { type PlayerView } from "./PlayerView";
import type { RaceManager } from "../race/raceManager";
import { type GameState } from "./gameState";
import { FieldBuilder, SPEED_OFFSET, HUD_OFFSET, LIFE_BAR_TOP_OFFSET } from "./FieldBuilder";
import { createResultsEl } from "../ui/resultsDisplay";
import { timeOfDayToEnvParams, type TimeOfDayConfig } from "./timeOfDayConfig";
import { type WeatherChoice } from "./weatherConfig";
import { GameFlow, type FlowHost } from "./GameFlow";
import { type DevFlags } from "./devFlags";
import { devCircuitId, applyDevFlowConfig } from "./devBoot";
import { createKartPreview } from "../ui/KartPreview";
import { DEFAULT_QUALITY, qualityKnobs, resolveStreamPlan, type QualityTier } from "./quality";
import type { EffectSettings, TiltSettings } from "./settings";
import type { Pt } from "../kart/kartLod";
import { fillKartFoci } from "./colliderFoci";

// 205: draw-distance cap, chunk-seed budget, LOD cross-fade, and far-decor
// density floor are tier-gated (quality.ts QualityKnobs), resolved in buildWorld
// from qualityTier — LOW streams a nearer fog horizon, HIGH (default) reaches
// farthest and reproduces the pre-205 constants (360/16/0.4/0.35) exactly.
/**
 * 202 collider range: terrain + prop colliders spawn only within this XZ
 * distance of a kart/AI focus, disabled again past COLLIDER_CULL_RADIUS
 * (hysteresis). World-independent + bounded, so extending the visual stream
 * radius to the fog horizon no longer multiplies Rapier colliders. Kept
 * tier-independent (physics safety): karts need ground + prop colliders around
 * them at every tier. Visual stream follows the camera; colliders the karts.
 */
const COLLIDER_RADIUS = 140;
const COLLIDER_CULL_RADIUS = 170;
/** Spline point the menu camera orbits (t = 0, start/finish line). */
const MENU_CAM_T = 0;
const MENU_CAM_ALTITUDE = 18;
const MENU_CAM_RADIUS = 28;
/** Minimap mainline sample count (matches the old Minimap default). */
const MINIMAP_SAMPLES = 96;

export interface GameOptions {
  /** Terrain/streaming knobs forwarded to Terrain (streamRadius/cullRadius/maxActivations/etc). */
  terrain?: Partial<TerrainOptions>;
  /** Dev URL-flag overrides (biome/seed/weather/time/kart/quality/autostart). */
  dev?: DevFlags;
}

export class Game implements FlowHost {
  readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  readonly input = new Input();
  /** Mobile driving overlay (touch devices only); feeds a P1 KartInput. */
  readonly touch: TouchControls | null;
  private terrain!: Terrain;
  env!: Environment;
  /** Caller streaming opts forwarded to Terrain on every (re)build. */
  private readonly gameTerrainOpts: Partial<TerrainOptions>;
  /**
   * Circuit for the current {@link current} CircuitId. The biome's track
   * traits drive width (and 060 branches); the id's seed drives the mainline
   * shape, so buildWorld re-derives the circuit per CircuitId.
   */
  private circuit!: GeneratedCircuit;
  readonly menuCamera: MenuCamera;
  /** Static XZ of the menu orbit target (env focus in menu state). */
  menuFocusX = 0;
  menuFocusZ = 0;
  readonly minimap: Minimap;
  readonly results: HTMLElement;
  readonly container: HTMLElement;
  /** Procedural audio. Public so dev console can drive resume()/beeps. */
  readonly audio: AudioManager;
  readonly gameAudio: GameAudioDriver;
  field!: FieldBuilder;
  /** CircuitId (seed + biome index) of the currently built world. */
  current: CircuitId;
  builtPicks: KartPick[] = DEFAULT_SELECTION.map((p) => ({ ...p }));
  resultsShown = false;
  raf = 0;
  last = NaN;
  acc = 0;
  time = 0;
  running = false;
  readonly perfEwma = new FrameMsEwma();
  freeFly: FreeFlyCamera | null = null;
  /** Crosshair + pose readout shown while free-fly is active (prod). */
  freeFlyHud: FreeFlyHud | null = null;
  readonly flow: GameFlow;
  /** Pooled 202 collider foci (kart positions), rewritten each frame. */
  private readonly colliderFoci: Pt[] = [];
  /**
   * 205 active quality tier. Drives the draw-distance / streaming budgets read
   * in buildWorld (via qualityKnobs). setQuality updates it; the new radii take
   * effect on the next world (re)build (menu-time), not live mid-race.
   */
  qualityTier: QualityTier = DEFAULT_QUALITY;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.container = container;
    // Mobile touch/tilt overlay: built up-front (before GameFlow's boot
    // applySettings fan-out reaches applyTouchConfig) only on touch devices.
    this.touch = isTouchDevice() ? new TouchControls(container) : null;
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

    // Build the persisted circuit world first, then minimap (caches its
    // spline polyline), then field (needs the minimap ref + rebuilt terrain).
    this.current = loadCircuitId();
    if (opts.dev) this.current = devCircuitId(opts.dev, this.current);
    if (opts.dev?.kart) this.builtPicks = validateSelection([opts.dev.kart]);
    this.buildWorld(this.current);

    this.minimap = new Minimap(container, this.minimapShape(), {
      halfExtent: this.circuit.worldSize / 2,
    });

    this.buildField();

    this.flow = new GameFlow({
      host: this,
      container,
      audio: this.audio,
      kartPreview: createKartPreview,
    });

    if (opts.dev) applyDevFlowConfig(opts.dev, this.flow);
    this.applyTimeOfDay(this.flow.timeOfDayConfig);
    this.env.setWeatherMode(this.flow.weatherMode);
    // Reactivate the persisted camera mode (free-fly stays on across reloads).
    this.applyCameraMode(this.flow.cameraMode);

    window.addEventListener("resize", this.onResize);

    if (opts.dev) applyDevRuntime(this, opts.dev);
  }

  /**
   * World-space minimap shape (060): sampled closed mainline + one open
   * polyline per branch edge (decimated station tables).
   */
  private minimapShape(): MinimapShape {
    return buildMinimapShape(this.terrain, MINIMAP_SAMPLES);
  }

  /** Build terrain + env for a CircuitId; reset menu-cam target + focus. */
  private buildWorld(id: CircuitId): void {
    const biome = biomeByIndex(id.biome);
    this.current = { seed: id.seed >>> 0, biome: id.biome };
    const terrainCfg = biomeTerrain(biome);
    // 078: the world seed drives terrain relief too (was fixed at 1337). Mixed
    // via the codebase hashSeed(label) ^ seed convention so terrain varies
    // independently of the track yet deterministically from one root seed.
    terrainCfg.noiseSeed = (hashSeed("terrain") ^ this.current.seed) >>> 0;
    // Effective water plane matches Terrain.waterLevel (override ?? sandLevel).
    // Fed into circuit gen so the road is clamped above water (no submerged track).
    const waterLevel = biome.waterLevel ?? terrainCfg.sandLevel;
    this.circuit = generateCircuit(this.current.seed, resolveTrackTraits(biome.track), waterLevel);
    // 205: draw distance + streaming budgets are tier-gated. resolveStreamPlan
    // scales the reach to the world (out to the fog horizon, not a hard disc edge)
    // capped by the tier drawCap so LOW streams nearer than HIGH, and derives the
    // 203 HLOD backdrop ring past the cull ring (fog hazes the boundary once
    // terrain reaches it). gameTerrainOpts still wins over the plan below.
    const knobs = qualityKnobs(this.qualityTier, window.devicePixelRatio);
    const halfExtent = this.circuit.worldSize / 2;
    const { streamRadius, cullRadius, backdrop } = resolveStreamPlan(knobs, this.circuit.worldSize);
    this.terrain = new Terrain(this.physics, {
      config: terrainCfg,
      waterLevel: biome.waterLevel,
      control: this.circuit.control,
      worldSize: this.circuit.worldSize,
      mainWidth: this.circuit.mainWidth,
      mainBank: this.circuit.mainBank,
      branches: this.circuit.branches,
      streamRadius,
      cullRadius,
      colliderRadius: COLLIDER_RADIUS,
      colliderCullRadius: COLLIDER_CULL_RADIUS,
      seedBudget: knobs.terrainSeedBudget,
      crossFadeSeconds: knobs.terrainCrossFadeSeconds,
      backdrop,
      ...this.gameTerrainOpts,
    });
    this.renderer.scene.add(this.terrain.group);
    this.renderer.terrain = this.terrain;
    this.renderer.worldHalfExtent = this.circuit.worldSize / 2;

    this.env = new Environment(this.physics, this.terrain, {
      biome,
      seed: this.current.seed,
      water: { level: this.terrain.waterLevel },
      dynamicSky: { dayStartSeconds: daytimeStartSeconds() },
      worldHalfExtent: halfExtent,
      // 202: dressing props stream to the same fog horizon as terrain, but
      // their Rapier bodies stay bounded to the kart-following collider ring.
      dressing: {
        streamRadius,
        cullRadius,
        colliderRadius: COLLIDER_RADIUS,
        colliderCullRadius: COLLIDER_CULL_RADIUS,
        // 205: far-decor density floor is tier-gated (LOW thins harder).
        densityMin: knobs.dressingDensityMin,
      },
    });
    this.renderer.scene.add(this.env.group);
    // 243: ground bounce tint for kart env-reflection downward rays (LINEAR
    // biome grass/road avg). One-time world-build write into the shared uniform.
    lightUniforms.uGroundTint.value.copy(biomeGroundTint(biome));

    const menuTarget = this.terrain.spline.getPoint(MENU_CAM_T);
    this.menuCamera.setTarget(menuTarget);
    this.menuFocusX = menuTarget.x;
    this.menuFocusZ = menuTarget.z;
    // 224: reapply shadow focus so no target from the prior world lingers.
    this.renderer.setShadowTarget(menuTarget.x, menuTarget.z);
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
    this.field.build(this.builtPicks);
    this.resultsShown = false;
    // 206: prime terrain chunks near the spawn/start line synchronously (the
    // incremental ctor seed spreads the rest over frames). Bounded to the
    // collider ring, so gameplay-critical terrain + colliders exist before the
    // first physics step even when a distant start line sits past the origin
    // seed. 202: seed terrain + prop colliders at that same spawn grid. Per-
    // frame refresh then tracks the moving karts.
    this.terrain.primeSeed(this.fillColliderFoci(), COLLIDER_RADIUS);
    this.updateColliderFoci();
  }

  /**
   * 202 collider-range pass: build/enable terrain + prop colliders within
   * COLLIDER_RADIUS of every kart (humans + AI), disable them past
   * COLLIDER_CULL_RADIUS. Foci are ALL kart positions (not the camera), so a
   * far off-camera rival still has ground + prop colliders. Written into a
   * reused pool. Runs before the camera-driven visual stream so newly activated
   * chunks pick up the current foci.
   */
  updateColliderFoci(): void {
    const out = this.fillColliderFoci();
    this.terrain.updateColliders(out);
    this.env.updateColliders(out);
  }

  /** Fill the reused foci pool with every kart position (the human + AI). */
  private fillColliderFoci(): Pt[] {
    return fillKartFoci(this.colliderFoci, this.field.view, this.field.rivals);
  }

  /** Rebuild world (terrain + env + field) for a CircuitId. Menu-time only. */
  rebuildWorld(id?: CircuitId): void {
    const next = id ?? this.current;
    this.field.dispose();
    this.renderer.scene.remove(this.env.group);
    this.renderer.scene.remove(this.terrain.group);
    this.env.dispose();
    this.terrain.dispose();
    this.buildWorld(next);
    this.buildField();
    this.env.setWeatherMode(this.flow.weatherMode);
    // Biome track traits change width/branches/worldSize -> re-project.
    this.minimap.setShape(this.minimapShape(), this.circuit.worldSize / 2);
    // Player-driven rebuild persists the chosen circuit.
    saveCircuitId(this.current);
  }

  rebuildField(picks: readonly KartPick[]): void {
    this.field.dispose();
    this.field.build(picks);
    this.builtPicks = picks.map((p) => ({ ...p }));
    this.resultsShown = false;
  }

  get view(): PlayerView {
    return this.field.view;
  }

  /** Derived biome id of the current CircuitId (keeps FlowHost surface). */
  get currentBiome(): BiomeId {
    return biomeByIndex(this.current.biome).id;
  }

  get rivals(): Kart[] {
    return this.field.rivals;
  }

  get race(): RaceManager {
    return this.field.race;
  }

  get raceHud(): RaceHud {
    return this.field.raceHud;
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
    this.freeFly?.dispose();
    this.freeFlyHud?.remove();
    this.field.dispose();
    this.minimap.remove();
    this.results.remove();
    this.touch?.remove();
    this.env.dispose();
    this.terrain.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  frame = (now: number): void => runGameFrame(this, now);

  /** Fixed physics sub-step; delegates to FieldBuilder with loop time/state. */
  stepWorld(step: number, driving: boolean, inputs: KartInput[]): void {
    this.field.stepWorld(step, driving, inputs, this.time, this.flow.state);
  }

  /** Respawn a rival at the nearest spline-ahead point; delegates to the field. */
  respawnAhead(rival: Kart): void {
    this.field.respawnAhead(rival);
  }

  /** window.__game.debugSnapshot(): whole-game state as JSON. See gameDev.ts. */
  debugSnapshot(): DebugSnapshot {
    return gameDebugSnapshot(this);
  }

  /** Apply a quality tier to renderer + VFX + water glint. */
  setQuality(tier: QualityTier): void {
    // 205: record the tier so the next buildWorld resolves its draw-distance /
    // streaming budgets from it. The live subsystems below apply immediately;
    // the tier-gated stream radii + seed budget re-apply on the next world
    // (re)build (menu-time), which is when they are cheap to change.
    this.qualityTier = tier;
    this.renderer.setQuality(tier);
    this.field.setQuality(tier);
    this.env.setQuality(tier);
  }

  /** 042: push the persisted time-of-day config onto the live sky (no rebuild). */
  applyTimeOfDay(config: TimeOfDayConfig): void {
    this.env.setTimeOfDay(timeOfDayToEnvParams(config));
  }

  /** 054: push the weather mode onto the live env (no world rebuild). */
  applyWeatherMode(mode: WeatherChoice): void {
    this.env.setWeatherMode(mode);
  }

  /**
   * Apply the user-selected camera mode. Lazy-constructs the free-fly cam + HUD
   * on first request (so prod pays nothing until free-fly is chosen). On
   * "freefly" it seeds the pose from the currently-rendering camera (chase while
   * racing/paused, the menu orbit cam otherwise) so the handoff does not snap;
   * a zero source position (e.g. pre-first-frame menu cam) leaves the
   * FreeFlyCamera default vantage. KeyC still toggles in-game.
   */
  applyCameraMode(mode: CameraMode): void {
    if (!this.freeFly) {
      this.freeFly = new FreeFlyCamera(this.renderer.domElement, {
        aspect: window.innerWidth / window.innerHeight,
      });
    }
    if (!this.freeFlyHud) this.freeFlyHud = new FreeFlyHud(this.container);
    if (mode === "freefly") {
      const racing = this.flow.state === "racing" || this.flow.state === "paused";
      const cam = racing ? this.view.chaseCam.camera : this.menuCamera.camera;
      if (cam.position.lengthSq() > 0) {
        const { yaw, pitch } = yawPitchFromQuaternion(cam.quaternion);
        this.freeFly.seedPose(cam.position, yaw, pitch);
      }
      this.freeFly.setActive(true);
      this.freeFlyHud.show();
    } else {
      this.freeFly.setActive(false);
      this.freeFlyHud.hide();
    }
  }

  /** 159: push the per-effect light-effect toggles onto the live Renderer. */
  applyEffectSettings(effects: EffectSettings): void {
    this.renderer.setEffects(effects);
  }

  /** Push mobile tilt-steering settings onto the live TouchControls (no-op on desktop). */
  applyTouchConfig(tilt: TiltSettings): void {
    this.touch?.setConfig(tilt);
  }
  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.menuCamera.setAspect(w / h);
    this.freeFly?.setAspect(w / h);
    const rect = { x: 0, y: 0, w, h };
    this.view.applyLayout(rect, w, h, SPEED_OFFSET, LIFE_BAR_TOP_OFFSET);
    this.raceHud.applyLayout(rect, w, h, SPEED_OFFSET, HUD_OFFSET);
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
