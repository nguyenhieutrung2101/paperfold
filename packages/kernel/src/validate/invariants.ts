import { lineThrough, signedDistance, type Line2 } from '../geometry/line.ts';
import {
  type Box,
  boxesOverlap,
  collinearOverlap,
  intersectConvex,
  isFat,
  segmentLengthInside,
  signedArea,
} from '../geometry/polygon.ts';
import { apply, applyMaterial, det3, orthonormalityError } from '../geometry/rigid.ts';
import { cross2, sub2, type Vec2 } from '../geometry/vec.ts';
import { adjacency, getVertex, materialPolygon } from '../paper/creasePattern.ts';
import type { EdgeId, FaceId, VertexId } from '../paper/types.ts';
import { derivePlacements, faceSideOfLine, flatFoldAngle } from '../state/derive.ts';
import { flatView, overlapPairs, overlapPairsTouching, type FlatView } from '../state/flat.ts';
import { orderOf, type PairKey, pairKey, parsePairKey } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';

export type InvariantCode =
  | 'topology'
  | 'not-flat'
  | 'isometry'
  | 'connectivity'
  | 'consistency'
  | 'order-missing'
  | 'order-stale'
  | 'order-cycle'
  | 'taco-taco'
  | 'taco-tortilla'
  | 'tortilla-tortilla'
  | 'maekawa'
  | 'kawasaki';

export interface Violation {
  readonly code: InvariantCode;
  readonly message: string;
  readonly faces?: readonly FaceId[];
  readonly edges?: readonly EdgeId[];
  readonly vertex?: VertexId;
}

/**
 * Restrict checking to constraints that involve at least one of these faces. Sound when
 * the state was produced from a valid state by a move that changed only these faces
 * (new faces, and faces whose placement or layer relations changed): every constraint
 * among untouched faces is exactly as it was, and it held then.
 */
export interface CheckScope {
  readonly changed: ReadonlySet<FaceId>;
}

/**
 * Check the invariants of brief section 3 on a state:
 *  1 isometry, 2 connectivity, 3 consistency, 4 no penetration (flat layer-order
 *  constraints), 5 Maekawa and Kawasaki at flat interior vertices.
 * (6, determinism, is a property of the op log and is tested in history tests.)
 *
 * Returns every violation found; an empty array means the state is valid. With a scope,
 * only constraints touching the changed faces are checked (moves use this; tests use the
 * full check, and property tests compare the two).
 */
export function checkInvariants(state: KernelState, scope?: CheckScope): Violation[] {
  const out: Violation[] = [];
  checkTopology(state, out);
  if (out.length) return out;
  checkIsometry(state, out);
  const view = flatView(state);
  if (!view) {
    out.push({ code: 'not-flat', message: 'Phase 0 kernel states must lie flat' });
    return out;
  }
  const changed = scope?.changed ?? null;
  checkConnectivity(state, out, changed);
  checkConsistency(state, view, out, changed);
  checkLayerOrder(state, view, out, changed);
  checkFlatVertices(state, out, changed);
  return out;
}

const touches = (changed: ReadonlySet<FaceId> | null, ...faces: Array<FaceId | null>) =>
  changed === null || faces.some((f) => f !== null && changed.has(f));

export function isValid(state: KernelState): boolean {
  return checkInvariants(state).length === 0;
}

// --- topology ---------------------------------------------------------------

