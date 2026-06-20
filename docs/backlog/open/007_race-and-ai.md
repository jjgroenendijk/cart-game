# 007 Track 01 race + AI opponents

Status: open (concept — to be refined)

## Context
003 ships geometry only: a closed-loop spline circuit on height-varied terrain.
Explicitly deferred as "Track 01" future work (`003:27`, `003:156`):
checkpoints, lap counting, race UI. README lists both as undone
(`README:15` Track 01 circuit, `README:16` race systems, `README:18` AI
opponents). Countdown + `racing` state come from 006; nothing turns the
circuit into an actual race, and the grid has one kart.

Consolidates two coupled gaps: the race loop needs opponents to race against,
and AI rivals need the checkpoint/lap system to navigate + score. Splitting
them would leave either half inert.

## Goal
Single-player race against AI rivals on the 003 circuit:
- checkpoint gates along the spline (progress validation; cut detection)
- lap counting + lap timer + race finish (N laps)
- live position/rank vs rivals
- minimap (top-down track + kart blips)
- AI karts: waypoint follow along spline, steering/throttle controller,
  avoidance, optional rubber-band, grid start

Reuse 003's `SplineTrack` (control points + `closestPoint`) for checkpoint
placement + AI path. Reuse 006 state machine (`racing` gate).

## Non-goals
- Multi-track (see 012 track select; needs >1 track)
- Human 2P (008 split-screen)
- Replay/ghost, online leaderboards
- Difficulty UI (tuning knobs only, no menu yet — 012 owns settings)
- Collision/impact audio for rivals (009)

## Dependencies
003 (`SplineTrack`, `Terrain`, spawn). 006 (`racing` state, countdown).
Transitively 001/002. Kart controller + Input already exist (P1).

## Needs refinement
- Checkpoint model: ordered gates vs continuous arc-length progress (closestPoint
  gives arc-length; likely the cleaner path)
- Cut/shortcut penalty policy
- AI feel target (arcade forgiving vs punishing), rubber-band on/off default
- Grid size + rival count default
- Minimap render path (canvas overlay vs off-screen ortho cam)
- Position computation: by arc-length progress or by lap+checkpoint?
