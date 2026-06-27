/**
 * 006 game state machine. Pure + side-effect free (no DOM, no Game deps) so it
 * runs under jsdom and mirrors the engineCurve helper pattern. Game owns the
 * current state and calls transition() on openSelect / confirm / countdown-
 * done / pause / resume / quit; the loop gates physics/input/camera/audio off
 * the returned state.
 *
 * Flow: menu --openSelect--> select --confirm--> countdown
 * --countdownDone--> racing --pause--> paused --resume--> racing;
 * paused --quit--> menu; select --quit--> menu. racing is no longer fully
 * terminal (pause leaves it), but every other event keeps it racing. Illegal
 * combos (e.g. countdownDone from menu) leave the state unchanged so a stray
 * event can never skip the countdown or the kart select.
 */

export type GameState = "menu" | "select" | "countdown" | "racing" | "paused";

export type GameEvent = "openSelect" | "confirm" | "countdownDone" | "pause" | "resume" | "quit";

/**
 * Advance the state machine. Deterministic: same (state, event) always yields
 * the same next state. Unknown/illegal events return the input state.
 */
export function transition(state: GameState, event: GameEvent): GameState {
  switch (state) {
    case "menu":
      return event === "openSelect" ? "select" : state;
    case "select":
      return event === "confirm" ? "countdown" : event === "quit" ? "menu" : state;
    case "countdown":
      return event === "countdownDone" ? "racing" : state;
    case "racing":
      return event === "pause" ? "paused" : "racing";
    case "paused":
      return event === "resume" ? "racing" : event === "quit" ? "menu" : "paused";
  }
}
