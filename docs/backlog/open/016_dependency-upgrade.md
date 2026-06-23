# 016 Dependency upgrade + Dependabot

Status: open (full plan — ready for execution)

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
- Drive the game in-browser after commits 7 (three) + 8 (rapier).

## Needs refinement

- `typescript-eslint`<->ESLint 10 peer: confirm before commit 3.
- `tools/vitest.config.ts` shape under Vitest 4 (commit 6 may need edits).
- three r184 shader breakage scope: unknown until typecheck/build; list
  at commit 7 body. CelMaterial/PostOutlinePass/SkyPosterizePass most
  exposed.
- rapier 0.19 heightfield ray-hit re-test: 003 switched to TRIMESH for
  0.14's ~60% miss; 0.19 may fix -> optional switch back (separate item).

## Legend

Tiers: 0 = patch/Node infra; 1 = dev-tooling majors (build/test only);
2 = runtime/lib majors (touches game code, needs in-browser QA).
