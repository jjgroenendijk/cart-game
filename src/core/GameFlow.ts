/**
 * Screen-flow controller extracted from Game (046). Owns the GameState field,
 * every overlay instance (StartMenu/Countdown/PauseOverlay/SettingsOverlay +
 * the transient KartSelect/RaceConfig overlays), every on* handler, Escape
 * routing, and persistence (settings/kartSelection/timeOfDay storage +
 * applySettings fan-out to audio). Calls into Game via the narrow FlowHost
 * interface; Game reads flow.state in its frame loop. Net-zero behavior: the
 * handlers + ctor wiring moved verbatim, only this.X references re-pointed.
 */

import { StartMenu } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { PauseOverlay } from "../ui/PauseOverlay";
import { SettingsOverlay } from "../ui/SettingsOverlay";
import { KartSelectOverlay } from "../ui/KartSelectOverlay";
import type { KartPreviewFactory } from "../ui/KartPreview";
import { RaceConfigOverlay } from "../ui/RaceConfigOverlay";
import type { RaceHud } from "../ui/RaceHud";
import type { Minimap } from "../ui/Minimap";
import type { KartPick } from "./kartSelection";
import type { RaceManager } from "../race/raceManager";
import type { AudioManager } from "../audio/AudioManager";
import { resolveBiome, biomeIndexOf, type BiomeId } from "../environment/biomes/registry";
import type { CircuitId } from "../terrain/circuitCode";
import { transition, type GameState } from "./gameState";
import {
  validateSettings,
  type EffectSettings,
  type SettingsState,
  type TiltSettings,
} from "./settings";
import { loadSettings, saveSettings } from "./storage";
import { loadKartSelection, saveKartSelection } from "./kartSelectionStorage";
import { validateSelection } from "./kartSelection";
import { loadTimeOfDay, saveTimeOfDay } from "./timeOfDayStorage";
import { loadWeather, saveWeather } from "./weatherStorage";
import { loadCameraMode, saveCameraMode } from "./cameraModeStorage";
import type { CameraMode } from "./cameraModeConfig";
import type { TimeOfDayConfig } from "./timeOfDayConfig";
import type { WeatherChoice } from "./weatherConfig";
import type { QualityTier } from "./quality";

/** Game's narrow surface that GameFlow drives back into (world/field/sky). */
export interface FlowHost {
  readonly audio: AudioManager;
  readonly race: RaceManager;
  readonly raceHud: RaceHud;
  readonly minimap: Minimap;
  readonly current: CircuitId;
  readonly currentBiome: BiomeId;
  readonly builtPicks: readonly KartPick[];
  rebuildWorld(id?: CircuitId): void;
  rebuildField(picks: readonly KartPick[]): void;
  applyTimeOfDay(cfg: TimeOfDayConfig): void;
  applyWeatherMode(mode: WeatherChoice): void;
  /** Apply the user-selected camera mode (chase/free-fly) to the live Game. */
  applyCameraMode(mode: CameraMode): void;
  /** 159: push the per-effect light-effect toggles onto the live Renderer. */
  applyEffectSettings(effects: EffectSettings): void;
  /** Push mobile tilt-steering settings onto the live TouchControls (no-op on desktop). */
  applyTouchConfig(tilt: TiltSettings): void;
  /** 278: apply the user-selected quality tier to renderer/field/env (live). */
  setQuality(tier: QualityTier): void;
}

export interface GameFlowOptions {
  host: FlowHost;
  container: HTMLElement;
  audio: AudioManager;
  /** 3D preview factory for the kart select overlay (absent under jsdom). */
  kartPreview?: KartPreviewFactory;
}

