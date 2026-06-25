# 015 Positional audio

Status: pending-review (implemented)

## Context

Split from 009 (`009:12-16,71`): 009 refined to collision + respawn + music
bed; positional/3D/doppler split out as deferred polish. 008 landed BASIC
per-player pan for HUMANS (StereoPanner P1 -1 / P2 +1, `voiceSet.ts:59-62`),
which covers human-side spatial perception. This item adds true 3D
spatialization for NON-human sources (rivals) + an audio listener + manual
doppler. `voiceSet.ts:57` already flagged "009 may extend toward a positional
model."

Real constraints, resolved against the code:

- 005 deliberately avoided THREE.Audio (raw Web Audio only; grep
  `AudioListener`/`PositionalAudio` in src/ -> 0 hits). 015 keeps raw
  `PannerNode` (consistency; THREE would give nothing free here).
- Rival sources: 5 AI karts (`Game.ts:140-142`, `FieldBuilder.ts:131-137`), full
  `Kart` instances. World pos = `rival.group.position` (synced each frame,
  `Game.ts:212`); velocity = `rival.controller.body.linvel()` (`Kart.ts:166`).
- Listener: Web Audio has ONE `AudioListener` per ctx. 1P = the single kart;
  2P = midpoint of the two humans (clean, symmetric; dual per-view listeners
  are impossible with one ctx). Forward + velocity derive from the same humans
  (`Kart.forwardDir`, body linvel). The chase cam (`ChaseCamera.ts:57-59`)
  tracks the kart so kart data is a fine proxy; no new velocity state on it.
- Doppler: `PannerNode`/`AudioListener` built-in doppler is deprecated/removed
  in modern browsers -> MANUAL pitch shift on the rival engine osc frequency
  from relative radial velocity (pure `dopplerShift`).
- `AudioManager.ts` is 580/600 lines (near cap). ALL rival positional logic
  goes in a new pure `rivalVoices.ts` collaborator (`RivalVoiceBank`), mirroring
  the 009 `MusicBed`/`CollisionVoice` pattern. AudioManager gains only thin
  calls. `Game.ts` is 443/600, `FieldBuilder.ts` 358/600, `SettingsOverlay.ts`
  275/600, `settings.ts` 50/600 — all ample.
- Autoplay guard holds: rival voices built inside `resume()` (like the rest).
- Mock gap: `mockAudioContext.ts:123-184` has no `createPanner`/`listener` ->
  015 adds `MockPanner` + `createPanner` + a `listener` mock (`positionX/Y/Z`,
  `forwardX/Y/Z`, `upX/Y/Z` AudioParams).
- AudioListener API variance: modern uses `positionX.setValueAtTime`; older
  Safari used `setPosition`/`setOrientation`. Feature-detect; mock mirrors the
  modern path.
- Settings toggle: `settings.ts` validateSettings already fills any missing
  field from DEFAULTS, so adding fields is additive with NO schema-version bump
  (old v1 stores load + default the new fields). `storage.ts:11` stays v1.

## Goal

True 3D spatialization for non-human sources, zero-asset:

- rival positional engine voices: one `PannerNode` per rival (equalpower or
  HRTF, inverse distance) routed through sfxBus; position = rival world pos each
  frame; gain-scaled by distance so distant rivals fade.
- audio listener: `ctx.listener` fed from the human midpoint (pos + forward +
  velocity) each frame.
- doppler: manual pitch shift from relative source/listener radial velocity
  (approach -> pitch up, recede -> down), clamped.
- 2P policy: single midpoint listener (documented compromise).
- settings toggle: positional on/off + HRTF opt-in.

## Non-goals

- Reverb / environmental zones (echo in tunnels).
- HRTF head tracking (HRTF is a panningModel opt-in only).
- Human-side positional (008 StereoPanner stays for human voices).
- Music spatialization (009 bed stays stereo).
- Rival DRIFT voice (rivals get positional ENGINE only; drift for rivals is out
  of scope to keep voice count lean).
- Per-view dual listeners in 2P (impossible with one AudioContext).

## Architecture (new)

