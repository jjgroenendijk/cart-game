/**
 * Per-frame HUD sync helpers. Pure over their inputs (no `this`, no Game
 * state); extracted from Game byte-for-byte to free the 600-line cap.
 * jsdom-testable: only reads DOM + typed deps.
 */

import type { PlayerView } from "./PlayerView";
import type { HudState, RaceHud } from "../ui/RaceHud";
import type { Minimap, MinimapKart } from "../ui/Minimap";
import type { RaceManager } from "../race/raceManager";
import type { Kart } from "../kart/Kart";
import type { FreeFlyCamera } from "../kart/FreeFlyCamera";
import type { FreeFlyHud } from "../ui/FreeFlyHud";
import { clamp } from "./math";
import { renderResults } from "../ui/resultsDisplay";

export function updateHudVisibility(view: PlayerView, racing: boolean): void {
  (view["speedEl"] as HTMLElement).style.display = racing ? "block" : "none";
}

/**
 * Refresh the free-fly spectator HUD when the free-fly cam is active, else hide
 * it. No-op (and hides) when the cam/HUD are absent so the frame loop can call
 * this unconditionally. Pure over its inputs.
 */
export function updateFreeFlyHud(hud: FreeFlyHud | null, freeFly: FreeFlyCamera | null): void {
  if (!hud) return;
  if (!freeFly?.active) {
    hud.hide();
    return;
  }
  hud.show();
  hud.update(freeFly.pose);
}

export function updateSpeedHuds(view: PlayerView): void {
  const kmh = Math.round(clamp(view.kart.speed, 0, 999) * 3.6);
  view.setSpeed(kmh);
}

export function updateLifeBars(view: PlayerView): void {
  view.setLife(view.kart.controller.life, view.kart.controller.inWater);
}

export interface RaceUiDeps {
  view: PlayerView;
  rivals: readonly Kart[];
  raceHud: RaceHud;
  race: RaceManager;
  minimap: Minimap;
  resultsEl: HTMLElement;
  resultsShown: boolean;
}

/** Refresh the race HUD + minimap; reveal results once finished. */
export function updateRaceUi(deps: RaceUiDeps): boolean {
  const { view, rivals, raceHud, race, minimap, resultsEl, resultsShown } = deps;
  const snap = race.snapshot();
  const lap = Math.min(snap.progress[0]!.lap + 1, race.targetLaps);
  const hudState: HudState = {
    lap,
    targetLaps: race.targetLaps,
    position: snap.positions[0]!,
    totalKarts: race.kartCount,
    timer: snap.timer,
  };
  raceHud.update(hudState);

  const k = view.kart;
  const blips: MinimapKart[] = [{ x: k.group.position.x, z: k.group.position.z, player: true }];
  for (const r of rivals) {
    blips.push({
      x: r.group.position.x,
      z: r.group.position.z,
      player: false,
    });
  }
  minimap.update(blips);

  if (snap.phase === "finished" && !resultsShown) {
    renderResults(resultsEl, snap, view);
    resultsEl.style.display = "flex";
    return true;
  }
  return resultsShown;
}
