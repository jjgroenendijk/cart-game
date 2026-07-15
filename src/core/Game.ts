import { Renderer, splitRects, type ViewDescriptor } from "./Renderer";
import { Input, mergeKartInput, zeroInput, type KartInput } from "./Input";
import { TouchControls } from "../ui/TouchControls";
import { isTouchDevice } from "./deviceInput";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain, type TerrainOptions } from "../terrain/Terrain";
import { Environment } from "../environment/Environment";
import { biomeTerrain, biomeByIndex, type BiomeId } from "../environment/biomes/registry";
import { generateCircuit, type GeneratedCircuit } from "../terrain/circuit";
import { type CircuitId } from "../terrain/circuitCode";
import { loadCircuitId, saveCircuitId } from "./circuitStorage";
import { resolveTrackTraits } from "../terrain/trackTraits";
import { hashSeed } from "./rng";
import { daytimeStartSeconds, dayCycleState } from "../environment/dayCycle";
import { FrameMsEwma, type PerfSample } from "./stats";
import { buildDebugSnapshot, type DebugSnapshot } from "./debugSnapshot";
import type { Kart } from "../kart/Kart";
import { MenuCamera } from "../kart/MenuCamera";
import { AudioManager } from "../audio/AudioManager";
import { GameAudioDriver } from "../audio/gameAudio";
import { type RaceHud } from "../ui/RaceHud";
import { Minimap, type MinimapShape } from "../ui/Minimap";
import { DEFAULT_SELECTION, validateSelection, type KartPick } from "./kartSelection";
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
import { type DevFlags } from "./devFlags";
import { devCircuitId, applyDevFlowConfig } from "./devBoot";
import { createKartPreview } from "../ui/KartPreview";
import { DEFAULT_QUALITY, qualityKnobs, resolveStreamPlan, type QualityTier } from "./quality";
import type { EffectSettings, TiltSettings } from "./settings";
import type { Pt } from "../kart/kartLod";
import { fillKartFoci } from "./colliderFoci";

