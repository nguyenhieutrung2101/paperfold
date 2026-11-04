import {
  compose,
  cross3,
  dot3,
  type FaceId,
  IDENTITY,
  planeDirToWorld,
  planeToWorld,
  type Rigid3,
  rotationAbout,
  type Transition,
  type Vec3,
} from '@paperfold/kernel';
import type { ReversePlan } from './reverse.ts';

export type SquashTransition = Extract<Transition, { kind: 'squash' }>;
export type PetalTransition = Extract<Transition, { kind: 'petal' }>;
export type ZigzagTransition = Extract<Transition, { kind: 'pleat' | 'crimp' }>;
export type RabbitTransition = Extract<Transition, { kind: 'rabbitEar' }>;

/**
 * How squash and petal folds move (Phase 2), without tearing: every part turns rigidly, and the
 * parts that share a crease share its direction at every moment, so the paper stays joined.
 *
 * **Squash.** The flap first lifts on its hinge until it stands up (40% of the time). Then its
 * spine comes down onto the hinge line in the upright plane, from its angle θ to the hinge down
 * to 0, while the two sides spread: each side's part by the hinge turns about the hinge by ψ with
 * sin ψ = cot(θ/2)·tan(φ/2) (φ is the spine's angle), which keeps the bisector crease at θ/2 from
 * both. Each part by the spine is then fixed by two directions it must contain: the bisector
 * crease (shared with its near part) and the spine (shared with the other side).
 *
 * **Petal.** The petal turns over its hinge (φ from 0 to π). Each inner side turns about its kite
 * line by ψ, and each side between them is fixed by its two creases: the kite line where it meets
 * the petal and its outer edge where it meets the inner side. ψ solves the side's one condition
 * (the angle between those two creases stays as it is in the paper): a spherical four-bar,
 * closed form.
 *
 * **Pleat and crimp.** The strip between the lines lifts over the first line (φ from 0 to π),
 * and the part past the second turns back about the second line by the same φ, in the strip's
 * frame: two hinges in a zigzag, joined at every moment.
 *
 * **Rabbit ear.** One degree-4 vertex, at the incenter: side a turns over its bisector by φ,
 * side b over its own by ψ, and the ear between them is fixed by its two creases (the tip's
 * bisector, shared with side a, and the foot crease, shared with side b). ψ keeps the angle
 * between those creases as it is in the paper, closed form like the petal's sides.
 *
 * APPROXIMATION: a crimp's two sides move together, like a pleat of the whole flap; the strip
 * and the far part end between (inside) or around (outside) the flap's layers by sliding to
 * their heights as they land, where real paper opens the flap a little to let them in.
 */
export type MultiPlan = ReversePlan;

const UP: Vec3 = [0, 1, 0];
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const rotDir = (r: Rigid3, v: Vec3): Vec3 => [
  r.r[0] * v[0] + r.r[1] * v[1] + r.r[2] * v[2],
  r.r[3] * v[0] + r.r[4] * v[1] + r.r[5] * v[2],
  r.r[6] * v[0] + r.r[7] * v[1] + r.r[8] * v[2],
];

/** The rotation about point o taking directions (a0, b0) to (a1, b1) (same angle between). */
function frameTurn(o: Vec3, a0: Vec3, b0: Vec3, a1: Vec3, b1: Vec3): Rigid3 {
  const basis = (a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] => {
    const e1 = norm(a);
    const e2 = norm(add(b, scale(e1, -dot3(b, e1))));
    return [e1, e2, cross3(e1, e2)];
  };
  const [e1, e2, e3] = basis(a0, b0);
  const [f1, f2, f3] = basis(a1, b1);
  // R = F·Eᵀ.
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(f1[i]! * e1[j]! + f2[i]! * e2[j]! + f3[i]! * e3[j]!);
  const m = r as unknown as Rigid3['r'];
  const ro = rotDir({ r: m, t: [0, 0, 0] }, o);
  return { r: m, t: [o[0] - ro[0], o[1] - ro[1], o[2] - ro[2]] };
}

/** Rotation about the axis (o, d) by the angle that turns `from` (⊥ d) toward up, by `angle`. */
function lift(o: Vec3, d: Vec3, from: Vec3, angle: number): Rigid3 {
  const sgn = dot3(cross3(d, from), UP) >= 0 ? 1 : -1;
  return rotationAbout(o, d, sgn * angle);
}

const squashCache = new WeakMap<SquashTransition, MultiPlan>();

