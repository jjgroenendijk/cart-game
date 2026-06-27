# Game Cart

Game Cart is a browser kart racer built with Three.js, Rapier physics, and
TypeScript. It runs as a static Vite app and deploys to Cloudflare Pages.

Play it here: [cart-game.pages.dev](https://cart-game.pages.dev/)

## Features

- Arcade kart handling with suspension, grip, drifting, and reset.
- Procedural terrain, closed-loop track, water, clouds, trackside props, and
  ambient wildlife.
- Cel-shaded renderer with toon outlines and post-processing.
- Dynamic day cycle (sun arc, phase retune, moon, stars) with seeded weather.
- Race flow with start menu, countdown, laps, checkpoints, ranking, and minimap.
- AI rivals with pure-pursuit steering, rubber-band tuning, and stuck recovery.
- Local 2-player split-screen with separate HUD and panned procedural audio.

## Quick start

Prereqs:

- Node 24
- `shellcheck` and `shfmt` for local git hooks

On macOS:

```bash
brew install shellcheck shfmt
npm install
npm run setup
npm run dev
```

Open the printed Vite URL. Default dev URL is
<http://localhost:5173/>.

## Controls

### Player 1

| Action          | Keyboard          | Gamepad                 |
| --------------- | ----------------- | ----------------------- |
| Accelerate      | `W` / `↑`         | Right trigger / face up |
| Brake / Reverse | `S` / `↓`         | Left trigger            |
| Steer           | `A` `D` / `←` `→` | Left stick              |
| Drift           | `Space`           | `A` / cross             |
| Reset kart      | `R`               | `B` / circle            |

### Player 2

Enable `2 PLAYERS` on the start menu.

| Action          | Keyboard     | Gamepad   |
| --------------- | ------------ | --------- |
| Accelerate      | `↑`          | Gamepad 2 |
| Brake / Reverse | `↓`          | Gamepad 2 |
| Steer           | `←` `→`      | Gamepad 2 |
| Drift           | `ShiftRight` | Gamepad 2 |
| Reset kart      | `Enter`      | Gamepad 2 |

## Scripts

```bash
npm run dev            # start Vite dev server
npm run build          # typecheck + production build to dist/
npm run preview        # preview built dist/
npm run format         # check Prettier formatting
npm run lint           # ESLint + markdownlint
npm run lint:secrets   # secretlint scan
npm run lint:repo      # repo rules from tools/check-repo-rules.sh
npm run typecheck      # TypeScript no-emit check
npm test               # Vitest suite
```

## Deploy

`.github/workflows/deploy.yml` builds on every push to `main` and publishes
`dist/` to Cloudflare Pages project `cart-game`.

The production URL is
[https://cart-game.pages.dev/](https://cart-game.pages.dev/).

## Development notes

- Static assets use relative paths via Vite `base: "./"` so previews and
  Pages deploys work from sub-paths.
- Git hooks live in `.githook/`. Run `npm run setup` once per clone or
  worktree to set `core.hooksPath`.
- Current backlog lives in `docs/backlog/` (open, concept, pending-review,
  done dirs); new ideas and discovered issues start in `docs/backlog/concept/`.
- Rendering code lives in `src/core/Renderer.ts` and `src/materials/`.
- Kart handling constants live in `src/kart/KartController.ts`; pure water
  buoyancy and life-drain math lives in `src/kart/buoyancy.ts`.
- Terrain is a chunked mesh + per-chunk Rapier trimesh (`src/terrain/`): a
  pure HeightSource feeds `chunkBuilder.ts` (buildChunk + skirts),
  `terrainLod.ts` (near/mid/far bands), and `TerrainChunkManager.ts`
  (activate/deactivate/LOD/dispose). Height truth stays world-global.
- Per-human DOM overlays (race HUD, blue water life bar, minimap, menus) live
  in `src/ui/`.
- Procedural audio (engine, drift, wind, impacts, respawn, music, positional
  rival voices) lives in `src/audio/`.
- Environment dressing (props, water, clouds, dynamic sky, weather, ambient
  critters) lives in `src/environment/`.