function checkTopology(state: KernelState, out: Violation[]): void {
  const { cp, paper } = state;
  try {
    adjacency(cp);
  } catch (e) {
    out.push({ code: 'topology', message: (e as Error).message });
    return;
  }
  let total = 0;
  for (const face of cp.faces.values()) {
    const poly = materialPolygon(cp, face.id);
    const a = signedArea(poly);
    total += a;
    if (!(a > 0)) out.push({ code: 'topology', message: `Face ${face.id} is not counter-clockwise`, faces: [face.id] });
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const r = poly[(i + 2) % poly.length]!;
      // Convex, allowing straight (collinear) vertices left by edge splits.
      if (cross2(sub2(q, p), sub2(r, q)) < -state.tol.len * Math.hypot(q[0] - p[0], q[1] - p[1])) {
        out.push({ code: 'topology', message: `Face ${face.id} is not convex`, faces: [face.id] });
        break;
      }
    }
    if (!state.folded.placements.has(face.id)) {
      out.push({ code: 'topology', message: `Face ${face.id} has no placement`, faces: [face.id] });
    }
  }
  const sheet = signedArea(paper.outline);
  if (Math.abs(total - sheet) > state.tol.len * Math.sqrt(sheet) * 10) {
    out.push({ code: 'topology', message: `Faces cover ${total} mm² of a ${sheet} mm² sheet` });
  }
  const adj = adjacency(cp);
  for (const c of cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    const sides = (ef.left === null ? 0 : 1) + (ef.right === null ? 0 : 1);
    if (sides === 0) out.push({ code: 'topology', message: `Edge ${c.id} has no faces`, edges: [c.id] });
    if (sides === 1 && c.assignment !== 'B') {
      out.push({ code: 'topology', message: `Raw edge ${c.id} is not marked B`, edges: [c.id] });
    }
    if (sides === 2 && c.assignment === 'B') {
      out.push({ code: 'topology', message: `Interior edge ${c.id} is marked B`, edges: [c.id] });
    }
  }
}

// --- 1. isometry ------------------------------------------------------------

function checkIsometry(state: KernelState, out: Violation[]): void {
  for (const [f, tr] of state.folded.placements) {
    if (!state.cp.faces.has(f)) {
      out.push({ code: 'isometry', message: `Placement for missing face ${f}`, faces: [f] });
      continue;
    }
    if (orthonormalityError(tr) > 1e-9 || Math.abs(det3(tr.r) - 1) > 1e-9) {
      out.push({ code: 'isometry', message: `Face ${f} is stretched, sheared or mirrored`, faces: [f] });
    }
  }
}

// --- 2. connectivity --------------------------------------------------------

function checkConnectivity(state: KernelState, out: Violation[], changed: ReadonlySet<FaceId> | null): void {
  const { cp } = state;
  const adj = adjacency(cp);
  const tol = state.tol.len;
  for (const c of cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    if (!touches(changed, ef.left, ef.right)) continue;
    const tl = state.folded.placements.get(ef.left)!;
    const tr = state.folded.placements.get(ef.right)!;
    for (const v of c.v) {
      const p = getVertex(cp, v);
      const a = applyMaterial(tl, p);
      const b = applyMaterial(tr, p);
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > tol) {
        out.push({
          code: 'connectivity',
          message: `Faces ${ef.left} and ${ef.right} come apart along edge ${c.id}`,
          faces: [ef.left, ef.right],
          edges: [c.id],
        });
        break;
      }
    }
  }
}

// --- 3. consistency ---------------------------------------------------------

function checkConsistency(
  state: KernelState,
  view: FlatView,
  out: Violation[],
  changed: ReadonlySet<FaceId> | null,
): void {
  const { cp } = state;
  const adj = adjacency(cp);
  for (const c of cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (!touches(changed, ef.left, ef.right)) continue;
    if (ef.left === null || ef.right === null) {
      if (c.angleDeg !== 0) out.push({ code: 'consistency', message: `Raw edge ${c.id} has a fold angle`, edges: [c.id] });
      continue;
    }
    const angle = flatFoldAngle(view, state.folded.layerOrder, c, ef.left, ef.right);
    if (angle === null) continue; // reported by the layer-order check
    if (angle !== c.angleDeg) {
      out.push({
        code: 'consistency',
        message: `Edge ${c.id} says ${c.angleDeg}° but the faces sit at ${angle}°`,
        edges: [c.id],
      });
    }
    if ((c.angleDeg > 0 && c.assignment !== 'V') || (c.angleDeg < 0 && c.assignment !== 'M')) {
      out.push({ code: 'consistency', message: `Edge ${c.id} assignment disagrees with its angle`, edges: [c.id] });
    }
  }
  // Placements must agree with the crease graph (spanning tree + loop closure).
  const root = view.faceIds[0]!;
  const derived = derivePlacements(cp, root, state.folded.placements.get(root)!);
  for (const [f, tr] of state.folded.placements) {
    if (!touches(changed, f)) continue;
    const d = derived.get(f);
    if (!d) {
      out.push({ code: 'consistency', message: `Face ${f} is not connected to the sheet`, faces: [f] });
      continue;
    }
    for (const v of cp.faces.get(f)!.verts) {
      const p = getVertex(cp, v);
      const a = applyMaterial(tr, p);
      const b = apply(d, [p[0], p[1], 0]);
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > state.tol.len) {
        out.push({ code: 'consistency', message: `Face ${f} is not where its creases put it`, faces: [f] });
        break;
      }
    }
  }
}

