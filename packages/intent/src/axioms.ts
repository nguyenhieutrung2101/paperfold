import { cross2, type Line2, perpendicularBisector, reflectPoint, signedDistance, type Vec2 } from '@paperfold/kernel';

/**
 * The Huzita–Justin axioms used for snapping (brief, section 5): 1–5 and 7. Axiom 6 (two
 * points onto two lines, a cubic) comes later. All on the table plane, all returning every
 * solution.
 */

const EPS = 1e-9;

function unit(d: Vec2): Vec2 | null {
  const l = Math.hypot(d[0], d[1]);
  return l > EPS ? [d[0] / l, d[1] / l] : null;
}

/** Axiom 1: the line through two points. */
export function axiom1(p1: Vec2, p2: Vec2): Line2[] {
  const d = unit([p2[0] - p1[0], p2[1] - p1[1]]);
  return d ? [{ p: p1, d }] : [];
}

/** Axiom 2: the fold that places p1 onto p2 (perpendicular bisector). */
export function axiom2(p1: Vec2, p2: Vec2): Line2[] {
  if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < EPS) return [];
  return [perpendicularBisector(p1, p2)];
}

/** Axiom 3: the folds that place line l1 onto line l2 (angle bisectors; the midline if parallel). */
export function axiom3(l1: Line2, l2: Line2): Line2[] {
  const c = cross2(l1.d, l2.d);
  if (Math.abs(c) < EPS) {
    // Parallel: the midline.
    const off = signedDistance(l1, l2.p);
    if (Math.abs(off) < EPS) return [];
    const n: Vec2 = [-l1.d[1], l1.d[0]];
    return [{ p: [l1.p[0] + (n[0] * off) / 2, l1.p[1] + (n[1] * off) / 2], d: l1.d }];
  }
  // Intersection point.
  const w: Vec2 = [l2.p[0] - l1.p[0], l2.p[1] - l1.p[1]];
  const t = cross2(w, l2.d) / c;
  const x: Vec2 = [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t];
  const out: Line2[] = [];
  for (const d of [unit([l1.d[0] + l2.d[0], l1.d[1] + l2.d[1]]), unit([l1.d[0] - l2.d[0], l1.d[1] - l2.d[1]])]) {
    if (d) out.push({ p: x, d });
  }
  return out;
}

/** Axiom 4: the fold through p perpendicular to line l. */
export function axiom4(p: Vec2, l: Line2): Line2[] {
  return [{ p, d: [-l.d[1], l.d[0]] }];
}

/** Axiom 5: folds through p2 that place p1 onto line l. */
export function axiom5(p1: Vec2, p2: Vec2, l: Line2): Line2[] {
  // p1 swings on the circle around p2; where that circle meets l is where p1 can land.
  const r = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  if (r < EPS) return [];
  const dist = signedDistance(l, p2);
  if (Math.abs(dist) > r) return [];
  const foot: Vec2 = [p2[0] - -l.d[1] * dist, p2[1] - l.d[0] * dist];
  const half = Math.sqrt(Math.max(0, r * r - dist * dist));
  const out: Line2[] = [];
  for (const s of half < EPS ? [0] : [-1, 1]) {
    const q: Vec2 = [foot[0] + l.d[0] * half * s, foot[1] + l.d[1] * half * s];
    out.push(...axiom2(p1, q));
  }
  return out;
}

/** Axiom 7: folds that place p onto line l1 with the fold perpendicular to line l2. */
export function axiom7(p: Vec2, l1: Line2, l2: Line2): Line2[] {
  // A fold perpendicular to l2 moves p along l2's direction.
  // q = p + t·d2 lies on l1: cross(d1, p − p1) + t·cross(d1, d2) = 0.
  const c = cross2(l1.d, l2.d);
  if (Math.abs(c) < EPS) return [];
  const t = -signedDistance(l1, p) / c;
  const q: Vec2 = [p[0] + l2.d[0] * t, p[1] + l2.d[1] * t];
  return axiom2(p, q);
}

/** Where a fold along l puts p. */
export const imageOf = (l: Line2, p: Vec2): Vec2 => reflectPoint(l, p);
