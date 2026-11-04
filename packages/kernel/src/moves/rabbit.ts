import { lineThrough, signedDistance } from '../geometry/line.ts';
import { centroid } from '../geometry/polygon.ts';
import { compose, halfTurnAboutPlaneLine } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import type { FaceId } from '../paper/types.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { isRejection, prepareHalfTurn } from './foldCore.ts';
import { applyMultiMotion, type MotionGroup } from './multi.ts';
import { type MoveResult, type RabbitEarParams, reject } from './types.ts';

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2) => Math.hypot(v[0], v[1]);

/** The foot of the perpendicular from p to the line through a and b. */
function foot(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}

/** Does the chord of a convex polygon along the line i→e overlap the segment from i to e? */
function touchesRay(poly: readonly Vec2[], i: Vec2, e: Vec2, tol: number): boolean {
  const l = lineThrough(i, e);
  const L = len(sub(e, i));
  let lo = Infinity;
  let hi = -Infinity;
  let pos = false;
  let neg = false;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const da = signedDistance(l, a);
    const db = signedDistance(l, b);
    if (da > tol) pos = true;
    if (da < -tol) neg = true;
    const at = (p: Vec2) => {
      const t = ((p[0] - i[0]) * l.d[0] + (p[1] - i[1]) * l.d[1]);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    };
    if (Math.abs(da) <= tol) at(a);
    if ((da > tol && db < -tol) || (da < -tol && db > tol)) {
      const t = da / (da - db);
      at([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return pos && neg && hi > tol && lo < L - tol;
}

/**
 * Rabbit ear (brief, section 6): a triangle's two sides fold in along the bisectors of its base
 * corners, and the paper at the tip pinches up into a flap (the ear) that lies down to one side.
 *
 * Exactly, with I the triangle's incenter: the creases are the three bisectors (to I) and the
 * perpendicular from I to the side the ear lies toward. Of the parts between them, the one at
 * the base (around the foot of I on the base) stays; the side away from the ear turns over its
 * bisector and runs on past the base's middle as the ear's top half; the side toward the ear
 * turns over its bisector; the ear's other half turns over that bisector and then back over
 * the perpendicular, so the ear lies between the two sides. One degree-4 vertex, at I.
 *
 * The paper that moves is what a fold along the base would pick up at the seed.
 */
export function rabbitEarFold(state: KernelState, params: RabbitEarParams): MoveResult {
  const C = params.tip;
  // P: the side whose flap runs on into the ear; Q: the side the ear lies toward.
  const [P, Q] = params.side === 'a' ? [params.base[1], params.base[0]] : [params.base[0], params.base[1]];
  const a = len(sub(Q, C));
  const b = len(sub(P, C));
  const c = len(sub(P, Q));
  const area2 = Math.abs((Q[0] - P[0]) * (C[1] - P[1]) - (Q[1] - P[1]) * (C[0] - P[0]));
  if (Math.min(a, b, c) < 4 * state.tol.len || area2 < 1e-6 * c * c) {
    return reject('degenerate', [], { detail: 'A rabbit ear needs a triangle' });
  }
  const I: Vec2 = [(a * P[0] + b * Q[0] + c * C[0]) / (a + b + c), (a * P[1] + b * Q[1] + c * C[1]) / (a + b + c)];
  const F = foot(I, Q, C);
  const D = foot(I, P, Q);

  // Pick up the triangle's layers as a fold along the base would, from just inside it (the
  // base is often the paper's own edge).
  const toC = sub(C, D);
  const h = len(toC);
  const off = Math.min(0.5, h / 8);
  const p0: Vec2 = [P[0] + (toC[0] / h) * off, P[1] + (toC[1] / h) * off];
  const prep = prepareHalfTurn(state, { p: p0, d: sub(Q, P) }, params.seed, params.layers ?? 1, params.holds);
  if (isRejection(prep)) return prep;
  const { moving } = prep;
  const tol = state.tol.len;
  // The tip must be on the side of the base that moves.
  if (signedDistance(prep.line, C) <= tol) return reject('degenerate', [], { detail: 'The tip is not on the paper that moves' });

  // Sectors around I, turning from P toward C: P→C (side a), C→F (ear), F→Q (side b), the rest
  // (the base, around D) stays.
  const ang = (p: Vec2) => Math.atan2(p[1] - I[1], p[0] - I[0]);
  const ccw = (x: number) => {
    const t = x - ang(P);
    return ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  };
  const flip = ccw(ang(C)) > ccw(ang(Q));
  const t = (p: Vec2) => {
    const v = ccw(ang(p));
    return flip ? (2 * Math.PI - v) % (2 * Math.PI) : v;
  };
  const tC = t(C);
  const tF = t(F);
  const tQ = t(Q);
  const sector = (p: Vec2): 'a' | 'ear' | 'b' | 'base' => {
    const v = t(p);
    if (v < tC) return 'a';
    if (v < tF) return 'ear';
    if (v < tQ) return 'b';
    return 'base';
  };

  const lP = lineThrough(P, I);
  const lQ = lineThrough(Q, I);
  const lC = lineThrough(C, I);
  const lF = lineThrough(I, F);
  const lD = lineThrough(I, D);
  const HP = halfTurnAboutPlaneLine(lP);
  const HQ = halfTurnAboutPlaneLine(lQ);
  const groups: Record<'a' | 'ear' | 'b', MotionGroup> = {
    a: { id: 'a', motion: HP },
    b: { id: 'b', motion: HQ },
    ear: { id: 'ear', motion: compose(halfTurnAboutPlaneLine(lD), HQ) },
  };
  // Heights where the parts end up: the ear between the two sides, both over the base.
  const level = { base: 0, b: 1, ear: 2, a: 3 } as const;
  const partOf = (orig: FaceId, g: MotionGroup | null): keyof typeof level | null => {
    if (g) return g.id as 'a' | 'b' | 'ear';
    return moving.has(orig) ? 'base' : null;
  };
  const order = state.folded.layerOrder;
  const built = applyMultiMotion(state, {
    cuts: [
      { line: lP, faces: (_f, orig, poly) => moving.has(orig) && touchesRay(poly, I, P, tol) },
      { line: lQ, faces: (_f, orig, poly) => moving.has(orig) && touchesRay(poly, I, Q, tol) },
      { line: lC, faces: (_f, orig, poly) => moving.has(orig) && touchesRay(poly, I, C, tol) },
      { line: lF, faces: (_f, orig, poly) => moving.has(orig) && touchesRay(poly, I, F, tol) },
    ],
    groupOf: (_f, orig, poly) => {
      if (!moving.has(orig)) return null;
      const s = sector(centroid(poly));
      return s === 'base' ? null : groups[s];
    },
    fixed: (_x, _y, gx, gy, ox, oy) => {
      const px = partOf(ox, gx);
      const py = partOf(oy, gy);
      if (px === null || py === null || px === py) return undefined;
      return level[px] > level[py] ? 1 : -1;
    },
    hint: (_x, _y, gx, gy, ox, oy) => {
      const px = partOf(ox, gx);
      const py = partOf(oy, gy);
      if (px === null || py === null || px === py) return orderOf(order, ox, oy);
      return level[px] > level[py] ? 1 : -1;
    },
  });
  if (isRejection(built)) return built;
  const of = (id: string) => [...built.groups].filter(([, g]) => g === id).map(([f]) => f);
  return {
    ok: true,
    state: built.state,
    transition: {
      kind: 'rabbitEar',
      tip: C,
      sideA: P,
      sideB: Q,
      center: I,
      foot: F,
      moving: built.moving,
      a: of('a'),
      b: of('b'),
      ear: of('ear'),
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
    },
  };
}