export function planSquash(tr: SquashTransition): MultiPlan {
  const hit = squashCache.get(tr);
  if (hit) return hit;
  const O = planeToWorld(tr.hinge.p);
  const h = norm(planeDirToWorld(tr.hinge.d));
  const s0 = norm(planeDirToWorld(tr.spine.d));
  const k0 = norm(planeDirToWorld(tr.bisector.d));
  const n = norm(add(s0, scale(h, -dot3(s0, h))));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot3(h, s0))));
  const w = (psi: number): Vec3 => add(scale(n, Math.cos(psi)), scale(UP, Math.sin(psi)));
  const kAt = (psi: number): Vec3 => add(scale(h, Math.cos(theta / 2)), scale(w(psi), Math.sin(theta / 2)));
  const groups = new Map<FaceId, 'tNear' | 'tFar' | 'bNear' | 'bFar'>();
  for (const f of tr.tNear) groups.set(f, 'tNear');
  for (const f of tr.tFar) groups.set(f, 'tFar');
  for (const f of tr.bNear) groups.set(f, 'bNear');
  for (const f of tr.bFar) groups.set(f, 'bFar');
  const SPLIT = 0.4;
  const pose = (f: FaceId, k: number): Rigid3 => {
    const g = groups.get(f);
    if (!g) return IDENTITY;
    if (k <= SPLIT) return lift(O, h, n, (Math.PI / 2) * ease(k / SPLIT));
    const phi = theta * (1 - ease((k - SPLIT) / (1 - SPLIT)));
    const s = add(scale(h, Math.cos(phi)), scale(UP, Math.sin(phi)));
    const t = Math.tan(theta / 2) > 1e-9 ? Math.tan(phi / 2) / Math.tan(theta / 2) : 0;
    const psiB = Math.asin(Math.max(0, Math.min(1, t)));
    const psi = g === 'tNear' || g === 'tFar' ? Math.PI - psiB : psiB;
    if (g === 'tNear' || g === 'bNear') return lift(O, h, n, psi);
    return frameTurn(O, k0, s0, kAt(psi), s);
  };
  const plan: MultiPlan = { mode: 'kinematic', moves: new Set(groups.keys()), pose, lift: () => 0 };
  squashCache.set(tr, plan);
  return plan;
}

const petalCache = new WeakMap<PetalTransition, MultiPlan>();

export function planPetal(tr: PetalTransition): MultiPlan {
  const hit = petalCache.get(tr);
  if (hit) return hit;
  const X = planeToWorld(tr.x);
  const Y = planeToWorld(tr.y);
  const A = planeToWorld(tr.apex);
  const hd = norm([Y[0] - X[0], Y[1] - X[1], Y[2] - X[2]]);
  // The petal side of the hinge, in the table.
  const toA: Vec3 = [A[0] - X[0], A[1] - X[1], A[2] - X[2]];
  const pin = norm(add(toA, scale(hd, -dot3(toA, hd))));
  const center = (phi: number) => lift(X, hd, pin, phi);

  const side = (P: Vec3, edgePlane: readonly [number, number]) => {
    const a = norm([A[0] - P[0], A[1] - P[1], A[2] - P[2]]);
    const e0 = norm(planeDirToWorld(edgePlane));
    const beta = Math.acos(Math.max(-1, Math.min(1, dot3(a, e0))));
    const u = norm(add(e0, scale(a, -dot3(e0, a))));
    // The inner side folds up (toward the viewer) about its kite line.
    const v0 = cross3(a, u);
    const v = dot3(v0, UP) >= 0 ? v0 : scale(v0, -1);
    const eAt = (psi: number): Vec3 => add(scale(a, Math.cos(beta)), scale(add(scale(u, Math.cos(psi)), scale(v, Math.sin(psi))), Math.sin(beta)));
    const solve = (phi: number): number => {
      const k1 = rotDir(center(phi), a);
      const Aa = Math.sin(beta) * dot3(k1, u);
      const Bb = Math.sin(beta) * dot3(k1, v);
      const C = Math.cos(beta) * (1 - dot3(k1, a));
      const R = Math.hypot(Aa, Bb);
      if (R < 1e-9) return phi;
      const d = Math.atan2(Bb, Aa);
      const c = Math.acos(Math.max(-1, Math.min(1, C / R)));
      const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const cands = [wrap(d + c), wrap(d - c)];
      // The branch that keeps pace with the petal (both turn from 0 to π).
      return cands.reduce((b, x) => (Math.abs(x - phi) < Math.abs(b - phi) ? x : b));
    };
    // The inner side's rotation about the kite line, and the side between.
    const inner = (phi: number): Rigid3 => {
      const psi = solve(phi);
      // Rotation about a taking u toward v by psi.
      const sgn = dot3(cross3(a, u), v) >= 0 ? 1 : -1;
      return rotationAbout(P, a, sgn * psi);
    };
    const outer = (phi: number): Rigid3 => {
      const psi = solve(phi);
      return frameTurn(P, a, e0, rotDir(center(phi), a), eAt(psi));
    };
    return { inner, outer };
  };
  const sx = side(X, tr.edgeX);
  const sy = side(Y, tr.edgeY);
  const groups = new Map<FaceId, string>();
  for (const f of tr.center) groups.set(f, 'center');
  for (const f of tr.sideX) groups.set(f, 'sideX');
  for (const f of tr.sideY) groups.set(f, 'sideY');
  for (const f of tr.innerX) groups.set(f, 'innerX');
  for (const f of tr.innerY) groups.set(f, 'innerY');
  const pose = (f: FaceId, k: number): Rigid3 => {
    const g = groups.get(f);
    if (!g) return IDENTITY;
    const phi = Math.PI * ease(k);
    if (g === 'center') return center(phi);
    if (g === 'sideX') return sx.outer(phi);
    if (g === 'sideY') return sy.outer(phi);
    if (g === 'innerX') return sx.inner(phi);
    return sy.inner(phi);
  };
  const plan: MultiPlan = { mode: 'kinematic', moves: new Set(groups.keys()), pose, lift: () => 0 };
  petalCache.set(tr, plan);
  return plan;
}