// --- 4. no penetration: layer order -----------------------------------------

interface WorldEdge {
  readonly id: EdgeId;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly line: Line2;
  readonly left: FaceId;
  readonly right: FaceId;
  readonly taco: boolean;
}

function between(order: ReadonlyMap<PairKey, 1 | -1>, x: FaceId, a: FaceId, b: FaceId): boolean | null {
  const oa = orderOf(order, x, a);
  const ob = orderOf(order, x, b);
  if (oa === undefined || ob === undefined) return null;
  return oa !== ob;
}

function checkLayerOrder(
  state: KernelState,
  view: FlatView,
  out: Violation[],
  changed: ReadonlySet<FaceId> | null,
): void {
  const order = state.folded.layerOrder;
  const tol = state.tol;
  const pairs = changed === null ? overlapPairs(state) : overlapPairsTouching(state, changed);
  const overlapping = new Set<PairKey>();
  const neighbors = new Map<FaceId, Set<FaceId>>();
  for (const [f, g] of pairs) {
    const key = pairKey(f, g);
    overlapping.add(key);
    if (!order.has(key)) {
      out.push({ code: 'order-missing', message: `Faces ${f} and ${g} overlap with no layer order`, faces: [f, g] });
    }
    if (!neighbors.has(f)) neighbors.set(f, new Set());
    if (!neighbors.has(g)) neighbors.set(g, new Set());
    neighbors.get(f)!.add(g);
    neighbors.get(g)!.add(f);
  }
  for (const key of order.keys()) {
    if (!overlapping.has(key)) {
      const [f, g] = parsePairKey(key);
      if (!touches(changed, f, g)) continue;
      out.push({ code: 'order-stale', message: `Faces ${f} and ${g} have an order but don't overlap`, faces: [f, g] });
    }
  }

  // Transitivity: no 3-cycle among faces sharing a common region.
  const checkTriple = (f: FaceId, g: FaceId, h: FaceId) => {
    const fg = orderOf(order, f, g);
    const gh = orderOf(order, g, h);
    const hf = orderOf(order, h, f);
    if (fg === undefined || gh === undefined || hf === undefined) return;
    if (fg === gh && gh === hf) {
      const common = intersectConvex(intersectConvex(view.poly.get(f)!, view.poly.get(g)!), view.poly.get(h)!);
      if (isFat(common, tol)) {
        out.push({ code: 'order-cycle', message: `Faces ${f}, ${g}, ${h} are stacked in a loop`, faces: [f, g, h] });
      }
    }
  };
  if (changed === null) {
    for (const [f, g] of pairs) {
      for (const h of neighbors.get(f)!) {
        if (h > g && neighbors.get(g)!.has(h)) checkTriple(f, g, h);
      }
    }
  } else {
    // Every triple with a changed face, once: from its smallest changed face c. Two
    // unchanged faces overlap iff they have an order (the previous state was valid).
    const overlaps = (a: FaceId, b: FaceId): boolean =>
      changed.has(a) || changed.has(b) ? neighbors.get(a)?.has(b) === true : order.has(pairKey(a, b));
    for (const c of [...changed].sort((x, y) => x - y)) {
      const around = [...(neighbors.get(c) ?? [])].sort((x, y) => x - y);
      for (let i = 0; i < around.length; i++) {
        const a = around[i]!;
        if (changed.has(a) && a < c) continue;
        for (let j = i + 1; j < around.length; j++) {
          const b = around[j]!;
          if (changed.has(b) && b < c) continue;
          if (overlaps(a, b)) checkTriple(c, a, b);
        }
      }
    }
  }

  // Facewise constraints along creases (Akitaya, Demaine & Ku, "Computing Flat-Folded States").
  const adj = adjacency(state.cp);
  const edges: WorldEdge[] = [];
  for (const c of state.cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    const a = view.vertexWorld.get(c.v[0])!;
    const b = view.vertexWorld.get(c.v[1])!;
    const l = lineThrough(a, b);
    const taco = faceSideOfLine(view.poly.get(ef.left)!, l) === faceSideOfLine(view.poly.get(ef.right)!, l);
    edges.push({ id: c.id, a, b, line: l, left: ef.left, right: ef.right, taco });
  }

  // Scoped: a constraint matters only if one of its faces changed. Enumerate just those
  // (edges touching a changed face against everything; the rest only against changed faces),
  // instead of filtering all E² edge pairs and E·F edge–face pairs.
  const hot = edges.map((e) => changed === null || changed.has(e.left) || changed.has(e.right));
  const hotIdx: number[] = [];
  for (let i = 0; i < edges.length; i++) if (hot[i]) hotIdx.push(i);
  const changedFaces = changed === null ? view.faceIds : view.faceIds.filter((f) => changed.has(f));

  const edgePair = (e: WorldEdge, k: WorldEdge) => {
    if (Math.abs(signedDistance(e.line, k.a)) > tol.len || Math.abs(signedDistance(e.line, k.b)) > tol.len) return;
    if (collinearOverlap(e.a, e.b, k.a, k.b, e.line.d) <= tol.len) return;
    if (e.left === k.left || e.left === k.right || e.right === k.left || e.right === k.right) return;
    checkEdgePair(state, view, e, k, out);
  };
  const edgeFace = (e: WorldEdge, eBox: Box, f: FaceId) => {
    if (f === e.left || f === e.right) return;
    if (!boxesOverlap(eBox, view.box.get(f)!)) return;
    if (segmentLengthInside(e.a, e.b, view.poly.get(f)!, tol) <= tol.len) return;
    if (e.taco) {
      const b = between(order, f, e.left, e.right);
      if (b === true) {
        out.push({
          code: 'taco-tortilla',
          message: `Face ${f} passes through the fold at edge ${e.id}`,
          faces: [f, e.left, e.right],
          edges: [e.id],
        });
      }
    } else {
      const ol = orderOf(order, e.left, f);
      const or = orderOf(order, e.right, f);
      if (ol !== undefined && or !== undefined && ol !== or) {
        out.push({
          code: 'tortilla-tortilla',
          message: `Face ${f} cuts through the sheet at edge ${e.id}`,
          faces: [f, e.left, e.right],
          edges: [e.id],
        });
      }
    }
  };

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const eBox: Box = { minX: Math.min(e.a[0], e.b[0]), maxX: Math.max(e.a[0], e.b[0]), minY: Math.min(e.a[1], e.b[1]), maxY: Math.max(e.a[1], e.b[1]) };
    // Edge vs edge on the same line: each unordered pair once, if either edge is hot.
    if (hot[i]) {
      for (let j = i + 1; j < edges.length; j++) edgePair(e, edges[j]!);
    } else {
      for (const j of hotIdx) if (j > i) edgePair(e, edges[j]!);
    }
    // Edge vs a face whose interior it crosses.
    if (hot[i]) for (const f of view.faceIds) edgeFace(e, eBox, f);
    else for (const f of changedFaces) edgeFace(e, eBox, f);
  }
}

