import { describe, expect, it } from 'vitest';
import { applyMove, canonicalBases, createSheet, type KernelState, type Move, recognizeBase, type Vec2 } from '../src/index.ts';
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
