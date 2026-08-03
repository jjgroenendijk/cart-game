/**
 * Per-frame Game loop body (split from Game for the file-size cap; behavior
 * unchanged). Mirrors gameDev.ts: type-only Game import, reads/writes g.X.
 * Game keeps a one-line delegate `frame = (now) => runGameFrame(this, now)`.
 * Owns the fixed-step accumulator, input sampling, sync/alpha blend, env +
 * audio + VFX update, and the render/HUD dispatch. Promoted members on Game
 * are the minimal set this body touches (matches the gameDev.ts precedent).
 */

import type { Game } from "./Game";
import { mergeKartInput, zeroInput, type KartInput } from "./Input";
import { renderGameFrame } from "./gameDev";
import {
  updateFreeFlyHud,
  updateHudVisibility,
  updateLifeBars,
  updateRaceUi,
  updateSpeedHuds,
} from "./hudSync";
import { clamp } from "./math";

const STEP = 1 / 60;
/** Max fixed sub-steps per frame; leftover beyond this is dropped. */
const MAX_STEPS = 5;

export function runGameFrame(g: Game, now: number): void {
  if (!g.running) return;
  if (Number.isNaN(g.last)) g.last = now;
  g.raf = requestAnimationFrame(g.frame);

  const dt = Math.min((now - g.last) / 1000, 0.1);
  g.last = now;
  g.perfEwma.push(dt * 1000);

  const racing = g.flow.state === "racing";
  const paused = g.flow.state === "paused";
  const driving = racing && g.race.phase === "racing" && !g.freeFly?.active;

  g.input.beginFrame();
  const inputs: KartInput[] = [driving ? g.input.sample(0) : zeroInput()];
  // Mobile touch/tilt drives P1: merge over the keyboard/gamepad sample so a
  // paired keyboard still works and neither source zeroes the other.
  if (g.touch && driving) {
    inputs[0] = mergeKartInput(inputs[0], g.touch.sample());
  }

  if (g.flow.state !== "menu" && g.flow.state !== "paused") {
    g.acc += dt;
    let steps = 0;
    while (g.acc >= STEP && steps < MAX_STEPS) {
      // Snapshot prev pose pre-step so sync() interpolates by acc/STEP.
      g.view.kart.capturePrevPose();
      for (const r of g.rivals) r.capturePrevPose();
      g.stepWorld(STEP, driving, inputs);
      g.acc -= STEP;
      steps++;
    }
    if (g.acc > STEP * MAX_STEPS) g.acc = STEP * MAX_STEPS;
  }

  if (g.flow.state === "countdown" && g.flow.countdown.update(dt) === "done") {
    g.flow.onCountdownDone();
  }

  const syncAlpha = clamp(g.acc / STEP, 0, 1);
  g.view.sync(syncAlpha);
  for (const r of g.rivals) r.sync(syncAlpha);

  g.time += dt;

  const mid = g.field.humansMidpoint();
  // 202: colliders follow the karts (bounded ring), independent of the
  // camera-driven visual stream below. Runs before env/terrain visual updates
  // so freshly streamed chunks near a kart get colliders the same frame.
  g.updateColliderFoci();
  // Menu/select/countdown use the MenuCamera; env/water follow its target
  // (not the kart grid start, else the bounded plane is culled out of view).
  const menuFocus = g.flow.state !== "racing" && g.flow.state !== "paused";
  const focusX = menuFocus ? g.menuFocusX : mid.x;
  const focusZ = menuFocus ? g.menuFocusZ : mid.z;
  g.env.update(dt, g.time, focusX, focusZ);
  g.gameAudio.updateWeather(g.env.weatherInfo);
  g.field.updateVfx(dt, g.time, driving);

  // 224: pass the resolved view focus (menu vs human midpoint) so the shadow
  // box follows whatever camera renders, not only the racing midpoint.
  renderGameFrame(g, dt, racing, paused, focusX, focusZ);
  g.audio.updatePlayers(dt, g.field.humanAudioStates(driving, inputs));
  g.audio.updateRivals(dt, g.field.rivalAudioStates(driving), g.field.listenerTransform());

  updateHudVisibility(g.view, racing || paused);
  updateFreeFlyHud(g.freeFlyHud, g.freeFly);
  if (g.touch) {
    // Pedals ride the race; the tilt-enable prompt lives on the start menu so
    // sensor permission is granted before driving (not at race start).
    if (racing) g.touch.showRace();
    else if (g.flow.state === "menu") g.touch.showMenu();
    else g.touch.hide();
  }
  if (racing) {
    updateSpeedHuds(g.view);
    updateLifeBars(g.view);
    g.resultsShown = updateRaceUi({
      view: g.view,
      rivals: g.rivals,
      raceHud: g.raceHud,
      race: g.race,
      minimap: g.minimap,
      resultsEl: g.results,
      resultsShown: g.resultsShown,
    });
  }
  g.input.endFrame();
}
