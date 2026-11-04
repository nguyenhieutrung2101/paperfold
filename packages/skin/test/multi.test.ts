import { applyMove, createSheet, type KernelState, snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { CRANE, foldCrane } from '../../kernel/test/crane.ts';
import { type MotionTransition, skinParamsFor, skinPoint, skinPointsOf } from '../src/index.ts';

/** The crane's states, and the squash and petal steps in it. */
const states = foldCrane(createSheet({ sizeMm: 150 }));
const steps = CRANE.map((s, i) => ({ label: s.label, i })).filter(({ i }) => {
  const m = CRANE[i]!.move(states[i]!);
  return m.type === 'squash' || m.type === 'petal' || m.type === 'reverseFold';
});

function scene(i: number) {
  const before = states[i]! as KernelState;
  const r = applyMove(before, CRANE[i]!.move(before));
  if (!r.ok) throw new Error('refused');
  const after = snapshot(r.state);
  return { before: snapshot(before), after, transition: r.transition as MotionTransition, params: { ...skinParamsFor(after.paper, 'real'), restOpen: false } };
}

function worstGap(s: ReturnType<typeof scene>, theta: number): number {
  const motion = { before: s.before, transition: s.transition, theta, sharpnessAt: () => 0 };
  const at = skinPointsOf(s.after, s.params, motion);
  let worst = 0;
  for (const c of s.after.creases) {
    if (c.left === null || c.right === null) continue;
    for (const t of [0, 0.5, 1]) {
      const p: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t];
      const a = at(c.left, p);
      const b = at(c.right, p);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return worst;
}

describe('the crane\'s squash, petal and reverse folds move without tearing the paper', () => {
  it('the crane has two squashes, two petals and three reverse folds', () => {
    expect(steps.length).toBe(7);
  });
  for (const { label, i } of steps) {
    describe(`${label} (step ${i + 1})`, () => {
      const s = scene(i);
      it('every crease stays joined all the way through (within the layer gaps)', () => {
        // Folded creases join layers a stack apart; the motion may not open them further.
        const rest = Math.max(worstGap(s, 0), worstGap(s, Math.PI));
        let worst = 0;
        for (let j = 1; j < 16; j++) worst = Math.max(worst, worstGap(s, (Math.PI * j) / 16));
        expect(worst).toBeLessThan(rest + 1);
      });
      it('lands exactly where the static frame draws it', () => {
        const motion = { before: s.before, transition: s.transition, theta: Math.PI, sharpnessAt: () => 0 };
        for (const f of s.after.faces) {
          for (const p of f.material) {
            const a = skinPoint(s.after, s.params, f.id, p, motion);
            const b = skinPoint(s.after, s.params, f.id, p);
            for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 5);
          }
        }
      });
      it('starts where the paper was', () => {
        const motion = { before: s.before, transition: s.transition, theta: 0, sharpnessAt: () => 0 };
        for (const f of s.after.faces) {
          const start = s.transition.startPlacements.get(f.id)!;
          for (const p of f.material) {
            const a = skinPoint(s.after, s.params, f.id, p, motion);
            const w = [start.r[0] * p[0] + start.r[1] * p[1] + start.t[0], start.t[2] + start.r[6] * p[0] + start.r[7] * p[1]];
            expect(a[0]).toBeCloseTo(w[0]!, 5);
            expect(a[2]).toBeCloseTo(w[1]!, 5);
          }
        }
      });
    });
  }
});
