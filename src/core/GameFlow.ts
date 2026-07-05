/**
 * Screen-flow controller extracted from Game (046). Owns the GameState field,
 * every overlay instance (StartMenu/Countdown/PauseOverlay/SettingsOverlay +
 * the transient KartSelect/RaceConfig overlays), every on* handler, Escape
 * routing, and persistence (settings/kartSelection/timeOfDay storage +
 * applySettings fan-out to audio). Calls into Game via the narrow FlowHost
 * interface; Game reads flow.state in its frame loop. Net-zero behavior: the
 * handlers + ctor wiring moved verbatim, only this.X references re-pointed.
 */

import { StartMenu, type GameMode } from "../ui/StartMenu";
import { Countdown } from "../ui/Countdown";
import { PauseOverlay } from "../ui/PauseOverlay";
import { SettingsOverlay } from "../ui/SettingsOverlay";
import { KartSelectOverlay, type KartSelectResult } from "../ui/KartSelectOverlay";
import { RaceConfigOverlay } from "../ui/RaceConfigOverlay";
import type { RaceHud } from "../ui/RaceHud";
import type { Minimap } from "../ui/Minimap";
import type { KartVariantId } from "../kart/kartVariants";
import type { RaceManager } from "../race/raceManager";
import type { AudioManager } from "../audio/AudioManager";
import { resolveBiome, biomeIndexOf, type BiomeId } from "../terrain/biomes";
import type { CircuitId } from "../terrain/circuitCode";
import { transition, type GameState } from "./gameState";
import { validateSettings, type SettingsState } from "./settings";
import { loadSettings, saveSettings } from "./storage";
import { loadKartSelection, saveKartSelection } from "./kartSelectionStorage";
import { loadTimeOfDay, saveTimeOfDay } from "./timeOfDayStorage";
import { loadWeather, saveWeather } from "./weatherStorage";
import type { TimeOfDayConfig } from "./timeOfDayConfig";
import type { WeatherChoice } from "./weatherConfig";

/** Game's narrow surface that GameFlow drives back into (world/field/sky). */
export interface FlowHost {
  readonly audio: AudioManager;
  readonly race: RaceManager;
  readonly raceHuds: readonly RaceHud[];
  readonly minimap: Minimap;
  readonly humanCount: number;
  readonly current: CircuitId;
  readonly currentBiome: BiomeId;
  readonly builtVariants: readonly KartVariantId[];
  rebuildWorld(id?: CircuitId): void;
  rebuildField(humanCount: number, variants: readonly KartVariantId[]): void;
  applyTimeOfDay(cfg: TimeOfDayConfig): void;
  applyWeatherMode(mode: WeatherChoice): void;
}

export interface GameFlowOptions {
  host: FlowHost;
  container: HTMLElement;
  audio: AudioManager;
}

export class GameFlow {
  state: GameState = "menu";
  /** Read by Game's ctor for the boot applyTimeOfDay; mutated on confirm. */
  timeOfDayConfig: TimeOfDayConfig;
  /** 054: persisted weather mode; read by Game's ctor for the boot apply. */
  weatherMode: WeatherChoice;
  readonly startMenu: StartMenu;
  readonly countdown: Countdown;
  readonly pauseOverlay: PauseOverlay;
  readonly settingsOverlay: SettingsOverlay;
  private readonly host: FlowHost;
  private readonly container: HTMLElement;
  private readonly audio: AudioManager;
  private settings: SettingsState;
  private settingsOrigin: "menu" | "pause" | null = null;
  private kartSelect: KartSelectOverlay | null = null;
  private raceConfig: RaceConfigOverlay | null = null;
  private pendingMode: GameMode = "1P";
  private selectedVariants: KartVariantId[];
  private pendingWeatherMode: WeatherChoice;
  private menuAudioUnlocked = false;

  constructor(opts: GameFlowOptions) {
    this.host = opts.host;
    this.container = opts.container;
    this.audio = opts.audio;

    this.settings = loadSettings();
    this.selectedVariants = loadKartSelection();
    this.timeOfDayConfig = loadTimeOfDay();
    this.weatherMode = loadWeather();
    this.pendingWeatherMode = this.weatherMode;

    this.startMenu = new StartMenu(
      this.container,
      this.audio,
      this.onStart,
      this.openSettingsFromMenu,
      this.onBiomeChange,
      this.host.current,
      this.onCircuitChange,
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

  onStart = (mode: GameMode, biome?: BiomeId): void => {
    const biomeIdx = biomeIndexOf(resolveBiome(biome).id);
    if (biomeIdx !== this.host.current.biome) {
      this.host.rebuildWorld({ seed: this.host.current.seed, biome: biomeIdx });
    }
    this.audio.resume();
    this.pendingMode = mode;
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
    this.kartSelect = new KartSelectOverlay(this.container, this.audio, this.pendingMode, {
      initialVariants: this.selectedVariants,
      onConfirm: this.onSelectConfirm,
      onBack: this.onSelectBack,
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

  onSelectConfirm = (result: KartSelectResult): void => {
    const { mode, variants } = result;
    this.selectedVariants = [...variants];
    saveKartSelection(this.selectedVariants);
    const humanCount = mode === "2P" ? 2 : 1;
    const variantChanged =
      humanCount !== this.host.humanCount ||
      this.host.builtVariants.slice(0, humanCount).some((v, i) => v !== variants[i]);
    if (variantChanged) this.host.rebuildField(humanCount, this.selectedVariants);
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
    for (const hud of this.host.raceHuds) hud.show();
    this.host.minimap.show();
  };

  onPause = (): void => {
    if (this.state !== "racing") return;
    this.state = transition(this.state, "pause"); // racing -> paused
    this.audio.suspend();
    this.pauseOverlay.show();
  };

  onResume = (): void => {
    if (this.state !== "paused") return;
    this.state = transition(this.state, "resume"); // paused -> racing
    this.audio.resume();
    this.pauseOverlay.hide();
  };

  onQuit = (): void => {
    if (this.state !== "paused") return;
    this.state = transition(this.state, "quit"); // paused -> menu
    this.pauseOverlay.hide();
    this.host.minimap.hide();
    this.host.rebuildField(this.host.humanCount, ["balanced", "balanced"]);
    this.audio.resume(); // un-suspend (was suspended on pause)
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

  /** Push the settings fields onto audio (no-op pre-resume). */
  applySettings = (s: SettingsState): void => {
    this.audio.setVolume(s.masterVolume);
    this.audio.mute(s.muted);
    this.audio.setMusicVolume(s.musicVolume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.audio.setPositional(s.positionalAudio);
    this.audio.setHrtf(s.hrtf);
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
