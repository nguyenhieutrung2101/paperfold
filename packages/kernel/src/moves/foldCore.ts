import { line as makeLine, type Line2, type Side, side } from '../geometry/line.ts';
import { boxesOverlap, boxOf, clipHalfPlane, containsStrictly, convexOverlap, isFat } from '../geometry/polygon.ts';
import { applyMaterial, compose, halfTurnAboutPlaneLine, worldToPlane, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges, materialPolygon } from '../paper/creasePattern.ts';
import { foldedRestDeg, memoryDeg } from '../paper/physics.ts';
import { maxSpan } from '../paper/spans.ts';
import type { Crease, CreasePattern, EdgeId, FaceId, VertexId } from '../paper/types.ts';
import { derivePlacements, flatFoldAngle } from '../state/derive.ts';
import { type FlatView, flatView, overlapPairsTouching, stackAt } from '../state/flat.ts';
import { orderOf, type PairKey, parsePairKey, setOrder } from '../state/order.ts';
import type { IdCounters, KernelState } from '../state/types.ts';
import { checkInvariants } from '../validate/invariants.ts';
import { SplitError, splitFaces } from './split.ts';
import { type PlaneLine, type Rejection, reject } from './types.ts';

/** New faces must be at least this many length tolerances wide. */
const SLIVER_FACTOR = 4;

/**
 * Everything a half-turn move (plain fold, reverse fold) decides before touching the
 * crease pattern: the oriented line, the picked-up layers, and the moving set.
 */
export interface HalfTurnPrep {
  readonly view: FlatView;
  /** The fold line, oriented so the moving side is its left (+1) side. */
  readonly line: Line2;
  /** All faces under the grab point, top to bottom. */
  readonly stack: readonly FaceId[];
  /** The picked-up faces (top `count` of the stack). */
  readonly seeds: readonly FaceId[];
  readonly vside: ReadonlyMap<VertexId, Side>;
  readonly cls: ReadonlyMap<FaceId, 'pos' | 'neg' | 'cross'>;
  /** Old faces with a part that moves. */
  readonly moving: ReadonlySet<FaceId>;
}

/**
 * Steps 1–3 of every half-turn move: orient the line, pick up layers, flood-fill the
 * moving set on the grabbed side (never across creases on the line), refuse joined layers
 * and held faces (brief, section 3, "Kernel moves").
 */
export function prepareHalfTurn(
  state: KernelState,
  lineIn: PlaneLine,
  seed: Vec2,
  layers: number | 'all',
  holds: readonly Vec2[] = [],
): HalfTurnPrep | Rejection {
  const view = flatView(state);
  if (!view) return reject('unsupported', [], { detail: 'Folding needs a flat model' });
  const tol = state.tol;
  let l: Line2;
  try {
    l = makeLine(lineIn.p, lineIn.d);
  } catch {
    return reject('degenerate', [], { detail: 'The fold line has no direction' });
  }
  const seedSide = side(l, seed, tol);
  if (seedSide === 0) return reject('degenerate', [], { detail: 'The grab point is on the fold line' });
  if (seedSide < 0) l = { p: l.p, d: [-l.d[0], -l.d[1]] };

  const stackRes = stackAt(state, seed);
  if (!stackRes.ok) return reject('internal', [], { detail: 'Layers under the grab have no consistent order' });
  const stack = stackRes.faces;
  if (stack.length === 0) return reject('missed');
  const count = layers === 'all' ? stack.length : Math.max(1, Math.min(stack.length, Math.floor(layers)));
  const seeds = stack.slice(0, count);

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
  const joined = stack.filter((f) => moving.has(f) && !seedSet.has(f));
  if (joined.length > 0) {
    const deepest = Math.max(...joined.map((f) => stack.indexOf(f)));
    return reject('joined', joined, { suggestLayers: deepest + 1 });
  }

  // Held faces can't move: persistent pins, and the other hand's presses for this move.
  for (const h of state.folded.holds) {
    if (!moving.has(h.face)) continue;
    const w = worldToPlane(applyMaterial(state.folded.placements.get(h.face)!, h.material));
    if (side(l, w, tol) >= 0) return reject('held', [h.face]);
  }
  for (const h of holds) {
    if (side(l, h, tol) <= 0) continue;
    const pinned = [...moving].filter((f) => containsStrictly(view.poly.get(f)!, h, tol));
    if (pinned.length > 0) return reject('held', pinned);
  }

  return { view, line: l, stack, seeds, vside, cls, moving };
}

/** The part of an old face on the moving side, on the table plane. */
export function plusPiece(prep: HalfTurnPrep, f: FaceId): Vec2[] {
  const poly = prep.view.poly.get(f)!;
  return prep.cls.get(f) === 'cross' ? clipHalfPlane(poly, prep.line, 1) : [...poly];
}

/**
 * Stationary layers that a plain half-turn would have to pass through: anything lying over
 * (valley, dir = +1) or under (mountain) a moving layer where they overlap on the moving
 * side. In the zero-thickness flat model nothing else can be hit.
 */