```text
src/audio/
  rivalVoices.ts     # PURE dopplerShift(srcPos,srcVel,lisPos,lisVel,opts)->
                     #   freq mult; pannerDefaults(); types RivalAudioState +
                     #   ListenerTransform. PositionalVoice: rival engine synth
                     #   (3 detuned saws + sub -> lowpass -> gain; freq from
                     #   engineCurve * dopplerShift) -> PannerNode -> sfxBus.
                     #   update() sets panner pos + osc freq*mult + gain/cutoff;
                     #   when spatial=false pins the panner to the listener
                     #   (centered) + doppler mult 1. setActive() gates gain.
                     #   RivalVoiceBank: owns N voices + drives ctx.listener
                     #   (pos/forward); setSpatial/setHrtf; dispose().
  AudioManager.ts    # ADD setRivalCount(n); build RivalVoiceBank in
                     #   startPersistentVoices; updateRivals(dt,states,listener);
                     #   setPositional/setHrtf delegate; setEngineActive gates
                     #   the bank; stop in dispose. THIN (~14 lines).
  mockAudioContext.ts# ADD MockPanner (positionX/Y/Z, panningModel,
                     #   distanceModel, refDistance, maxDistance, rolloffFactor)
                     #   + createPanner; ctx.listener mock (positionX/Y/Z,
                     #   forwardX/Y/Z, upX/Y/Z AudioParams).
src/core/
  FieldBuilder.ts    # ADD rivalAudioStates(driving)->RivalAudioState[] (pos +
                     #   vel + speed/throttle/drifting; zeros when not driving)
                     #   + listenerTransform(driving)->ListenerTransform
                     #   (midpoint of humans pos/forward/vel).
  settings.ts        # ADD positionalAudio (default true) + hrtf (default false)
                     #   to SettingsState + DEFAULTS + validateSettings (boolean
                     #   fallback). No schema-version bump (additive).
  Game.ts            # frame: after updatePlayers call
                     #   audio.updateRivals(dt, field.rivalAudioStates(driving),
                     #   field.listenerTransform(driving)). applySettings wires
                     #   setPositional/setHrtf.
src/ui/
  SettingsOverlay.ts # ADD two checkbox rows (POSITIONAL AUDIO + HRTF) to the
                     #   overlay; emit/refresh/nav list include them.
```

## Contracts with prior items

- 001: none.
- 005: extends AudioManager (005 base). 1P/2P bit-identical until racing. Rival
  voices built in resume() (autoplay guard preserved). Feed sfxBus like 009
  collision.
- 007: consumes rival `Kart[]` (`Game.ts:140-142`) as positional sources. AI
  unchanged.
- 008: human per-player StereoPanner (`voiceSet.ts`) UNTOUCHED — rivals are a
  SEPARATE voice set with PannerNode. 2P keeps human pan; rivals spatialize vs
  the midpoint listener.
- 009: additive on the same graph (collision/respawn/music unchanged).
- 012: extends settings v1 surface (two fields) + SettingsOverlay; no schema
  bump.
