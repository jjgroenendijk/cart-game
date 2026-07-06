# 075 Procedural music engine (Tone.js, phase-specific)

Status: open (full plan; ready for execution)

## Context

009 shipped a minimal procedural music bed (`src/audio/musicBed.ts`): a single
detuned-saw pad (110 Hz root, 800 Hz lowpass) + a triangle arp cycling a static
minor-pentatonic scale, with phase-gated gains (menu/countdown/racing/finished).
It works but is musically thin — no chord progression, bassline, melody, or
percussion; a fixed root; one timbre.

Direction (user): replace the bed entirely with a phase-specific score —
ambient menu, tense countdown, upbeat arcade racing, triumphant finish — in A
minor. Generation via Tone `Pattern` combinators over literal note pools.

Engine choice (user): Tone.js, accepting the ~80 KB gzip cost (`tone@15`,
`hasSideEffects: true`; `standardized-audio-context` shim ~328 KB raw is the
largest non-removable chunk). Rationale: Tone's `setContext` lets it share this
AudioManager's single AudioContext, and its `connect()` can target our native
`musicBus` GainNode — so the music-volume slider, mute, and compressor still
apply. Its synth vocabulary maps 1:1 to the design (`MembraneSynth` kick,
`MetalSynth` hat, `NoiseSynth` snare, `PolySynth` pad, `MonoSynth` bass/lead).
Considered and rejected: hand-rolled (too plain), Strudel (own ctx + scheduler +
transpiler; fights four invariants), Gibberish (opinionated worklet graph),
web-audio-scheduler (marginal; we had a working scheduler already).

## Goal

- Replace `musicBed.ts` with a Tone.js adaptive engine routed into `musicBus`.
- Per-phase score: chord pad + bass + generative lead + drum kit, BPM-gated.
- Keep the single-AudioContext ownership, the musicBus routing, the
  load-bearing voice build order (#4), and full no-op-before-resume safety.
- Stay zero-asset (all synthesis; no sample files).

## Non-goals

- No new settings UI (the existing MUSIC slider + `musicVolume` already drive
  `musicBus`).
- No changes to engine/drift/wind/rain/collision/rival voices.
- No live-coding REPL / Strudel-style string DSL (embedded function-call API).
- No sample sets (`s("bd")`); pure synths only (zero-media policy).

## Architecture (change)

```text
src/audio/musicEngine.ts   # NEW: MusicEngine (Tone synths + Transport +
                           #   Pattern/Sequence). Exports MusicPhase,
                           #   musicPhaseFor, MusicOptions, DEFAULT_MUSIC,
                           #   PHASE_CONFIG. Replaces musicBed.ts.
src/audio/musicEngine.test.ts  # NEW: pure musicPhaseFor + PHASE_CONFIG
                               #   invariants; graceful-degrade under mock.
src/audio/musicBed.ts      # DELETED (+ musicBed.test.ts).
src/audio/audioGraph.ts    # buildMusic -> MusicEngine; PersistentVoices.
                           #   musicBed -> musicEngine; stopMusic updated.
src/audio/AudioManager.ts  # setMusicPhase -> musicEngine.setPhase; drop
                           #   musicStateFor import.
src/audio/gameAudio.ts     # import musicPhaseFor from ./musicEngine.
package.json               # + tone runtime dep.
```

### Graceful degrade (load-bearing)

Tone's `standardized-audio-context` validates AudioParam types at construction
and throws (`param must be an AudioParam`) against the jsdom `MockAudioContext`,
leaking one stray gain per failed build. `supportsTone(ctx)` probes
`createConstantSource` (present on real AudioContext, absent on the mock) so
the engine builds ZERO nodes and no-ops under jsdom — the load-bearing voice
node indices stay stable and existing AudioManager tests stay green. A
constructor try/catch also degrades on any real-but-unsupported context.

### Phase map (A minor, root A2 = 110 Hz)

| Phase     | Pad           | Bass    | Lead       | Drums          | BPM |
| --------- | ------------- | ------- | ---------- | -------------- | --- |
| menu      | Am-F-C-G 4bar | -       | -          | -              | 80  |
| countdown | Am7sus pedal  | root    | -          | hat+kick       | 100 |
| racing    | Am-F-C-G 1bar | offbeat | pentatonic | kick+snare+hat | 140 |
| finished  | C-F-G-C major | root    | fanfare    | kick           | 110 |

## Tests

- `musicEngine.test.ts`: `musicPhaseFor` mapping; `PHASE_CONFIG` invariants
  (menu pad-only; racing full kit; finished opens C major; BPM monotonic up;
  gains >= 0); degraded engine under mock adds zero nodes, `isOk === false`,
  `setPhase`/`dispose` no-ops.
- Existing `gameAudio.test.ts` (setMusicPhase transition spy) + `GameFlow`
  menu-audio invariant unchanged.

## Docs

- `docs/knowledge/audio/music-engine.md` (new).
- Update `audio-manager.md`, `audio-graph.md`, `data-flows/audio-lifecycle.md`.

## Verify

`npm run verify:changed` then full `npm run verify`
(format -> typecheck -> lint -> lint:secrets -> test -> build -> lint:repo).
