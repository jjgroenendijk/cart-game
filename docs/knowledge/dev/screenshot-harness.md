---
type: Subsystem
title: Screenshot Harness
description: Headless Playwright script that captures a deterministic frame PNG plus its JSON state.
tags: [dev, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Screenshot Harness

`tools/shoot.mjs` boots the game to a deterministic frame, waits for a few
rendered frames, then saves the WebGL canvas as a PNG next to
`window.__game.debugSnapshot()` as JSON. It exists so an out-of-process agent
can verify shaders/scenes and inspect live state without a manual browser
session.

It pairs two features that already exist:

- Dev URL flags (`docs/knowledge/core/dev-flags.md`) jump straight to a
  biome/seed/weather/time/kart/quality without menu clicks.
- Debug snapshot (`docs/knowledge/core/debug-snapshot.md`) dumps the whole game
  state as one JSON-serializable object.

## Dependency

`playwright-core` is a devDependency. It ships NO bundled browser (so CI
`npm ci` stays light and downloads nothing), and instead drives an installed
system browser via a channel:

```sh
npm i -D playwright-core
```

The harness defaults to Google Chrome (`channel: "chrome"`); override with
`--channel <name>` (e.g. `msedge`, `chromium`) or point at an explicit binary
with `--executable <path>`. Otherwise Node built-ins only
(`node:child_process`, `node:fs`, `node:path`, `node:process`).

## Serving modes

- `--url <base>` — use an already-running server verbatim, e.g. the Vite dev
  server (`npm run dev` at `http://localhost:5173`). Dev builds honor the flags
  even without `debug`, but the harness always appends it anyway.
- no `--url` — the script serves the built app itself by spawning
  `npm run preview` (Vite preview of `dist/`), parsing its printed
  `http://localhost:<port>` line, and killing the child on exit. This requires
  a prior `npm run build` so `dist/` exists; the script errors clearly if it
  does not.

Dev flags are gated (dev build OR `debug` present), so the harness always
appends `debug=1`. A production `dist` served by preview then honors the
overrides.

## Usage

```sh
# Serve dist/ via `npm run preview` (needs a prior `npm run build`):
node tools/shoot.mjs --biome tundra --autostart --label tundra-race

# Against a running dev server:
node tools/shoot.mjs --url http://localhost:5173 --biome desert --time dusk \
  --autostart --label desert-dusk

# Resolve the URL + output paths without launching a browser:
node tools/shoot.mjs --dry-run --biome tundra --autostart --label test
```

## Flags

Value flags map one-to-one onto the dev URL params:

| CLI           | URL param     |
| ------------- | ------------- |
| `--biome`     | `biome`       |
| `--seed`      | `seed`        |
| `--weather`   | `weather`     |
| `--time`      | `time`        |
| `--kart`      | `kart`        |
| `--quality`   | `quality`     |
| `--autostart` | `autostart=1` |
| `--garage`    | `garage=1`    |
| `--freefly`   | `freefly=1`   |

`debug=1` is always appended. Value flags render first (stable order), then
boolean flags, then `debug`, so `--biome tundra --autostart` yields
`.../?biome=tundra&autostart=1&debug=1`.

Harness-only options: `--label <name>` (output basename, default `shot`),
`--url <base>` (skip the preview server), `--wait <ms>` (extra settle time,
default 1500), `--out <dir>` (default `.agent/shots`), `--channel <name>`
(system browser channel, default `chrome`), `--executable <path>` (explicit
browser binary), `--dry-run` (print the resolved URL + paths, launch nothing).

## Garage mode

`--garage` drives the kart-inspection garage (`docs/knowledge/dev/garage.md`)
instead of the race Game. It waits for `window.__garage`, then for each view in
`--views` (default `front,side,top,iso`) calls `setView`, screenshots the
`.gc-garage` root (canvas + burned-in dimension overlay) to
`<label>-<view>.png`, and collects `window.__garage.snapshot()`. It writes one
`<label>.json` with the shared `dimensions` plus each view's `pixelsPerMeter` +
`viewport`.

- `--variant <id>` / `--colorway <id>` — seed the kart (URL params).
- `--views <csv>` — views to capture, e.g. `front,side,top`.
- `--ref <path>` / `--ref-meters <m>` — inject a local reference image as a
  data URL (via `setReference`), scaled to a known real width for comparison.

This is the render/measure half of the kart-model vision loop: capture, read the
to-scale renders + measurements, edit the model def under `src/kart/models/`,
re-shoot.

```sh
node tools/shoot.mjs --channel chrome --garage --variant speed \
  --views front,side,top,iso --label speed-garage
```

## Behavior

- Launches an installed system browser (Chrome by default) headless at a
  1280x720 viewport, navigates to the built URL, waits for `window.__game`
  (set after `game.start()` in `src/main.ts`), then waits `--wait` ms for
  frames to render.
- Smoke-checks GL: reads a fresh `webgl2`/`webgl` context's `getError()` and
  fails on a non-zero code. If `getContext` returns null (the renderer already
  holds the context) it falls back to asserting a non-zero canvas size.
- Writes `<out>/<label>.json` (pretty snapshot) and screenshots the `canvas`
  element to `<out>/<label>.png`, falling back to a full-page shot if the
  canvas locator fails.

## Outputs

Everything lands under `.agent/shots/` (git-ignored, created on demand):

- `<label>.png` — the WebGL canvas image.
- `<label>.json` — the `debugSnapshot()` state (`state`, `seed`, `biome`,
  `weather`, `day`, `quality`, `perf`, `race`, `karts[]`).

Exits non-zero on any failure (bad flag, GL error, missing `dist/`, timeout).