function checkEdgePair(state: KernelState, view: FlatView, e: WorldEdge, k: WorldEdge, out: Violation[]): void {
  const order = state.folded.layerOrder;
  const sideOf = (f: FaceId) => faceSideOfLine(view.poly.get(f)!, e.line);
  if (e.taco && k.taco) {
    if (sideOf(e.left) !== sideOf(k.left)) return; // opening to opposite sides: no contact
    const c = between(order, k.left, e.left, e.right);
    const d = between(order, k.right, e.left, e.right);
    if (c === null || d === null) return;
    if (c !== d) {
      out.push({
        code: 'taco-taco',
        message: `Folds at edges ${e.id} and ${k.id} cross each other`,
        faces: [e.left, e.right, k.left, k.right],
        edges: [e.id, k.id],
      });
    }
    return;
  }
  if (e.taco !== k.taco) {
    const taco = e.taco ? e : k;
    const tortilla = e.taco ? k : e;
    const s = sideOf(taco.left);
    const near = sideOf(tortilla.left) === s ? tortilla.left : tortilla.right;
    const b = between(order, near, taco.left, taco.right);
    if (b === true) {
      out.push({
        code: 'taco-tortilla',
        message: `The sheet at edge ${tortilla.id} passes through the fold at edge ${taco.id}`,
        faces: [taco.left, taco.right, tortilla.left, tortilla.right],
        edges: [taco.id, tortilla.id],
      });
    }
    return;
  }
  // tortilla–tortilla
  const eL = sideOf(e.left);
  const kSame = sideOf(k.left) === eL ? k.left : k.right;
  const kOther = kSame === k.left ? k.right : k.left;
  const o1 = orderOf(order, e.left, kSame);
  const o2 = orderOf(order, e.right, kOther);
  if (o1 === undefined || o2 === undefined) return;
  if (o1 !== o2) {
    out.push({
      code: 'tortilla-tortilla',
      message: `Sheets at edges ${e.id} and ${k.id} cut through each other`,
      faces: [e.left, e.right, k.left, k.right],
      edges: [e.id, k.id],
    });
  }
}

