# 056 Wet-grip coupling (concept stub)

Status: concept

## Context

054 ships weather VFX/audio only: uWetness darkens terrain, rain/storm
particles render, thunder plays. KartController grip is unchanged
regardless of wetness. This stub captures the deferred gameplay coupling
so it has a home before refinement.

## Sketch

- KartController reads a wetness scalar (0-1) sourced from Environment's
  resolved weather channel level (weatherChannels.ts channelLevel).
- Grip multiplier: `base * (1 - wetness * factor)`. `factor` tuned so rain
  is noticeable (~15-20% reduction), storm more (~25-30%).
- Aquaplaning: at high speed + high wetness, forward grip drops sharply
  (water layer between wheels + ground). Threshold + curve TBD.
- Visual feedback: tire spray particles (reuse particle budget idiom).
- Snow: separate grip curve (lower top speed, earlier slide, no aquaplane).

## Open questions

- Read wetness per-step (physics cost) or cache per-frame in Game?
- Per-wheel wetness (puddles) or uniform? Uniform is simpler + cheaper.
- AI difficulty: does wetness slow rivals too? (Probably yes for parity.)
- Biome interaction: desert rain (rare) vs alpine snow (common) tuning.

## Depends on

054 (wetness channel + uWetness), 007 (KartController grip model).
