import { along, line as makeLine, type Line2, lineThrough, signedDistance } from '../geometry/line.ts';
import { centroid } from '../geometry/polygon.ts';
import { compose, halfTurnAboutPlaneLine } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import type { KernelState } from '../state/types.ts';
import { isRejection, prepareHalfTurn, sweepBlockers } from './foldCore.ts';
import { applyMultiMotion, type MotionGroup } from './multi.ts';
import { type MoveResult, reject, type SquashParams } from './types.ts';

/**
 * Squash fold (brief, section 6): lift a closed flap on its hinge, open it, and press its
 * spine down onto the hinge line, so the flap spreads evenly to both sides.
 *
 * Setup: the flap is what a fold along the hinge would pick up (`seed`, `layers`). Its spine
 * is the folded edge that meets the hinge at O; the flap's layers split there into a top
 * side T and a bottom side B (the same split as a reverse fold). K is the line through O
 * halfway between the hinge's ray (the flap's own edge along the hinge) and the spine.
 *
 * Exactly, each side splits along K into a near part (by the hinge) and a far part (by the
 * spine):
 * - B near stays; B far folds over K onto it.
 * - T near turns over the hinge to the other side; T far folds over K and then over the
 *   hinge, onto T near.
 * The spine then lies on the hinge line, and the two far parts meet along it. Layer order
 * comes from the constraint solver, with far parts preferred on top of near ones and moving
 * paper on top of paper that stays.
 */
