import { type Line2, side } from '../geometry/line.ts';
import { isFat } from '../geometry/polygon.ts';
import { compose, IDENTITY, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, materialPolygon } from '../paper/creasePattern.ts';
import type { CreasePattern, EdgeId, FaceId, VertexId } from '../paper/types.ts';
import { derivePlacements, flatFoldAngle } from '../state/derive.ts';
import { flatView, overlapPairsTouching } from '../state/flat.ts';
import { orderOf, type PairKey, pairKey, parsePairKey } from '../state/order.ts';
import { solveLayerOrder } from '../state/solveOrder.ts';
import type { IdCounters, KernelState } from '../state/types.ts';
import { checkInvariants } from '../validate/invariants.ts';
import { updatedCrease } from './foldCore.ts';
import { SplitError, splitFaces } from './split.ts';
import { type Rejection, reject } from './types.ts';

const SLIVER_FACTOR = 4;

/** A cut through some faces along a line on the table plane (a new crease where it crosses them). */
export interface Cut {
  readonly line: Line2;
  /** Which faces to cut: the current face, the original face it came from, its world polygon. */
  readonly faces: (face: FaceId, original: FaceId, poly: readonly Vec2[]) => boolean;
}

/** A part of the paper that moves rigidly; `motion` is a world-space rigid motion. */
export interface MotionGroup {
  readonly id: string;
  readonly motion: Rigid3;
}

export interface MultiSpec {
  readonly cuts: readonly Cut[];
  /**
   * Which group a face of the cut pattern belongs to, from the original face it came from
   * and its world polygon (before the move). null: it stays put.
   */
  readonly groupOf: (face: FaceId, original: FaceId, poly: readonly Vec2[]) => MotionGroup | null;
  /**
   * Orders the move itself decides (they define it: an outside reverse fold's tip goes
   * outside): +1 if x ends above y. Same arguments as `hint`.
   */
  readonly fixed?: (
    x: FaceId,
    y: FaceId,
    gx: MotionGroup | null,
    gy: MotionGroup | null,
    ox: FaceId,
    oy: FaceId,
  ) => 1 | -1 | undefined;
  /**
   * Preferred order for a pair the constraints leave free: +1 if x should end above y. Given
   * both faces, their groups, and the original faces they came from.
   */
  readonly hint?: (
    x: FaceId,
    y: FaceId,
    gx: MotionGroup | null,
    gy: MotionGroup | null,
    ox: FaceId,
    oy: FaceId,
  ) => 1 | -1 | undefined;
}

export interface MultiBuild {
  readonly state: KernelState;
  readonly moving: readonly FaceId[];
  readonly parentOf: ReadonlyMap<FaceId, FaceId>;
  readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
  readonly newCreases: readonly EdgeId[];
  /** New face -> its group id (moving faces only). */
  readonly groups: ReadonlyMap<FaceId, string>;
}

/**
 * A flat move where several parts of the paper turn at once, each rigidly (squash, petal,
 * and later rabbit ears, swivels, crimps): cut the faces the move creases, give every part
 * its own motion, then work out the layer order the new geometry allows, preferring the
 * move's own idea where the paper leaves a choice (state/solveOrder.ts). Pairs that moved
 * together keep their order (flipped if their part turned over). Fold angles and placements
 * are then re-derived from the creases and every touched invariant is checked (fail closed),
 * exactly as for a plain fold.
 */
