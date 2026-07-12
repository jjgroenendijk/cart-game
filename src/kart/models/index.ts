/**
 * Kart model registry. One KartModelDef per file in this directory; this
 * index is the single place a new kart is wired in:
 *
 *   1. add src/kart/models/<id>.ts exporting a KartModelDef
 *   2. add the id to KartVariantId (types.ts)
 *   3. append the def to KART_MODELS below
 *
 * Registry order is display order (select overlay cycles it) and feeds the
 * derived KART_VARIANTS (kartVariants.ts). Ids must be unique; a registry
 * test enforces the invariants.
 */

import { balancedModel } from "./balanced";
import { speedModel } from "./speed";
import { gripModel } from "./grip";
import { heavyModel } from "./heavy";
import { featherModel } from "./feather";
import { trailModel } from "./trail";
import { lanciaModel } from "./lancia";
import type { KartBodyCtx, KartModelDef, KartVariantId, WheelOffset } from "./types";

export type {
  KartBodyCtx,
  KartModelDef,
  KartSilhouette,
  KartVariantId,
  WheelOffset,
} from "./types";
export { BODY_OUTLINE, DETAIL_OUTLINE } from "./parts";

export const KART_MODELS: ReadonlyArray<KartModelDef> = [
  balancedModel,
  speedModel,
  gripModel,
  heavyModel,
  featherModel,
  trailModel,
  lanciaModel,
];

export function modelById(id: KartVariantId): KartModelDef {
  const m = KART_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`modelById: unknown model id "${id}"`);
  return m;
}

/** Local wheel offsets for a model (shared by the visual rig + VFX contact points). */
export function wheelOffsetsFor(model: KartVariantId): ReadonlyArray<WheelOffset> {
  return modelById(model).stance;
}

/** Build the chassis (everything above the axles) for `model` into ctx.group. */
export function buildKartBody(model: KartVariantId, ctx: KartBodyCtx): void {
  modelById(model).build(ctx);
}
