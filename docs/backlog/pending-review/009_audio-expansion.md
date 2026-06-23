# 009 Audio expansion

Status: pending-review (implemented; 5 code commits + this docs/verify commit landed)

## Context

005 ships engine/drift/wind/UI/countdown only. Explicitly out of scope
(`005:64-66`): collision/impact, respawn cue, music, positional/3D pan,
doppler, 2P split-screen audio. 008 took the BASIC 2P pan (StereoPanner,
P1 -1 / P2 +1) via `src/audio/voiceSet.ts` + `panForIndex` +
`AudioManager.updatePlayers` (`voiceSet.ts:57-62`, `AudioManager.ts:347-355`).
009 keeps the rest of the sketch EXCEPT positional/3D/doppler, which splits
to 015 (`docs/backlog/open/015_positional-audio.md`). 008's per-player pan
already covers human-side spatial perception; rival 3D spatialization is
deferred polish (N `PannerNode`s + per-view listener sync + manual
doppler).

Real constraints the sketch left open, now resolved against the code:

- Collision source: no contact hook exists today. `PhysicsWorld` builds
  `this.eventQueue = new RAPIER.EventQueue(true)` (`PhysicsWorld.ts:24`)
  and passes it to `world.step(this.eventQueue)` (`:30`) but NOTHING drains
  it (grep `eventQueue` -> 3 hits, all in `PhysicsWorld.ts`). Contact-force
  events are NOT enabled on any collider (no `setActiveEvents` anywhere).
  API verified in `@dimforge/rapier3d-compat` 0.14: `ActiveEvents.
CONTACT_FORCE_EVENTS` (`event_queue.d.ts:16`), `ColliderDesc.
setActiveEvents` (`event_queue.d.ts:789`), `drainContactForceEvents` +
  `TempContactForceEvent.totalForceMagnitude` (`event_queue.d.ts:96,47`).
  Decision: Rapier contact-force events, not an impulse poll.
- eventQueue is `autoDrain:true` -> cleared BEFORE each `step()`. The
  fixed-step loop runs up to 5 `stepWorld`->`physics.step()` sub-steps/frame
  (`Game.ts:259-266,357`). Events MUST be drained inside `stepWorld` right
  after `physics.step()` (per sub-step); draining once/frame would lose all
  but the last sub-step. Cooldown state persists across sub-steps.
- Kart body collider only contacts props/other karts: wheels are raycast
  (`KartController.ts:181` suspension `applyImpulseAtPoint`), so body
  contact-force events ≈ real impacts, not terrain rumble.
- Respawn cue: `KartController.respawn()` is `void`, no args
  (`KartController.ts:268-277`); human respawn fires inside `fixedUpdate`
  on `input.reset` (`:148`). Rivals do NOT use it — `Game.respawnAhead`
  (`Game.ts:424-438`) mutates the body directly. Game owns BOTH call sites
  and knows `inputs[i].reset`, so the cue fires from Game (no
  `KartController` change).
