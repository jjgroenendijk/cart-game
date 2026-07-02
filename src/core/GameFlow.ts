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
import { resolveBiome, type BiomeId, type BiomeDefinition } from "../terrain/biomes";
import { transition, type GameState } from "./gameState";
import { validateSettings, type SettingsState } from "./settings";
import { loadSettings, saveSettings } from "./storage";
import { loadKartSelection, saveKartSelection } from "./kartSelectionStorage";
import { loadTimeOfDay, saveTimeOfDay } from "./timeOfDayStorage";
import type { TimeOfDayConfig } from "./timeOfDayConfig";

/** Game's narrow surface that GameFlow drives back into (world/field/sky). */
export interface FlowHost {
  readonly audio: AudioManager;
  readonly race: RaceManager;
  readonly raceHuds: readonly RaceHud[];
  readonly minimap: Minimap;
  readonly humanCount: number;
  readonly currentBiome: BiomeId;
  readonly builtVariants: readonly KartVariantId[];
  rebuildWorld(biome: BiomeId | BiomeDefinition): void;
  rebuildField(humanCount: number, variants: readonly KartVariantId[]): void;
  applyTimeOfDay(cfg: TimeOfDayConfig): void;
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

  constructor(opts: GameFlowOptions) {
    this.host = opts.host;
    this.container = opts.container;
    this.audio = opts.audio;

    this.settings = loadSettings();
    this.selectedVariants = loadKartSelection();
    this.timeOfDayConfig = loadTimeOfDay();

    this.startMenu = new StartMenu(
      this.container,
      this.audio,
      this.onStart,
      this.openSettingsFromMenu,
      this.onBiomeChange,
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
  }

  onBiomeChange = (biome: BiomeId): void => {
    if (biome !== this.host.currentBiome) this.host.rebuildWorld(biome);
  };

  onStart = (mode: GameMode, biome?: BiomeId): void => {
    const resolved = resolveBiome(biome);
    if (resolved.id !== this.host.currentBiome) this.host.rebuildWorld(resolved);
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
    });
    this.raceConfig.show();
  };

  onRaceConfigConfirm = (config: TimeOfDayConfig): void => {
    this.timeOfDayConfig = config;
    saveTimeOfDay(config);
    this.host.applyTimeOfDay(config);
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
    this.state = transition(this.state, "quit"); // raceConfig -> menu
    this.raceConfig?.hide();
    this.raceConfig?.remove();
    this.raceConfig = null;
    this.startMenu.show();
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
    this.startMenu.show();
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
    this.startMenu.show();
  };

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
}
