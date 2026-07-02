# 046 Composition headroom: split Game flow + AudioManager graph

Status: open (full plan; ready for execution)

## Context

The repo enforces a hard 600-line cap per hand-written file
(`tools/check-repo-rules.sh`, `max_lines=600`; pre-commit + CI). Current
counts of the composition roots:

```text
src/core/Game.ts          598  (2 lines of headroom)
src/audio/AudioManager.ts 600  (0 lines of headroom)
src/core/FieldBuilder.ts  528
src/core/Renderer.ts      528
```

`Game.ts` mixes four roles today:

- Frame loop + fixed-step accumulator (`frame`, `Game.ts:265-345`).
- World lifecycle (`buildWorld`/`buildField`/`rebuildWorld`,
  `Game.ts:157-210`).
- Screen flow: every overlay field, every `on*` handler
  (`Game.ts:362-523`), Escape routing (`onKeydown`), and persistence
  (settings, kart selection, time-of-day storage).
- Per-frame HUD sync (`updateHudVisibility`/`updateSpeedHuds`/
  `updateLifeBars`/`updateRaceUi`, `Game.ts:540-597`).

Screen flow is the growth axis: 024 (kart select), 025 (biome row), 042
(race config + time-of-day) each added an overlay + storage + rebuild
wiring here. OPEN 037 needs the same again (`currentCircuit`, wider
`onStart`, `circuitStorage`) and does not fit in 2 lines -> 046 blocks 037.
Concept 044 (circuit options panel) lands on the same axis after that.

`AudioManager.ts` is at the cap exactly; the next audio feature (or even a
tuning comment) forces an unplanned split mid-feature. Its private "graph
construction" section (`AudioManager.ts:425-600`: `buildGraph`,
`start/stopPersistentVoices`, `buildWind`, `buildCollision`, `buildMusic`,
`stopSource`, visibility handler) is already a self-contained seam, as is
the `BeepDef` table + `uiBeep` (`AudioManager.ts:103-155,301`).

The repo already has the target pattern: `FieldBuilder` (012) and
`GameAudioDriver` were net-zero relocations of in-Game/-Manager code behind
injected deps, with Game delegating. This plan repeats that pattern twice.

## Goal

Create durable headroom along real ownership seams so the next ~10 features
(037, 044, 029-036 biomes, audio work) land in files that own them, not in
a root at 99% of cap. Net-zero behavior: no user-visible change, existing
test suites pass with import-path-only edits.

## Non-goals

- No behavior, tuning, or UI change of any kind.
- No new abstraction layers beyond the two extractions + one helper module.
- Renderer.ts split (528; owner of concepts 039/040 which will restructure
  it anyway - splitting now would churn twice).
- FieldBuilder.ts split (528; already a single coherent owner).

## Architecture (change)

