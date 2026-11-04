import { describe, expect, it } from 'vitest';
import { applyMove, checkInvariants, createSheet, flatView, stackAt } from '../src/index.ts';
import { CRANE, foldCrane } from './crane.ts';

describe('the traditional crane (Phase 2 gate)', () => {
  it('every step is accepted and every state is valid', () => {
    let s = createSheet({ sizeMm: 150 });
    for (const step of CRANE) {
      const r = applyMove(s, step.move(s));
      if (!r.ok) throw new Error(`${step.label}: ${r.reason} ${r.detail ?? ''}`);
      expect(checkInvariants(r.state), step.label).toEqual([]);
      s = r.state;
    }
  });

  it('passes through a square preliminary base and a bird base', () => {
    const states = foldCrane(createSheet({ sizeMm: 150 }));
    const box = (i: number) => {
      const v = flatView(states[i]!)!;
      const xs = v.faceIds.flatMap((f) => v.poly.get(f)!.map((p) => p[0]));
      const ys = v.faceIds.flatMap((f) => v.poly.get(f)!.map((p) => p[1]));
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((x) => Math.round(x * 10) / 10 + 0);
    };
    // After the second squash: a 75 mm square, four layers everywhere.
    expect(box(5)).toEqual([0, 75, 0, 75]);
    for (const q of [[20, 50], [50, 20], [60, 70]] as const) {
      const st = stackAt(states[5]!, [q[0], q[1]]);
      expect(st.ok && st.faces.length).toBe(4);
    }
    // Bird base (after the second petal fold): a long diamond, 150 mm tip to tip.
    const t = 75 * Math.tan(Math.PI / 8);
    expect(box(13)).toEqual([-31.1, 75, -31.1, 75].map((x) => Math.round(x * 10) / 10 + 0));
    void t;
    // The head (the step before the final turn) turns the neck's tip down: more faces.
    const end = states[states.length - 2]!;
    const before = states[states.length - 3]!;
    expect(flatView(end)!.faceIds.length).toBeGreaterThan(flatView(before)!.faceIds.length);
  });
});
