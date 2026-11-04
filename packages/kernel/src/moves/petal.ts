import { line as makeLine, type Line2, lineThrough, side, signedDistance } from '../geometry/line.ts';
import { centroid, containsStrictly } from '../geometry/polygon.ts';
import { applyMaterial, compose, halfTurnAboutPlaneLine, worldToPlane } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges } from '../paper/creasePattern.ts';
import type { FaceId, VertexId } from '../paper/types.ts';
import { flatView, stackAt } from '../state/flat.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { isRejection } from './foldCore.ts';
import { applyMultiMotion, type MotionGroup } from './multi.ts';
import { type MoveResult, type PetalParams, reject } from './types.ts';

/**
 * Petal fold (brief, section 6): lift the tip of the top layer up on a hinge line across it,
 * while its sides swing in along the kite lines and lie down under it. The heart of the
 * bird base.
 *
 * Setup, from the grab: the petal is the top layer's flat region on the grabbed side of the
 * hinge (everything joined to the grabbed face by unfolded creases). It must be bounded on
 * two sides by folded edges, which meet the hinge at X and Y; the layers behind those edges
 * are the inner sides. The apex A is the petal's corner farthest from the hinge, and the kite
 * lines run from A to X and from A to Y.
 *
 * Exactly:
 * - the petal between the kite lines turns over the hinge;
 * - each side (between a kite line and its folded edge) folds in on the kite line, then turns
 *   with the petal, so it ends up under it;
 * - each inner side folds in on the same kite line and stays.
 * The folded edges between the sides and the inner sides open flat, and the raw edges of the
 * inner sides meet along the middle. Layer order comes from the constraint solver, preferring
 * petal over sides over inner sides over paper that stays.
 */