```text
src/core/
  GameFlow.ts        # NEW: screen-flow controller. Owns the GameState field
                     #   + all overlay instances (StartMenu, RaceConfig-
                     #   Overlay, KartSelectOverlay, Countdown, PauseOverlay,
                     #   SettingsOverlay), every on* handler, Escape routing,
                     #   and persistence (settings/kartSelection/timeOfDay
                     #   storage + applySettings fan-out to audio).
                     #   Calls into Game via a narrow FlowHost interface:
                     #   { rebuildWorld(biome); rebuildField(count,variants);
                     #     applyTimeOfDay(cfg); race; raceHuds; minimap;
                     #     humanCount }. Game reads flow.state (getter) in
                     #   frame(). gameState.transition() moves verbatim into
                     #   GameFlow call sites; the state machine itself is
                     #   untouched.
  GameFlow.test.ts   # relocated flow tests (Game.select.test.ts and friends
                     #   keep passing via the Game facade; add direct
                     #   GameFlow coverage for Escape routing + settings
                     #   origin, the two subtlest moved blocks).
  hudSync.ts         # NEW: per-frame HUD block as plain functions taking
                     #   (views, raceHuds, race, minimap, results):
                     #   updateHudVisibility/updateSpeedHuds/updateLifeBars/
                     #   updateRaceUi + resultsShown handling. jsdom-testable
                     #   without a Game.
  Game.ts            # keeps: ctor composition, frame loop + accumulator,
                     #   world lifecycle, env focus, render dispatch,
                     #   resize. Target <= 400 lines.
src/audio/
  beeps.ts           # NEW: BeepDef table + playBeep(ctx, bus, kind).
  audioGraph.ts      # NEW: pure-ish builders moved verbatim: buildGraph,
                     #   persistent voices start/stop, wind, collision,
                     #   music, stopSource. Take (ctx, buses, opts), return
                     #   node handles; no AudioManager state.
  AudioManager.ts    # keeps: public API, resume/suspend/dispose, bus state,
                     #   update fan-out. All no-op-before-resume guards STAY
                     #   here (public methods check ctx before delegating).
                     #   Target <= 450 lines.
tools/
  check-repo-rules.sh # headroom report: after the limits pass, print
                     #   "[INFO] <file> <lines> (>550)" for files within 50
                     #   lines of cap. Non-fatal; makes creep visible in CI
                     #   logs before it blocks a feature branch again.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `refactor(core): extract hudSync helpers from Game`
   - Move the four HUD methods verbatim; Game calls the functions. Tests:
     direct hudSync unit tests + existing Game tests unchanged.
2. `refactor(core): extract GameFlow screen controller from Game`
   - Move state field, overlay fields, on\* handlers, keydown routing,
     persistence. Game implements FlowHost; facade getters
     (`currentState`) preserved so every existing Game test passes
     unmodified. The `menu`/`racing`/`paused` reads in `frame()` switch to
     `this.flow.state`.
3. `refactor(audio): extract beep table + graph builders from AudioManager`
   - Move verbatim; AudioManager delegates. The six AudioManager test files
     pass with import edits only.
4. `chore(tools): headroom report in repo rules`
5. `docs: refresh src/AGENTS.md + root diagram, move 046 to pending-review`
   - AGENTS.md gains GameFlow/hudSync/audioGraph ownership lines (>1000 LOC
     moved below `src/`).

## Risks

- State-transition drift: Escape routing has ordered early-outs
  (`select`/`raceConfig` overlay owns Escape, then settings, then
  pause/resume) and `settingsOrigin` dual-entry logic. Mitigation: move
  verbatim, add direct GameFlow tests for exactly these two paths before
  the move commit lands.
- Audio pre-resume invariant: "no-op safe before resume()" must survive.
  Mitigation: guards stay in AudioManager public methods; audioGraph
  functions require a non-null ctx by signature, so they cannot be called
  early by construction.
- Facade erosion: juniors may wire new overlays back into Game. Mitigation:
  AGENTS.md ownership line ("screen flow lives in GameFlow; Game never
  constructs an overlay") + the headroom report keeps Game's count honest.
- Test relocation churn: keep Game.\*.test.ts filenames + assertions as-is
  wherever they drive via DOM/facade; only genuinely-moved units get new
  test files.

## Acceptance

- [ ] Game.ts <= 400 lines; AudioManager.ts <= 450; no src file > 550.
- [ ] Net-zero behavior: full existing vitest suite passes with only
      import-path edits; no snapshot/assertion changes.
- [ ] 037's Game additions (`currentCircuit`, `onStart` widening, storage
      wiring) fit in GameFlow/Game without approaching the cap.
- [ ] gameState.ts transition table byte-identical.
- [ ] check-repo-rules.sh prints the >550 headroom report and still exits 0
      for compliant trees.
- [ ] `npm run verify` green; AGENTS.md files updated + under 200 lines.

## Verification

- Manual pass: menu -> settings -> back; menu -> race config -> select ->
  countdown -> race -> Escape pause -> settings -> back -> resume -> quit;
  biome switch from menu; 2P start. Audio: beeps on hover/click, engine on
  countdown done, mute/volume sliders live.
- `npm run verify:changed` per commit, `npm run verify` at the end.

## Depends on

Nothing. Blocks 037 in practice (Game.ts headroom) - land 046 first.
Composes with 044 (options panel lands in GameFlow), 029-036 (biome rows),
009+ audio follow-ups (graph builders now have room). Pattern precedent:
012 FieldBuilder extraction.
