import { describe, expect, it } from 'vitest';
import { applyMove, canonicalBases, createSheet, type KernelState, matchesState, type Move, recognizeBase, type Vec2 } from '../src/index.ts';
import { foldCrane } from './crane.ts';

const run = (s: KernelState, moves: Move[]) =>
  moves.reduce((st, m) => {
    const r = applyMove(st, m);
    if (!r.ok) throw new Error(`${m.type}: ${r.reason} ${r.detail ?? ''}`);
    return r.state;
  }, s);
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({ type: 'fold', params: { line: { p, d }, seed, layers, direction: 'valley' } });

describe('bases', () => {
  it('every canonical base folds', () => {
    expect(canonicalBases(150).map(([n]) => n)).toEqual(['blintz', 'kite', 'preliminary', 'waterbomb', 'bird']);
  });

  it('a flat sheet and a plain triangle are not bases', () => {
    const s = createSheet({ sizeMm: 150 });
    expect(recognizeBase(s)).toBeNull();
    expect(recognizeBase(run(s, [fold([0, 0], [1, 1], [40, -40])]))).toBeNull();
  });

  it('the crane passes through the preliminary base and the bird base', () => {
    const states = foldCrane(createSheet({ sizeMm: 150 }));
    expect(recognizeBase(states[5]!)).toBe('preliminary');
    // With the kite precreases made and unfolded, still a preliminary base.
    expect(recognizeBase(states[9]!)).toBe('preliminary');
    expect(recognizeBase(states[12]!)).toBe('bird');
    expect(recognizeBase(states[13]!)).toBeNull();
  });

  it('a blintz folded from other corners, turned and rotated, is still a blintz', () => {
    const s = createSheet({ sizeMm: 150 });
    const b = run(s, [
      fold([-37.5, -37.5], [1, -1], [-70, -70], 1),
      fold([37.5, 37.5], [1, -1], [70, 70], 1),
      fold([37.5, -37.5], [1, 1], [70, -70], 1),
      fold([-37.5, 37.5], [1, 1], [-70, 70], 1),
      { type: 'turnOver', params: { axis: 'side' } },
      { type: 'rotate', params: { degrees: 45 } },
    ]);
    expect(recognizeBase(b)).toBe('blintz');
  });

  it('works at other sizes', () => {
    const states = foldCrane(createSheet({ sizeMm: 150 }));
    expect(recognizeBase(states[12]!)).toBe('bird');
    expect(canonicalBases(200).length).toBe(5);
  });
});

describe('follow-along matching', () => {
  const s0 = createSheet({ sizeMm: 150 });
  const valley = run(s0, [fold([0, 0], [1, 1], [40, -40])]);
  const mountain = run(s0, [{ type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [40, -40], layers: 'all', direction: 'mountain' } }]);

  it('a state matches itself, and the same fold made from another corner', () => {
    expect(matchesState(valley, valley)).toBe(true);
    const other = run(s0, [fold([0, 0], [1, 1], [-40, 40])]);
    expect(matchesState(other, valley)).toBe(true);
  });

  it('a mountain fold is not the valley fold the step asked for', () => {
    expect(matchesState(mountain, valley)).toBe(false);
  });

  it('a precrease counts only once it is creased', () => {
    const pre = run(s0, [fold([0, 0], [1, 1], [40, -40]), fold([0, 0], [1, 1], [-40, 40], 1)]);
    expect(matchesState(s0, pre)).toBe(false);
    expect(matchesState(pre, pre)).toBe(true);
  });

  it('every crane state matches itself and not the next one', () => {
    const states = foldCrane(createSheet({ sizeMm: 150 }));
    for (let i = 1; i < states.length - 1; i++) {
      expect(matchesState(states[i]!, states[i]!), `state ${i}`).toBe(true);
      if (i < states.length - 2) expect(matchesState(states[i]!, states[i + 1]!), `state ${i} vs ${i + 1}`).toBe(false);
    }
  });
});
