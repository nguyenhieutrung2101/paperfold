/**
 * The Phase 1 gate (brief, section 10, "Reverse-fold fixtures"): a square folded in half on the
 * diagonal, then an inside reverse fold of one sharp corner and an outside reverse fold of the
 * other; the same on a flap with nested layers; and the precrease-then-push version. Each must
 * fold, validate, get the right name and produce build steps that replay to the same final state.
 */
import {
  applyMove,
  checkInvariants,
  createHistory,
  createSheet,
  currentState,
  type History,
  type KernelState,
  lineThrough,
  type Move,
  type MoveName,
  NAME_CONFIDENCE,
  perform,
  recognize,
  reflectPoint,
  sameFoldedState,
  type Vec2,
} from '@paperfold/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSteps, designLog } from '../src/index.ts';

const SIZE = 100;
const c3 = (a: Vec2, b: Vec2, c: Vec2): Vec2 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers, direction: 'valley' },
});
const crease = (p: Vec2, d: Vec2): Move => ({ type: 'burnish', params: { line: { p, d }, amount: 1 } });
const reverse = (p: Vec2, q: Vec2, corner: Vec2, kind: 'inside' | 'outside'): Move => ({
  type: 'reverseFold',
  params: { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, seed: c3(p, q, corner), kind },
});
/** Fold along p→q, then fold back: a precrease, leaving the paper as it was. */
const precrease = (p: Vec2, q: Vec2, corner: Vec2, layers: number): Move[] => {
  const seed = c3(p, q, corner);
  const d: Vec2 = [q[0] - p[0], q[1] - p[1]];
  return [fold(p, d, seed, 'all'), fold(p, d, reflectPoint(lineThrough(p, q), seed), layers)];
};

// Square A(-50,-50) B(50,50) C(-50,50) D(50,-50), folded on the diagonal AB: spine AB.
const DIAGONAL = [fold([0, 0], [1, 1], [25, -25]), crease([0, 0], [1, 1])];
// Folded in half again, A onto B: triangle O(0,0) B C, four layers, nested folds along OC.
const NESTED = [...DIAGONAL, fold([0, 0], [1, -1], [-40, -30]), crease([0, 0], [1, -1])];

interface Fixture {
  readonly name: string;
  readonly moves: readonly Move[];
  /** The name each move should get (null: don't care, e.g. creases). */
  readonly names: ReadonlyArray<MoveName | null>;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'diagonal triangle: inside reverse at B, outside reverse at A',
    moves: [...DIAGONAL, reverse([20, 20], [35, 50], [50, 50], 'inside'), reverse([-20, -20], [-50, 22.8], [-50, -50], 'outside')],
    names: ['valley-fold', 'crease', 'inside-reverse-fold', 'outside-reverse-fold'],
  },
  {
    name: 'nested flap: inside reverse at B, outside reverse at C',
    moves: [...NESTED, reverse([20, 20], [35, 50], [50, 50], 'inside'), reverse([-20, 20], [22.8, 50], [-50, 50], 'outside')],
    names: ['valley-fold', 'crease', 'valley-fold', 'crease', 'inside-reverse-fold', 'outside-reverse-fold'],
  },
  {
    name: 'diagonal triangle: precrease, then push',
    moves: [...DIAGONAL, ...precrease([20, 20], [35, 50], [50, 50], 2), reverse([20, 20], [35, 50], [50, 50], 'inside')],
    names: ['valley-fold', 'crease', 'valley-fold', 'unfold', 'inside-reverse-fold'],
  },
  {
    name: 'nested flap: precrease, then push',
    moves: [...NESTED, ...precrease([-20, 20], [-35, 50], [-50, 50], 4), reverse([-20, 20], [-35, 50], [-50, 50], 'inside')],
    names: ['valley-fold', 'crease', 'valley-fold', 'crease', 'valley-fold', 'unfold', 'inside-reverse-fold'],
  },
];

describe('Phase 1 gate: reverse-fold fixtures', () => {
  for (const fx of FIXTURES) {
    describe(fx.name, () => {
      let h: History;
      let design: KernelState;
      const named: MoveName[] = [];
      const invalidAfter: number[] = [];
      // Fold, validate (every invariant, from scratch, after every move), and name each move.
      beforeAll(() => {
        h = createHistory(createSheet({ sizeMm: SIZE }));
        fx.moves.forEach((m, i) => {
          const before = currentState(h);
          const r = perform(h, m);
          if (!r.ok) throw new Error(`${m.type} refused: ${r.reason} ${r.detail ?? ''}`);
          h = r.history;
          const after = currentState(h);
          if (checkInvariants(after).length > 0) invalidAfter.push(i);
          const rec = recognize(before, after);
          named.push(rec.confidence >= NAME_CONFIDENCE ? rec.name : 'fold');
        });
        design = currentState(h);
      });

      it('folds and validates', () => {
        expect(invalidAfter).toEqual([]);
        expect(checkInvariants(design)).toEqual([]);
      });

      it('gets the right names', () => {
        fx.names.forEach((want, i) => {
          if (want !== null) expect(named[i], `move ${i}`).toBe(want);
        });
      });

      it('produces build steps that replay to the same final state', () => {
        const { steps, verified } = buildSteps(designLog(h));
        expect(verified).toBe(true);
        // Replay the steps' own moves from a fresh sheet, independently of verifySteps.
        let s: KernelState = createSheet({ sizeMm: SIZE });
        for (const step of steps) {
          for (const m of step.moves) {
            const r = applyMove(s, m);
            if (!r.ok) throw new Error(`step ${step.index + 1} refused: ${r.reason}`);
            s = r.state;
          }
        }
        expect(sameFoldedState(s, design)).toEqual({ same: true });
        // The reverse folds keep their names in the steps.
        const reverseNames = steps.filter((x) => x.kind === 'reverse').map((x) => x.name);
        const wanted = fx.names.filter((n) => n === 'inside-reverse-fold' || n === 'outside-reverse-fold');
        expect(reverseNames).toEqual(wanted);
      });
    });
  }
});
