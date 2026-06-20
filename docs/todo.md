# Game Cart — backlog

Track A — visual/audio/menu overhaul: cartoony cel-shaded world, procedural
sky, height variation, environment dressing, procedural audio, start menu +
countdown (001-006).
Track B — gameplay + polish concepts post-overhaul: race systems + AI,
split-screen, audio expansion, dynamic world, LOD/perf, full front-end
(007-012). Concept sketches; to be refined into full plans.

## Tasks

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
007-012 are concept sketches (Context/Goal/Non-goals/Dependencies + open
questions); not yet refined into full plans. Dependency gate: Track B items
build on Track A (001 foundational; 006 gates menu; 003 gates race/AI).

## Legend
`- [ ]` open · `- [~]` in progress · `- [x]` done

Tracking files live in `docs/backlog/{open,pending-review,done}/`.
