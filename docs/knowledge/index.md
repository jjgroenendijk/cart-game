---
okf_version: "0.1"
---

# game-cart Knowledge Wiki

```text
docs/knowledge/                        # 65+ files across 10 domains
├── conventions/                       # Cross-cutting rules and invariants
│   ├── commit-style.md
│   ├── fixed-step.md
│   ├── render-layers.md
│   └── steering-sign.md
├── core/                              # Game engine core lifecycle
│   ├── game.md
│   ├── game-flow.md
│   ├── hud-sync.md
│   ├── input.md
│   ├── player-view.md
│   ├── quality.md
│   ├── renderer.md
│   └── stats.md
├── terrain/                           # Procedural terrain surface and biomes
│   ├── biome-validator.md
│   ├── biomes.md
│   ├── chunk-streaming.md
│   ├── circuit-shape.md
│   ├── circuits.md
│   ├── height-pipeline.md
│   ├── noise.md
│   ├── normal-from-height.md
│   ├── spline-track.md
│   └── terrain-lod.md
├── environment/                       # Sky, weather, water, dressing mood stack
│   ├── cascade.md
│   ├── clouds.md
│   ├── dressing.md
│   ├── dynamic-sky.md
│   ├── flora-archetypes.md
│   ├── prop-factory.md
│   ├── prop-sampler.md
│   ├── sun-disc.md
│   ├── water.md
│   ├── weather.md
│   └── wildlife.md
├── kart/                              # Kart physics, mesh, camera, VFX
│   ├── controller.md
│   ├── kart-mesh.md
│   ├── skid-marks.md
│   └── vfx.md
├── race/                              # Race manager, AI driver, checkpoints
│   ├── ai-driver.md
│   ├── checkpoints.md
│   └── race-manager.md
├── audio/                             # Web Audio engine and audio graph
│   ├── audio-graph.md
│   └── audio-manager.md
├── materials/                         # Custom GLSL shaders and materials
│   ├── cel-material.md
│   ├── light-uniforms.md
│   ├── outlines.md
│   └── water-shading.md
├── ui/                                # DOM overlays and HUD
│   ├── menu-styles.md
│   └── overlays.md
├── data-flows/                        # System interaction and pipeline flows
│   ├── audio-lifecycle.md
│   ├── quality-propagation.md
│   └── render-pipeline.md
├── references/                        # External library usage notes
│   ├── rapier.md
│   └── threejs.md
└── log.md                             # Knowledge wiki change log
```