export function squashFold(state: KernelState, params: SquashParams): MoveResult {
  const prep = prepareHalfTurn(state, params.hinge, params.seed, params.layers ?? 'all', params.holds);
  if (isRejection(prep)) return prep;
  const { view, vside, moving, seeds } = prep;
  const tol = state.tol;
  const hinge = prep.line;
  const adj = adjacency(state.cp);

  // Nothing may lie on the flap.
  const blockers = sweepBlockers(state, prep, 1);
  if (isRejection(blockers)) return blockers;
  if (blockers.length > 0) return reject('tucked', blockers);

  // 1. The spine: folded creases of the flap that reach the hinge line.
  interface Spine {
    readonly a: FaceId;
    readonly b: FaceId;
    readonly line: Line2;
    readonly o: Vec2;
    readonly far: Vec2;
  }
  const spines: Spine[] = [];
  for (const c of state.cp.creases.values()) {
    if (Math.abs(c.angleDeg) !== 180) continue;
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null || !moving.has(ef.left) || !moving.has(ef.right)) continue;
    const s0 = vside.get(c.v[0])!;
    const s1 = vside.get(c.v[1])!;
    const w0 = view.vertexWorld.get(c.v[0])!;
    const w1 = view.vertexWorld.get(c.v[1])!;
    if (s0 === 0 && s1 === 0) continue; // on the hinge itself
    let o: Vec2;
    let far: Vec2;
    if (s0 * s1 === -1) {
      const d0 = signedDistance(hinge, w0);
      const d1 = signedDistance(hinge, w1);
      const t = d0 / (d0 - d1);
      o = [w0[0] + (w1[0] - w0[0]) * t, w0[1] + (w1[1] - w0[1]) * t];
      far = s0 > 0 ? w0 : w1;
    } else if (s0 === 0 || s1 === 0) {
      o = s0 === 0 ? w0 : w1;
      far = s0 === 0 ? w1 : w0;
    } else continue;
    spines.push({ a: ef.left, b: ef.right, line: lineThrough(w0, w1), o, far });
  }
  if (spines.length === 0) return reject('unsupported', [], { detail: 'No folded edge of the flap meets the hinge: nothing to squash' });
  const O = spines[0]!.o;
  for (const s of spines) {
    if (Math.hypot(s.o[0] - O[0], s.o[1] - O[1]) > 100 * tol.len || Math.abs(signedDistance(spines[0]!.line, s.far)) > 100 * tol.len) {
      return reject('unsupported', [], { detail: 'The flap has more than one folded edge on the hinge' });
    }
  }
  const spineFar = spines.reduce((best, s) => (Math.hypot(s.far[0] - O[0], s.far[1] - O[1]) > Math.hypot(best[0] - O[0], best[1] - O[1]) ? s.far : best), spines[0]!.far);
  const dS: Vec2 = (() => {
    const l = Math.hypot(spineFar[0] - O[0], spineFar[1] - O[1]);
    return [(spineFar[0] - O[0]) / l, (spineFar[1] - O[1]) / l];
  })();

  // 2. The flap's two sides, split at its innermost spine.
  const index = new Map(seeds.map((f, i) => [f, i]));
  let gap = -1;
  let best = Infinity;
  for (const s of spines) {
    const i = index.get(s.a);
    const j = index.get(s.b);
    if (i === undefined || j === undefined || Math.abs(i - j) !== 1) continue;
    const g = Math.min(i, j);
    const score = Math.abs(g + 1 - seeds.length / 2);
    if (score < best || (score === best && g < gap)) {
      best = score;
      gap = g;
    }
  }
  if (gap < 0) return reject('unsupported', [], { detail: 'Pick up the flap where both of its sides are' });
  const sideOf = new Map<FaceId, 'T' | 'B'>();
  seeds.forEach((f, i) => sideOf.set(f, i <= gap ? 'T' : 'B'));
  const spineLine = spines[0]!.line;
  const onSpine = (v0: number, v1: number) =>
    Math.abs(signedDistance(spineLine, view.vertexWorld.get(v0)!)) <= tol.len &&
    Math.abs(signedDistance(spineLine, view.vertexWorld.get(v1)!)) <= tol.len;
  const queue = [...seeds];
  for (let qi = 0; qi < queue.length; qi++) {
    const f = queue[qi]!;
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || !moving.has(g) || sideOf.has(g)) continue;
      if (Math.abs(c.angleDeg) === 180 && onSpine(c.v[0], c.v[1])) continue;
      sideOf.set(g, sideOf.get(f)!);
      queue.push(g);
    }
  }
  for (const f of moving) {
    if (!sideOf.has(f)) return reject('unsupported', [f], { detail: 'Part of the flap belongs to neither side' });
  }

  // 3. The hinge ray the flap lies along, and K halfway between it and the spine.
  let lo = Infinity;
  let hi = -Infinity;
  const ref = makeLine(O, hinge.d);
  for (const f of moving) {
    for (const v of state.cp.faces.get(f)!.verts) {
      if (vside.get(v) !== 0) continue;
      const t = along(ref, view.vertexWorld.get(v)!);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  const eps = 100 * tol.len;
  let r1: Vec2;
  if (lo >= -eps && hi > eps) r1 = hinge.d;
  else if (hi <= eps && lo < -eps) r1 = [-hinge.d[0], -hinge.d[1]];
  else return reject('unsupported', [], { detail: 'The flap reaches both ways along the hinge from its folded edge' });
  const bis: Vec2 = [r1[0] + dS[0], r1[1] + dS[1]];
  if (Math.hypot(bis[0], bis[1]) < 1e-9) return reject('degenerate', [], { detail: 'The folded edge lies along the hinge' });
  const K = makeLine(O, bis);
  // Which side of K the hinge ray is on (the near side).
  const nearSign = Math.sign(signedDistance(K, [O[0] + r1[0], O[1] + r1[1]]));

  // 4. Cut the flap along the hinge (if it isn't creased there yet) and along K, then move.
  const H = halfTurnAboutPlaneLine(hinge);
  const Kt = halfTurnAboutPlaneLine(K);
  const groups: Record<string, MotionGroup> = {
    tNear: { id: 'tNear', motion: H },
    tFar: { id: 'tFar', motion: compose(H, Kt) },
    bFar: { id: 'bFar', motion: Kt },
  };
  const level: Record<string, number> = { tNear: 1, bFar: 1, tFar: 2 };
  const built = applyMultiMotion(state, {
    cuts: [
      { line: hinge, faces: (_f, orig) => moving.has(orig) },
      { line: K, faces: (_f, orig, poly) => moving.has(orig) && signedDistance(hinge, centroid(poly)) > 0 },
    ],
    groupOf: (_f, orig, poly) => {
      if (!moving.has(orig)) return null;
      const c = centroid(poly);
      if (signedDistance(hinge, c) <= 0) return null; // the part of a cut face behind the hinge
      const near = Math.sign(signedDistance(K, c)) === nearSign;
      const s = sideOf.get(orig)!;
      if (s === 'B') return near ? null : groups['bFar']!;
      return near ? groups['tNear']! : groups['tFar']!;
    },
    hint: (_x, _y, gx, gy) => {
      const lx = gx ? level[gx.id]! : 0;
      const ly = gy ? level[gy.id]! : 0;
      return lx === ly ? undefined : lx > ly ? 1 : -1;
    },
  });
  if (isRejection(built)) return built;

  const facesOf = (id: string) => [...built.groups].filter(([, g]) => g === id).map(([f]) => f);
  const bNear = [...built.state.cp.faces.keys()]
    .filter((f) => !built.groups.has(f) && moving.has(built.parentOf.get(f)!) && sideOf.get(built.parentOf.get(f)!) === 'B')
    .sort((a, b) => a - b);
  return {
    ok: true,
    state: built.state,
    transition: {
      kind: 'squash',
      hinge: makeLine(O, r1),
      spine: makeLine(O, dS),
      bisector: makeLine(O, bis),
      moving: built.moving,
      tNear: facesOf('tNear'),
      tFar: facesOf('tFar'),
      bFar: facesOf('bFar'),
      bNear,
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
    },
  };
}
