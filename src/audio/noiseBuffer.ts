/**
 * 005 procedural audio: white-noise AudioBuffer builder. Fills a mono buffer
 * with Math.random()*2-1 (stochastic — deliberately NOT deterministic, so no
 * dependency on 004's rng.ts). Built once on first resume() and shared by the
 * drift and wind voices (each gets its own BufferSource looping this buffer).
 *
 * Not an asset file: the bytes are synthesized at runtime, keeping the repo's
 * zero-media policy intact.
 */

export const NOISE_SECONDS = 2;

export function makeNoiseBuffer(
  ctx: BaseAudioContext,
  seconds: number = NOISE_SECONDS,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
