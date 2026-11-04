/** The Phase 2 gate: the traditional crane's op log turns into verified build steps. */
import { createHistory, createSheet, currentState, type History, perform } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { CRANE } from '../../kernel/test/crane.ts';
import { buildSteps, designLog } from '../src/index.ts';

function foldCrane(): History {
  let h = createHistory(createSheet({ sizeMm: 150 }));
  for (const step of CRANE) {
    const r = perform(h, step.move(currentState(h)));
    if (!r.ok) throw new Error(`${step.label}: ${r.reason}`);
    h = r.history;
  }
  return h;
}

describe('the crane, as build steps', () => {
  const { steps, verified } = buildSteps(designLog(foldCrane()));

  it('replays from a flat sheet to the same crane', () => {
    expect(verified).toBe(true);
  });

  it('names the moves a folder would', () => {
    const names = steps.map((s) => (s.named ? s.name : s.kind));
    expect(names.filter((n) => n === 'squash-fold')).toHaveLength(2);
    expect(names.filter((n) => n === 'petal-fold')).toHaveLength(2);
    expect(names.filter((n) => n === 'inside-reverse-fold')).toHaveLength(3);
    // The kite folds are precreases: fold, crease, unfold in one step each.
    expect(steps.filter((s) => s.kind === 'precrease')).toHaveLength(2);
  });

  it('every step has a caption and something to draw', () => {
    for (const s of steps) {
      expect(s.caption).toBeTruthy();
      if (s.kind !== 'turn-over' && s.kind !== 'rotate') expect(s.symbols.length).toBeGreaterThan(0);
    }
  });
});
