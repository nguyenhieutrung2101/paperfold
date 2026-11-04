import {
  applyPlaneIso,
  centroid,
  cross2,
  dot2,
  type FaceId,
  type Line2,
  lineThrough,
  maxSpan,
  planeIsoOf,
  signedDistance,
  type Snapshot,
  type Vec2,
} from '@paperfold/kernel';
import { type SnapContext, snapFold } from './snap.ts';
import type { PressZone } from './surface.ts';

/** A folded edge of the model as seen from above. */
export interface FoldedEdge {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly line: Line2;
  /** Not fully creased yet. */
  readonly soft: boolean;
  /** Unit normal pointing from the edge into the paper it folds. */
  readonly inward: Vec2;
  /** The two faces folded together along it. */
  readonly faces: readonly [FaceId, FaceId];
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
    out.push({ a, b, line, soft: maxSpan(c.sharpness) < 1, inward: [-line.d[1] * s, line.d[0] * s], faces: [c.left, c.right] });
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
  | { readonly kind: 'push'; readonly edge: FoldedEdge };

export interface StrokeOptions {
  /** How far the pointer moves before we decide (about 8 px, in mm). */
  readonly decideMm: number;
}

/**
 * What a stroke means, from where it started and its first few millimetres (Phase 1 polish,
 * plan 1). Corners and the paper are picked up. On a folded edge, along it creases it (brief,
 * section 5, "Crease"); across it pushes it: inward tucks the tip inside, outward wraps it
 * around the outside.
 */
export function classifyStroke(start: Vec2, now: Vec2, zone: PressZone, opts: StrokeOptions): StrokeIntent {
  const mx = now[0] - start[0];
  const my = now[1] - start[1];
  const moved = Math.hypot(mx, my);
  if (moved < opts.decideMm) return { kind: 'pending' };
  if (zone.kind !== 'folded-edge') return { kind: 'grab' };
  const along = Math.abs(dot2([mx / moved, my / moved], zone.edge.line.d));
  if (along >= Math.cos((35 * Math.PI) / 180)) return { kind: 'crease', edge: zone.edge };
  return { kind: 'push', edge: zone.edge };
}

/** A push on a folded edge, read as a reverse fold. */
export interface PushFold {
  readonly line: Line2;
  /** On the tip, strictly on the paper. */
  readonly seed: Vec2;
  readonly kind: 'inside' | 'outside';
  /** How far the tip has turned (radians), for the live preview. */
  readonly theta: number;
  /** Along a precrease the push found, rather than a line of its own. */
  readonly precrease: boolean;
  /** Landmarks the snap used. */
  readonly marks: readonly Vec2[];
}

export interface PushOptions {
  readonly radiusMm: number;
  /** How close a precrease must cross the edge to the press (about 10 px, in mm). */
  readonly nearMm: number;
  readonly freehand: boolean;
}

/**
 * Pushing a folded edge (Phase 1 polish, plan 1). The pressed point of the edge goes where the
 * pointer is, so the fold line is the one that takes one to the other: push inward (and back
 * from the tip) for an inside reverse fold, pull outward for an outside one. The line snaps like
 * any fold. Beside a precrease, the push follows the precrease and only its depth matters (the
 * real-paper way, brief section 6). The kernel decides whether the result is possible.
 */
export function pushFold(
  press: Vec2,
  pointer: Vec2,
  edge: FoldedEdge,
  ctx: { readonly snap: SnapContext; readonly precreases: readonly Line2[] },
  opts: PushOptions,
): PushFold | null {
  const dx = edge.b[0] - edge.a[0];
  const dy = edge.b[1] - edge.a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((press[0] - edge.a[0]) * dx + (press[1] - edge.a[1]) * dy) / l2));
  const q: Vec2 = [edge.a[0] + dx * t, edge.a[1] + dy * t];
  const depth = (pointer[0] - press[0]) * edge.inward[0] + (pointer[1] - press[1]) * edge.inward[1];
  const kind = depth >= 0 ? 'inside' : 'outside';
  const nudge = (line: Line2): Vec2 | null => {
    // Just inside the flap, on the tip's side of the line.
    const side = Math.sign(signedDistance(line, q));
    for (const k of [0.6, 0.3, 0.12]) {
      const s: Vec2 = [q[0] + edge.inward[0] * k, q[1] + edge.inward[1] * k];
      if (Math.sign(signedDistance(line, s)) === side && side !== 0) return s;
    }
    return null;
  };

  for (const pc of ctx.precreases) {
    if (Math.abs(cross2(pc.d, edge.line.d)) < 0.05) continue;
    const off = Math.abs(signedDistance(pc, q));
    if (off > opts.nearMm * 1.5 || off < 0.3) continue;
    const seed = nudge(pc);
    if (!seed) continue;
    return { line: pc, seed, kind, theta: Math.max(0, Math.min(1, Math.abs(depth) / 12)) * Math.PI, precrease: true, marks: [] };
  }

  const snapped = snapFold(q, pointer, ctx.snap, { radiusMm: opts.radiusMm, freehand: opts.freehand, snapGrab: false });
  if (!snapped) return null;
  const seed = nudge(snapped.line);
  if (!seed) return null;
  const x0 = signedDistance(snapped.line, q);
  const x = signedDistance(snapped.line, pointer);
  const theta = Math.acos(Math.max(-1, Math.min(1, x0 === 0 ? 1 : x / x0)));
  return { line: snapped.line, seed, kind, theta, precrease: false, marks: snapped.marks };
}