const zigzagCache = new WeakMap<ZigzagTransition, MultiPlan>();

export function planZigzag(tr: ZigzagTransition): MultiPlan {
  const hit = zigzagCache.get(tr);
  if (hit) return hit;
  // Both lines have the part that moves on their left.
  const axis = (l: ZigzagTransition['first']) => ({
    o: planeToWorld(l.p),
    d: norm(planeDirToWorld(l.d)),
    left: norm(planeDirToWorld([-l.d[1], l.d[0]])),
  });
  const a = axis(tr.first);
  const b = axis(tr.second);
  const middle = new Set(tr.middle);
  const far = new Set(tr.far);
  const strip = (phi: number) => lift(a.o, a.d, a.left, phi);
  const pose = (f: FaceId, k: number): Rigid3 => {
    const phi = Math.PI * ease(k);
    if (middle.has(f)) return strip(phi);
    if (far.has(f)) return compose(strip(phi), lift(b.o, b.d, b.left, -phi));
    return IDENTITY;
  };
  const plan: MultiPlan = { mode: 'kinematic', moves: new Set([...middle, ...far]), pose, lift: () => 0 };
  zigzagCache.set(tr, plan);
  return plan;
}

const rabbitCache = new WeakMap<RabbitTransition, MultiPlan>();

export function planRabbit(tr: RabbitTransition): MultiPlan {
  const hit = rabbitCache.get(tr);
  if (hit) return hit;
  const I = planeToWorld(tr.center);
  const dirTo = (p: readonly [number, number]): Vec3 => {
    const w = planeToWorld(p);
    return norm([w[0] - I[0], w[1] - I[1], w[2] - I[2]]);
  };
  const pA = dirTo(tr.sideA);
  const pB = dirTo(tr.sideB);
  const c0 = dirTo(tr.tip);
  const f0 = dirTo(tr.foot);
  // In the table, the side of each bisector its part lies on.
  const toward = (axis: Vec3, p: Vec3): Vec3 => norm(add(p, scale(axis, -dot3(p, axis))));
  const uA = toward(pA, c0);
  const uB = toward(pB, f0);
  const sideA = (phi: number) => lift(I, pA, uA, phi);
  const sB = dot3(cross3(pB, uB), UP) >= 0 ? 1 : -1;
  const sideB = (psi: number) => rotationAbout(I, pB, sB * psi);
  const v = scale(cross3(pB, uB), sB);
  const beta = Math.acos(Math.max(-1, Math.min(1, dot3(pB, f0))));
  const gamma = Math.acos(Math.max(-1, Math.min(1, dot3(c0, f0))));
  const solve = (phi: number): number => {
    const k1 = rotDir(sideA(phi), c0);
    const A = Math.sin(beta) * dot3(k1, uB);
    const B = Math.sin(beta) * dot3(k1, v);
    const C = Math.cos(gamma) - Math.cos(beta) * dot3(k1, pB);
    const R = Math.hypot(A, B);
    if (R < 1e-9) return phi;
    const d = Math.atan2(B, A);
    const c = Math.acos(Math.max(-1, Math.min(1, C / R)));
    const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const cands = [wrap(d + c), wrap(d - c)];
    return cands.reduce((b, x) => (Math.abs(x - phi) < Math.abs(b - phi) ? x : b));
  };
  const groups = new Map<FaceId, 'a' | 'b' | 'ear'>();
  for (const f of tr.a) groups.set(f, 'a');
  for (const f of tr.b) groups.set(f, 'b');
  for (const f of tr.ear) groups.set(f, 'ear');
  const pose = (f: FaceId, k: number): Rigid3 => {
    const g = groups.get(f);
    if (!g) return IDENTITY;
    const phi = Math.PI * ease(k);
    if (g === 'a') return sideA(phi);
    const psi = solve(phi);
    if (g === 'b') return sideB(psi);
    return frameTurn(I, c0, f0, rotDir(sideA(phi), c0), rotDir(sideB(psi), f0));
  };
  const plan: MultiPlan = { mode: 'kinematic', moves: new Set(groups.keys()), pose, lift: () => 0 };
  rabbitCache.set(tr, plan);
  return plan;
}
