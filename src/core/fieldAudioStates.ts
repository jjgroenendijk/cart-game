/**
 * Pooled audio-state fills for the kart field (split from FieldBuilder for
 * the file-size cap; behavior unchanged). Pure writes into caller-owned
 * buffers — consumers read synchronously each frame, no retention.
 */

import type { PlayerAudioState } from "../audio/AudioManager";
import type { RivalAudioState } from "../audio/rivalVoices";
import type { KartInput } from "./Input";
import type { PlayerView } from "./PlayerView";
import type { Kart } from "../kart/Kart";

/** Per-human audio states (zeros while not driving). */
export function fillHumanAudioStates(
  views: readonly PlayerView[],
  driving: boolean,
  inputs: readonly KartInput[],
  buf: PlayerAudioState[],
): PlayerAudioState[] {
  for (let i = 0; i < views.length; i++) {
    const s = buf[i]!;
    if (driving) {
      const v = views[i]!;
      s.speed = v.kart.speed;
      s.throttle = inputs[i]!.throttle;
      s.drifting = v.kart.controller.isDrifting;
    } else {
      s.speed = 0;
      s.throttle = 0;
      s.drifting = false;
    }
  }
  return buf;
}

/**
 * Per-rival audio states. Rivals are AI always-on-throttle while racing ->
 * throttle 1 + live pos/vel/speed; zeros otherwise (mirrors the human
 * gating). Drift is unused by the engine-only rival voice but kept for
 * shape parity with RivalAudioState.
 */
export function fillRivalAudioStates(
  rivals: readonly Kart[],
  driving: boolean,
  buf: RivalAudioState[],
): RivalAudioState[] {
  for (let i = 0; i < rivals.length; i++) {
    const r = rivals[i]!;
    const p = r.group.position;
    const lv = r.controller.body.linvel();
    const s = buf[i]!;
    s.pos.x = p.x;
    s.pos.y = p.y;
    s.pos.z = p.z;
    s.vel.x = lv.x;
    s.vel.y = lv.y;
    s.vel.z = lv.z;
    s.speed = driving ? r.speed : 0;
    s.throttle = driving ? 1 : 0;
    s.drifting = driving ? r.controller.isDrifting : false;
  }
  return buf;
}