export function applyMultiMotion(state: KernelState, spec: MultiSpec): MultiBuild | Rejection {
  const view = flatView(state);
  if (!view) return reject('unsupported', [], { detail: 'This move needs a flat model' });
  const tol = state.tol;
  const opId = state.next.op;
  let cp: CreasePattern = state.cp;
  let next: IdCounters = state.next;
  const parentOf = new Map<FaceId, FaceId>();
  for (const f of cp.faces.keys()) parentOf.set(f, f);
  const newCreases: EdgeId[] = [];
  const placementOf = (f: FaceId) => state.folded.placements.get(parentOf.get(f)!)!;
  const draftWith = (c: CreasePattern, placements: Map<FaceId, Rigid3>, n: IdCounters): KernelState => ({
    ...state,
    cp: c,
    next: n,
    folded: { ...state.folded, placements, layerOrder: new Map() },
  });
  const unmoved = () => new Map([...cp.faces.keys()].map((f) => [f, placementOf(f)]));

  // 1. Cuts, one line at a time.
  for (const cut of spec.cuts) {
    const v = flatView(draftWith(cp, unmoved(), next));
    if (!v) return reject('internal', [], { detail: 'Lost the flat view while cutting' });
    const vside = new Map<VertexId, -1 | 0 | 1>();
    for (const [id, p] of v.vertexWorld) vside.set(id, side(cut.line, p, tol, tol.weld));
    const toSplit: FaceId[] = [];
    for (const f of [...cp.faces.keys()].sort((a, b) => a - b)) {
      if (!cut.faces(f, parentOf.get(f)!, v.poly.get(f)!)) continue;
      let pos = false;
      let neg = false;
      for (const vid of cp.faces.get(f)!.verts) {
        const s = vside.get(vid)!;
        if (s > 0) pos = true;
        else if (s < 0) neg = true;
      }
      if (pos && neg) toSplit.push(f);
    }
    if (toSplit.length === 0) continue;
    let split;
    try {
      split = splitFaces(cp, next, cut.line, v.vertexWorld, vside, toSplit, opId);
    } catch (e) {
      if (e instanceof SplitError) return reject('degenerate', [], { detail: e.message });
      throw e;
    }
    const sliverTol = { ...tol, len: tol.len * SLIVER_FACTOR };
    for (const [old, pcs] of split.pieces) {
      const original = parentOf.get(old)!;
      for (const f of [pcs.plus, pcs.minus]) {
        if (!isFat(materialPolygon(split.cp, f), sliverTol)) {
          return reject('degenerate', [], { detail: 'A crease passes too close to a corner' });
        }
        parentOf.set(f, original);
      }
      parentOf.delete(old);
    }
    cp = split.cp;
    next = split.next;
    newCreases.push(...split.newCreases);
  }

  // 2. Every face's part and new placement.
  const cutView = flatView(draftWith(cp, unmoved(), next));
  if (!cutView) return reject('internal', [], { detail: 'Lost the flat view after cutting' });
  const group = new Map<FaceId, MotionGroup | null>();
  const startPlacements = new Map<FaceId, Rigid3>();
  const placements = new Map<FaceId, Rigid3>();
  const cutFaces = new Set<FaceId>();
  for (const f of [...cp.faces.keys()].sort((a, b) => a - b)) {
    const original = parentOf.get(f)!;
    if (!state.cp.faces.has(f)) cutFaces.add(f);
    const g = spec.groupOf(f, original, cutView.poly.get(f)!);
    group.set(f, g);
    const before = placementOf(f);
    startPlacements.set(f, before);
    placements.set(f, g ? compose(g.motion, before) : before);
  }
  const movingNew = [...cp.faces.keys()].filter((f) => group.get(f) !== null).sort((a, b) => a - b);
  const changed = new Set<FaceId>([...movingNew, ...cutFaces]);
  if (movingNew.length === 0) return reject('degenerate', [], { detail: 'Nothing moves' });

  // 3. Layer order: pairs that moved together keep theirs; the rest is solved.
  const draft = draftWith(cp, placements, { ...next, op: opId + 1 });
  if (!flatView(draft)) return reject('internal', [], { detail: 'The move does not lie flat' });
  const flips = (g: MotionGroup | null) => (g ? g.motion.r[4] < 0 : false);
  const sameGroup = (a: MotionGroup | null, b: MotionGroup | null) => (a === null ? b === null : b !== null && a.id === b.id);
  const known = new Map<PairKey, 1 | -1>();
  const old = state.folded.layerOrder;
  for (const [k, s] of old) {
    const [f, g] = parsePairKey(k);
    if (!changed.has(f) && !changed.has(g) && cp.faces.has(f) && cp.faces.has(g)) known.set(k, s);
  }
  for (const [x, y] of overlapPairsTouching(draft, changed)) {
    const gx = group.get(x)!;
    const gy = group.get(y)!;
    if (!sameGroup(gx, gy)) {
      const f = spec.fixed?.(x, y, gx, gy, parentOf.get(x)!, parentOf.get(y)!);
      if (f !== undefined) known.set(pairKey(x, y), x < y ? f : f === 1 ? -1 : 1);
      continue;
    }
    const px = parentOf.get(x)!;
    const py = parentOf.get(y)!;
    if (px === py) continue;
    const o = orderOf(old, px, py);
    if (o === undefined) continue;
    const s = flips(gx) ? (o === 1 ? -1 : 1) : o;
    known.set(pairKey(x, y), x < y ? s : s === 1 ? -1 : 1);
  }
  const hint = spec.hint;
  const solved = solveLayerOrder({
    state: draft,
    changed,
    known,
    ...(hint ? { hint: (x: FaceId, y: FaceId) => hint(x, y, group.get(x) ?? null, group.get(y) ?? null, parentOf.get(x)!, parentOf.get(y)!) } : {}),
  });
  if (!solved.ok) return reject('blocked', solved.faces, { detail: solved.detail });
  const newOrder = solved.order;

  // 4. Fold angles from the new geometry, then placements re-derived from the creases.
  const withOrder: KernelState = { ...draft, folded: { ...draft.folded, layerOrder: newOrder } };
  const newView = flatView(withOrder)!;
  const adj = adjacency(cp);
  const creases = new Map(cp.creases);
  const fresh = new Set(newCreases);
  for (const c of cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    if (!changed.has(ef.left) && !changed.has(ef.right)) continue;
    const angle = flatFoldAngle(newView, newOrder, c, ef.left, ef.right);
    if (angle === null) return reject('internal', [ef.left, ef.right], { detail: 'Folded faces with no order' });
    if (angle === c.angleDeg && !fresh.has(c.id)) continue;
    creases.set(c.id, updatedCrease(c, angle, state.paper.stiffness));
  }
  const cpAngles = { ...cp, creases };
  const root = [...cp.faces.keys()].filter((f) => group.get(f) === null).sort((a, b) => a - b)[0] ?? movingNew[0]!;
  const derived = derivePlacements(cpAngles, root, placements.get(root) ?? IDENTITY);
  const result: KernelState = {
    ...state,
    cp: cpAngles,
    folded: { placements: derived, layerOrder: newOrder, holds: state.folded.holds },
    next: { ...next, op: opId + 1 },
  };
  const violations = checkInvariants(result, { changed });
  if (violations.length > 0) {
    return reject('internal', violations.flatMap((v) => v.faces ?? []), {
      detail: violations.map((v) => `[${v.code}] ${v.message}`).join('; '),
    });
  }
  const groups = new Map<FaceId, string>();
  for (const f of movingNew) groups.set(f, group.get(f)!.id);
  return { state: result, moving: movingNew, parentOf, startPlacements, newCreases, groups };
}
