import { describe, expect, it } from 'vitest';
import {
  applyMove,
  checkInvariants,
  reflectPoint,
  lineThrough,
  sameFoldedState,
  stackAt,
  type KernelState,
  type Move,
  type Vec2,
} from '../src/index.ts';
import { foldMove, mustApply, sheet } from './helpers.ts';

/** Square folded in half on the diagonal: triangle A(-50,-50), B(50,50), C(-50,50); spine AB. */
export function diagonalTriangle(): KernelState {
  return mustApply(sheet(), foldMove([0, 0], [1, 1], [25, -25]));
}

/** The triangle folded in half again (A onto B): triangle O(0,0), B, C, four layers. */
export function nestedTriangle(): KernelState {
  return mustApply(diagonalTriangle(), foldMove([0, 0], [1, -1], [-40, -30]));
}

function reverse(p: Vec2, q: Vec2, seed: Vec2, kind: 'inside' | 'outside'): Move {
  return { type: 'reverseFold', params: { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, seed, kind } };
}

function apply(s: KernelState, m: Move): KernelState {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail ?? ''}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return r.state;
}

/** Faces at a point, top to bottom, tagged with whether they're part of the moved tip. */
function stackTags(before: KernelState, m: Move, at: Vec2): Array<'tip' | 'flap'> {
  const r = applyMove(before, m);
  if (!r.ok || r.transition.kind !== 'reverse') throw new Error('not a reverse fold');
  const moving = new Set(r.transition.moving);
  const st = stackAt(r.state, at);
  if (!st.ok) throw new Error('no stack');
  return st.faces.map((f) => (moving.has(f) ? 'tip' : 'flap'));
}

const centroid3 = (a: Vec2, b: Vec2, c: Vec2): Vec2 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];

// Corner B of the triangle, inside: ℓ from P(20,20) on the spine to (35,50) on the open
// edge, 18° off the spine, so the tip swings in along the flap.
const B_P: Vec2 = [20, 20];
const B_Q: Vec2 = [35, 50];
const B_SEED: Vec2 = centroid3(B_P, B_Q, [50, 50]);
// Corner A, outside: ℓ from (-20,-20) to (-50,22.8), 100° off the spine, so the tip's
// spine swings out past the flap's edge and the tip can wrap around the outside.
const A_P: Vec2 = [-20, -20];
const A_Q: Vec2 = [-50, 22.8];
const A_SEED: Vec2 = centroid3(A_P, A_Q, [-50, -50]);

/** Where a tip point lands: its mirror image across ℓ. */
const landing = (p: Vec2, q: Vec2, seed: Vec2) => reflectPoint(lineThrough(p, q), seed);

describe('reverse folds on a two-layer flap (section 10 fixtures)', () => {
  it('inside reverse folds one sharp corner of the diagonal triangle: the tip goes between the layers', () => {
    const t = diagonalTriangle();
    const m = reverse(B_P, B_Q, B_SEED, 'inside');
    apply(t, m);
    expect(stackTags(t, m, landing(B_P, B_Q, B_SEED))).toEqual(['flap', 'tip', 'tip', 'flap']);
  });

  it('outside reverse folds the other corner: the tip wraps around the outside', () => {
    const t = diagonalTriangle();
    const m = reverse(A_P, A_Q, A_SEED, 'outside');
    apply(t, m);
    expect(stackTags(t, m, landing(A_P, A_Q, A_SEED))).toEqual(['tip', 'flap', 'flap', 'tip']);
  });

  it('both corners, one after the other', () => {
    const s = apply(apply(diagonalTriangle(), reverse(B_P, B_Q, B_SEED, 'inside')), reverse(A_P, A_Q, A_SEED, 'outside'));
    expect(s.cp.faces.size).toBe(6);
  });

  it('a plain fold through both layers lands the tip in the same place but on top', () => {
    const t = diagonalTriangle();
    const plain = mustApply(t, foldMove(B_P, [B_Q[0] - B_P[0], B_Q[1] - B_P[1]], B_SEED, 'all'));
    const inside = apply(t, reverse(B_P, B_Q, B_SEED, 'inside'));
    const same = sameFoldedState(plain, inside);
    expect(same.same).toBe(false);
  });

  it('refuses a line that crosses no folded edge', () => {
    const r = applyMove(sheet(), reverse([0, -60], [0, 60], [20, 0], 'inside'));
    expect(!r.ok && r.reason).toBe('unsupported');
  });
});

describe('reverse folds on a flap with nested layers', () => {
  // Corner C(-50,50) of the nested triangle: the folded edge OC holds two nested folds.
  const P: Vec2 = [-20, 20];
  const C: Vec2 = [-50, 50];

  it('inside reverse puts all four tip layers between the two halves', () => {
    const Q: Vec2 = [-35, 50];
    const seed = centroid3(P, Q, C);
    const n = nestedTriangle();
    const m = reverse(P, Q, seed, 'inside');
    apply(n, m);
    expect(stackTags(n, m, landing(P, Q, seed))).toEqual(['flap', 'flap', 'tip', 'tip', 'tip', 'tip', 'flap', 'flap']);
  });

  it('outside reverse wraps two layers over the top and two under the bottom', () => {
    const Q: Vec2 = [22.8, 50];
    const seed = centroid3(P, Q, C);
    const n = nestedTriangle();
    const m = reverse(P, Q, seed, 'outside');
    apply(n, m);
    expect(stackTags(n, m, landing(P, Q, seed))).toEqual(['tip', 'tip', 'flap', 'flap', 'flap', 'flap', 'tip', 'tip']);
  });

  it('outside reverse refuses a line that would drag the tip through the flap', () => {
    const r = applyMove(nestedTriangle(), reverse(P, [-35, 50], centroid3(P, [-35, 50], C), 'outside'));
    expect(!r.ok && r.reason).toBe('blocked');
  });
});

describe('precrease, then push', () => {
  it('precreasing along the line and pushing the spine in equals the direct inside reverse fold', () => {
    const t = diagonalTriangle();
    const d: Vec2 = [B_Q[0] - B_P[0], B_Q[1] - B_P[1]];
    const folded = mustApply(t, foldMove(B_P, d, B_SEED, 'all'));
    const back = landing(B_P, B_Q, B_SEED);
    const precreased = mustApply(folded, foldMove(B_P, d, back, 2));
    expect(precreased.cp.faces.size).toBe(4);
    const pushed = apply(precreased, reverse(B_P, B_Q, B_SEED, 'inside'));
    const direct = apply(t, reverse(B_P, B_Q, B_SEED, 'inside'));
    expect(sameFoldedState(pushed, direct)).toEqual({ same: true });
  });

  it('works on the nested flap too', () => {
    const n = nestedTriangle();
    const P: Vec2 = [-20, 20];
    const Q: Vec2 = [-35, 50];
    const seed = centroid3(P, Q, [-50, 50]);
    const d: Vec2 = [Q[0] - P[0], Q[1] - P[1]];
    const folded = mustApply(n, foldMove(P, d, seed, 'all'));
    const precreased = mustApply(folded, foldMove(P, d, landing(P, Q, seed), 4));
    const pushed = apply(precreased, reverse(P, Q, seed, 'inside'));
    expect(sameFoldedState(pushed, apply(n, reverse(P, Q, seed, 'inside')))).toEqual({ same: true });
  });
});
