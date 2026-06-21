# Game Cart — backlog

Track A — visual/audio/menu overhaul: cartoony cel-shaded world, procedural
sky, height variation, environment dressing, procedural audio, start menu +
countdown (001-006).
Track B — gameplay + polish concepts post-overhaul: race systems + AI,
split-screen, audio expansion, dynamic world, LOD/perf, full front-end
(007-012), clouds + sky decor (013). 007 has a full plan; 008-013 still
concept sketches.
Track 0 — tooling & quality gate: git hooks — multi-lang lint+format
(ts/js/md/json/yml/html), max LOC/file, max line length, auto-format,
conventional-commits + asset/secrets guards (000). Foundational
prerequisite for every item's "green commit" gate.

## Tasks

### Track 0 — tooling & quality gate (000)

- [x] 000 Git hooks: multi-lang lint+format, max LOC/file, max line len, auto-format, conv-commits + asset/secrets guards — `pending-review/000`

### Track A — overhaul (001-006)

- [x] 001 Toon cel-shading + outlines (reimplementation) — `pending-review/001`
- [x] 002 Procedural sky + lighting pass (reimplementation) — `pending-review/002`
- [x] 003 Terrain height variation + closed-loop circuit — `pending-review/003`
- [~] 004 Stylized environment dressing — `open/004`
- [ ] 005 Procedural audio system — `open/005`
- [ ] 006 Start menu + countdown + game state machine — `open/006`

### Track B — gameplay + polish (concept sketches, 007-013)

- [ ] 007 Track 01 race + AI opponents — `open/007`
- [ ] 008 2-player split-screen — `open/008`
- [ ] 009 Audio expansion — `open/009`
- [ ] 010 Dynamic world (time-of-day, weather, wildlife, buoyancy) — `open/010`
- [ ] 011 LOD + performance budget — `open/011`
- [ ] 012 Menu: pause, settings, select — `open/012`
- [ ] 013 Clouds + sky decorations — `open/013`

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
004-006 not started. 004 has a full plan (see `open/004`); unblocked now that
001/002/003 have landed.
007 is a full plan (race + AI); 008-013 are concept sketches (Context/Goal/
Non-goals/Dependencies + open questions) still to be refined. Dependency gate:
Track B items build on Track A (001 foundational; 006 gates menu; 003 gates
race/AI). 007 also depends on 004 (owns src/core/rng.ts). 013 forward-deps
on 010 (time-of-day/weather will drive cloud tint+density post-013 landing).

## Refinement status

Concept sketches — still need refinement into full plans:

- 008 split-screen
- 009 audio expansion
- 010 dynamic world
- 011 LOD/perf
- 012 menu/settings/select
- 013 clouds + sky decor

Full plans — ready for execution (gated only by deps):

- 001 cel-shading · 002 sky · 003 terrain · 004 dressing · 005 audio · 006 menu · 007 race + AI

Done (pending-review):

- 000 quality gate
- 001 cel-shading
- 002 sky
- 003 terrain height variation + closed-loop circuit

## Legend

`- [ ]` open · `- [~]` in progress · `- [x]` done

Tracking files live in `docs/backlog/{open,pending-review,done}/`.
