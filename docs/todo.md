# Game Cart — backlog

Track A — visual/audio/menu overhaul: cartoony cel-shaded world, procedural
sky, height variation, environment dressing, procedural audio, start menu +
countdown (001-006).
Track B — gameplay + polish concepts post-overhaul: race systems + AI,
split-screen, audio expansion, dynamic world, LOD/perf, full front-end
(007-012), clouds + sky decor (014), positional audio (015). 007-009
implemented (pending-review); 010-015 still concept sketches (015 split
from 009 — positional/3D/doppler deferred from 009).
Track 0 — tooling & quality gate: git hooks — multi-lang lint+format
(ts/js/md/json/yml/html), max LOC/file, max line length, auto-format,
conventional-commits + asset/secrets guards (000). Foundational
prerequisite for every item's "green commit" gate.

## Tasks

### Track 0 — tooling & quality gate (000)

- [x] 000 Git hooks: multi-lang lint+format, max LOC/file, max line len,
      auto-format, conv-commits + asset/secrets guards — `pending-review/000`
- [x] 013 Agent rules sync: AGENTS tree, Mermaid, CLAUDE symlink —
      `pending-review/013`
- [x] 016 Dependency upgrade + Dependabot (Node 24, all deps latest,
      patch auto-merge) — `pending-review/016`

### Track A — overhaul (001-006)

- [x] 001 Toon cel-shading + outlines (reimplementation) — `pending-review/001`
- [x] 002 Procedural sky + lighting pass (reimplementation) — `pending-review/002`
- [x] 003 Terrain height variation + closed-loop circuit — `pending-review/003`
- [x] 004 Stylized environment dressing — `pending-review/004`
- [x] 005 Procedural audio system — `pending-review/005`
- [x] 006 Start menu + countdown + game state machine — `pending-review/006`

### Track B — gameplay + polish (sketches + plans, 007-021)

- [x] 007 Track 01 race + AI opponents — `pending-review/007`
- [x] 008 2-player split-screen — `pending-review/008`
- [x] 009 Audio expansion — `pending-review/009`
- [x] 010 Dynamic sky, weather + moon/stars — `pending-review/010`
- [x] 011 LOD + performance budget — `pending-review/011`
- [x] 017 Ambient wildlife — `pending-review/017`
- [x] 018 Water buoyancy + life bar — `pending-review/018`
- [x] 012 Menu: pause + settings v1 — `pending-review/012`
- [ ] 020 Track + kart select — `open/020`
- [ ] 022 Perf pass — `open/022`
- [x] 019 Terrain chunking — `pending-review/019`
- [x] 014 Clouds + sky decorations — `pending-review/014`
- [x] 015 Positional audio (rival 3D + doppler) — `pending-review/015`
- [ ] 021 Terrain shade-quantisation (heightmap-texel normal) — `open/021`
- [ ] 023 Infinite procedural terrain (wall removal + streaming dressing) —
      `open/023`

## Status