export class GameFlow {
  state: GameState = "menu";
  /** Read by Game's ctor for the boot applyTimeOfDay; mutated on confirm. */
  timeOfDayConfig: TimeOfDayConfig;
  /** 054: persisted weather mode; read by Game's ctor for the boot apply. */
  weatherMode: WeatherChoice;
  /** Persisted camera mode (chase/free-fly); read by Game's ctor for the boot apply. */
  cameraMode: CameraMode;
  readonly startMenu: StartMenu;
  readonly countdown: Countdown;
  readonly pauseOverlay: PauseOverlay;
  readonly settingsOverlay: SettingsOverlay;
  private readonly host: FlowHost;
  private readonly container: HTMLElement;
  private readonly audio: AudioManager;
  private readonly kartPreview?: KartPreviewFactory;
  private settings: SettingsState;
  private settingsOrigin: "menu" | "pause" | null = null;
  private kartSelect: KartSelectOverlay | null = null;
  private raceConfig: RaceConfigOverlay | null = null;
  private selectedPicks: KartPick[];
  private pendingWeatherMode: WeatherChoice;
  private menuAudioUnlocked = false;

  constructor(opts: GameFlowOptions) {
    this.host = opts.host;
    this.container = opts.container;
    this.audio = opts.audio;
    this.kartPreview = opts.kartPreview;

    this.settings = loadSettings();
    this.selectedPicks = loadKartSelection();
    this.timeOfDayConfig = loadTimeOfDay();
    this.weatherMode = loadWeather();
    this.pendingWeatherMode = this.weatherMode;
    this.cameraMode = loadCameraMode();

    this.startMenu = new StartMenu(
      this.container,
      this.audio,
      this.onStart,
      this.openSettingsFromMenu,
      this.onBiomeChange,
      this.host.current,
      this.onCircuitChange,
      this.cameraMode,
      this.onCameraModeChange,
    );
    this.countdown = new Countdown(this.container, this.audio);
    this.pauseOverlay = new PauseOverlay(this.container, this.audio, {
      onResume: this.onResume,
      onSettings: this.openSettingsFromPause,
      onQuit: this.onQuit,
    });
    this.settingsOverlay = new SettingsOverlay(this.container, this.audio, this.settings, {
      onChange: this.onSettingsChange,
      onBack: this.onSettingsBack,
    });

    this.applySettings(this.settings);

    window.addEventListener("keydown", this.onKeydown);
    // Browsers block audio until a user gesture. Unlock the AudioContext on
    // the first menu interaction so the procedural menu music can play before
    // the START click. resume() is idempotent; onStart calls it again safely.
    window.addEventListener("pointerdown", this.onFirstGesture);
    window.addEventListener("keydown", this.onFirstGesture);
  }

  /** Remove overlays + transient overlays + the keydown listener. */
  dispose(): void {
    this.kartSelect?.remove();
    this.raceConfig?.remove();
    this.startMenu.remove();
    this.countdown.remove();
    this.pauseOverlay.remove();
    this.settingsOverlay.remove();
    window.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("pointerdown", this.onFirstGesture);
    window.removeEventListener("keydown", this.onFirstGesture);
  }

  onBiomeChange = (biome: BiomeId): void => {
    const next: CircuitId = { seed: this.host.current.seed, biome: biomeIndexOf(biome) };
    if (next.biome !== this.host.current.biome) this.host.rebuildWorld(next);
  };

  onCircuitChange = (id: CircuitId): void => {
    this.host.rebuildWorld(id);
  };

  /** Camera mode changed from the start-menu CAMERA row: persist + apply live. */
  onCameraModeChange = (mode: CameraMode): void => {
    this.cameraMode = mode;
    saveCameraMode(mode);
    this.host.applyCameraMode(mode);
  };

