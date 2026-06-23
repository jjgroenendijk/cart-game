# Source Guidelines

## Directory Map

```text
./src/                 # game source
├── audio/             # Web Audio engine, drift, wind, UI, voice sets
├── core/              # loop, render, input, rng, game state, PlayerView
├── environment/       # props, water, clouds
├── kart/              # kart physics, mesh, chase/menu cam, grid
├── materials/         # cel + outline materials and tests
├── physics/           # Rapier wrapper
├── race/              # checkpoints, ranking, race manager, AI driver
├── terrain/           # heightmap, spline field, terrain mesh
└── ui/                # DOM overlays: start menu, countdown, HUD, minimap
```

## Rendering And Terrain Flow

```mermaid
flowchart LR
  height[heightAt x,z] --> mesh[terrain mesh]
  height --> collider[Rapier heightfield]
  mesh --> layer1[layer 1 terrain walls]
  collider --> kart[kart physics]
  light[lightUniforms] --> cel[cel materials]
  cel --> layer0[layer 0 kart props]
  layer0 --> renderer[Renderer composer]
  layer1 --> renderer
  sky[layer 2 sky] --> renderer
  renderer --> output[OutputPass ACES sRGB]
```

## Project Conventions

- Rendering pipeline lives in `core/Renderer.ts` and `materials/`.
- EffectComposer layer numbers:
  - `0`: solid kart + props, inverted-hull outline.
  - `1`: terrain/walls, post Sobel outline.
  - `2`: sky, post posterize.
- Shared sun/ambient uniforms live in `materials/lightUniforms.ts`.
- `Renderer` writes lighting once/frame; all materials read uniforms by ref.
- Custom `ShaderMaterial` output is LINEAR; `OutputPass` applies ACES + sRGB
  once.
- Tests run under jsdom, no WebGL. Export WebGL-free pure helpers for unit
  tests.
- Tests assert shader source, uniform defaults, and render-target structure.
- Terrain subsystem lives in `terrain/`.
- One shared `heightAt(x,z)` fn feeds both visual mesh and Rapier heightfield.
- `heightAt(x,z)` uses SplineFieldCache bilinear lookup plus simplex hills.
- Never sample physics from visual raw arrays, or visuals from collider arrays.
- `CelMaterial` uses `vertexColors:true` for road/grass/rock/sand on layer 1.
- Vertex color attribute values are sRGB->LINEAR to match ColorManagement.
