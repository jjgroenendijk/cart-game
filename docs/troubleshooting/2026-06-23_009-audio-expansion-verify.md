# 2026-06-23 009 audio expansion verify

009 collision/respawn/music. Verify the new audio paths on the dev server
after all 5 code commits landed (1P + 2P). Cannot literally hear audio in a
headless browser; verified graph build, state transitions, impact/respawn
counters, no console errors, no 008 regression.

## Scope

Verified on the dev server (`npm run dev`) with Chrome DevTools MCP after
the 5 009 code commits (Rapier contact-force events, collision one-shot +
impactRouting, respawn cue at both sites, procedural music bed). 001-008 in
`pending-review/`. 009 adds `src/audio/{collisionVoice,respawnCue,musicBed,
impactRouting,gameAudio}.ts` + thin AudioManager/Game calls; this verify
drives menu -> countdown -> race -> finish in 1P then 2P.

## Result

Audio graph builds inside `resume()` on the START gesture; ctx -> "running"
(sr 44100). 1P builds 1 centered voice (0 panners); 2P builds 2 voices +
StereoPanners pan [-1, +1] (bit-identical to 008). musicBed +
collisionVoice + wind all present post-gesture; all absent pre-gesture
(autoplay guard holds — ctx null until the gesture).

Steps + observations:

- Boot: `#loading` hides, StartMenu renders (animated title, 1P/2P toggle,
  START, controls list). Canvas live: webgl2 true, 2402x1206. Not black.
  Pre-gesture: `audio.ctx` null, `isGestured` false, musicBed/collisionVoice
  absent (built only in `resume`).
- Click START (gesture): ctx built + "running". State menu -> countdown ->
  racing. `gameAudio.lastMusic` null in menu (flush runs only outside menu)
  -> countdown -> racing; `setMusicPhase` fires only on a transition.
- 1P racing: held W + A/D -> 54 impacts routed via `triggerImpact` in ~1.8s
  (routeImpacts threshold + per-kart cooldown throttle; no machine-gun
  stack). No error. Music phase "racing".
- 1P respawn: pressed R during active racing -> `onRespawn` fired once
  (delta 1). respawnCue path (osc glide 660->220Hz + env, self-cleans) also
  exercised directly on the live ctx -> no throw.
- 1P finish: race ended via "leader" mode (rival4 lap 3, `finished:true`) ->
  racePhase "finished" -> musicPhase "finished" (fade state). Confirms
  finished-phase gating.
- 2P: toggle "1 PLAYER" -> "2 PLAYERS" (P1: WASD / P2: Arrows controls
  grow). START -> 2 voices, 2 panners pan [-1, +1]. Two stacked half-height
  viewports (rect y=0 top, y=301.5 bottom over a 603px-tall canvas), 2 chase
  cams at distinct positions, two HUDs (distinct speed + POS). Impacts (7)
  - P1 respawn (1) fire in 2P same as 1P. Music phase "racing".
- No audio-related console errors/warnings across either flow. Only noise:
  `favicon.ico` 404 + Rapier "deprecated init params" warning (both pre-
  existing, unrelated to 009).

## Notes / handoffs

- Cannot hear audio headless. Verified by proxy: ctx.state, node presence
  (musicBed/collisionVoice/wind), and per-call counters wrapping
  `triggerImpact`/`onRespawn`. Screenshot of the 2P racing frame captured to
  `/tmp/009-2p-racing.png` but not visually parsed here; split confirmed
  structurally (2 viewports, 2 distinct cams, 2 HUDs).
- Rival respawn (`respawnAhead`, `Game.ts:444`) wiring not triggered live —
  AI stuck-recovery is nondeterministic. Confirmed by unit tests
  (`Game.test.ts`) + the cue path itself ran clean on the live ctx.
- Observed AI rivals complete 3 laps very fast (rival4 finishTime ~37.7s
  game-clock), so a 1P "leader" race ends in seconds. Pre-existing race/AI
  (007) behavior: 009 `flush` only reads `g.state` + `g.race.phase`
  (read-only), so it cannot cause this. Worth a separate 007 look; out of
  009 scope.
- P2 synthetic ArrowUp input weak (same limitation the 016 verify logged);
  P2 voice + panner still confirmed present + panned.
