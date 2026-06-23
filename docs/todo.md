# Game Cart — backlog

Track A — visual/audio/menu overhaul: cartoony cel-shaded world, procedural
sky, height variation, environment dressing, procedural audio, start menu +
countdown (001-006).
Track B — gameplay + polish concepts post-overhaul: race systems + AI,
split-screen, audio expansion, dynamic world, LOD/perf, full front-end
(007-012), clouds + sky decor (014). 007-008 full plans (007 implemented
pending-review; 008 implemented pending-review); 009-014 still concept
sketches.
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

### Track A — overhaul (001-006)

- [x] 001 Toon cel-shading + outlines (reimplementation) — `pending-review/001`
- [x] 002 Procedural sky + lighting pass (reimplementation) — `pending-review/002`
- [x] 003 Terrain height variation + closed-loop circuit — `pending-review/003`
- [x] 004 Stylized environment dressing — `pending-review/004`
- [x] 005 Procedural audio system — `pending-review/005`
- [x] 006 Start menu + countdown + game state machine — `pending-review/006`

### Track B — gameplay + polish (concept sketches, 007-014)

- [x] 007 Track 01 race + AI opponents — `pending-review/007`
- [x] 008 2-player split-screen — `pending-review/008`
- [ ] 009 Audio expansion — `open/009`
- [ ] 010 Dynamic world (time-of-day, weather, wildlife, buoyancy) — `open/010`
- [ ] 011 LOD + performance budget — `open/011`
- [ ] 012 Menu: pause, settings, select — `open/012`
- [ ] 014 Clouds + sky decorations — `open/014`

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
007 is a full plan (race + AI); 008-014 are concept sketches (Context/Goal/
Non-goals/Dependencies + open questions) still to be refined. Dependency gate:
Track B items build on Track A (001 foundational; 006 gates menu; 003 gates
race/AI). 007 also depends on 004 (owns src/core/rng.ts). 014 forward-deps
on 010 (time-of-day/weather will drive cloud tint+density post-014 landing).
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

## Refinement status

Concept sketches — still need refinement into full plans:

- 009 audio expansion
- 010 dynamic world
- 011 LOD/perf
- 012 menu/settings/select
- 014 clouds + sky decor

Full plans — ready for execution (gated only by deps):

- 001 cel-shading · 002 sky · 003 terrain · 004 dressing · 005 audio
  · 006 menu · 007 race + AI · 008 split-screen

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

## Legend

`- [ ]` open · `- [~]` in progress · `- [x]` done

Tracking files live in `docs/backlog/{open,pending-review,done}/`.
