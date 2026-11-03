import type { FaceId } from '../paper/types.ts';

/**
 * Layer-order keys are numbers: (min id) · 2^21 + (max id). Face ids stay far below 2^21
 * (each split adds two), and the product stays an exact integer. Numeric keys keep the
 * order map off the string-hashing path, which dominates validation on deep stacks.
 */
export type PairKey = number;

const SHIFT = 2097152; // 2^21

export function pairKey(f: FaceId, g: FaceId): PairKey {
  return f < g ? f * SHIFT + g : g * SHIFT + f;
}

export function parsePairKey(key: PairKey): [FaceId, FaceId] {
  const lo = key % SHIFT;
  return [(key - lo) / SHIFT, lo];
}

/** +1 if f is above g in world, −1 if below, undefined if they have no recorded order. */
export function orderOf(order: ReadonlyMap<PairKey, 1 | -1>, f: FaceId, g: FaceId): 1 | -1 | undefined {
  const s = order.get(pairKey(f, g));
  if (s === undefined) return undefined;
  return f < g ? s : s === 1 ? -1 : 1;
}

/** Record "f above g" (s = +1) or "f below g" (s = −1). */
export function setOrder(order: Map<PairKey, 1 | -1>, f: FaceId, g: FaceId, s: 1 | -1): void {
  if (f === g) throw new Error('A face has no order with itself');
  order.set(pairKey(f, g), f < g ? s : s === 1 ? -1 : 1);
}
