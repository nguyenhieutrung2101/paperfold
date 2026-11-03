import { applyMove, createSheet, fold, snapshot, type KernelState } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { buildFrame, type FoldTransition, skinParamsFor, skinPoint, stackLevels } from '../src/index.ts';

function bookFold(): { before: KernelState; after: KernelState; transition: FoldTransition } {
  const before = createSheet({ sizeMm: 100 });
  const r = fold(before, { line: { p: [0, 0], d: [0, 1] }, seed: [25, 0], layers: 'all', direction: 'valley' });
  if (!r.ok || r.transition.kind !== 'fold') throw new Error('fold failed');
  return { before, after: r.state, transition: r.transition };
}

describe('stack levels', () => {
  it('puts the folded half one layer up', () => {
    const { after } = bookFold();
    const levels = [...stackLevels(snapshot(after)).values()].sort();
    expect(levels).toEqual([0, 1]);
  });
});

describe('frames', () => {
  const { before, after, transition } = bookFold();
  const snap = snapshot(after);
  const params = skinParamsFor(after.paper, 'real');

  it('builds a static frame with a rounded folded edge', () => {
    const frame = buildFrame(snap, params);
    expect(frame.paper.indices.length).toBeGreaterThan(0);
    expect(frame.edges.indices.length).toBeGreaterThan(0);
    // The fillet bulges past the crease line (x = 0) by about half the layer gap.
    let maxX = -Infinity;
    for (let i = 0; i < frame.paper.positions.length; i += 3) maxX = Math.max(maxX, frame.paper.positions[i]!);
    expect(maxX).toBeGreaterThan(0);
    expect(maxX).toBeLessThan(params.layerGapMm);
  });

  it('a finished, creased fold lands exactly where the static frame draws it', () => {
    const motion = { before: snapshot(before), transition, theta: Math.PI, sharpnessAt: () => 1 };
    for (const f of snap.faces) {
      for (const p of f.material) {
        const moving = skinPoint(snap, params, f.id, p, motion);
        const still = skinPoint(snap, params, f.id, p);
        for (let k = 0; k < 3; k++) expect(moving[k]).toBeCloseTo(still[k]!, 6);
      }
    }
  });

  it('an uncreased fold rides higher than a creased one', () => {
    const soft = { before: snapshot(before), transition, theta: Math.PI, sharpnessAt: () => 0 };
    const m = transition.moving[0]!;
    const face = snap.faces.find((f) => f.id === m)!;
    // The flap's far edge (the vertex farthest from the fold line x = 0 before folding).
    const p = face.material.reduce((best, q) => (Math.abs(q[0] - 50) > Math.abs(best[0] - 50) ? q : best));
    expect(skinPoint(snap, params, m, p, soft)[1]).toBeGreaterThan(skinPoint(snap, params, m, p)[1] + params.softRadiusMm);
  });

  it('every mesh index is in range and every normal is unit length', () => {
    const motion = { before: snapshot(before), transition, theta: 1.3, sharpnessAt: (u: number) => (u > 0 ? 1 : 0.2) };
    for (const frame of [buildFrame(snap, params), buildFrame(snap, params, motion)]) {
      const n = frame.paper.positions.length / 3;
      for (const i of frame.paper.indices) expect(i).toBeLessThan(n);
      for (let i = 0; i < frame.paper.normals.length; i += 3) {
        const l = Math.hypot(frame.paper.normals[i]!, frame.paper.normals[i + 1]!, frame.paper.normals[i + 2]!);
        expect(l).toBeCloseTo(1, 4);
      }
    }
  });

  it('turning the model over keeps the frame valid', () => {
    const r = applyMove(after, { type: 'turnOver', params: { axis: 'side' } });
    if (!r.ok) throw new Error('turn failed');
    expect(buildFrame(snapshot(r.state), params).paper.indices.length).toBeGreaterThan(0);
  });
});
