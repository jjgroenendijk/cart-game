# Game Cart — backlog

Track A — visual/audio/menu overhaul: cartoony cel-shaded world, procedural
sky, height variation, environment dressing, procedural audio, start menu +
countdown (001-006).
Track B — gameplay + polish concepts post-overhaul: race systems + AI,
split-screen, audio expansion, dynamic world, LOD/perf, full front-end
(007-012). 007 has a full plan; 008-012 still concept sketches.
Track 0 — tooling & quality gate: git hooks — multi-lang lint+format
(ts/js/md/json/yml/html), max LOC/file, max line length, auto-format,
conventional-commits + asset/secrets guards (000). Foundational
prerequisite for every item's "green commit" gate.

## Tasks

### Track 0 — tooling & quality gate (000)

- [ ] 000 Git hooks: multi-lang lint+format, max LOC/file, max line len, auto-format, conv-commits + asset/secrets guards — `open/000`

### Track A — overhaul (001-006)

- [ ] 001 Toon cel-shading + outlines (reimplementation) — `open/001` (prior impl commit 26f8622 superseded)
- [ ] 002 Procedural sky + lighting pass (reimplementation) — `open/002` (prior impl commit 7865277 superseded)
- [ ] 003 Terrain height variation + closed-loop circuit — `open/003`
- [~] 004 Stylized environment dressing — `open/004`
- [ ] 005 Procedural audio system — `open/005`
- [ ] 006 Start menu + countdown + game state machine — `open/006`

### Track B — gameplay + polish (concept sketches, 007-012)

- [ ] 007 Track 01 race + AI opponents — `open/007`
- [ ] 008 2-player split-screen — `open/008`
- [ ] 009 Audio expansion — `open/009`
- [ ] 010 Dynamic world (time-of-day, weather, wildlife, buoyancy) — `open/010`
- [ ] 011 LOD + performance budget — `open/011`
- [ ] 012 Menu: pause, settings, select — `open/012`

## Status

001 reopened for reimplementation (custom cel ShaderMaterial pipeline, see `open/001`).
002 reopened for reimplementation (Ghibli posterize + lightUniforms integration, see `open/002`).
003-006 not started. 004 has a full plan (see `open/004`); awaiting 001/002/003.
000 owns the quality-gate harness (lint/format/test + hooks); 001's former
harness commit + Config section were dropped — 001 now depends on 000 and
consumes the harness. All "per 000 harness" test gates (001-006, 007-012)
are dormant until 000 lands (typecheck-only meanwhile).
007 is a full plan (race + AI); 008-012 are concept sketches (Context/Goal/
Non-goals/Dependencies + open questions) still to be refined. Dependency gate:
Track B items build on Track A (001 foundational; 006 gates menu; 003 gates
race/AI). 007 also depends on 004 (owns src/core/rng.ts).

## Refinement status

Concept sketches — still need refinement into full plans:

- 008 split-screen
- 009 audio expansion
- 010 dynamic world
- 011 LOD/perf
- 012 menu/settings/select

Full plans — ready for execution (gated only by deps):

- 000 quality gate · 001 cel-shading · 002 sky · 003 terrain · 004 dressing · 005 audio · 006 menu · 007 race + AI

## Legend

`- [ ]` open · `- [~]` in progress · `- [x]` done

Tracking files live in `docs/backlog/{open,pending-review,done}/`.
