import { line as makeLine, type Line2, type Side, side } from '../geometry/line.ts';
import { boxesOverlap, boxOf, clipHalfPlane, convexOverlap, isFat } from '../geometry/polygon.ts';
import { applyMaterial, compose, halfTurnAboutPlaneLine, worldToPlane, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges, materialPolygon } from '../paper/creasePattern.ts';
import { foldedRestDeg, memoryDeg } from '../paper/physics.ts';
import { maxSpan } from '../paper/spans.ts';
import type { Crease, FaceId, VertexId } from '../paper/types.ts';
import { derivePlacements, flatFoldAngle } from '../state/derive.ts';
import { flatView, overlapPairs, stackAt } from '../state/flat.ts';
import { orderOf, setOrder } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { checkInvariants } from '../validate/invariants.ts';
import { SplitError, splitFaces } from './split.ts';
import { type FoldParams, type MoveResult, reject } from './types.ts';

/** New faces must be at least this many length tolerances wide. */
const SLIVER_FACTOR = 4;

/**
 * Fold the picked-up layers 180° about a straight line (valley: up and over, toward the
 * viewer; mountain: down and under).
 *
 * 1. Selection: the layers under the grab point, top k or all.
 * 2. Moving set: flood fill from the grabbed faces, on the grabbed side of the line,
 *    across every crease except ones lying on the fold line (brief, section 3).
 * 3. Refuse if the fill reached layers under the grab that weren't picked up ('joined').
 * 4. Sweep check: a flat 180° rotation lifts every moving point off the table plane
 *    immediately, so a stationary layer lying over (valley) or under (mountain) a moving
 *    layer anywhere they overlap is in the way ('tucked'). Nothing else on the table can be
 *    hit: in the zero-thickness flat model the moving sheet sweeps the open half-space.
 * 5. Layer order is rewritten locally: the moving stack is reversed and laid on top (valley)
 *    or underneath (mountain) where it lands; everything else keeps its order. We never
 *    solve flat-foldability from scratch (NP-hard: Bern and Hayes 1996).
 * 6. Fold angles are re-derived from the result, placements are re-derived from the crease
 *    graph, and the whole state is checked against every invariant. Any violation refuses
 *    the move (fail closed).
 */
