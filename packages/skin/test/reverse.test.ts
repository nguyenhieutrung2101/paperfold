import { applyMove, createSheet, type KernelState, lineThrough, type Move, reflectPoint, snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { type MotionTransition, planReverse, skinParamsFor, skinPoint } from '../src/index.ts';

const must = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type} refused: ${r.reason} ${r.detail ?? ''}`);
  return r;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers, direction: 'valley' },
});
const c3 = (a: Vec2, b: Vec2, c: Vec2): Vec2 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
const reverse = (p: Vec2, q: Vec2, corner: Vec2, kind: 'inside' | 'outside'): Move => ({
  type: 'reverseFold',
  params: { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, seed: c3(p, q, corner), kind },
});

// 100 mm square folded on the diagonal: triangle A(-50,-50), B(50,50), C(-50,50), spine AB.
const triangle = must(createSheet({ sizeMm: 100 }), fold([0, 0], [1, 1], [25, -25])).state;
const nested = must(triangle, fold([0, 0], [1, -1], [-40, -30])).state;
// The open corner C folded over both layers onto the middle: it lies over the flap's top side.
const cornerOver = must(triangle, fold([-25, 25], [1, 1], [-40, 40])).state;

interface Case {
  readonly name: string;
  readonly before: KernelState;
  readonly move: Move;
  readonly mode: 'kinematic' | 'swing';
}
const CASES: readonly Case[] = [
  { name: 'inside, diagonal triangle', before: triangle, move: reverse([20, 20], [35, 50], [50, 50], 'inside'), mode: 'kinematic' },
  { name: 'outside, diagonal triangle', before: triangle, move: reverse([-20, -20], [-50, 22.8], [-50, -50], 'outside'), mode: 'kinematic' },
  { name: 'inside, nested flap', before: nested, move: reverse([-20, 20], [-35, 50], [-50, 50], 'inside'), mode: 'kinematic' },
  { name: 'outside, nested flap', before: nested, move: reverse([-20, 20], [22.8, 50], [-50, 50], 'outside'), mode: 'kinematic' },
  { name: 'inside, with a corner folded over both layers', before: cornerOver, move: reverse([20, 20], [35, 50], [50, 50], 'inside'), mode: 'swing' },
];

function scene(c: Case) {
  const r = must(c.before, c.move);
  if (r.transition.kind !== 'reverse') throw new Error('not a reverse fold');
  const after = snapshot(r.state);
  return { before: snapshot(c.before), after, transition: r.transition as MotionTransition & { kind: 'reverse' }, params: skinParamsFor(after.paper, 'real') };
}

/** The widest gap anywhere along a crease: the same paper seen from its two faces. */
function worstGap(s: ReturnType<typeof scene>, theta: number): number {
  const motion = { before: s.before, transition: s.transition, theta, sharpnessAt: () => 0 };
  let worst = 0;
  for (const c of s.after.creases) {
    if (c.left === null || c.right === null) continue;
    for (const t of [0, 0.5, 1]) {
      const p: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t];
      const a = skinPoint(s.after, s.params, c.left, p, motion);
      const b = skinPoint(s.after, s.params, c.right, p, motion);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return worst;
}

describe('reverse folds move without tearing the paper', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const s = scene(c);

      it(`moves as planned (${c.mode})`, () => {
        expect(planReverse(s.after, s.transition).mode).toBe(c.mode);
      });

      it('every crease stays joined all the way through (within the layer gaps)', () => {
        let worst = 0;
        for (let i = 1; i < 48; i++) worst = Math.max(worst, worstGap(s, (Math.PI * i) / 48));
        expect(worst).toBeLessThan(1);
      });

      it('lands exactly where the static frame draws it, even uncreased', () => {
        const motion = { before: s.before, transition: s.transition, theta: Math.PI, sharpnessAt: () => 0 };
        for (const f of s.after.faces) {
          for (const p of f.material) {
            const a = skinPoint(s.after, s.params, f.id, p, motion);
            const b = skinPoint(s.after, s.params, f.id, p);
            for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 6);
          }
        }
      });
    });
  }

  it('the flap opens to let the tip in, then closes', () => {
    const s = scene(CASES[0]!);
    const f = s.after.faces.find((x) => s.transition.flapTop.includes(x.id))!;
    const top = (theta: number) =>
      Math.max(...f.material.map((p) => skinPoint(s.after, s.params, f.id, p, { before: s.before, transition: s.transition, theta, sharpnessAt: () => 0 })[1]));
    expect(top(Math.PI / 4)).toBeGreaterThan(10);
    expect(top(Math.PI)).toBeLessThan(1);
  });

  it('an outside reverse fold keeps the tip off the table', () => {
    const s = scene(CASES[1]!);
    for (let i = 1; i < 24; i++) {
      const motion = { before: s.before, transition: s.transition, theta: (Math.PI * i) / 24, sharpnessAt: () => 0 };
      for (const id of s.transition.moving) {
        const f = s.after.faces.find((x) => x.id === id)!;
        for (const p of f.material) expect(skinPoint(s.after, s.params, id, p, motion)[1]).toBeGreaterThan(-1e-6);
      }
    }
  });

  it('a precreased push lands in the same place as the direct fold', () => {
    const P: Vec2 = [20, 20];
    const d: Vec2 = [15, 30];
    const seed: Vec2 = [35, 40];
    const folded = must(triangle, fold(P, d, seed)).state;
    const pre = must(folded, fold(P, d, reflectPoint(lineThrough(P, [35, 50]), seed), 2)).state;
    const s = scene({ name: 'pushed', before: pre, move: reverse(P, [35, 50], [50, 50], 'inside'), mode: 'kinematic' });
    let worst = 0;
    for (let i = 1; i < 24; i++) worst = Math.max(worst, worstGap(s, (Math.PI * i) / 24));
    expect(worst).toBeLessThan(1);
  });
});
