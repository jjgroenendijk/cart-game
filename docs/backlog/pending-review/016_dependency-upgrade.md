# 016 Dependency upgrade + Dependabot

Status: implemented (pending-review)

## Context

Toolchain frozen at early-2025 majors; several pieces now EOL or stale.
Verified via `npm view` + web search (Jun 2026):

- Node: workflows pin `node-version: 20` — Node 20 hit EOL Apr 2026.
  Active LTS is `24` (Node 22 = Maintenance LTS, EOL Apr 2027).
- `three` ^0.169.0 -> 0.184.0 (15 revs). Custom ShaderMaterials +
  EffectComposer + CelMaterial + outline/post in `src/materials/`,
  `src/core/Renderer.ts` -> high risk of removed APIs.
- `@dimforge/rapier3d-compat` ^0.14.0 -> 0.19.3 (5 minors). Kart physics
  - heightfield collider (`src/physics/`, `src/kart/`, `src/terrain/`).
    NB: 003 notes Rapier 0.14 heightfield rays miss ~60% -> collider is a
    TRIMESH today; revisit on bump.
- `vite` ^5.4.10 -> 8.0.16 (Rolldown replaces esbuild+Rollup).
- `vitest` ^2.1.9 -> 4.1.9; `jsdom` ^25.0.1 -> 29.1.1.
- `typescript` ^5.6.3 -> 6.0.3 (bridge release; new defaults).
- `eslint` ^9.0.0 -> 10.5.0 (ESLint 9 EOL Aug 2026; flat config only in
  10 — repo already on flat config at `tools/eslint.config.js`, so the
  hard migration is done). `@eslint/js` 9 -> 10.0.1,
  `eslint-config-prettier` 9 -> 10.1.8.
- patch-only: `prettier` 3.8.0 -> 3.8.4, `markdownlint-cli2` 0.22.0 ->
  0.22.1, `typescript-eslint` 8.61 -> 8.62.0. `secretlint`/preset already
  latest (13.0.2).

No `.github/dependabot.yml` today; no PR-gate workflow (`deploy.yml` is
push-to-main only). "Auto-merge patch" needs both a CI gate on PRs and
the repo "Allow auto-merge" setting.

## Goal

- Dependabot config: `npm` + `github-actions` ecosystems, weekly/Monday,
  `chore(deps)` prefix, dev-deps grouped, prod (`three`/`rapier`) single
  PRs, patch-only auto-merge.
- CI workflow on `pull_request` + `push:main`: ci -> typecheck -> lint ->
  lint:secrets -> test. The gate auto-merge waits on.
- Node 24 in both workflows.
- Bump all deps to latest stable (tiers below), atomic per package group,
  each commit leaves headless gate green.
- Tier 2 (`three`, `rapier`) commits carry "manual QA pending" —
  headless verifies compile/build only; game must be driven in-browser.

## Tiers + commit sequence (atomic, green after each)

1. `ci: add dependabot config and CI workflow`
   - new `.github/dependabot.yml`, new `.github/workflows/ci.yml`;
     `deploy.yml` node 20 -> 24. No package.json change.

2. `chore(deps): bump patch versions` (Tier 0)
   - `prettier`, `markdownlint-cli2`, `typescript-eslint`.
   - gate: `npm run lint && npm test`.

3. `chore(deps)!: upgrade eslint to v10` (Tier 1)
   - `eslint`, `@eslint/js`, `eslint-config-prettier`.
   - pre-check `typescript-eslint@8.62` peer allows E10; else hold at 9
     - note in body (E9 EOL Aug 2026).
   - gate: `npm run lint`.

4. `chore(deps)!: upgrade typescript to v6` (Tier 1)
   - `typescript`. TS6 new defaults may surface strict errors.
   - gate: `npm run typecheck`.

5. `chore(deps)!: upgrade vite to v8` (Tier 1)
   - `vite` (Rolldown). gate: `npm run build`.

6. `chore(deps)!: upgrade vitest to v4 and jsdom to v29` (Tier 1)
   - `vitest`, `jsdom`. May touch `tools/vitest.config.ts`.
   - gate: `npm test`.

7. `chore(deps)!: upgrade three.js to r184` (Tier 2, high risk)
   - `three` 0.169 -> 0.184, `@types/three` -> 0.184.1.
   - headless: typecheck + build. BROWSER QA owed: shaders/materials.

8. `chore(deps)!: upgrade rapier3d-compat to v0.19` (Tier 2, high risk)
   - `@dimforge/rapier3d-compat` 0.14 -> 0.19.3.
   - headless: build. GAMEPLAY QA owed: physics + collider (see 003
     trimesh note; re-test heightfield rays on 0.19).

## Non-goals

- TS7 RC (Go compiler) — stable ~Jul 2026, not yet; stay TS6.
- Prettier 4 — only alpha; stay 3.x.
- Branch protection / required-status config (manual GitHub step, noted
  not code).
- Behavior changes during bumps. Fixes forced by API removal = minimal;
  no feature work.
- Asset/media policy change.

## Dependencies

000 (quality gate — every commit's green gate). 001 (materials) + 003
(terrain/physics) + 008 (renderer multi-view) own the surfaces Tier 2
touches. No gameplay dep; pure toolchain + libs.

## Manual steps (cannot do via files)

- Repo `Settings -> General -> Pull Requests -> Allow auto-merge` ON, else
  Dependabot `auto-merge` directive ignored.
- (optional) Branch protection on `main` requiring the `CI` check.
- Review-drive the game with physical input, especially P2 ArrowUp/ArrowDown.

## Review follow-ups

- Repo setting: turn on `Settings -> General -> Pull Requests -> Allow
  auto-merge`, else Dependabot patch auto-merge cannot take effect.
- Optional branch protection on `main` requiring the `CI` check.
- Browser QA note: 2P split-screen rendered nonblank after Three/Rapier bumps;
  P1 throttle + physics verified via automation. P2 ArrowUp did not move via
  synthetic Playwright events, so verify P2 with physical/manual input in
  review.

## Implementation (2026-06-23)

- `ci: add dependabot config and CI workflow`
- `chore(deps): bump patch versions`
- `chore(deps)!: upgrade eslint to v10`
- `chore(deps)!: upgrade typescript to v6`
- `chore(deps)!: upgrade vite to v8`
- `chore(deps)!: upgrade vitest and jsdom`
- `chore(deps)!: upgrade three.js to r184`
- `chore(deps)!: upgrade rapier to v0.19`

`npm outdated --long` is empty after the final dependency bump.
`npm run build`, `npm run lint`, and `npm test` passed for the final head.
Rapier 0.19.3 flat-heightfield ray probe still misses 217/361 downward rays,
so terrain stays on the trimesh collider. See
`docs/troubleshooting/2026-06-23_016-dependency-upgrade.md`.

Browser smoke after runtime bumps:

- Vite dev server loads menu under Vite 8.
- 2P mode starts and renders two nonblank split-screen views with HUDs.
- P1 synthetic throttle moves kart/physics from 0 to 115+ km/h and rank updates.
- Console residue: favicon 404; Rapier wrapper init deprecation warning; Vite
  terminal reported non-fatal WebGL shader unused-output warnings during reload.

## Legend

Tiers: 0 = patch/Node infra; 1 = dev-tooling majors (build/test only);
2 = runtime/lib majors (touches game code, needs in-browser QA).
