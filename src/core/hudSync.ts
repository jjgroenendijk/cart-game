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
import { clamp } from "./math";
import { resultsText } from "../ui/resultsDisplay";

export function updateHudVisibility(views: readonly PlayerView[], racing: boolean): void {
  for (const v of views) {
    (v["speedEl"] as HTMLElement).style.display = racing ? "block" : "none";
  }
}

export function updateSpeedHuds(views: readonly PlayerView[]): void {
  for (const v of views) {
    const kmh = Math.round(clamp(v.kart.speed, 0, 999) * 3.6);
    v.setSpeed(kmh);
  }
}

export function updateLifeBars(views: readonly PlayerView[]): void {
  for (const v of views) {
    v.setLife(v.kart.controller.life, v.kart.controller.inWater);
  }
}

export interface RaceUiDeps {
  views: readonly PlayerView[];
  rivals: readonly Kart[];
  raceHuds: readonly RaceHud[];
  race: RaceManager;
  minimap: Minimap;
  resultsEl: HTMLElement;
  resultsShown: boolean;
}

/** Refresh per-view race HUDs + minimap; reveal results once finished. */
export function updateRaceUi(deps: RaceUiDeps): boolean {
  const { views, rivals, raceHuds, race, minimap, resultsEl, resultsShown } = deps;
  const snap = race.snapshot();
  for (let i = 0; i < raceHuds.length; i++) {
    const lap = Math.min(snap.progress[i]!.lap + 1, race.targetLaps);
    const hudState: HudState = {
      lap,
      targetLaps: race.targetLaps,
      position: snap.positions[i]!,
      totalKarts: race.kartCount,
      timer: snap.timer,
    };
    raceHuds[i]!.update(hudState);
  }

  const blips: MinimapKart[] = [];
  for (let i = 0; i < views.length; i++) {
    const k = views[i]!.kart;
    blips.push({
      x: k.group.position.x,
      z: k.group.position.z,
      player: i === 0,
    });
  }
  for (const r of rivals) {
    blips.push({
      x: r.group.position.x,
      z: r.group.position.z,
      player: false,
    });
  }
  minimap.update(blips);

  if (snap.phase === "finished" && !resultsShown) {
    resultsEl.textContent = resultsText(snap, views as PlayerView[]);
    resultsEl.style.display = "flex";
    return true;
  }
  return resultsShown;
}
