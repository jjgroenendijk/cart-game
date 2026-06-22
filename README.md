# Game Cart

A 3D browser-based kart racing game built with Three.js + Rapier physics, in
TypeScript. Natural-scene tracks, arcade driving with drifting, local 2-player
split-screen co-op planned. Designed to deploy to GitHub Pages.

## Status

- [x] Vite + TypeScript scaffold (static-host friendly)
- [x] Fixed-timestep game loop
- [x] Rapier physics world with raycast-query helper
- [x] Arcade kart vehicle controller (raycast suspension, grip, drift, steering)
- [x] Chase camera
- [x] Keyboard + gamepad input
- [x] Test arena (flat playground; superseded by terrain)
- [x] HUD (speedometer + controls)
- [x] Terrain height variation + closed-loop circuit (cel vertex colors: road/grass/rock/sand)
- [ ] Track 01 — checkpoints + lap counting on the terrain circuit
- [ ] Race systems (lap timer, position, countdown, minimap)
- [ ] 2-player split-screen
- [ ] AI opponents
- [ ] More tracks

## Quick start

Prerequisites: Node 20+, plus `shellcheck` and `shfmt` for git hooks.
macOS: `brew install shellcheck shfmt`.

```bash
npm install
npm run setup    # wire git hooks (.githook via core.hooksPath)
npm run dev
```

Open printed URL (default http://localhost:5173). First load inlines Rapier
WASM, so "Loading physics engine..." flashes briefly.

### Controls (Player 1)

| Action          | Keyboard          | Gamepad                 |
| --------------- | ----------------- | ----------------------- |
| Accelerate      | `W` / `↑`         | Right trigger / face up |
| Brake / Reverse | `S` / `↓`         | Left trigger            |
| Steer           | `A` `D` / `←` `→` | Left stick              |
| Drift           | `Space`           | `A` / cross             |
| Reset kart      | `R`               | `B` / circle            |

## Build & test

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build to dist/
npm run preview     # serve the built dist/ locally
npm run lint        # eslint + markdownlint
npm run format      # prettier check (format:write to auto-fix)
npm test            # vitest (jsdom)
```

Build outputs one static bundle in `dist/` using relative asset paths
(`base: './'`). It works under sub-paths such as
`https://<user>.github.io/game-cart/`.

## Quality gate (git hooks)

Pre-commit and commit-msg hooks in `.githook/` enforce conventions in
`AGENTS.md`. Hooks are local-only because git does not version
`core.hooksPath`, so after cloning run `npm run setup`. This sets
`core.hooksPath=.githook` and marks hook scripts executable. Hooks then run on
every commit:

- format (prettier + shfmt) and re-stage edited files (no index drift)
- lint (eslint + markdownlint + shellcheck)
- file limits (hand-written tracked files <=600 lines and <=100 chars/line)
- typecheck + vitest (skips cleanly when no tests exist)
- zero-asset guard (rejects committed media/binaries)
- secrets guard (secretlint)
- governance (AGENTS.md <=200 LOC, CLAUDE.md symlink, Mermaid block, refresh)
- Conventional Commits subject (commit-msg)

## Deploy to GitHub Pages

### Automatic (recommended)

This repo includes `.github/workflows/deploy.yml`. After pushing to `main`:

1. Repo Settings -> Pages -> Build and deployment -> Source: GitHub Actions.
2. Push to `main`. The workflow builds and publishes automatically.

### Manual (gh-pages branch)

```bash
npm run build
npx gh-pages -d dist
```

## Project structure

```text
src/
  main.ts              # entry: init Rapier, bootstrap Game
  core/
    Game.ts            # orchestrator: fixed-timestep loop, HUD
    Renderer.ts        # WebGLRenderer + EffectComposer (cel + post-outline),
                       #   scene, sun + shadows, fog, shared light uniforms
    Input.ts           # keyboard + gamepad, per-player bindings
    math.ts            # clamp/lerp/damp helpers + temp vectors
  materials/
    lightUniforms.ts   # shared sun/ambient uniforms (Renderer writes once/frame)
    cel.ts             # CelMaterial: banded lambert + rim + flatShading toggle
    outline.ts         # InvertedHullMaterial: constant pixel-width toon outline
    postOutline.ts     # PostOutlinePass: Sobel edge-detect on terrain (layer 1)
    skyPosterize.ts    # SkyPosterizePass: Ghibli band blend on sky (layer 2)
    gradient.ts        # stepped 1D gradient reference helper
  physics/
    PhysicsWorld.ts    # Rapier world wrapper + downward raycast helper
  kart/
    KartController.ts  # arcade raycast vehicle physics (suspension, grip, drift)
    Kart.ts            # kart mesh (low-poly) + wheel rigs + transform sync
    ChaseCamera.ts     # third-person follow camera
  terrain/
    Terrain.ts         # displaced vertex-colored mesh + Rapier collider from
                       #   one shared heightAt fn; perimeter wall; spawn pose
    SplineTrack.ts     # closed Catmull-Rom circuit + closestPoint cache
    heightmap.ts       # SplineFieldCache (O(1) bilinear) + heightAt + colorAt
    noise.ts           # seeded 2D simplex noise (pure, jsdom-testable)
```

### Tuning the driving feel

Kart handling constants live in `src/kart/KartController.ts`
(`DEFAULT_TUNING`): engine force, grip, drift grip, suspension
stiffness/damping, max speed, steering rate, etc. Tweak these to change the
arcade feel.