  onStart = (biome?: BiomeId): void => {
    const biomeIdx = biomeIndexOf(resolveBiome(biome).id);
    if (biomeIdx !== this.host.current.biome) {
      this.host.rebuildWorld({ seed: this.host.current.seed, biome: biomeIdx });
    }
    this.audio.resume();
    // Reset the pending weather to the persisted mode so a fresh config
    // session starts in sync with the overlay's displayed initial. Without
    // this, confirming without re-picking weather would apply a stale
    // pendingWeatherMode left over from an aborted prior session.
    this.pendingWeatherMode = this.weatherMode;
    this.state = transition(this.state, "openRaceConfig"); // menu -> raceConfig
    this.audio.setEngineActive(false);
    this.startMenu.hide();
    this.raceConfig?.remove();
    this.raceConfig = new RaceConfigOverlay(this.container, this.audio, {
      initial: this.timeOfDayConfig,
      onApply: (c) => this.host.applyTimeOfDay(c),
      onConfirm: this.onRaceConfigConfirm,
      onBack: this.onRaceConfigBack,
      initialWeather: this.weatherMode,
      onWeatherApply: (m) => {
        this.pendingWeatherMode = m;
        this.host.applyWeatherMode(m);
      },
    });
    this.raceConfig.show();
  };

  onRaceConfigConfirm = (config: TimeOfDayConfig): void => {
    this.timeOfDayConfig = config;
    saveTimeOfDay(config);
    this.host.applyTimeOfDay(config);
    this.weatherMode = this.pendingWeatherMode;
    saveWeather(this.weatherMode);
    this.host.applyWeatherMode(this.weatherMode);
    this.state = transition(this.state, "confirm"); // raceConfig -> select
    this.raceConfig?.hide();
    this.raceConfig?.remove();
    this.raceConfig = null;
    this.kartSelect?.remove();
    this.kartSelect = new KartSelectOverlay(this.container, this.audio, {
      initialPicks: this.selectedPicks,
      onConfirm: this.onSelectConfirm,
      onBack: this.onSelectBack,
      preview: this.kartPreview,
    });
    this.kartSelect.show();
  };

  onRaceConfigBack = (): void => {
    this.host.applyTimeOfDay(this.timeOfDayConfig); // cancel abandoned live preview
    this.host.applyWeatherMode(this.weatherMode); // cancel abandoned weather preview
    this.state = transition(this.state, "quit"); // raceConfig -> menu
    this.raceConfig?.hide();
    this.raceConfig?.remove();
    this.raceConfig = null;
    this.enterMenu();
  };

  onSelectConfirm = (picks: KartPick[]): void => {
    this.selectedPicks = picks.map((p) => ({ ...p }));
    saveKartSelection(this.selectedPicks);
    const pickChanged =
      this.host.builtPicks[0]?.variant !== picks[0]?.variant ||
      this.host.builtPicks[0]?.colorway !== picks[0]?.colorway;
    if (pickChanged) this.host.rebuildField(this.selectedPicks);
    this.state = transition(this.state, "confirm"); // select -> countdown
    this.kartSelect?.hide();
    this.kartSelect?.remove();
    this.kartSelect = null;
    this.countdown.show();
  };

  onSelectBack = (): void => {
    this.state = transition(this.state, "quit"); // select -> menu
    this.kartSelect?.hide();
    this.kartSelect?.remove();
    this.kartSelect = null;
    this.enterMenu();
  };

  onCountdownDone = (): void => {
    this.state = transition(this.state, "countdownDone"); // countdown -> racing
    this.audio.setEngineActive(true);
    this.countdown.hide();
    this.host.race.startRace();
    this.host.raceHud.show();
    this.host.minimap.show();
  };

  /**
   * Dev/agent fast path: skip the menu/config/select overlays and drop
   * straight into a running race. Reuses the real handler chain (the same
   * transitions Game.test.ts drives) so state, race start, and HUD/minimap
   * wiring stay identical; the transient overlays are created and torn down
   * synchronously within this call. Passing the current biome to onStart
   * avoids a redundant world rebuild. Note the handlers persist their config
   * (weather/time/kart) as usual, so a dev-flag boot sticks its choices.
   */
  autostart(opts: { picks?: readonly KartPick[] } = {}): void {
    if (opts.picks) this.selectedPicks = opts.picks.map((p) => ({ ...p }));
    this.onStart(this.host.currentBiome);
    this.onRaceConfigConfirm(this.timeOfDayConfig);
    this.onSelectConfirm(this.selectedPicks);
    this.onCountdownDone();
  }

