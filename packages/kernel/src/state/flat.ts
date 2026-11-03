import { applyPlaneIso, frontUp as isFrontUp, isFlat, planeIsoDet, planeIsoOf, type PlaneIso } from '../geometry/rigid.ts';
import { type Box, boxesOverlap, boxOf, containsStrictly, convexOverlap } from '../geometry/polygon.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { getVertex } from '../paper/creasePattern.ts';
import type { FaceId, VertexId } from '../paper/types.ts';
import { orderOf } from './order.ts';
import type { KernelState } from './types.ts';

/**
 * Derived 2D view of a flat-folded state: every face lies in the table plane.
 * Computed once per immutable state and cached.
 */
export interface FlatView {
  readonly faceIds: readonly FaceId[];
  readonly iso: ReadonlyMap<FaceId, PlaneIso>;
  readonly frontUp: ReadonlyMap<FaceId, boolean>;
  /** World-plane polygon of each face, normalized to counter-clockwise. */
  readonly poly: ReadonlyMap<FaceId, readonly Vec2[]>;
  readonly box: ReadonlyMap<FaceId, Box>;
  /** Canonical world-plane position of each vertex, taken from its lowest-id face. */
  readonly vertexWorld: ReadonlyMap<VertexId, Vec2>;
}

const viewCache = new WeakMap<KernelState, FlatView | null>();

/** The flat view, or null if some face is not lying flat (Phase 1+ states). */
export function flatView(state: KernelState): FlatView | null {
  if (viewCache.has(state)) return viewCache.get(state)!;
  const faceIds = [...state.cp.faces.keys()].sort((a, b) => a - b);
  const iso = new Map<FaceId, PlaneIso>();
  const frontUp = new Map<FaceId, boolean>();
  const poly = new Map<FaceId, Vec2[]>();
  const box = new Map<FaceId, Box>();
  const vertexWorld = new Map<VertexId, Vec2>();
  for (const f of faceIds) {
    const tr = state.folded.placements.get(f);
    if (!tr || !isFlat(tr, state.tol.len)) {
      viewCache.set(state, null);
      return null;
    }
    const m = planeIsoOf(tr);
    iso.set(f, m);
    frontUp.set(f, isFrontUp(tr));
    const verts = state.cp.faces.get(f)!.verts;
    const pts = verts.map((v) => applyPlaneIso(m, getVertex(state.cp, v)));
    verts.forEach((v, i) => {
      if (!vertexWorld.has(v)) vertexWorld.set(v, pts[i]!);
    });
    const ccw = planeIsoDet(m) > 0 ? pts : [...pts].reverse();
    poly.set(f, ccw);
    box.set(f, boxOf(ccw));
  }
  const view: FlatView = { faceIds, iso, frontUp, poly, box, vertexWorld };
  viewCache.set(state, view);
  return view;
}

export function requireFlat(state: KernelState): FlatView {
  const v = flatView(state);
  if (!v) throw new Error('This operation needs a flat-folded state');
  return v;
}

const overlapCache = new WeakMap<KernelState, ReadonlyArray<readonly [FaceId, FaceId]>>();

/** All pairs (f < g) of faces whose world polygons overlap with positive area. */
export function overlapPairs(state: KernelState): ReadonlyArray<readonly [FaceId, FaceId]> {
  const cached = overlapCache.get(state);
  if (cached) return cached;
  const view = requireFlat(state);
  const out: Array<readonly [FaceId, FaceId]> = [];
  const ids = view.faceIds;
  for (let i = 0; i < ids.length; i++) {
    const f = ids[i]!;
    const bf = view.box.get(f)!;
    const pf = view.poly.get(f)!;
    for (let j = i + 1; j < ids.length; j++) {
      const g = ids[j]!;
      if (!boxesOverlap(bf, view.box.get(g)!)) continue;
      if (convexOverlap(pf, view.poly.get(g)!, state.tol)) out.push([f, g]);
    }
  }
  overlapCache.set(state, out);
  return out;
}

/** Overlapping pairs (f < g) where at least one face is in `changed`. */
export function overlapPairsTouching(
  state: KernelState,
  changed: ReadonlySet<FaceId>,
): ReadonlyArray<readonly [FaceId, FaceId]> {
  const view = requireFlat(state);
  const out: Array<readonly [FaceId, FaceId]> = [];
  for (const f of [...changed].sort((a, b) => a - b)) {
    const bf = view.box.get(f);
    const pf = view.poly.get(f);
    if (!bf || !pf) continue;
    for (const g of view.faceIds) {
      if (g === f || (changed.has(g) && g < f)) continue;
      if (!boxesOverlap(bf, view.box.get(g)!)) continue;
      if (convexOverlap(pf, view.poly.get(g)!, state.tol)) out.push(f < g ? [f, g] : [g, f]);
    }
  }
  return out;
}

export type StackResult =
  | { readonly ok: true; readonly faces: readonly FaceId[] }
  | { readonly ok: false; readonly reason: 'no-order'; readonly faces: readonly FaceId[] };

/** Faces whose interior contains q, sorted top (nearest the viewer) to bottom. */
export function stackAt(state: KernelState, q: Vec2): StackResult {
  const view = requireFlat(state);
  const faces = view.faceIds.filter((f) => containsStrictly(view.poly.get(f)!, q, state.tol));
  const above = new Map<FaceId, number>();
  for (const f of faces) {
    let count = 0;
    for (const g of faces) {
      if (g === f) continue;
      const o = orderOf(state.folded.layerOrder, g, f);
      if (o === undefined) return { ok: false, reason: 'no-order', faces };
      if (o === 1) count++;
    }
    above.set(f, count);
  }
  const sorted = [...faces].sort((a, b) => above.get(a)! - above.get(b)! || a - b);
  // A consistent stack has exactly 0, 1, 2, ... faces above each face.
  for (let i = 0; i < sorted.length; i++) {
    if (above.get(sorted[i]!) !== i) return { ok: false, reason: 'no-order', faces };
  }
  return { ok: true, faces: sorted };
}