000 implemented (pending-review) — quality gate landed: prettier + eslint +
markdownlint + vitest + secretlint configs in tools/, .githook dispatcher +
7 pre-commit fragments + commit-msg, npm run setup wires core.hooksPath,
baseline cleanup green. Every item's "per 000 harness" test gate is now live
(run `npm run setup` after clone). See `pending-review/000`.
001 implemented (pending-review) — custom cel ShaderMaterial pipeline
(lightUniforms + CelMaterial + fixed screen-space InvertedHullMaterial +
PostOutlinePass Sobel), EffectComposer wired, kart + tracks migrated off
toon.ts (deleted). 20 tests; visually verified via dev server. See
`pending-review/001`.
013 implemented (pending-review) — root agent rules synced with attached
requirements; AGENTS/CLAUDE pairing and Mermaid block checked by hook. See
`pending-review/013`.
002 implemented (pending-review) — synthetic Ghibli gradient blend over
stock Preetham Sky (SkyPosterizePass: depth-masked, UV.y-banded, 4
visible bands zenith->horizon). lightUniforms gains uSunDirWorld (single
shared sun vector). Renderer palette retuned (hemisphere/directional/fog).
Sun-disc overlay sprite owed (synthetic blend at uBandMix=0.85 obscures
the Preetham sun spot). See `pending-review/002`.
003 implemented (pending-review) — closed Catmull-Rom circuit (SplineTrack) +
seeded simplex height field (heightmap/SplineFieldCache/colorAt) feeding BOTH
the displaced vertex-colored PlaneGeometry mesh (layer 1, CelMaterial
vertexColors) and a Rapier collider, all from one heightAt fn. collider is a
TRIMESH, not the planned heightfield (Rapier 0.14 heightfield rays miss ~60%;
trimesh reuses the mesh's vertices -> 0 ray misses). KartController.respawn
resets to ctor spawn; Game spawns at the spline start. TestArena deleted.
72 tests; visually verified driving a closed loop. See `pending-review/003`.
004 implemented (pending-review) — deterministic seeded prop dressing
(propSampler jittered-grid + corridor/spawn/slope rejection), procedural
cel geometry (propFactory), PropField (big props + Rapier colliders +
InstancedMesh decor, full dispose), cel water plane on layer 1, drifting
instanced clouds. CelMaterial gains USE_INSTANCING support; Terrain gains a
waterLevel getter (003 valley hook). 004 acceptance items are code-verified;
visual verify (no black screen, castRayDown prop-conformity sample, draw-
call count) deferred to the review pass — see
`docs/troubleshooting/2026-06-22_004-environment-dressing.md`. 005-006 not
started.
005 implemented (pending-review) — procedural Web Audio layer (zero asset
files): engineCurve pure 6-gear RPM mapping, noiseBuffer (shared white
noise), AudioManager synthesizing engine (3 detuned saws + sub sine ->
lowpass -> gain, pitch tracks speed), drift (bandpass, gated by isDrifting
&& speed>7), wind (lowpass, rises with speed), UI beeps (hover/click/beep/
go, auto-clean). AudioContext built ONLY inside resume() (autoplay guard);
Game wires AudioManager silent (update + dispose); 006's Start click calls
resume() to make it audible. 201 tests; build verified (44 modules). Full
audible verify + no-black-screen deferred to 006 — see
`docs/troubleshooting/2026-06-22_005-procedural-audio.md`.
006 not started (005 audio API provider; 006 gesture/integration consumer).
006 implemented (pending-review) — start menu + countdown + game state
machine. Pure `transition()` (menu->countdown->racing, racing terminal,
illegal no-op) gates the loop: menu = no physics; countdown = fixed-step
settle (zero input + zeroed XZ linvel, keeps Y so the kart drops onto
the surface); racing = real input. StartMenu overlay (animated title +
START + controls list, click/Enter/Space confirm once, hover/click
beeps) and Countdown overlay (3-2-1-GO, phase beeps) in new `src/ui/`.
MenuCamera orbits a scenic spline point; ChaseCamera snaps on the first
racing frame (separate objects). HUD is now speed-only (controls moved
to the menu); hidden in menu/countdown. Renderer rebinds the active
camera on all composer passes each frame so the menu/chase swap works.
Start -> audio.resume + setEngineActive(false); GO -> setEngineActive
(true); audio.update fed zeros until racing. Dev-server verified:
menu->countdown->race flows, HUD shows in racing, kart drives, audio
gestured. Also fixed a latent 004 CelWaterMaterial USE_FOG crash
(undeclared fog uniforms) that aborted the whole composer render ->
blocked the on-screen flow. See
`docs/troubleshooting/2026-06-22_006-menu-countdown-verify.md`.
007-009 implemented (pending-review). 010 implemented (pending-review):
dynamic sky + weather + moon/stars landed in 4 atomic commits (dayCycle
pure module + singleton, Renderer apply, DynamicSky controller with
star/moon decor, Weather seeded rain/snow preset). Game.ts stays at
600/600 (env.update reordered before render, net-zero). 017/018 still
ready for execution; 011 refined (terrain LOD split to 019); 012 implemented
(pending-review): pause + settings v1; track/kart select split to 020
(concept); 014/015/019
still concept sketches (014 forward-deps on 010's phase read for cloud
tint/density). Dependency gate:
Track B items build on Track A (001 foundational; 006 gates menu; 003
gates race/AI). 007 also depends on 004 (owns src/core/rng.ts). 014
forward-deps on 010 (time-of-day/weather drives cloud tint+density post-
014 landing). 015 depends on 009 (split-off remainder). 018 depends on
008 (per-human PlayerView for life bars). 020 splits from 012 (select; needs
multi-track plumbing). 011's Renderer.setQuality landed, so a future
settings-v2 quality toggle is unblocked (012 v1 scoped it out).
008 implemented (pending-review) — local 2P split-screen. voiceSet extracts
the per-player engine+drift bundle; Renderer.renderViews draws one composer
per viewport (scissor+viewport, autoClear off); PlayerView bundles each
human's kart + chase cam + speed HUD + rect; RaceManager gains finishWhen
'allHumans' so 2P races until both humans finish; StartMenu carries a 1P/2P
mode into onStart; AudioManager builds N StereoPanner voices (P1 -1, P2 +1)
with a shared wind, driven by updatePlayers. 1P stays bit-identical. 395
tests; dev-server verified (menu + 2P split render, two HUDs/positions, audio
gestured). Basic per-player pan landed here (was 009's); see
`docs/troubleshooting/2026-06-23_008-split-screen-verify.md`.
009 implemented (pending-review) — audio expansion. Rapier contact-force
events (PhysicsWorld.drainContactForceEvents + CONTACT_FORCE_EVENTS on the
kart collider) feed a collision one-shot (collisionVoice: noise burst ->
lowpass -> decay env, intensity-tiered) through impactRouting (pure
threshold + per-kart cooldown dedupe); respawnCue (660->220Hz glide) fires
at both respawn sites (human inputs[i].reset + rival respawnAhead);
procedural musicBed (detuned-saw pads + ctx-time lookahead arp) is gated by
race phase (menu/countdown build -> racing -> finished fade). GameAudioDriver
owns the collider-handle map + drains per sub-step; AudioManager stays 542
lines, Game stays 600 (at cap). Zero asset files; all new logic in pure
src/audio modules. Dev-server verified (1P + 2P: graph builds on gesture, impacts +
respawn + music-phase transitions fire, 008 pan/voices/wind unchanged, no
errors); see `docs/troubleshooting/2026-06-23_009-audio-expansion-verify.md`.
016 implemented (pending-review) — dependency upgrade + Dependabot. Node 24
in CI/deploy, Dependabot npm + GitHub Actions weekly/Monday with `chore(deps)`
prefix and patch auto-merge workflow. All deps latest (`npm outdated --long`
empty): patch deps, ESLint 10, TypeScript 6, Vite 8, Vitest 4/jsdom 29,
Three r184 + types, Rapier 0.19.3. Final headless gate green. Rapier
heightfield rays still miss 217/361 on 0.19.3, so terrain stays on trimesh.
Browser smoke: Vite menu loads, 2P split renders nonblank, P1 physics/input
moves; P2 physical input still needs manual review because synthetic
Playwright ArrowUp did not move P2. See `pending-review/016`.
011 implemented (pending-review) — LOD + performance budget, 5 atomic code
commits + an AGENTS.md refresh. Pure perf sampler/budget (`core/stats.ts`),
F3 StatsHud overlay (`ui/StatsHud.ts`; Game.renderer -> public, Game.ts
600/600), big-prop spatial bucket merge (PropField: ~400 draw calls -> <=8
merged meshes, colliders unchanged), `core/quality.ts` + Renderer.setQuality
(default high == prior look), distance kart LOD (`kart/kartLod.ts` + per-
render nearest-camera pass; full/reduced/minimal + hysteresis). 585 tests
(+56). Build green. Runtime draw-call/FPS numbers + no-black-screen deferred
to a live F3 readout pass; see
`docs/troubleshooting/2026-06-24_011-lod-perf-verify.md`. 012 forward-deps
on Renderer.setQuality.
012 implemented (pending-review) — pause + settings v1, 8 atomic commits. New
`paused` state (racing<->paused, paused->menu); PauseOverlay (dim backdrop,
Resume/Settings/Quit) wired to Esc + audio suspend/resume + quit->field
rebuild; SettingsOverlay (master/music/sfx sliders + mute, live-apply +
persist via versioned localStorage); AudioManager sfx+music bus gains
(independent balance, default 1.0); shared `ui/menuNav.ts` (pure
digestGamepad + class) gives keyboard + gamepad nav across start/pause/
settings. A net-zero FieldBuilder refactor freed Game headroom (600->443).
Game owns settings (not main.ts) per src/AGENTS.md. 687 tests (+102); dev-
server verified (menu loads, SETTINGS opens the overlay, no black screen, no
errors). Live gamepad + audible balance + quit-cycle leak checks deferred to
review; see `docs/troubleshooting/2026-06-25_012-menu-pause-settings-verify.md`.
014 implemented (pending-review) — clouds + sky decor, 4 atomic commits.
Pure `clusterLayout(opts)` helper (cloudCluster.ts) builds multi-puff cloud
clusters; Clouds rewritten to ONE InstancedMesh of count\*puffsPerCloud
(default 6 puffs/cloud -> painted-blob silhouettes, 1 draw call). Day-cycle
tint via dayCycleState: pure `cloudTintFor(phase, skyHorizon, base, out)`
lerps base toward horizon (dawn/dusk 0.45, night 0.3, day 0); Clouds.update
reads the singleton each frame + writes uColor. density + altitude knobs
added to CloudsOptions. New `environment/SunDisc.ts` (additive layer-0 disc
mirroring 010's moon; opacity = 1 - nightFactor; tracks sunDirWorld at
shell 1500) wired into Environment after DynamicSky -> pays the 002
sun-disc debt. 728 tests (+35); typecheck + lint green. Dev-server visual
verify deferred; see `docs/troubleshooting/2026-06-25_014-sky-decor-verify.md`.
015 implemented (pending-review) — positional/3D rival audio + manual doppler, 4
atomic code commits + docs. New pure `src/audio/rivalVoices.ts` (`dopplerShift`

- `pannerDefaults` + `PositionalVoice` engine synth -> PannerNode +
  `RivalVoiceBank` driving ctx.listener; deprecated setPosition/setOrientation
  feature-detected); mock gains MockPanner + listener. AudioManager builds the bank
  into sfxBus in startPersistentVoices + thin setRivalCount/updateRivals/
  setPositional/setHrtf (AM 600/600; gate on setEngineActive; dispose frees
  panners). New pure `src/core/listenerTransform.ts` (listenerMidpoint);
  FieldBuilder.rivalAudioStates (rival throttle 1 racing) + listenerTransform
  (human midpoint); Game.frame calls updateRivals after updatePlayers. settings.ts
- SettingsOverlay gain positionalAudio (default true) + hrtf (default false)
  checkbox rows, forwarded in applySettings; no schema bump (old v1 stores load +
  default). Humans untouched (008 StereoPanner stays); music/impacts/respawn
  unchanged. 773 tests (+45); build green. Live audible + no-black-screen verify
  deferred to review; see
  `docs/troubleshooting/2026-06-25_015-positional-audio-verify.md`.
  017 implemented (pending-review) — ambient wildlife, 3 atomic code commits + an
  AGENTS.md refresh + docs. New pure `src/environment/critters.ts`
  (`placeCritters` jittered-grid + corridor/slope/spawn/bounds rejection; sky vs
  ground altitude bands; `critterPose` pure fn of time) + `src/environment/
Wildlife.ts` (one flat-shaded CelMaterial InstancedMesh on layer 0, NO outline,
  seeded placement, `update` recomputes matrices via `critterPose(time)` ->
  deterministic; dispose idempotent). Environment bundles Wildlife as child 6
  (indices 0-5 stable), cascades update + dispose; ZERO Game.ts edits (children
  self-seed like Clouds). 794 tests (+21); build green. Live visual + no-black-
  screen verify deferred to review; see
  `docs/troubleshooting/2026-06-26_017-ambient-wildlife-verify.md`.
  018 implemented (pending-review) — water buoyancy + life bar, 4 atomic code
  commits + docs. New pure `src/kart/buoyancy.ts` (`buoyancyForce` depth->up
  impulse + drag, `lifeDelta` drain/recover, `clampLife`; DEFAULT_BUOYANCY
  floatStrength 60 > gravity impulse ~42.5 so karts float strong when deep).
  KartController/Kart gain an optional `waterLevel` ctor param (null = disabled,
  backward compatible) + `fixedUpdate(dt, input, drainLife=false)`: upward
  impulse at the chassis + XZ linvel drag while submerged, `life`/`inWater`
  tracking (drain only when submerged && drainLife, recover out), `resetLife`;
  no self-respawn (FieldBuilder owns fail-out). New `src/ui/LifeBar.ts` (blue
  per-human DOM bar, RaceHud pattern). FieldBuilder passes `terrain.waterLevel`
  into every Kart, builds a LifeBar per human into PlayerView, drains life only
  while driving (`driving && !finished` humans, `driving` rivals), and
  respawns-ahead + resetLife on empty (humans + rivals). PlayerView `setLife`/
  `repositionLife`; Game `updateLifeBars` + onResize reposition. 818 tests
  (+24); build green. Live visual + no-black-screen verify deferred to review;
  see `docs/troubleshooting/2026-06-26_018-water-buoyancy-lifebar-verify.md`.
  019 implemented (pending-review) — terrain chunking, 5 atomic code commits +
  docs. World tiles into a grid (v1 8x8) of standalone layer-1 meshes + Rapier
  trimesh colliders built from one pure HeightSource (chunk layer never imports
  SplineFieldCache -> future streaming track supplies its own). Pure
  `chunkBuilder.ts` (buildChunk + buildSkirt) + `terrainLod.ts` (near/mid/far
  bands + ~chunkSize hysteresis, mirrors kartLod; segmentTier keyed off
  quality) + `TerrainChunkManager.ts` (activate/deactivate/update/dispose;
  mesh merges chunk+skirt, collider uses chunk only so verts match by
  construction). Terrain swaps single mesh+collider for the manager over a
  WorldHeightSource; heightAt/normalAt/waterLevel/spline/startPos unchanged;
  add update(cameras) + dispose (chunks + wall meshes + wall bodies +
  materials). Renderer.applyTerrainLod runs once per renderViews after
  applyKartLod (1P/2P nearest-cam); Game sets renderer.terrain +
  terrain.dispose (body count -> 0). Ray-parity guard passes across the
  chunked collider set (0 misses, seam-free). 873 tests (+55); build green.
  Live visual + F3 perf readout deferred to review; see
  `docs/troubleshooting/2026-06-27_019-terrain-chunking-verify.md`.
  022 open (concept refined to full plan) — perf pass. Measured follow-on to
  011: render-pass reduction (share DepthTexture across composer mask passes,
  gate post when not racing), GC elimination (pool raycast/impulse/AI/audio/
  day-cycle scratch across the fixed-step loop), terrain + physics hot paths
  (O(1) spline `t` cache; clamp physics accumulator; toggle pre-built trimesh
  bodies on LOD change; solver 8 -> 6), static-object waste (`matrixAutoUpdate`
  off on terrain/props/water/sky; skip kartLod traverse on unchanged level;
  decor draw-distance cull), polish (physics->visual interpolation, CSM,
  audio silence-gate, weather partial upload). One bundled correctness fix:
  `colorAt` toLinearScratch aliasing. Phase 0 fixes the F3 StatsHud sampling so
  gains are measurable. See `open/022`.

## Refinement status

Concept sketches — still need refinement into full plans:

- 020 track + kart select

Full plans — ready for execution:

- 001 cel-shading · 002 sky · 003 terrain · 004 dressing · 005 audio
  · 006 menu · 007 race + AI · 008 split-screen
  · 014 clouds + sky decor · 017 ambient wildlife
  · 022 perf pass
  · 023 infinite procedural terrain (wall removal + streaming dressing)

Done (pending-review):

- 000 quality gate
- 001 cel-shading
- 013 agent rules sync
- 002 sky
- 003 terrain height variation + closed-loop circuit
- 004 stylized environment dressing
- 005 procedural audio
- 006 start menu + countdown + game state machine
- 007 track 01 race + AI opponents
- 008 2-player split-screen
- 009 audio expansion
- 010 dynamic sky, weather + moon/stars
- 016 dependency upgrade + Dependabot
- 011 LOD + performance budget
- 012 menu: pause + settings v1
- 014 clouds + sky decorations
- 015 positional audio
- 018 water buoyancy + life bar
- 019 terrain chunking

## Legend

`- [ ]` open · `- [~]` in progress · `- [x]` done

Tracking files live in `docs/backlog/{open,pending-review,done}/`.