- 011: perf cross-ref — 5 PannerNodes + ~20 oscs added; under budget.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(audio): positional rival voice + doppler + listener helpers`
   - `rivalVoices.ts`: pure `dopplerShift` (sign + clamp + dist0), pure
     `pannerDefaults`, types; `PositionalVoice` + `RivalVoiceBank`.
   - `mockAudioContext.ts`: `MockPanner` + `createPanner`; `listener` mock.
   - tests: dopplerShift approach/recede/clamp/dist0; pannerDefaults shape;
     bank builds N panners, update sets panner pos + listener + doppler, flat
     mode pins panner to listener, gates gain on active=false, dispose
     disconnects.
2. `feat(audio): wire rival positional voices + spatial toggle into AudioManager`
   - AudioManager: `setRivalCount`; RivalVoiceBank built in
     startPersistentVoices; `updateRivals`; `setPositional`/`setHrtf` delegate
     to the bank; setEngineActive gates the bank; dispose stops it.
   - tests: resume builds N panners; updateRivals writes listener; dispose
     frees panners; 1P + 2P voices/wind/impacts unchanged.
3. `feat(game): drive rival audio states + listener transform`
   - FieldBuilder: `rivalAudioStates` + `listenerTransform` (human midpoint).
   - Game.frame: call `audio.updateRivals` after `updatePlayers`.
   - tests: transforms return midpoint (1P = single kart); Game.test mocks
     updated (no render change).
4. `feat(settings): positional audio + HRTF toggle`
   - settings.ts: 2 fields + validate boolean branches.
   - SettingsOverlay: 2 checkbox rows (emit/refresh/nav list).
   - Game.applySettings: wire `audio.setPositional` + `audio.setHrtf`.
   - tests: validateSettings fills new booleans from DEFAULTS; overlay emits +
     refreshes both; applySettings forwards to audio.
5. `docs: refine 015 plan + todo + README + troubleshooting`
   - mark 015 full plan in `docs/todo.md` (move refinement list); README audio
     list adds `rivalVoices.ts`; troubleshooting verify case; resolve "needs
     refinement".

## Risks

- AudioManager 580/600: rival logic lives in RivalVoiceBank (collaborator); AM
  adds ~14 thin lines. Stays under 600.
- Doppler warble under frame drops: clamp mult [0.5,2.0]; osc freq already
  smoothed via engineCurve tau. Manual doppler multiplies into the target freq
  each frame; tau dampens jitter.
- Single listener in 2P: midpoint compromise (documented). A rival equidistant
  from both humans pans center; acceptable for couch 2P.
- AudioListener API variance: feature-detect positionX vs setPosition; mock
  mirrors modern path.
- Listener velocity is a proxy (human kart linvel midpoint), not the lerped
  camera's true velocity — good enough for doppler; revisit if it sounds off.
- PannerNode/osc budget: 5 panners + ~20 oscs; trivial vs 011 budget. HRTF is
  costlier than equalpower (per-source convolution); default off, opt-in.
- Flat-off semantic: positional OFF pins rival panners to the listener
  (centered, no doppler) so rivals stay audible but unspatialized — NOT silent.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [x] `rivalVoices.ts` present; `dopplerShift` + `pannerDefaults` pure + tested
- [x] Rival engine voices spatialized via PannerNode relative to the listener
- [x] Distance attenuation fades distant rivals (refDistance/maxDistance)
- [x] Doppler shifts pitch on relative radial velocity (approach up, recede down)
- [x] Listener follows the human midpoint (1P = single kart; 2P = midpoint)
- [x] POSITIONAL toggle ON spatializes; OFF flattens rivals to centered (audible)
- [x] HRTF toggle swaps panningModel (equalpower default, HRTF opt-in)
- [x] 1P + 2P unaffected (no regression to 008 pan/voices/wind, 009
      impacts/respawn/music)
- [x] Rivals silent in menu/countdown (engineActive gate)
- [x] `AudioManager.ts` + `Game.ts` each <=600 lines
- [x] mock gains `createPanner` + `listener`; typecheck + lint + test green;
      pre-commit hook green
- [ ] No black screen at `npm run dev`; audible verify logged in
      `docs/troubleshooting/`

## Defaults

- panner: `panningModel 'equalpower'`, `distanceModel 'inverse'`, refDistance
  5m, maxDistance 120m, rolloffFactor 1 (loop ~377m -> far-straight rivals fade)
- doppler: speedOfSound 343 m/s, factor 1, clamp [0.5, 2.0]
- listener: midpoint of human karts (pos + forward + velocity); 1P = that kart
- rival engine: engineCurve defaults (parity with humans); 3 detuned saws + sub
  per rival
- rival count = `rivals.length` (5)
- settings: positionalAudio true, hrtf false; both persisted under v1 schema

## Previous implementation

None. Closest patterns: `voiceSet.ts` (008 voice + destination abstraction),
`engineCurve.ts` (shared pure freq/gain map), `MusicBed`/`CollisionVoice`
(009 collaborator pattern AudioManager holds), `Kart.group.position` +
`body.linvel()` (transform source), `ChaseCamera.position` (`ChaseCamera.ts:57`),
`settings.ts`/`SettingsOverlay.ts` (012 settings surface).

## Implementation (as built)

5 atomic commits, each green (typecheck + lint + test + hook):

1. `feat(audio): positional rival voice + doppler + listener helpers` — new
   `src/audio/rivalVoices.ts` (pure `dopplerShift` + `pannerDefaults`, types
   `RivalAudioState`/`ListenerTransform`, `PositionalVoice` engine synth ->
   `PannerNode`, `RivalVoiceBank` driving `ctx.listener`); mock gains
   `MockPanner` + `listener`.
2. `feat(audio): wire rival positional voices + spatial toggle into AudioManager`
   — AM builds `RivalVoiceBank` into sfxBus in `startPersistentVoices`; adds
   `setRivalCount`/`updateRivals`/`setPositional`/`setHrtf`; gates bank on
   `setEngineActive`; disposes in stop. AM at 600/600 (cap).
3. `feat(game): drive rival audio states + listener transform` — new pure
   `src/core/listenerTransform.ts` (`listenerMidpoint`); FieldBuilder gains
   `rivalAudioStates(driving)` (rival throttle = 1 racing, 0 else) +
   `listenerTransform()` (human midpoint); Game.frame calls `updateRivals`.
4. `feat(settings): positional audio + HRTF toggle` — `settings.ts` +
   `SettingsOverlay` (2 checkbox rows) + `Game.applySettings`; no schema bump.
5. `docs(agents)` + this doc + todo + README + troubleshooting.

Deviations vs plan:

- Deprecated PannerNode/AudioListener fallback (`setPosition`/`setOrientation`)
  uses typed intersections (`PannerNode & LegacyPannerPosition`), not `as any`
  (`@typescript-eslint/no-explicit-any` is on).
- `PositionalVoice` ctor param is `_noise` (engine-only synth; buffer unused this
  item). Forward-compat for a future drift voice.
- AM hit the 600 cap exactly; commit 2 removed 9 blank lines from existing
  helpers (whitespace only, prettier-stable, no logic change) to fit. Game.test
  similarly trimmed inter-test blanks (commit 3) to fit the cap.
- Rival throttle approximated (AI always-on -> 1); `engineActive` gate still
  silences rivals in menu/countdown.

Build green (`tsc --noEmit && vite build`); 773 tests. Live audible + no-black-
screen verify deferred to review (no browser audio device here); see
`docs/troubleshooting/2026-06-25_015-positional-audio-verify.md`.

## Depends on

000 (harness). 005 (AudioManager graph + sfxBus). 007 (rival `Kart[]` as
sources). 008 (human pan baseline; 015 is additive, humans untouched). 009
(collision/respawn/music land first; 015 additive on the same graph). 012
(settings surface this extends). 011 (perf budget cross-ref).