  onPause = (): void => {
    if (this.state !== "racing") return;
    this.state = transition(this.state, "pause"); // racing -> paused
    this.audio.setPaused(true);
    this.pauseOverlay.show();
  };

  onResume = (): void => {
    if (this.state !== "paused") return;
    this.state = transition(this.state, "resume"); // paused -> racing
    this.audio.setPaused(false);
    this.pauseOverlay.hide();
  };

  onQuit = (): void => {
    if (this.state !== "paused") return;
    this.state = transition(this.state, "quit"); // paused -> menu
    this.pauseOverlay.hide();
    this.host.minimap.hide();
    this.host.rebuildField(validateSelection(undefined));
    this.audio.setPaused(false); // un-suspend (was suspended on pause)
    this.enterMenu();
  };

  /**
   * Re-enter the menu: show the start menu, assert the engine voice off (it
   * is flipped on at countdown-done and would otherwise hum through the menu),
   * and set the music bed to its menu phase (flush() never runs in menu so the
   * bed would otherwise hold its last racing/finished phase). No-op safe
   * pre-resume; a prior resume() makes these effective.
   */
  private enterMenu(): void {
    this.startMenu.show();
    this.audio.setEngineActive(false);
    this.audio.setMusicPhase("menu");
  }

  /** Push the settings fields onto audio (no-op pre-resume) + the Renderer. */
  applySettings = (s: SettingsState): void => {
    this.audio.setVolume(s.masterVolume);
    this.audio.mute(s.muted);
    this.audio.setMusicVolume(s.musicVolume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.audio.setPositional(s.positionalAudio);
    this.audio.setHrtf(s.hrtf);
    this.host.applyEffectSettings(s.effects);
    this.host.applyTouchConfig(s.tilt);
    this.host.setQuality(s.quality);
  };

  openSettingsFromMenu = (): void => {
    this.settingsOrigin = "menu";
    this.startMenu.hide();
    this.settingsOverlay.show(this.settings);
  };

  openSettingsFromPause = (): void => {
    this.settingsOrigin = "pause";
    // Pause overlay stays visible behind the settings overlay.
    this.settingsOverlay.show(this.settings);
  };

  onSettingsChange = (s: SettingsState): void => {
    this.settings = validateSettings(s);
    this.applySettings(this.settings);
    saveSettings(this.settings);
  };

  onSettingsBack = (): void => {
    this.settingsOverlay.hide();
    if (this.settingsOrigin === "menu") this.startMenu.show();
    this.settingsOrigin = null;
  };

  onKeydown = (e: KeyboardEvent): void => {
    if (e.code !== "Escape") return;
    if (this.state === "select" || this.state === "raceConfig") return; // overlay owns Escape
    if (this.settingsOverlay.isVisible) {
      this.onSettingsBack();
      return;
    }
    if (this.state === "racing") this.onPause();
    else if (this.state === "paused") this.onResume();
  };

  /**
   * One-shot: build the AudioContext on the first menu gesture so the
   * procedural menu music plays before START. resume() builds the graph
   * (the music bed defaults to its menu phase) and is idempotent, so the
   * later onStart resume() is a safe no-op. Detaches itself after firing.
   * Ignored outside the menu since racing resumes audio through its own path.
   */
  onFirstGesture = (): void => {
    if (this.menuAudioUnlocked || this.state !== "menu") return;
    this.menuAudioUnlocked = true;
    this.audio.resume();
    this.audio.setMusicPhase("menu");
    window.removeEventListener("pointerdown", this.onFirstGesture);
    window.removeEventListener("keydown", this.onFirstGesture);
  };
}