const STEP = 1 / 60;
/** Max fixed sub-steps per frame; leftover beyond this is dropped. */
const MAX_STEPS = 5;
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
  private readonly input = new Input();
  /** Mobile driving overlay (touch devices only); feeds a P1 KartInput. */
  private readonly touch: TouchControls | null;
  private terrain!: Terrain;
  private env!: Environment;
  /** Caller streaming opts forwarded to Terrain on every (re)build. */
  private readonly gameTerrainOpts: Partial<TerrainOptions>;
  /**
   * Circuit for the current {@link current} CircuitId. The biome's track
   * traits drive width (and 060 branches); the id's seed drives the mainline
   * shape, so buildWorld re-derives the circuit per CircuitId.
   */
  private circuit!: GeneratedCircuit;
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
  /** CircuitId (seed + biome index) of the currently built world. */
  current: CircuitId;
  builtPicks: KartPick[] = DEFAULT_SELECTION.map((p) => ({ ...p }));
  private resultsShown = false;
  private raf = 0;
  private last = NaN;
  private acc = 0;
  private time = 0;
  private running = false;
  /** Smoothed frame time (ms) for the debug snapshot perf sample. */
  private readonly perfEwma = new FrameMsEwma();
  private readonly flow: GameFlow;
  /** Pooled ViewDescriptor[] for renderViews (grown/truncated as views change). */
  private readonly _viewDescs: ViewDescriptor[] = [];
  /** Pooled 202 collider foci (kart positions), rewritten each frame. */
  private readonly colliderFoci: Pt[] = [];
  /**
   * 205 active quality tier. Drives the draw-distance / streaming budgets read
   * in buildWorld (via qualityKnobs). setQuality updates it; the new radii take
   * effect on the next world (re)build (menu-time), not live mid-race.
   */
  private qualityTier: QualityTier = DEFAULT_QUALITY;

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
    // Dev flags override the persisted circuit id + kart picks before the build.
    this.current = loadCircuitId();
    if (opts.dev) this.current = devCircuitId(opts.dev, this.current);
    if (opts.dev?.kart) this.builtPicks = validateSelection([opts.dev.kart, opts.dev.kart]);
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

    // Dev flags override the flow's persisted weather/time before the boot apply.
    if (opts.dev) applyDevFlowConfig(opts.dev, this.flow);
    this.applyTimeOfDay(this.flow.timeOfDayConfig);
    this.env.setWeatherMode(this.flow.weatherMode);

    window.addEventListener("resize", this.onResize);

    // Dev flags: force quality, then optionally drop straight into a race.
    if (opts.dev?.quality) this.setQuality(opts.dev.quality);
    if (opts.dev?.autostart) {
      this.flow.autostart(opts.dev.kart ? { picks: this.builtPicks } : {});
    }
  }

  /**
   * World-space minimap shape (060): sampled closed mainline + one open
   * polyline per branch edge (decimated station tables).
   */
  private minimapShape(): MinimapShape {
    const main: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < MINIMAP_SAMPLES; i++) {
      const p = this.terrain.spline.getPoint(i / MINIMAP_SAMPLES);
      main.push({ x: p.x, z: p.z });
    }
    const branches = this.terrain.graph.edges
      .filter((e) => !e.closed)
      .map((e) => {
        const pts: Array<{ x: number; z: number }> = [];
        const stride = Math.max(1, Math.floor(e.count / 32));
        for (let i = 0; i < e.count; i += stride) pts.push({ x: e.sx[i]!, z: e.sz[i]! });
        pts.push({ x: e.sx[e.count - 1]!, z: e.sz[e.count - 1]! });
        return pts;
      });
    return { main, branches };
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

    const menuTarget = this.terrain.spline.getPoint(MENU_CAM_T);
    this.menuCamera.setTarget(menuTarget);
    this.menuFocusX = menuTarget.x;
    this.menuFocusZ = menuTarget.z;
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
    this.field.build(this.humanCount, this.builtPicks);
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
  private updateColliderFoci(): void {
    const out = this.fillColliderFoci();
    this.terrain.updateColliders(out);
    this.env.updateColliders(out);
  }

  /** Fill the reused foci pool with every kart position (humans + AI). */
  private fillColliderFoci(): Pt[] {
    return fillKartFoci(this.colliderFoci, this.field.views, this.field.rivals);
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

  rebuildField(humanCount: number, picks: readonly KartPick[]): void {
    this.field.dispose();
    this.field.build(humanCount, picks);
    this.builtPicks = picks.map((p) => ({ ...p }));
    this.resultsShown = false;
  }

  get views(): PlayerView[] {
    return this.field.views;
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
    this.touch?.remove();
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
    this.perfEwma.push(dt * 1000);

    const racing = this.flow.state === "racing";
    const paused = this.flow.state === "paused";
    const driving = racing && this.race.phase === "racing";

    this.input.beginFrame();
    const inputs = this.views.map((_, i) => (driving ? this.input.sample(i) : zeroInput()));
    // Mobile touch/tilt drives P1: merge over the keyboard/gamepad sample so a
    // paired keyboard still works and neither source zeroes the other.
    if (this.touch && driving && inputs[0]) {
      inputs[0] = mergeKartInput(inputs[0], this.touch.sample());
    }

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
    // 202: colliders follow the karts (bounded ring), independent of the
    // camera-driven visual stream below. Runs before env/terrain visual updates
    // so freshly streamed chunks near a kart get colliders the same frame.
    this.updateColliderFoci();
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
      this.renderer.renderViews(this.viewDescriptors());
    } else {
      this.menuCamera.update(dt);
      this.renderer.render(this.menuCamera.camera);
    }
    this.audio.updatePlayers(dt, this.field.humanAudioStates(driving, inputs));
    this.audio.updateRivals(
      dt,
      this.field.rivalAudioStates(driving),
      this.field.listenerTransform(),
    );

    updateHudVisibility(this.views, racing || paused);
    if (this.touch) {
      // Pedals ride the race; the tilt-enable prompt lives on the start menu so
      // sensor permission is granted before driving (not at race start).
      if (racing) this.touch.showRace();
      else if (this.flow.state === "menu") this.touch.showMenu();
      else this.touch.hide();
    }
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

  /**
   * Plain, JSON-serializable dump of the whole live game state (dev/agent
   * inspection). Exposed via `window.__game.debugSnapshot()` from main.ts. All
   * heavy copying (Rapier bodies, the reused race buffer, day-cycle scratch)
   * lives in the pure {@link buildDebugSnapshot} assembler; here we only read
   * the live subsystems and adapt the renderer's FrameStats into a PerfSample.
   */
  debugSnapshot(): DebugSnapshot {
    return buildDebugSnapshot({
      state: this.flow.state,
      time: this.time,
      seed: this.current.seed,
      biome: this.currentBiome,
      weather: this.env.weatherInfo,
      day: dayCycleState,
      quality: this.qualityTier,
      perf: this.perfSample(),
      karts: [...this.views.map((v) => v.kart), ...this.rivals],
      race: this.race.snapshot(),
    });
  }

  /** Adapt the renderer's per-frame FrameStats into a PerfSample (smoothed ms). */
  private perfSample(): PerfSample {
    const fs = this.renderer.getFrameStats();
    const frameMs = this.perfEwma.smoothed;
    const ms = Number.isNaN(frameMs) ? 0 : frameMs;
    return {
      frameMs: ms,
      fps: ms > 0 ? 1000 / ms : 0,
      drawCalls: fs.calls,
      tris: fs.triangles,
      geometries: fs.geometries,
      textures: fs.textures,
    };
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
