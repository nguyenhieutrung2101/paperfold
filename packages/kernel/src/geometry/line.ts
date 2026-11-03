import { orient } from './predicates.ts';
import type { Tolerance } from './tolerance.ts';
import { add2, cross2, dot2, normalize2, perp2, scale2, sub2, type Vec2 } from './vec.ts';

/** An infinite line through `p` with unit direction `d`. Left of the line is perp(d). */
export interface Line2 {
  readonly p: Vec2;
  readonly d: Vec2;
}

export type Side = -1 | 0 | 1;

export function line(p: Vec2, d: Vec2): Line2 {
  return { p, d: normalize2(d) };
}

export function lineThrough(a: Vec2, b: Vec2): Line2 {
  return line(a, sub2(b, a));
}

/**
 * Point-to-point fold line (Huzita–Justin axiom 2): the perpendicular bisector
 * of a and b. Its left side contains `a`.
 */
export function perpendicularBisector(a: Vec2, b: Vec2): Line2 {
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ab = sub2(b, a);
  // The left normal perp(d) = (-d.y, d.x) must point from b toward a, i.e. along -ab.
  // d = (-ab.y, ab.x) gives perp(d) = (-ab.x, -ab.y) = -ab.
  return line(mid, [-ab[1], ab[0]]);
}

/** Signed distance; positive on the left of the line. */
export function signedDistance(l: Line2, q: Vec2): number {
  return cross2(l.d, sub2(q, l.p));
}

/** Coordinate of q's projection along the line, measured from l.p. */
export function along(l: Line2, q: Vec2): number {
  return dot2(l.d, sub2(q, l.p));
}

export function pointAt(l: Line2, t: number): Vec2 {
  return add2(l.p, scale2(l.d, t));
}

export function leftNormal(l: Line2): Vec2 {
  return perp2(l.d);
}

/**
 * Which side of the line q is on. Points within the band (default tol.len) are ON the
 * line (0); outside it the sign comes from the exact orientation predicate, so two
 * nearly-equal decisions can never disagree in sign.
 */
export function side(l: Line2, q: Vec2, tol: Tolerance, band: number = tol.len): Side {
  const dist = signedDistance(l, q);
  if (Math.abs(dist) <= band) return 0;
  const o = orient(l.p, add2(l.p, l.d), q);
  if (o > 0) return 1;
  if (o < 0) return -1;
  // Exactly collinear by the predicate but outside the band by the float distance:
  // only possible through rounding; trust the float distance.
  return dist > 0 ? 1 : -1;
}

/** Mirror image of q across the line. */
export function reflectPoint(l: Line2, q: Vec2): Vec2 {
  const dist = signedDistance(l, q);
  const n = leftNormal(l);
  return sub2(q, scale2(n, 2 * dist));
}

/** True when both lines are the same within tolerance over a window of half-width `extent`. */
export function sameLine(a: Line2, b: Line2, tol: Tolerance, extent: number): boolean {
  const s = Math.abs(cross2(a.d, b.d));
  if (s * extent > tol.len) return false;
  return Math.abs(signedDistance(a, b.p)) <= tol.len;
}
