# 061 AI difficulty selector

Status: concept (to be refined)

## Context

Split out of 037. The rejected 037 v1 coupled difficulty into track LAYOUT
(per-difficulty curvature floors), which was wrong: track shape and rival
skill are independent axes. 037 v3 makes layout purely seed-derived, so
difficulty is now free to be its own knob that scales AI QUALITY only, with
zero effect on the generated world (same code = same track at any difficulty).

## Goal

- An easy/medium/hard selector that scales rival driving quality: corner
  speed (`aiSpeed.ts` A_LAT / max-speed scale), lookahead, aggression,
  mistake rate, and rubber-band strength.
- Explicitly NOT seed-derived and NOT encoded in the circuit code; it is a
  local player setting with its own storage key.

## Needs refinement

- Where the knobs live: move `AiDriver`/`aiSpeed` gains into `AiTuning`
  (`src/race/aiTuning.ts`), thread an `aiSkill` value Game -> FieldBuilder ->
  `makeAiTuning`, so per-rival personality composes with the global skill.
- UI: a cycle row (reuse 024/042 MenuNav `onHorizontal` pattern) vs a Race
  Setup screen. Persist via own localStorage key (schema-versioned).
- Balance targets: define target lap-time gaps to the player per tier; avoid
  making "hard" just uniformly faster (should corner better, not teleport).
- Interaction with rubber-band (`raceManager.rubberBandScale`): decide whether
  difficulty scales the band or only the base skill.

## Depends on

056 (AI speed/corridor model the knobs scale). 007 (aiTuning/FieldBuilder).
024/042 (cycle-row + MenuNav pattern). Independent of the circuit seed/code.
