import type { FaceId, Snapshot } from '@paperfold/kernel';

/**
 * Stack level of every face: the longest chain of faces beneath it (over overlapping
 * pairs). Level 0 lies on the table; a face resting on a 3-layer stack is level 3.
 *
 * The kernel only orders faces that overlap, and that relation can legally be cyclic
 * across faces that don't share a point (woven states). Then no single level per face
 * exists. APPROXIMATION (Phase 0): we break such cycles by face id and log it; Phase 2
 * moves to per-region heights from the overlap arrangement.
 */
export function stackLevels(snap: Snapshot): Map<FaceId, number> {
  const below = new Map<FaceId, FaceId[]>();
  const aboveCount = new Map<FaceId, number>();
  for (const f of snap.faces) {
    below.set(f.id, []);
    aboveCount.set(f.id, 0);
  }
  // Edge lower -> upper.
  const upper = new Map<FaceId, FaceId[]>();
  for (const f of snap.faces) upper.set(f.id, []);
  for (const [f, g, s] of snap.layerOrder) {
    const [lo, hi] = s === 1 ? [g, f] : [f, g];
    upper.get(lo)!.push(hi);
    below.get(hi)!.push(lo);
  }
  const indeg = new Map<FaceId, number>();
  for (const [f, list] of below) indeg.set(f, list.length);
  const level = new Map<FaceId, number>();
  const ready = [...indeg.entries()].filter(([, d]) => d === 0).map(([f]) => f).sort((a, b) => a - b);
  const remaining = new Set(snap.faces.map((f) => f.id));
  for (;;) {
    while (ready.length > 0) {
      const f = ready.shift()!;
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
    // A cycle: release the lowest-id face still waiting.
    const f = Math.min(...remaining);
    indeg.set(f, 0);
    ready.push(f);
  }
  return level;
}

/** Mid-surface height (mm above the table) of every face for a given layer gap. */
export function faceHeights(snap: Snapshot, gapMm: number): Map<FaceId, number> {
  const levels = stackLevels(snap);
  const out = new Map<FaceId, number>();
  for (const [f, lv] of levels) out.set(f, (lv + 0.5) * gapMm);
  return out;
}
