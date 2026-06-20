# 008 2-player split-screen

Status: open (concept — to be refined)

## Context
README calls out "local 2-player split-screen co-op (planned)" (`README:3`,
`README:17`). No split-screen infra today: `Game.frame()` runs one fixed-step
physics pass + one render to one ChaseCamera (`Game.ts:58-84`). Audio for 2P
deferred in 005 (`005:64`). Input already supports per-player bindings
(`Input.ts` keyboard+gamepad, README controls table), but Game wires one kart.

Architecturally distinct from race/AI (007): this is a render/loop/audio
multiplexing problem, not a gameplay-rules problem. Kept separate so it can
land independently of AI.

## Goal
Side-by-side (or top/bottom) split rendering for P1 + P2:
- second kart (own RigidBody, own KartController)
- two viewports, two cameras (scissor test or two WebGLRenderer passes)
- P2 input binding (gamepad assumed for P2; keyboard share TBD)
- per-player HUD (speed; lap/position if 007 landed)
- audio mix policy (pan per player? single mix? — see 009)

Decide single-physics-world-with-two-karts (preferred) vs two worlds.

## Non-goals
- 3+ players (local), online multiplayer
- Per-player audio isolation beyond what 009 delivers
- Dynamic split (merge when karts close) — polish, defer
- AI field combined w/ 2P (needs 007 first; this item is strictly human 2P)

## Dependencies
001 (render-layer system + camera). 006 (state machine; countdown gates both
players). 007 (lap/position HUD; grid start w/ 2 karts — soft dep). 009
(positional/2P audio). Transitively 002/003.

## Needs refinement
- Viewport split axis + aspect handling on resize
- Single renderer + scissor vs two renderers (perf + shadow-map cost)
- Shadow maps: one shared or one per view
- P2 control scheme default (gamepad only? keyboard split WASD/arrows?)
- Game loop shape: step both karts in fixed-step; render twice per frame
- How countdown/settle (006) extends to two karts
