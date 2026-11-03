import { type Line2, signedDistance } from './line.ts';
import type { Tolerance } from './tolerance.ts';
import { cross2, dist2, lerp2, sub2, type Vec2 } from './vec.ts';

/** A simple polygon as a vertex loop. Every face in the kernel is convex and counter-clockwise. */
export type Polygon = readonly Vec2[];

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function signedArea(poly: Polygon): number {
  // Relative to the first vertex: the shoelace sum on raw coordinates cancels
  // catastrophically for tiny regions far from the origin.
  if (poly.length < 3) return 0;
  const o = poly[0]!;
  let a = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[i + 1]!;
    a += (p[0] - o[0]) * (q[1] - o[1]) - (q[0] - o[0]) * (p[1] - o[1]);
  }
  return a / 2;
}

export function centroid(poly: Polygon): Vec2 {
  // Area centroid; falls back to the vertex average for degenerate input.
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const w = p[0] * q[1] - q[0] * p[1];
    a += w;
    cx += (p[0] + q[0]) * w;
    cy += (p[1] + q[1]) * w;
  }
  if (Math.abs(a) < 1e-300) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function boxOf(poly: Polygon): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;
}

export function diameter(poly: Polygon): number {
  let d = 0;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      d = Math.max(d, dist2(poly[i]!, poly[j]!));
    }
  }
  return d;
}

/**
 * A region counts as having positive area only when it is wider than the length
 * tolerance: area > tol.len * diameter. Two faces that merely share an edge
 * produce a sliver of rounding-error width and do not "overlap".
 */
export function isFat(poly: Polygon, tol: Tolerance): boolean {
  if (poly.length < 3) return false;
  const d = diameter(poly);
  if (d <= tol.len) return false;
  return Math.abs(signedArea(poly)) > tol.len * d;
}

/**
 * Keep the part of `poly` on one closed side of a line (Sutherland–Hodgman step).
 * keep = +1 keeps the left side, -1 the right side.
 */
export function clipHalfPlane(poly: Polygon, l: Line2, keep: 1 | -1): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const dp = signedDistance(l, p) * keep;
    const dq = signedDistance(l, q) * keep;
    if (dp >= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      out.push(lerp2(p, q, dp / (dp - dq)));
    }
  }
  return out;
}

/** Intersection of two convex counter-clockwise polygons (Sutherland–Hodgman). */
export function intersectConvex(a: Polygon, b: Polygon): Vec2[] {
  let out: Vec2[] = [...a];
  const n = b.length;
  for (let i = 0; i < n && out.length > 0; i++) {
    const p = b[i]!;
    const q = b[(i + 1) % n]!;
    const d = sub2(q, p);
    const l = Math.hypot(d[0], d[1]);
    if (l === 0) continue;
    out = clipHalfPlane(out, { p, d: [d[0] / l, d[1] / l] }, 1);
  }
  return out;
}

/** True when two convex polygons share a region wider than the tolerance. */
export function convexOverlap(a: Polygon, b: Polygon, tol: Tolerance): boolean {
  return isFat(intersectConvex(a, b), tol);
}

/** q is inside the convex CCW polygon and farther than tol.len from every edge. */
export function containsStrictly(poly: Polygon, q: Vec2, tol: Tolerance): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const r = poly[(i + 1) % n]!;
    const e = sub2(r, p);
    const l = Math.hypot(e[0], e[1]);
    if (l === 0) continue;
    if (cross2(e, sub2(q, p)) / l <= tol.len) return false;
  }
  return true;
}

/**
 * Length of the part of segment ab that lies strictly inside the convex CCW
 * polygon (at least tol.len away from its boundary).
 */
export function segmentLengthInside(a: Vec2, b: Vec2, poly: Polygon, tol: Tolerance): number {
  let t0 = 0;
  let t1 = 1;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const r = poly[(i + 1) % n]!;
    const e = sub2(r, p);
    const l = Math.hypot(e[0], e[1]);
    if (l === 0) continue;
    // Inside means cross(e, x - p)/l > tol.  f(t) = fa + t (fb - fa).
    const fa = cross2(e, sub2(a, p)) / l - tol.len;
    const fb = cross2(e, sub2(b, p)) / l - tol.len;
    if (fa <= 0 && fb <= 0) return 0;
    if (fa < 0) t0 = Math.max(t0, fa / (fa - fb));
    else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * dist2(a, b);
}

/** Overlap length of two collinear segments, measured along unit direction d. */
export function collinearOverlap(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, d: Vec2): number {
  const pa0 = a0[0] * d[0] + a0[1] * d[1];
  const pa1 = a1[0] * d[0] + a1[1] * d[1];
  const pb0 = b0[0] * d[0] + b0[1] * d[1];
  const pb1 = b1[0] * d[0] + b1[1] * d[1];
  const lo = Math.max(Math.min(pa0, pa1), Math.min(pb0, pb1));
  const hi = Math.min(Math.max(pa0, pa1), Math.max(pb0, pb1));
  return hi - lo;
}