export function sweepBlockers(state: KernelState, prep: HalfTurnPrep, dir: 1 | -1): FaceId[] | Rejection {
  const { view, moving, cls } = prep;
  const pieces = new Map<FaceId, Vec2[]>();
  const piece = (f: FaceId) => {
    let p = pieces.get(f);
    if (!p) pieces.set(f, (p = plusPiece(prep, f)));
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
      if (!boxesOverlap(bm, boxOf(pq)) || !convexOverlap(pm, pq, state.tol)) continue;
      const o = orderOf(order, m, q);
      if (o === undefined) return reject('internal', [m, q], { detail: 'Overlapping layers with no order' });
      if (o !== dir) blockers.add(q);
    }
  }
  return [...blockers].sort((a, b) => a - b);
}

/** What the order rule is told about a pair of overlapping faces of the new state. */
export interface PairInfo {
  readonly x: FaceId;
  readonly y: FaceId;
  readonly xMoves: boolean;
  readonly yMoves: boolean;
  /** The old faces they came from. */
  readonly px: FaceId;
  readonly py: FaceId;
}

/** New order for an overlapping pair: +1 if x ends above y, −1 below, undefined if unknown. */
export type OrderRule = (pair: PairInfo) => 1 | -1 | undefined;

export interface HalfTurnBuild {
  readonly state: KernelState;
  readonly line: Line2;
  readonly moving: readonly FaceId[];
  readonly parentOf: ReadonlyMap<FaceId, FaceId>;
  readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
  readonly newCreases: readonly EdgeId[];
  /** Old face -> its pieces, for faces the line cut. */
  readonly pieces: ReadonlyMap<FaceId, { readonly plus: FaceId; readonly minus: FaceId }>;
}

/**
 * Steps 4–6 of every half-turn move: cut the moving faces that straddle the line, give the
 * moving faces a half-turn about it, ask `rule` for every pair whose relation can change,
 * re-derive fold angles and placements, and check every invariant the move could have
 * touched (fail closed).
 */
export function applyHalfTurn(state: KernelState, prep: HalfTurnPrep, rule: OrderRule): HalfTurnBuild | Rejection {
  const tol = state.tol;
  const l = prep.line;
  const opId = state.next.op;
  const toSplit = [...prep.moving].filter((f) => prep.cls.get(f) === 'cross');
  let split: { cp: CreasePattern; next: IdCounters; pieces: ReadonlyMap<FaceId, { plus: FaceId; minus: FaceId }>; newCreases: readonly EdgeId[] };
  try {
    split = splitFaces(state.cp, state.next, l, prep.view.vertexWorld, prep.vside, toSplit, opId);
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
  for (const f of prep.moving) if (!split.pieces.has(f)) movingNew.add(f);

  const turn = halfTurnAboutPlaneLine(l);
  const startPlacements = new Map<FaceId, Rigid3>();
  const placements = new Map<FaceId, Rigid3>();
  for (const f of [...cp.faces.keys()].sort((a, b) => a - b)) {
    const before = state.folded.placements.get(parentOf.get(f)!)!;
    startPlacements.set(f, before);
    placements.set(f, movingNew.has(f) ? compose(turn, before) : before);
  }

  const draft: KernelState = {
    ...state,
    cp,
    folded: { ...state.folded, placements, layerOrder: new Map() },
    next: { ...split.next, op: opId + 1 },
  };
  // Only faces that moved or were cut can gain, lose or change a relation; every other pair
  // keeps its overlap and its order exactly.
  const changed = new Set<FaceId>(movingNew);
  for (const pcs of split.pieces.values()) {
    changed.add(pcs.plus);
    changed.add(pcs.minus);
  }
  const order = state.folded.layerOrder;
  const newOrder = new Map<PairKey, 1 | -1>();
  for (const [k, s] of order) {
    const [f, g] = parsePairKey(k);
    if (!changed.has(f) && !changed.has(g) && cp.faces.has(f) && cp.faces.has(g)) newOrder.set(k, s);
  }
  for (const [x, y] of overlapPairsTouching(draft, changed)) {
    const o = rule({ x, y, xMoves: movingNew.has(x), yMoves: movingNew.has(y), px: parentOf.get(x)!, py: parentOf.get(y)! });
    if (o === undefined) return reject('internal', [x, y], { detail: 'Lost track of a layer order' });
    setOrder(newOrder, x, y, o);
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
    if (!changed.has(ef.left) && !changed.has(ef.right)) continue;
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
  const violations = checkInvariants(result, { changed });
  if (violations.length > 0) {
    return reject('internal', violations.flatMap((v) => v.faces ?? []), {
      detail: violations.map((v) => `[${v.code}] ${v.message}`).join('; '),
    });
  }
  return {
    state: result,
    line: l,
    moving: [...movingNew].sort((a, b) => a - b),
    parentOf,
    startPlacements,
    newCreases: split.newCreases,
    pieces: split.pieces,
  };
}

/** New angle, assignment and rest angle for a crease whose fold angle changed. */
export function updatedCrease(c: Crease, angle: 0 | 180 | -180, stiffness: number): Crease {
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

export function isRejection(x: unknown): x is Rejection {
  return typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false;
}
