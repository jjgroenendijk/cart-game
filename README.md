# Game Cart 🏁

A 3D browser-based kart racing game built with **Three.js** + **Rapier** physics, in TypeScript. Natural-scene tracks, arcade driving with drifting, and local 2-player split-screen co-op (planned). Designed to deploy to GitHub Pages.

## Status

- [x] Vite + TypeScript scaffold (static-host friendly)
- [x] Fixed-timestep game loop
- [x] Rapier physics world with raycast-query helper
- [x] Arcade kart vehicle controller (raycast suspension, grip, drift, steering)
- [x] Chase camera
- [x] Keyboard + gamepad input
- [x] Test arena with ramps, trees, rocks to drive around
- [x] HUD (speedometer + controls)
- [ ] Track 01 — proper natural-scene circuit (laps, checkpoints)
- [ ] Race systems (lap timer, position, countdown, minimap)
- [ ] 2-player split-screen
- [ ] AI opponents
- [ ] More tracks

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). The first load inlines the Rapier WASM, so the "Loading physics engine…" screen flashes briefly.

### Controls (Player 1)

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `↑` | Right trigger / face up |
| Brake / Reverse | `S` / `↓` | Left trigger |
| Steer | `A` `D` / `←` `→` | Left stick |
| Drift | `Space` | `A` / cross |
| Reset kart | `R` | `B` / circle |

## Build & test

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build to dist/
npm run preview     # serve the built dist/ locally
```

The build outputs a single static bundle in `dist/` using **relative asset paths** (`base: './'`), so it works under any sub-path such as `https://<user>.github.io/game-cart/`.

## Deploy to GitHub Pages

### Automatic (recommended)

This repo includes `.github/workflows/deploy.yml`. After pushing to `main`:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The workflow builds and publishes automatically.

### Manual (gh-pages branch)

```bash
npm run build
npx gh-pages -d dist
```

## Project structure

```
src/
  main.ts              # entry: init Rapier, bootstrap Game
  core/
    Game.ts            # orchestrator: fixed-timestep loop, HUD
    Renderer.ts        # WebGLRenderer, scene, sun + shadows, fog
    Input.ts           # keyboard + gamepad, per-player bindings
    math.ts            # clamp/lerp/damp helpers + temp vectors
  physics/
    PhysicsWorld.ts    # Rapier world wrapper + downward raycast helper
  kart/
    KartController.ts  # arcade raycast vehicle physics (suspension, grip, drift)
    Kart.ts            # kart mesh (low-poly) + wheel rigs + transform sync
    ChaseCamera.ts     # third-person follow camera
  tracks/
    TestArena.ts       # flat ground + ramps/trees/rocks (playground)
```

### Tuning the driving feel

All kart handling constants live in `src/kart/KartController.ts` (`DEFAULT_TUNING`): engine force, grip, drift grip, suspension stiffness/damping, max speed, steering rate, etc. Tweak these to change the arcade feel.