// --- 5. Maekawa and Kawasaki --------------------------------------------------

function checkFlatVertices(state: KernelState, out: Violation[], changed: ReadonlySet<FaceId> | null): void {
  const { cp } = state;
  const adj = adjacency(cp);
  for (const [v, edgeIds] of adj.vertexEdges) {
    if (changed !== null && !(adj.vertexFaces.get(v) ?? []).some((f) => changed.has(f))) continue;
    const creases = edgeIds.map((e) => cp.creases.get(e)!);
    if (creases.some((c) => c.assignment === 'B')) continue; // on the sheet's edge
    if (creases.some((c) => c.angleDeg !== 0 && Math.abs(c.angleDeg) !== 180)) continue; // not flat
    const folded = creases.filter((c) => c.angleDeg !== 0);
    if (folded.length === 0) continue;
    const m = folded.filter((c) => c.angleDeg < 0).length;
    const vCount = folded.length - m;
    if (Math.abs(m - vCount) !== 2) {
      out.push({
        code: 'maekawa',
        message: `Vertex ${v} has ${m} mountains and ${vCount} valleys`,
        vertex: v,
        edges: folded.map((c) => c.id),
      });
    }
    // Kawasaki: alternating sector angles between folded creases sum to 180°.
    // Each crease direction is only known to about (weld band / its length): welded
    // vertices may sit up to the weld band off the ideal line. The tolerance adds that up,
    // so a vertex on a micron-wide strip is judged at the precision its creases support.
    const p = getVertex(cp, v);
    let angleTol = 1e-9;
    const dirs = folded
      .map((c) => {
        const other = getVertex(cp, c.v[0] === v ? c.v[1] : c.v[0]);
        angleTol += (8 * state.tol.weld) / Math.hypot(other[0] - p[0], other[1] - p[1]);
        return Math.atan2(other[1] - p[1], other[0] - p[0]);
      })
      .sort((a, b) => a - b);
    let alt = 0;
    for (let i = 0; i < dirs.length; i++) {
      const next = i + 1 < dirs.length ? dirs[i + 1]! : dirs[0]! + 2 * Math.PI;
      alt += (i % 2 === 0 ? 1 : -1) * (next - dirs[i]!);
    }
    if (dirs.length % 2 !== 0 || Math.abs(alt) > angleTol) {
      out.push({
        code: 'kawasaki',
        message: `Vertex ${v} breaks Kawasaki's theorem (off by ${alt.toExponential(2)} rad)`,
        vertex: v,
      });
    }
  }
}

/** Convenience for tests: throw with all violations listed. */
export function assertValid(state: KernelState): void {
  const v = checkInvariants(state);
  if (v.length) throw new Error(`Invalid state:\n${v.map((x) => `  [${x.code}] ${x.message}`).join('\n')}`);
}

