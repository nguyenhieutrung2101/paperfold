import { lineThrough, signedDistance, type Line2 } from '../geometry/line.ts';
import { compose, materialHalfTurn, rotationAbout, type Rigid3 } from '../geometry/rigid.ts';
import { adjacency, faceEdges, getVertex } from '../paper/creasePattern.ts';
import type { Crease, CreasePattern, EdgeId, FaceId } from '../paper/types.ts';
import type { FlatView } from './flat.ts';
import { orderOf } from './order.ts';

/** Sign (+1/−1) of the face vertex farthest from the line; 0 if the face is degenerate. */
export function faceSideOfLine(poly: readonly (readonly [number, number])[], l: Line2): -1 | 0 | 1 {
  let best = 0;
  for (const p of poly) {
    const d = signedDistance(l, p);
    if (Math.abs(d) > Math.abs(best)) best = d;
  }
  return best > 0 ? 1 : best < 0 ? -1 : 0;
}

/**
 * Fold angle of an interior crease in a flat state, from geometry and layer order.
 *
 * Faces on opposite sides of the crease line: 0°. On the same side: folded flat, and
 * the sign follows the material-front convention: the crease is a valley (+180°) when
 * the right face lies on the left face's front side (front surfaces meet), else a
 * mountain (−180°). Returns null when the needed layer order is missing.
 */
export function flatFoldAngle(
  view: FlatView,
  order: ReadonlyMap<string, 1 | -1>,
  crease: Crease,
  left: FaceId,
  right: FaceId,
): 0 | 180 | -180 | null {
  const a = view.vertexWorld.get(crease.v[0])!;
  const b = view.vertexWorld.get(crease.v[1])!;
  const l = lineThrough(a, b);
  const sl = faceSideOfLine(view.poly.get(left)!, l);
  const sr = faceSideOfLine(view.poly.get(right)!, l);
  if (sl !== sr) return 0;
  const rightAboveLeft = orderOf(order, right, left);
  if (rightAboveLeft === undefined) return null;
  const leftFrontUp = view.frontUp.get(left)!;
  // Right face on left face's front side <=> (above and front-up) or (below and front-down).
  const onFront = (rightAboveLeft === 1) === leftFrontUp;
  return onFront ? 180 : -180;
}

/**
 * Re-derive every face placement from the crease graph (brief, section 3, "Robustness"):
 * walk a spanning tree of faces from `root`, crossing each crease by rotating about it
 * by its fold angle. Placements are then products of exact per-crease rotations along
 * one tree path, so they never accumulate drift across moves. Creases off the tree are
 * the loop-closure checks (validate: connectivity).
 *
 * The tree is a maximum spanning tree by crease length (Prim), so placements are carried
 * across the longest, best-conditioned axes: a short crease defines its axis direction
 * poorly, and any error there grows with the distance to the far side of the face.
 * Ties break by edge id, so the tree (and the result) is deterministic.
 *
 * Sign convention: for crease a -> b on the CCW boundary of face f, the neighbor rotates
 * about axis (b − a) by −angle, so a positive (valley) angle swings it toward f's front (+w).
 */
export function derivePlacements(
  cp: CreasePattern,
  root: FaceId,
  rootPlacement: Rigid3,
  angleOf: (e: EdgeId) => number = (e) => cp.creases.get(e)!.angleDeg,
): Map<FaceId, Rigid3> {
  const out = new Map<FaceId, Rigid3>([[root, rootPlacement]]);
  const adj = adjacency(cp);
  interface Candidate {
    readonly len: number;
    readonly e: EdgeId;
    readonly from: FaceId;
    readonly to: FaceId;
    readonly a: readonly [number, number];
    readonly b: readonly [number, number];
  }
  const cand: Candidate[] = [];
  const grow = (f: FaceId): void => {
    const verts = cp.faces.get(f)!.verts;
    faceEdges(cp, f).forEach((e, i) => {
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || out.has(g)) return;
      const a = getVertex(cp, verts[i]!);
      const b = getVertex(cp, verts[(i + 1) % verts.length]!);
      cand.push({ len: Math.hypot(b[0] - a[0], b[1] - a[1]), e, from: f, to: g, a, b });
    });
  };
  grow(root);
  while (cand.length > 0) {
    let best = 0;
    for (let i = 1; i < cand.length; i++) {
      const c = cand[i]!;
      const k = cand[best]!;
      if (c.len > k.len || (c.len === k.len && c.e < k.e)) best = i;
    }
    const c = cand[best]!;
    cand[best] = cand[cand.length - 1]!;
    cand.pop();
    if (out.has(c.to)) continue;
    out.set(c.to, compose(out.get(c.from)!, creaseRotation(c.a, c.b, angleOf(c.e))));
    grow(c.to);
  }
  return out;
}

/** Material-space rotation carrying the right-hand neighbor of directed crease a -> b. */
export function creaseRotation(a: readonly [number, number], b: readonly [number, number], angleDeg: number): Rigid3 {
  if (angleDeg === 0) return { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  if (angleDeg === 180 || angleDeg === -180) return materialHalfTurn(a, b);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  return rotationAbout([a[0], a[1], 0], [dx / l, dy / l, 0], (-angleDeg * Math.PI) / 180);
}
