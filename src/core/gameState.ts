/**
 * 006 game state machine. Pure + side-effect free (no DOM, no Game deps) so it
 * runs under jsdom and mirrors the engineCurve helper pattern. Game owns the
 * current state and calls transition() on Start / countdown-done; the loop
 * gates physics/input/camera/audio off the returned state.
 *
 * Flow: menu --start--> countdown --countdownDone--> racing. racing is
 * terminal (the race has no finish/pause yet -> every event stays in racing).
 * Illegal combos (e.g. countdownDone from menu) leave the state unchanged so a
 * stray event can never skip the countdown.
 */

export type GameState = "menu" | "countdown" | "racing";

export type GameEvent = "start" | "countdownDone";

/**
 * Advance the state machine. Deterministic: same (state, event) always yields
 * the same next state. Unknown/illegal events return the input state.
 */
export function transition(state: GameState, event: GameEvent): GameState {
  switch (state) {
    case "menu":
      return event === "start" ? "countdown" : state;
    case "countdown":
      return event === "countdownDone" ? "racing" : state;
    case "racing":
      return "racing";
  }
}
