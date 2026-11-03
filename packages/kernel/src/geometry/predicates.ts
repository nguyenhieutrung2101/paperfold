import { orient2d as rawOrient2d } from 'robust-predicates';
import type { Vec2 } from './vec.ts';

/**
 * Exact orientation test (Shewchuk's adaptive predicates via robust-predicates).
 *
 * Returns > 0 when c is to the LEFT of the directed line a -> b (a, b, c counter-clockwise),
 * < 0 when to the right, 0 when exactly collinear.
 *
 * Note: robust-predicates' README says positive means counter-clockwise, but the
 * implementation returns the opposite sign. We negate here so the rest of the
 * kernel can rely on the usual math convention; predicates.test.ts pins it.
 */
export function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return -rawOrient2d(a[0], a[1], b[0], b[1], c[0], c[1]);
}
