---
type: Convention
title: Steering Sign Convention
description: Positive steer angle means turn left. Input mapping and gamepad axis convention.
tags: [input, kart, convention]
timestamp: 2026-07-05T00:00:00Z
---

# Steering Sign Convention

Positive steer angle means turn left. This is the single steering sign convention
used across all input sources and consumers.

## Input Mapping

| Source                         | Left                  | Right                |
| ------------------------------ | --------------------- | -------------------- |
| Keyboard (Arrow Left / A key)  | +steer                |                      |
| Keyboard (Arrow Right / D key) |                       | -steer               |
| Gamepad axis 0                 | +steer (axis negated) | -steer (stick right) |

## Consumers

- [KartController](/kart/controller.md) reads steer input for lateral forces.
- [AiDriver](/race/ai-driver.md) produces steer values matching this convention.

## Related

- [Input](/core/input.md)