export function petalFold(state: KernelState, params: PetalParams): MoveResult {
  const view = flatView(state);
  if (!view) return reject('unsupported', [], { detail: 'Folding needs a flat model' });
  const tol = state.tol;
  if ((params.layers ?? 1) !== 1) return reject('unsupported', [], { detail: 'A petal fold lifts one layer' });
  let hinge: Line2;
  try {
    hinge = makeLine(params.hinge.p, params.hinge.d);
  } catch {
    return reject('degenerate', [], { detail: 'The hinge has no direction' });
  }
  const s0 = side(hinge, params.seed, tol);
  if (s0 === 0) return reject('degenerate', [], { detail: 'The grab point is on the hinge' });
  if (s0 < 0) hinge = { p: hinge.p, d: [-hinge.d[0], -hinge.d[1]] };

  const stack = stackAt(state, params.seed);
  if (!stack.ok) return reject('internal', [], { detail: 'Layers under the grab have no consistent order' });
  const top = stack.faces[0];
  if (top === undefined) return reject('missed');

  const adj = adjacency(state.cp);
  const vside = new Map<VertexId, -1 | 0 | 1>();
  for (const [v, p] of view.vertexWorld) vside.set(v, side(hinge, p, tol, tol.weld));
  const plusEnd = (v0: VertexId, v1: VertexId) => vside.get(v0) === 1 || vside.get(v1) === 1;

  // 1. The petal region: the top face and everything joined to it by unfolded creases that
  //    reach the grabbed side of the hinge.
  const region = new Set<FaceId>([top]);
  const queue = [top];
  for (let qi = 0; qi < queue.length; qi++) {
    const f = queue[qi]!;
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || region.has(g) || c.angleDeg !== 0) continue;
      if (!plusEnd(c.v[0], c.v[1])) continue;
      region.add(g);
      queue.push(g);
    }
  }

  // 2. Its folded edges on the grabbed side: two lines, meeting the hinge at X and Y.
  interface Side {
    readonly line: Line2;
    readonly at: Vec2;
    readonly outer: Set<FaceId>;
  }
  const sides: Side[] = [];
  for (const f of region) {
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || region.has(g) || Math.abs(c.angleDeg) !== 180) continue;
      if (!plusEnd(c.v[0], c.v[1])) continue;
      const a = view.vertexWorld.get(c.v[0])!;
      const b = view.vertexWorld.get(c.v[1])!;
      const l = lineThrough(a, b);
      let s = sides.find((x) => Math.abs(signedDistance(x.line, a)) <= 100 * tol.len && Math.abs(signedDistance(x.line, b)) <= 100 * tol.len);
      if (!s) {
        const den = l.d[0] * hinge.d[1] - l.d[1] * hinge.d[0];
        if (Math.abs(den) < 1e-9) return reject('unsupported', [], { detail: 'A folded edge of the petal runs along the hinge' });
        const t = ((hinge.p[0] - l.p[0]) * hinge.d[1] - (hinge.p[1] - l.p[1]) * hinge.d[0]) / den;
        s = { line: l, at: [l.p[0] + l.d[0] * t, l.p[1] + l.d[1] * t], outer: new Set() };
        sides.push(s);
      }
      s.outer.add(g);
    }
  }
  if (sides.length !== 2) {
    return reject('unsupported', [], { detail: 'A petal needs a folded edge on each side' });
  }

  // 3. The apex: the petal's corner farthest from the hinge.
  let apex: Vec2 | null = null;
  let far = 0;
  for (const f of region) {
    for (const p of view.poly.get(f)!) {
      const d = signedDistance(hinge, p);
      if (d > far + tol.len) {
        far = d;
        apex = p;
      }
    }
  }
  if (!apex) return reject('degenerate', [], { detail: 'The petal has no tip' });
  const A = apex;
  // X is the side whose intersection lies to the hinge's right of... order them by the hinge.
  const [sx, sy] = sides.sort((a, b) => (a.at[0] - b.at[0]) * hinge.d[0] + (a.at[1] - b.at[1]) * hinge.d[1]) as [Side, Side];
  const X = sx.at;
  const Y = sy.at;
  if (Math.hypot(A[0] - X[0], A[1] - X[1]) < 100 * tol.len || Math.hypot(A[0] - Y[0], A[1] - Y[1]) < 100 * tol.len) {
    return reject('degenerate', [], { detail: 'The petal tip is on a folded edge' });
  }
  const KX = lineThrough(A, X);
  const KY = lineThrough(A, Y);
  // Orient the kite lines so the petal's middle is on their left.
  const mid: Vec2 = [(X[0] + Y[0]) / 2 + (A[0] - (X[0] + Y[0]) / 2) * 0.5, (X[1] + Y[1]) / 2 + (A[1] - (X[1] + Y[1]) / 2) * 0.5];
  const kx = signedDistance(KX, mid) > 0 ? KX : { p: KX.p, d: [-KX.d[0], -KX.d[1]] as Vec2 };
  const ky = signedDistance(KY, mid) > 0 ? KY : { p: KY.p, d: [-KY.d[0], -KY.d[1]] as Vec2 };

  // 4. The inner sides: the layers behind each folded edge, out to the kite line.
  const inner = (s: Side, k: Line2): Set<FaceId> | null => {
    const out = new Set<FaceId>(s.outer);
    const q = [...s.outer];
    const kside = new Map<VertexId, -1 | 0 | 1>();
    for (const [v, p] of view.vertexWorld) kside.set(v, side(k, p, tol, tol.weld));
    for (let qi = 0; qi < q.length; qi++) {
      const f = q[qi]!;
      for (const e of faceEdges(state.cp, f)) {
        const c = state.cp.creases.get(e)!;
        const ef = adj.edgeFaces.get(e)!;
        const g = ef.left === f ? ef.right : ef.left;
        if (g === null || out.has(g) || region.has(g) || c.angleDeg !== 0) continue;
        // Only toward the outside of the kite line, on the grabbed side of the hinge.
        const outside = kside.get(c.v[0]) === -1 || kside.get(c.v[1]) === -1;
        if (!outside || !plusEnd(c.v[0], c.v[1])) continue;
        out.add(g);
        q.push(g);
      }
    }
    // Nothing may lie on the petal or between it and its inner sides.
    return out;
  };
  const innerX = inner(sx, kx);
  const innerY = inner(sy, ky);
  if (!innerX || !innerY) return reject('unsupported');
  for (const f of innerX) if (innerY.has(f)) return reject('unsupported', [f], { detail: 'The two sides share a layer' });

  // Held faces can't move.
  const all = new Set<FaceId>([...region, ...innerX, ...innerY]);
  for (const h of state.folded.holds) {
    if (!all.has(h.face)) continue;
    const w = worldToPlane(applyMaterial(state.folded.placements.get(h.face)!, h.material));
    if (side(hinge, w, tol) > 0) return reject('held', [h.face]);
  }
  for (const h of params.holds ?? []) {
    if (side(hinge, h, tol) <= 0) continue;
    const pinned = [...all].filter((f) => containsStrictly(view.poly.get(f)!, h, tol));
    if (pinned.length > 0) return reject('held', pinned);
  }
  // Nothing outside the petal may lie on it.
  for (const f of region) {
    for (const g of view.faceIds) {
      if (all.has(g)) continue;
      if (orderOf(state.folded.layerOrder, g, f) === 1) {
        const pg = view.poly.get(g)!;
        if (pg.some((p) => signedDistance(hinge, p) > tol.len)) return reject('tucked', [g]);
      }
    }
  }

  // 5. Cut and move.
  const H = halfTurnAboutPlaneLine(hinge);
  const TX = halfTurnAboutPlaneLine(kx);
  const TY = halfTurnAboutPlaneLine(ky);
  const groups: Record<string, MotionGroup> = {
    center: { id: 'center', motion: H },
    sideX: { id: 'sideX', motion: compose(H, TX) },
    sideY: { id: 'sideY', motion: compose(H, TY) },
    innerX: { id: 'innerX', motion: TX },
    innerY: { id: 'innerY', motion: TY },
  };
  const level: Record<string, number> = { innerX: 1, innerY: 1, sideX: 2, sideY: 2, center: 3 };
  const onPlus = (poly: readonly Vec2[]) => signedDistance(hinge, centroid(poly)) > 0;
  const built = applyMultiMotion(state, {
    cuts: [
      { line: hinge, faces: (_f, orig) => region.has(orig) },
      { line: kx, faces: (_f, orig, poly) => (region.has(orig) || innerX.has(orig)) && onPlus(poly) },
      { line: ky, faces: (_f, orig, poly) => (region.has(orig) || innerY.has(orig)) && onPlus(poly) },
    ],
    groupOf: (_f, orig, poly) => {
      if (!onPlus(poly)) return null;
      const c = centroid(poly);
      const outX = signedDistance(kx, c) < 0;
      const outY = signedDistance(ky, c) < 0;
      if (region.has(orig)) {
        if (outX && outY) return null;
        return outX ? groups['sideX']! : outY ? groups['sideY']! : groups['center']!;
      }
      if (innerX.has(orig)) return outX ? groups['innerX']! : null;
      if (innerY.has(orig)) return outY ? groups['innerY']! : null;
      return null;
    },
    // Moving paper lands on paper that stays; among the moving parts, petal over sides over
    // inner sides where the paper leaves a choice. (The sides end up on the petal's face,
    // as kite folds do: the creases forbid them between the petal and the layer it lands on.)
    hint: (_x, _y, gx, gy) => {
      const lx = gx ? level[gx.id]! : 0;
      const ly = gy ? level[gy.id]! : 0;
      return lx === ly ? undefined : lx > ly ? 1 : -1;
    },
  });
  if (isRejection(built)) return built;
  const facesOf = (id: string) => [...built.groups].filter(([, g]) => g === id).map(([f]) => f);
  const away = (d: Vec2): Vec2 => (signedDistance(hinge, [X[0] + d[0], X[1] + d[1]]) - signedDistance(hinge, X) > 0 ? d : [-d[0], -d[1]]);
  return {
    ok: true,
    state: built.state,
    transition: {
      kind: 'petal',
      hinge: lineThrough(X, Y),
      x: X,
      y: Y,
      edgeX: away(sx.line.d),
      edgeY: away(sy.line.d),
      apex: A,
      moving: built.moving,
      center: facesOf('center'),
      sideX: facesOf('sideX'),
      sideY: facesOf('sideY'),
      innerX: facesOf('innerX'),
      innerY: facesOf('innerY'),
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
    },
  };
}
