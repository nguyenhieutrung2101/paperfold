import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMove, recognize, NAME_CONFIDENCE, type KernelState, type Move, type Vec2 } from '../src/index.ts';
import { bookFold, foldMove, mustApply, sheet } from './helpers.ts';
import { specArb, toMove } from './specs.ts';

const diagonal = () => mustApply(sheet(), foldMove([0, 0], [1, 1], [25, -25]));
const nested = () => mustApply(diagonal(), foldMove([0, 0], [1, -1], [-40, -30]));
const centroid3 = (a: Vec2, b: Vec2, c: Vec2): Vec2 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
const rev = (p: Vec2, q: Vec2, corner: Vec2, kind: 'inside' | 'outside'): Move => ({
  type: 'reverseFold',
  params: { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, seed: centroid3(p, q, corner), kind },
});

function name(s: KernelState, m: Move) {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return recognize(s, r.state);
}

describe('recognizing moves after the fact', () => {
  it('plain valley and mountain folds', () => {
    expect(name(sheet(), foldMove([0, 0], [0, 1], [25, 0]))).toMatchObject({ name: 'valley-fold' });
    expect(name(sheet(), foldMove([0, 0], [0, 1], [25, 0], 'all', 'mountain'))).toMatchObject({ name: 'mountain-fold' });
  });

  it('unfold, crease, turn over, rotate', () => {
    expect(name(bookFold(), foldMove([0, 0], [0, 1], [-25, 0], 1))).toMatchObject({ name: 'unfold' });
    expect(name(bookFold(), { type: 'burnish', params: { line: { p: [0, 0], d: [0, 1] }, amount: 1 } })).toMatchObject({ name: 'crease' });
    expect(name(bookFold(), { type: 'turnOver', params: { axis: 'side' } })).toMatchObject({ name: 'turn-over' });
    expect(name(bookFold(), { type: 'rotate', params: { degrees: 45 } })).toMatchObject({ name: 'rotate' });
  });

  it('every reverse fold in the fixtures gets the right name', () => {
    expect(name(diagonal(), rev([20, 20], [35, 50], [50, 50], 'inside')).name).toBe('inside-reverse-fold');
    expect(name(diagonal(), rev([-20, -20], [-50, 22.8], [-50, -50], 'outside')).name).toBe('outside-reverse-fold');
    expect(name(nested(), rev([-20, 20], [-35, 50], [-50, 50], 'inside')).name).toBe('inside-reverse-fold');
    expect(name(nested(), rev([-20, 20], [22.8, 50], [-50, 50], 'outside')).name).toBe('outside-reverse-fold');
  });

  it('a reverse fold along a precrease is still a reverse fold', () => {
    const t = diagonal();
    const d: Vec2 = [15, 30];
    const seed = centroid3([20, 20], [35, 50], [50, 50]);
    const folded = mustApply(t, foldMove([20, 20], d, seed, 'all'));
    const r0 = applyMove(folded, { type: 'fold', params: { line: { p: [20, 20], d }, seed: [27, 44], layers: 2, direction: 'valley' } });
    if (!r0.ok) throw new Error(r0.reason);
    expect(name(r0.state, rev([20, 20], [35, 50], [50, 50], 'inside')).name).toBe('inside-reverse-fold');
  });

  it('plain folds never get a confident reverse-fold name', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 6 }), (specs) => {
        let s = diagonal();
        for (const spec of specs) {
          const m = toMove(s, spec);
          if (!m || m.type === 'reverseFold') continue;
          const r = applyMove(s, m);
          if (!r.ok) continue;
          const got = recognize(s, r.state);
          if (got.confidence >= NAME_CONFIDENCE) expect(got.name.includes('reverse')).toBe(false);
          s = r.state;
        }
      }),
      { numRuns: 200 },
    );
  });
});