export function fold(state: KernelState, params: FoldParams): MoveResult {
  const view = flatView(state);
  if (!view) return reject('unsupported', [], { detail: 'Folding needs a flat model in Phase 0' });
  const tol = state.tol;

  let l: Line2;
  try {
    l = makeLine(params.line.p, params.line.d);
  } catch {
    return reject('degenerate', [], { detail: 'The fold line has no direction' });
  }
  const seedSide = side(l, params.seed, tol);
  if (seedSide === 0) return reject('degenerate', [], { detail: 'The grab point is on the fold line' });
  // Orient the line so the moving side is its left (+1) side.
  if (seedSide < 0) l = { p: l.p, d: [-l.d[0], -l.d[1]] };
  const dir: 1 | -1 = params.direction === 'valley' ? 1 : -1;

  const stack = stackAt(state, params.seed);
  if (!stack.ok) return reject('internal', [], { detail: 'Layers under the grab have no consistent order' });
  if (stack.faces.length === 0) return reject('missed');
  const count =
    params.layers === 'all' ? stack.faces.length : Math.max(1, Math.min(stack.faces.length, Math.floor(params.layers)));
  const seeds = stack.faces.slice(0, count);

  // Classify every vertex once, by its canonical world position, with the weld band.
  const vside = new Map<VertexId, Side>();
  for (const [v, p] of view.vertexWorld) vside.set(v, side(l, p, tol, tol.weld));
  const cls = new Map<FaceId, 'pos' | 'neg' | 'cross'>();
  for (const f of view.faceIds) {
    let pos = false;
    let neg = false;
    for (const v of state.cp.faces.get(f)!.verts) {
      const s = vside.get(v)!;
      if (s > 0) pos = true;
      else if (s < 0) neg = true;
    }
    cls.set(f, pos && neg ? 'cross' : pos ? 'pos' : 'neg');
  }

  // Moving set: flood fill on the + side, never across creases lying on the fold line.
  const adj = adjacency(state.cp);
  const moving = new Set<FaceId>(seeds);
  const queue = [...seeds];
  for (let qi = 0; qi < queue.length; qi++) {
    const f = queue[qi]!;
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      if (vside.get(c.v[0]) !== 1 && vside.get(c.v[1]) !== 1) continue; // on the line or behind it
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || moving.has(g)) continue;
      moving.add(g);
      queue.push(g);
    }
  }

  if (moving.size === view.faceIds.length && view.faceIds.every((f) => cls.get(f) !== 'cross')) {
    return reject('degenerate', [], { detail: 'The fold line misses the paper' });
  }

  const seedSet = new Set(seeds);
  const joined = stack.faces.filter((f) => moving.has(f) && !seedSet.has(f));
  if (joined.length > 0) {
    const deepest = Math.max(...joined.map((f) => stack.faces.indexOf(f)));
    return reject('joined', joined, { suggestLayers: deepest + 1 });
  }

  // Held faces can't move.
  for (const h of state.folded.holds) {
    if (!moving.has(h.face)) continue;
    const w = worldToPlane(applyMaterial(state.folded.placements.get(h.face)!, h.material));
    if (side(l, w, tol) >= 0) return reject('held', [h.face]);
  }

  // Sweep check on the + side.
  const plusPiece = new Map<FaceId, Vec2[]>();
  const piece = (f: FaceId): Vec2[] => {
    let p = plusPiece.get(f);
    if (!p) {
      p = cls.get(f) === 'cross' ? clipHalfPlane(view.poly.get(f)!, l, 1) : [...view.poly.get(f)!];
      plusPiece.set(f, p);
    }
    return p;
  };
  const blockers = new Set<FaceId>();
  const order = state.folded.layerOrder;
  for (const m of moving) {
    const pm = piece(m);
    const bm = boxOf(pm);
    for (const q of view.faceIds) {
      if (moving.has(q) || cls.get(q) === 'neg') continue;
      const pq = piece(q);
      if (!boxesOverlap(bm, boxOf(pq)) || !convexOverlap(pm, pq, tol)) continue;
      const o = orderOf(order, m, q);
      if (o === undefined) return reject('internal', [m, q], { detail: 'Overlapping layers with no order' });
      if (o !== dir) blockers.add(q);
    }
  }
  if (blockers.size > 0) return reject('tucked', [...blockers].sort((a, b) => a - b));

  // Cut the moving faces that straddle the line.
  const opId = state.next.op;
  const toSplit = [...moving].filter((f) => cls.get(f) === 'cross');
  let split;
  try {
    split = splitFaces(state.cp, state.next, l, view.vertexWorld, vside, toSplit, opId);
  } catch (e) {
    if (e instanceof SplitError) return reject('degenerate', [], { detail: e.message });
    throw e;
  }
  const cp = split.cp;
  // A line passing just outside the weld band of a corner would cut a sliver thinner than
  // the tolerance: no later decision about it could be trusted. Refuse; snapping in the
  // intent layer puts lines exactly through landmarks instead.
  const sliverTol = { ...tol, len: tol.len * SLIVER_FACTOR };
  for (const pcs of split.pieces.values()) {
    for (const f of [pcs.plus, pcs.minus]) {
      if (!isFat(materialPolygon(cp, f), sliverTol)) {
        return reject('degenerate', [], { detail: 'The fold line passes too close to a corner' });
      }
    }
  }

  const parentOf = new Map<FaceId, FaceId>();
  const movingNew = new Set<FaceId>();
  for (const f of cp.faces.keys()) parentOf.set(f, f);
  for (const [old, pcs] of split.pieces) {
    parentOf.set(pcs.plus, old);
    parentOf.set(pcs.minus, old);
    movingNew.add(pcs.plus);
  }
  for (const f of moving) if (!split.pieces.has(f)) movingNew.add(f);

  // Placements: moving faces take a half-turn about the fold line.
  const turn = halfTurnAboutPlaneLine(l);
  const startPlacements = new Map<FaceId, Rigid3>();
  const placements = new Map<FaceId, Rigid3>();
  for (const f of [...cp.faces.keys()].sort((a, b) => a - b)) {
    const before = state.folded.placements.get(parentOf.get(f)!)!;
    startPlacements.set(f, before);
    placements.set(f, movingNew.has(f) ? compose(turn, before) : before);
  }

  // Layer order of the new state.
  const draft: KernelState = {
    ...state,
    cp,
    folded: { ...state.folded, placements, layerOrder: new Map() },
    next: { ...split.next, op: opId + 1 },
  };
  const newOrder = new Map<string, 1 | -1>();
  for (const [x, y] of overlapPairs(draft)) {
    const mx = movingNew.has(x);
    const my = movingNew.has(y);
    if (mx !== my) {
      // The moving stack lands on top (valley) or underneath (mountain).
      setOrder(newOrder, mx ? x : y, mx ? y : x, dir);
      continue;
    }
    const px = parentOf.get(x)!;
    const py = parentOf.get(y)!;
    const o = px === py ? undefined : orderOf(order, px, py);
    if (o === undefined) return reject('internal', [x, y], { detail: 'Lost track of a layer order' });
    // Moving faces are turned over together, so their order flips; stationary ones keep it.
    setOrder(newOrder, x, y, mx ? (o === 1 ? -1 : 1) : o);
  }

  // Fold angles, assignments and rest angles from the new geometry.
  const withOrder: KernelState = { ...draft, folded: { ...draft.folded, layerOrder: newOrder } };
  const newView = flatView(withOrder)!;
  const newAdj = adjacency(cp);
  const creases = new Map(cp.creases);
  const newSet = new Set(split.newCreases);
  for (const c of cp.creases.values()) {
    const ef = newAdj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    const angle = flatFoldAngle(newView, newOrder, c, ef.left, ef.right);
    if (angle === null) return reject('internal', [ef.left, ef.right], { detail: 'Folded faces with no order' });
    if (angle === c.angleDeg && !newSet.has(c.id)) continue;
    creases.set(c.id, updatedCrease(c, angle, state.paper.stiffness));
  }
  const cpAngles = { ...cp, creases };

  // Re-derive placements from the crease graph so they never drift.
  const root = [...cp.faces.keys()].filter((f) => !movingNew.has(f)).sort((a, b) => a - b)[0];
  if (root === undefined) return reject('internal', [], { detail: 'Nothing stayed put' });
  const derived = derivePlacements(cpAngles, root, placements.get(root)!);

  const result: KernelState = {
    ...state,
    cp: cpAngles,
    folded: { placements: derived, layerOrder: newOrder, holds: state.folded.holds },
    next: { ...split.next, op: opId + 1 },
  };
  const violations = checkInvariants(result);
  if (violations.length > 0) {
    return reject('internal', violations.flatMap((v) => v.faces ?? []), {
      detail: violations.map((v) => `[${v.code}] ${v.message}`).join('; '),
    });
  }

  return {
    ok: true,
    state: result,
    transition: {
      kind: 'fold',
      line: l,
      direction: dir,
      moving: [...movingNew].sort((a, b) => a - b),
      parentOf,
      startPlacements,
      newCreases: split.newCreases,
      fromDeg: 0,
      toDeg: 180,
    },
  };
}

/** New angle, assignment and rest angle for a crease whose fold angle changed. */
function updatedCrease(c: Crease, angle: 0 | 180 | -180, stiffness: number): Crease {
  const sharp = maxSpan(c.sharpness);
  if (angle === 0) {
    // Unfolded: keep the M/V memory and a few degrees of it.
    const sign = c.angleDeg > 0 ? 1 : c.angleDeg < 0 ? -1 : c.assignment === 'M' ? -1 : 1;
    return { ...c, angleDeg: 0, restAngleDeg: sign * memoryDeg(sharp) };
  }
  const sign = angle > 0 ? 1 : -1;
  return {
    ...c,
    angleDeg: angle,
    assignment: sign > 0 ? 'V' : 'M',
    restAngleDeg: sign * foldedRestDeg(stiffness, sharp),
  };
}

