import type { FaceId } from '../paper/types.ts';
import { parsePairKey } from './order.ts';
import type { KernelState } from './types.ts';

/**
 * Stack level of every face: the longest chain of overlapping faces beneath it. Consistent
 * with every recorded pairwise order (if f is above g, level(f) > level(g)); for faces that
 * don't overlap it is only a tiebreak. Cycles across non-overlapping faces (legal in woven
 * states) are broken by releasing the lowest face id.
 */
export function stackLevels(state: KernelState): Map<FaceId, number> {
  const below = new Map<FaceId, FaceId[]>();
  const upper = new Map<FaceId, FaceId[]>();
  for (const f of state.cp.faces.keys()) {
    below.set(f, []);
    upper.set(f, []);
  }
  for (const [k, s] of state.folded.layerOrder) {
    const [f, g] = parsePairKey(k);
    const [lo, hi] = s === 1 ? [g, f] : [f, g];
    upper.get(lo)?.push(hi);
    below.get(hi)?.push(lo);
  }
  const indeg = new Map<FaceId, number>();
  for (const [f, list] of below) indeg.set(f, list.length);
  const level = new Map<FaceId, number>();
  const ready = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([f]) => f)
    .sort((a, b) => a - b);
  const remaining = new Set(state.cp.faces.keys());
  for (;;) {
    while (ready.length > 0) {
      const f = ready.shift()!;
      if (!remaining.has(f)) continue;
      remaining.delete(f);
      let lv = 0;
      for (const g of below.get(f)!) if (level.has(g)) lv = Math.max(lv, level.get(g)! + 1);
      level.set(f, lv);
      for (const h of upper.get(f)!) {
        const d = indeg.get(h)! - 1;
        indeg.set(h, d);
        if (d === 0) ready.push(h);
      }
    }
    if (remaining.size === 0) break;
    ready.push(Math.min(...remaining));
  }
  return level;
}
