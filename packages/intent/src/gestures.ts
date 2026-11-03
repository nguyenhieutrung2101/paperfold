import {
  applyPlaneIso,
  centroid,
  cross2,
  dot2,
  type Line2,
  lineThrough,
  maxSpan,
  planeIsoOf,
  signedDistance,
  type Snapshot,
  type Vec2,
} from '@paperfold/kernel';

/** A folded edge of the model as seen from above. */
export interface FoldedEdge {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly line: Line2;
  /** Not fully creased yet. */
  readonly soft: boolean;
  /** Unit normal pointing from the edge into the paper it folds. */
  readonly inward: Vec2;
}

export function foldedEdges(snap: Snapshot): FoldedEdge[] {
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  const out: FoldedEdge[] = [];
  for (const c of snap.creases) {
    if (c.left === null || c.right === null || Math.abs(c.angleDeg) !== 180) continue;
    const f = byId.get(c.left)!;
    const iso = planeIsoOf(f.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    const line = lineThrough(a, b);
    const mid = centroid(f.material.map((p) => applyPlaneIso(iso, p)));
    const s = signedDistance(line, mid) > 0 ? 1 : -1;
    out.push({ a, b, line, soft: maxSpan(c.sharpness) < 1, inward: [-line.d[1] * s, line.d[0] * s] });
  }
  return out;
}

/** Unfolded creases that remember a fold: where a push can make a reverse fold. */
export function precreaseLines(snap: Snapshot): Line2[] {
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  const out: Line2[] = [];
  for (const c of snap.creases) {
    if (c.left === null || c.right === null || c.angleDeg !== 0) continue;
    if (c.assignment !== 'M' && c.assignment !== 'V') continue;
    const iso = planeIsoOf(byId.get(c.left)!.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    const l = lineThrough(a, b);
    if (out.some((o) => Math.abs(cross2(o.d, l.d)) < 1e-9 && Math.abs(signedDistance(o, a)) < 1e-6)) continue;
    out.push(l);
  }
  return out;
}

export type StrokeIntent =
  | { readonly kind: 'pending' }
  | { readonly kind: 'grab' }
  | { readonly kind: 'crease'; readonly edge: FoldedEdge }
  | { readonly kind: 'push'; readonly line: Line2; readonly seed: Vec2; readonly edge: FoldedEdge };

export interface StrokeOptions {
  /** How far the pointer moves before we decide (about 8 px, in mm). */
  readonly decideMm: number;
  /** How close to a folded edge counts as on it (about 10 px, in mm). */
  readonly nearMm: number;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  const tc = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + dx * tc), p[1] - (a[1] + dy * tc)), t };
}

/**
 * Tell creasing from grabbing by the first few millimetres of motion (brief, section 5,
 * "Crease"): along a fold means crease it, across it means grab the flap. Pressing on a
 * folded edge next to a precrease and pushing into the paper means push the spine in: an
 * inside reverse fold along the precrease (brief, section 6, "The real-paper way").
 */
export function classifyStroke(
  start: Vec2,
  now: Vec2,
  ctx: { readonly edges: readonly FoldedEdge[]; readonly precreases: readonly Line2[] },
  opts: StrokeOptions,
): StrokeIntent {
  const mx = now[0] - start[0];
  const my = now[1] - start[1];
  const moved = Math.hypot(mx, my);
  if (moved < opts.decideMm) return { kind: 'pending' };
  const m: Vec2 = [mx / moved, my / moved];
  let nearest: FoldedEdge | null = null;
  let nd = opts.nearMm;
  for (const e of ctx.edges) {
    const { d } = distanceToSegment(start, e.a, e.b);
    if (d <= nd) {
      nd = d;
      nearest = e;
    }
  }
  if (!nearest) return { kind: 'grab' };
  const along = Math.abs(dot2(m, nearest.line.d));
  if (along >= Math.cos((35 * Math.PI) / 180)) return { kind: 'crease', edge: nearest };
  if (along <= Math.cos((55 * Math.PI) / 180) && dot2(m, nearest.inward) > 0) {
    // Pushing into the paper: is there a precrease crossing this edge right here?
    for (const pc of ctx.precreases) {
      if (Math.abs(cross2(pc.d, nearest.line.d)) < 0.05) continue;
      const off = Math.abs(signedDistance(pc, start));
      if (off > opts.nearMm * 1.5 || off < 0.3) continue;
      const seed: Vec2 = [start[0] + nearest.inward[0] * 0.8, start[1] + nearest.inward[1] * 0.8];
      return { kind: 'push', line: pc, seed, edge: nearest };
    }
  }
  return { kind: 'grab' };
}
