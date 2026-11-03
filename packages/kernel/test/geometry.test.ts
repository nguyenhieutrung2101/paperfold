import { describe, expect, it } from 'vitest';
import {
  applyMaterial,
  clipHalfPlane,
  compose,
  containsStrictly,
  convexOverlap,
  frontUp,
  halfTurnAboutPlaneLine,
  IDENTITY,
  intersectConvex,
  lineThrough,
  orient,
  perpendicularBisector,
  raiseSpans,
  reflectPoint,
  rigidFromPlaneIso,
  sampleSpans,
  segmentLengthInside,
  side,
  signedArea,
  subSpans,
  toleranceFor,
  type Vec2,
} from '../src/index.ts';

const tol = toleranceFor(100);
const square = (x0: number, y0: number, s: number): Vec2[] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];

describe('predicates', () => {
  it('orient is positive for counter-clockwise triples', () => {
    expect(orient([0, 0], [1, 0], [0, 1])).toBeGreaterThan(0);
    expect(orient([0, 0], [1, 0], [0, -1])).toBeLessThan(0);
    expect(orient([0, 0], [1, 1], [2, 2])).toBe(0);
  });

  it('orient is exact where floating point fails', () => {
    // Classic near-collinear case: the naive determinant gets the sign wrong or zero.
    const a: Vec2 = [0.5, 0.5];
    const b: Vec2 = [12, 12];
    const c: Vec2 = [24, 24 + 2 ** -48];
    expect(orient(a, b, c)).toBeGreaterThan(0);
  });

  it('side uses a tolerance band around the line', () => {
    const l = lineThrough([0, 0], [10, 0]);
    expect(side(l, [5, 1], tol)).toBe(1);
    expect(side(l, [5, -1], tol)).toBe(-1);
    expect(side(l, [5, tol.len / 2], tol)).toBe(0);
    expect(side(l, [5, tol.len * 2], tol)).toBe(1);
  });
});

describe('lines', () => {
  it('the point-to-point fold line has the grabbed point on its left', () => {
    const a: Vec2 = [3, 1];
    const b: Vec2 = [-2, 4];
    const l = perpendicularBisector(a, b);
    expect(side(l, a, tol)).toBe(1);
    expect(side(l, b, tol)).toBe(-1);
    const r = reflectPoint(l, a);
    expect(r[0]).toBeCloseTo(b[0], 12);
    expect(r[1]).toBeCloseTo(b[1], 12);
  });
});

describe('polygons', () => {
  it('squares sharing an edge do not overlap; offset squares do', () => {
    expect(convexOverlap(square(0, 0, 10), square(10, 0, 10), tol)).toBe(false);
    expect(convexOverlap(square(0, 0, 10), square(5, 5, 10), tol)).toBe(true);
    expect(signedArea(intersectConvex(square(0, 0, 10), square(5, 5, 10)))).toBeCloseTo(25, 10);
  });

  it('clips to a half-plane', () => {
    const l = lineThrough([5, -10], [5, 10]); // left side is x < 5
    const left = clipHalfPlane(square(0, 0, 10), l, 1);
    expect(signedArea(left)).toBeCloseTo(50, 10);
    expect(Math.max(...left.map((p) => p[0]))).toBeCloseTo(5, 12);
  });

  it('strict containment respects the tolerance', () => {
    const sq = square(0, 0, 10);
    expect(containsStrictly(sq, [5, 5], tol)).toBe(true);
    expect(containsStrictly(sq, [0, 5], tol)).toBe(false);
    expect(containsStrictly(sq, [11, 5], tol)).toBe(false);
  });

  it('measures the part of a segment inside a polygon', () => {
    // Shrunk by the tolerance at both ends.
    expect(segmentLengthInside([-5, 5], [15, 5], square(0, 0, 10), tol)).toBeCloseTo(10 - 2 * tol.len, 9);
    expect(segmentLengthInside([0, -5], [0, 15], square(0, 0, 10), tol)).toBe(0); // along an edge
  });
});

describe('rigid transforms', () => {
  it('a half-turn about a table line is its own inverse and flips the sheet', () => {
    const h = halfTurnAboutPlaneLine(lineThrough([1, 2], [4, 6]));
    const twice = compose(h, h);
    for (let i = 0; i < 9; i++) expect(twice.r[i]).toBeCloseTo(IDENTITY.r[i]!, 14);
    for (let i = 0; i < 3; i++) expect(twice.t[i]).toBeCloseTo(0, 12);
    const flat = rigidFromPlaneIso({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(frontUp(flat)).toBe(true);
    const turned = compose(h, flat);
    expect(frontUp(turned)).toBe(false);
    // A point on the axis stays put.
    const p = applyMaterial(turned, [1, 2]);
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(0, 12);
    expect(p[2]).toBeCloseTo(-2, 12);
  });
});

describe('spans', () => {
  it('raises sharpness only where pressed, up to a cap', () => {
    let s = raiseSpans([], 0.2, 0.6, 0.5, 1);
    expect(sampleSpans(s, 0.1)).toBe(0);
    expect(sampleSpans(s, 0.4)).toBe(0.5);
    s = raiseSpans(s, 0.4, 1, 0.7, 0.9);
    expect(sampleSpans(s, 0.3)).toBe(0.5);
    expect(sampleSpans(s, 0.5)).toBe(0.9);
    expect(sampleSpans(s, 0.8)).toBeCloseTo(0.7, 12);
    const half = subSpans(s, 0.5, 1);
    expect(sampleSpans(half, 0)).toBe(0.9);
  });
});
