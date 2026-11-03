import { applyMove, createSheet, snapshot, type KernelState, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { skinParamsFor, skinPoint } from '../src/index.ts';

function setup() {
  const sheet = createSheet({ sizeMm: 100 });
  const r0 = applyMove(sheet, { type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [25, -25], layers: 'all', direction: 'valley' } });
  if (!r0.ok) throw new Error('fold');
  const tri: KernelState = r0.state;
  const P: Vec2 = [20, 20];
  const r = applyMove(tri, { type: 'reverseFold', params: { line: { p: P, d: [15, 30] }, seed: [35, 40], kind: 'inside' } });
  if (!r.ok || r.transition.kind !== 'reverse') throw new Error('reverse');
  return { before: snapshot(tri), after: snapshot(r.state), transition: r.transition };
}

describe('reverse fold motion', () => {
  const { before, after, transition } = setup();
  const params = skinParamsFor(after.paper, 'real');

  it('lands exactly where the static frame draws it', () => {
    const motion = { before, transition, theta: Math.PI, sharpnessAt: () => 1 };
    for (const f of after.faces) {
      for (const p of f.material) {
        const a = skinPoint(after, params, f.id, p, motion);
        const b = skinPoint(after, params, f.id, p);
        for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 6);
      }
    }
  });

  it('an uncreased reverse fold still lands inside the stack, under the flap that closes over it', () => {
    // A soft loop would float the tip 2·rho above its layer, through the flap above it.
    const motion = { before, transition, theta: Math.PI, sharpnessAt: () => 0, opening: 0 };
    for (const f of after.faces) {
      for (const p of f.material) {
        const a = skinPoint(after, params, f.id, p, motion);
        const b = skinPoint(after, params, f.id, p);
        for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 6);
      }
    }
  });

  it('opens the flap’s top side mid-way to let the tip in', () => {
    const motion = { before, transition, theta: Math.PI / 2, sharpnessAt: () => 1 };
    const f = after.faces.find((x) => transition.flapTop.includes(x.id))!;
    const top = Math.max(...f.material.map((p) => skinPoint(after, params, f.id, p, motion)[1]));
    expect(top).toBeGreaterThan(10);
  });
});
