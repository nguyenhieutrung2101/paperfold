import type { FaceId } from '../paper/types.ts';

export function pairKey(f: FaceId, g: FaceId): string {
  return f < g ? `${f},${g}` : `${g},${f}`;
}

export function parsePairKey(key: string): [FaceId, FaceId] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** +1 if f is above g in world, −1 if below, undefined if they have no recorded order. */
export function orderOf(order: ReadonlyMap<string, 1 | -1>, f: FaceId, g: FaceId): 1 | -1 | undefined {
  const s = order.get(pairKey(f, g));
  if (s === undefined) return undefined;
  return f < g ? s : s === 1 ? -1 : 1;
}

/** Record "f above g" (s = +1) or "f below g" (s = −1). */
export function setOrder(order: Map<string, 1 | -1>, f: FaceId, g: FaceId, s: 1 | -1): void {
  if (f === g) throw new Error('A face has no order with itself');
  order.set(pairKey(f, g), f < g ? s : s === 1 ? -1 : 1);
}
