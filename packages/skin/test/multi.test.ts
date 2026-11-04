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

describe('pleats, crimps and rabbit ears move without tearing the paper', () => {
  const sheet = createSheet({ sizeMm: 100 });
  const tri = (() => {
    const r = applyMove(sheet, { type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [25, -25], layers: 'all', direction: 'valley' } });
    if (!r.ok) throw new Error('refused');
    return r.state;
  })();
  const cases: Array<{ label: string; before: KernelState; move: Parameters<typeof applyMove>[1] }> = [
    { label: 'pleat', before: sheet, move: { type: 'pleat', params: { first: { p: [10, 0], d: [0, 1] }, second: { p: [25, 0], d: [0.2, 1] }, seed: [40, 0] } } },
    { label: 'inside crimp', before: tri, move: { type: 'crimp', params: { first: { p: [10, 10], d: [1, 3] }, second: { p: [20, 20], d: [1, 1.5] }, seed: [40, 44], kind: 'inside' } } },
    { label: 'rabbit ear on one layer', before: sheet, move: { type: 'rabbitEar', params: { tip: [50, 50], base: [[-50, 50], [50, -50]], seed: [40, 40] } } },
    { label: 'rabbit ear on both layers, to the other side', before: tri, move: { type: 'rabbitEar', params: { tip: [50, 50], base: [[-50, 50], [-50, -50]], seed: [30, 40], layers: 'all', side: 'a' } } },
    { label: 'outside crimp', before: tri, move: { type: 'crimp', params: { first: { p: [10, 10], d: [-0.866, 0.5] }, second: { p: [20, 20], d: [-0.94, 0.342] }, seed: [40, 44], kind: 'outside' } } },
  ];
  for (const c of cases) {
    it(c.label, () => {
      const r = applyMove(c.before, c.move);
      if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail ?? ''}`);
      const after = snapshot(r.state);
      const s = { before: snapshot(c.before), after, transition: r.transition as MotionTransition, params: { ...skinParamsFor(after.paper, 'real'), restOpen: false } };
      const rest = Math.max(worstGap(s, 0), worstGap(s, Math.PI));
      let worst = 0;
      for (let j = 1; j < 16; j++) worst = Math.max(worst, worstGap(s, (Math.PI * j) / 16));
      expect(worst).toBeLessThan(rest + 1);
      // Lands where the static frame draws it.
      const motion = { before: s.before, transition: s.transition, theta: Math.PI, sharpnessAt: () => 0 };
      for (const f of after.faces) {
        for (const p of f.material) {
          const a = skinPoint(after, s.params, f.id, p, motion);
          const b = skinPoint(after, s.params, f.id, p);
          for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 5);
        }
      }
    });
  }
});

describe('a flap standing open', () => {
  it('is drawn turned up about its hinge, in both paper modes', () => {
    const s = createSheet({ sizeMm: 150 });
    const r = applyMove(s, { type: 'fold', params: { line: { p: [50, 50], d: [1, -1] }, seed: [70, 70], layers: 1, direction: 'valley', angleDeg: 90 } });
    if (!r.ok) throw new Error('refused');
    const after = snapshot(r.state);
    const f = after.faces.find((face) => face.material.some((p) => p[0] === 150 && p[1] === 150))!;
    for (const mode of ['ideal', 'real'] as const) {
      const params = skinParamsFor(after.paper, mode);
      const w = skinPoint(after, params, f.id, [150, 150]);
      // Straight up over the fold line, 35 mm (plus its layer height).
      expect(w[1]).toBeGreaterThan(Math.hypot(25, 25) - 0.5);
      expect(w[1]).toBeLessThan(Math.hypot(25, 25) + 1.5);
      expect(w[0]).toBeCloseTo(50, 0);
      expect(-w[2]).toBeCloseTo(50, 0);
    }
  });
});