- Music: zero-asset policy holds (`005:9`, AGENTS.md "Repo-Specific
  Rules"). Bed synthesized, not sampled. Music state has natural hooks:
  `onStart` (`Game.ts:453`), `onCountdownDone` (`:460`), finish
  detection (`:565`), `dispose`.
- AudioManager is raw Web Audio, no `THREE.Audio` (grep `AudioListener`/
  `PositionalAudio` in `src/` -> 0 hits). 009 keeps that.
- `AudioManager.ts` is 447/600 lines; `Game.ts` is 593/600. Both near cap.
  All new collision/respawn/music LOGIC goes in pure `src/audio/*` modules
  (mirrors `voiceSet.ts` extraction); AudioManager + Game get thin calls
  only. If Game crosses 600, extract a `gameAudio.step(...)` driver.
- Mock: `mockAudioContext.ts:112-173` has no `createPanner`/`listener` —
  not needed for 009 (no positional). Noise/osc/gain/buffer already mocked;
  verify BufferSource path for one-shots.

## Goal

Complete game-feel audio, zero-asset:

- collision/impact: Rapier contact-force event -> intensity-tiered impact
  one-shot (noise burst + lowpass + decay). Throttled (threshold + per-kart
  cooldown) so no machine-gun.
- respawn cue: short descending blip at both respawn sites (human
  `inputs[i].reset` during racing; rival `respawnAhead`).
- music bed: procedural pads + arp step sequencer, gated by game/race
  state (menu/countdown build -> racing -> finished fade). Zero asset
  files.

Out of scope (->015): positional/3D `PannerNode`, listener sync, doppler,
rival spatialization.

## Architecture (new)

```text
src/audio/
  collisionVoice.ts   # impact one-shot: noise burst -> lowpass -> decay
                      #   env. trigger(ctx,now,intensity). Pooled retrigger.
                      #   PURE impactTier(force,opts)->{gain,freq,decay}.
  respawnCue.ts       # descending blip: osc downward glide -> gain env.
                      #   play(ctx,now). PURE cueSpec()->{fromHz,toHz,decay}.
  musicBed.ts         # pads (detuned tri/saw -> lowpass -> gain) + arp step
                      #   sequencer (ctx-time lookahead). start(ctx)/stop()/
                      #   setState(s)->{padGain,arpGain,tempo}. PURE
                      #   musicStateFor(game,race)->MusicState + nextArpNote.
  impactRouting.ts    # PURE routeImpacts(events,handleMap,lastImpactAt,
                      #   now,opts)->{hits:{index,intensity}[],lastImpactAt}.
                      #   Threshold + per-kart cooldown dedupe. Keeps Game lean.
src/physics/
  PhysicsWorld.ts     # ADD drainContactForceEvents(cb) wrapping eventQueue;
                      #   re-export ActiveEvents. eventQueue stays autoDrain.
src/kart/
  KartController.ts   # collider desc .setActiveEvents(RAPIER.ActiveEvents.
                      #   CONTACT_FORCE_EVENTS) in the collider builder.
src/audio/
  AudioManager.ts     # ADD triggerImpact(intensity)->collisionVoice;
                      #   onRespawn()->respawnCue; musicBed built in resume();
                      #   setMusicState(state). All built inside resume()
                      #   (autoplay guard holds). 1P/2P unchanged.
src/core/
  Game.ts             # build colliderHandle->kartIndex map in buildField.
                      #   In stepWorld after physics.step(): drain events,
                      #   routeImpacts -> audio.triggerImpact per hit. Fire
                      #   audio.onRespawn() on human inputs[i].reset (racing)
                      #   + in respawnAhead(rival). Music: onStart->menu/
                      #   countdown build, onCountdownDone->racing, finish->
                      #   fade, dispose->stop. Thin calls; pure logic in audio.
```

## Contracts with 001-008

- 001: none new (no material change).
- 002: none.
- 003: none (heightmap unused by audio).
- 004: none new.
- 005: extends `AudioManager` (005 base). 1P/2P audio bit-identical until an
  impact/respawn/state-change fires. Autoplay guard (ctx lazy in `resume`,
  `AudioManager.ts:206-219`) preserved: collision/respawn/music built inside
  `resume()`.
- 006: hooks `onStart` (`Game.ts:453`) + `onCountdownDone` (`:460`) for
  music state. Does NOT modify `gameState.ts` (`gameState.ts:13,21-30`);
  music reads existing `state` + race `phase`.
- 007: consumes rival `Kart[]` (`Game.ts:184-189`) — full Kart instances with
  transforms; rival impacts surface via the handle map. AI unchanged.
- 008: 1P/2P pan (`voiceSet.ts`, `AudioManager.ts:347-355`) untouched. 009
  adds collision/respawn/music on top; both modes play them.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(physics): expose Rapier contact-force events + kart collider flag`
   - `PhysicsWorld.drainContactForceEvents(cb)` + re-export `ActiveEvents`;
     `KartController` collider `.setActiveEvents(CONTACT_FORCE_EVENTS)`.
   - tests: drain invokes cb per event (two-collider world steps in jsdom, as
     `KartController.test.ts`); collider flag set on the built collider.
2. `feat(audio): collision impact one-shot + impactTier`
   - `collisionVoice.ts` + pure `impactTier`; built lazily in `resume()`.
   - tests: `impactTier` thresholds/tiers monotonic; trigger wires noise
     source -> lowpass -> gain + ramps decay env.
3. `feat(audio): wire collision events -> impact SFX + handle map`
   - `impactRouting.ts` (pure dedupe/throttle); `AudioManager.triggerImpact`;
     `Game` collider-handle map + drain inside `stepWorld`.
   - tests: `routeImpacts` skips below threshold, dedupes within cooldown,
     maps handle->index; `Game.test.ts` mocks updated (no render change).
4. `feat(audio): respawn cue + wire both respawn sites`
   - `respawnCue.ts`; `AudioManager.onRespawn`; `Game` fires on human
     `inputs[i].reset` (racing) + inside `respawnAhead(rival)`.
   - tests: cue wiring; Game fires exactly once per reset input + per rival
     respawn.
5. `feat(audio): procedural music bed + state gating`
   - `musicBed.ts` (pads + arp ctx-time lookahead scheduler) + pure
     `musicStateFor`/`nextArpNote`; `AudioManager.setMusicState`; `Game`
     hooks at start/countdown/finish/dispose.
   - tests: start schedules pad+arp oscs; setState retunes gain/arp; stop
     disconnects; scheduler advances on ctx.currentTime.
6. `docs: refine 009 plan + todo + README + troubleshooting + split 015`
   - mark 009 full plan in `docs/todo.md`; new
     `docs/backlog/open/015_positional-audio.md` (deferred positional
     concept); README project structure adds new `src/audio/` files;
     troubleshooting verify case; 009 "needs refinement" -> resolved.

## Risks

- `Game.ts` 593/600, `AudioManager.ts` 447/600. All collision/respawn/music
  LOGIC in pure `src/audio/*` modules; Game/AudioManager do thin calls only.
  If Game crosses 600, extract a `gameAudio.step(...)` driver (pure, takes
  plain data, calls AudioManager methods).
- Impact machine-gun: threshold + per-kart cooldown (~80ms) in
  `routeImpacts`; cap impacts/frame. Rival-on-rival clatter could be noisy;
  threshold + cooldown mitigate.
- Rapier contact-force events fire for a pair if EITHER collider has the
  flag; enabling only on kart colliders covers kart-kart + kart-prop.
  Terrain/prop colliders need no change. v1 = kart-flagged only.
- Music scheduler drift under frame drops: ctx-time lookahead (not rAF);
  gated behind `gestured`; suspend via existing `suspend()`.
- Subtle drain-per-substep correctness: drain inside `stepWorld` after
  `physics.step()` (eventQueue is autoDrain). Cooldown persists sub-steps.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.
- One-shot pooling: retrigger must stop the prior source or gain stacks.
  Mitigation: restart envelope on a single reused gain node.

## Acceptance

- [ ] `collisionVoice.ts` + `respawnCue.ts` + `musicBed.ts` +
      `impactRouting.ts` present
- [ ] Impacts play on kart-kart / kart-prop contact, intensity-tiered,
      throttled (no machine-gun, no terrain rumble)
- [ ] Respawn cue plays on human R/reset AND on rival respawn
- [ ] Music bed plays, state-gated (menu/countdown build -> racing ->
      finished fade); zero asset files
- [ ] 1P + 2P modes unaffected (no regression to 008 pan/voices/wind)
- [ ] `AudioManager.ts` and `Game.ts` each <=600 lines
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; audible verify logged in
      `docs/troubleshooting/`

## Defaults

- collision: min-force threshold (skip below), 3 intensity tiers
  (low/mid/high -> gain+pitch), per-kart 80ms cooldown, single reused
  CollisionVoice (retrigger restarts env)
- respawn: fixed descending blip (660Hz->220Hz), one per respawn call
- music: pads + arp, fixed key + tempo; menu=countdown build (soft pads),
  racing=full (pads+arp), finished=fade out ~1.5s; music bus under master
  (own gain -> master -> compressor -> destination)
- out of scope (->015): positional/3D `PannerNode`, listener sync, doppler,
  rival spatialization

## Previous implementation

None. Closest patterns: `voiceSet.ts` extraction (008), one-shot envelope
(`AudioManager.ts` beep `:253`, `AudioManager.beeps.test.ts`), shared noise
buffer (`AudioManager.ts:343-367`), Rapier `EventQueue`
(`PhysicsWorld.ts:24,30`), race state hooks (`Game.ts:453,460,565`).

## Depends on

000 (harness; test gate live). 005 (`AudioManager` API, noise buffer,
master/compressor graph). 006 (`onStart`/`onCountdownDone` hooks). 007
(rival `Kart[]` as impact sources). 008 (2P pan baseline; 009 is additive).
Review/land 008 first (per its merge order). 010/011/012/014 unaffected.
015 is the split-off remainder of this sketch (forward dep, not blocking).
