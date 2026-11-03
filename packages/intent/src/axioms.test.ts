import { createSheet, fold, line, lineThrough, reflectPoint, signedDistance, snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import {
  axiom1,
  axiom2,
  axiom3,
  axiom4,
  axiom5,
  axiom7,
  candidateMoves,
  classifyStroke,
  foldedEdges,
  orderCandidates,
  precreaseLines,
  snapContext,
  snapFold,
} from './index.ts';

const on = (l: { p: Vec2; d: Vec2 }, p: Vec2) => Math.abs(signedDistance(l, p)) < 1e-9;
const close = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

describe('Huzita–Justin axioms', () => {
  const p1: Vec2 = [3, -2];
  const p2: Vec2 = [-4, 5];
  const l1 = line([0, 0], [1, 0.3]);
  const l2 = line([2, 7], [-0.4, 1]);

  it('1: through two points', () => {
    const [f] = axiom1(p1, p2);
    expect(on(f!, p1) && on(f!, p2)).toBe(true);
  });
  it('2: point onto point', () => {
    expect(close(reflectPoint(axiom2(p1, p2)[0]!, p1), p2)).toBe(true);
  });
  it('3: line onto line, both bisectors', () => {
    const folds = axiom3(l1, l2);
    expect(folds).toHaveLength(2);
    for (const f of folds) {
      for (const t of [0, 5]) expect(on(l2, reflectPoint(f, [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t]))).toBe(true);
    }
  });
  it('4: through a point, perpendicular to a line', () => {
    const [f] = axiom4(p1, l1);
    expect(on(f!, p1)).toBe(true);
    expect(Math.abs(f!.d[0] * l1.d[0] + f!.d[1] * l1.d[1])).toBeLessThan(1e-12);
  });
  it('5: point onto a line, through a point', () => {
    const folds = axiom5(p1, p2, l2);
    expect(folds.length).toBeGreaterThan(0);
    for (const f of folds) {
      expect(on(f, p2)).toBe(true);
      expect(on(l2, reflectPoint(f, p1))).toBe(true);
    }
  });
  it('7: point onto a line, perpendicular to another line', () => {
    const [f] = axiom7(p1, l2, l1);
    expect(on(l2, reflectPoint(f!, p1))).toBe(true);
    expect(Math.abs(f!.d[0] * l1.d[0] + f!.d[1] * l1.d[1])).toBeLessThan(1e-12);
  });
});

describe('snapping', () => {
  const ctx = snapContext(snapshot(createSheet({ sizeMm: 100 })));
  const opts = { radiusMm: 3, freehand: false };

  it('a drag that ends near a corner snaps to point onto point', () => {
    const s = snapFold([49, -49.5], [-48.6, 48.9], ctx, opts)!;
    expect(s.rule).toBe(2);
    expect(close(s.image, [-50, 50])).toBe(true);
    expect(close(s.grab, [50, -50])).toBe(true);
  });

  it('nothing near: a nearly 45° line snaps its angle softly', () => {
    const s = snapFold([20, -10], [3, 7.3], ctx, opts)!;
    expect(s.rule).toBe('angle');
  });

  it('freehand skips snapping', () => {
    expect(snapFold([49, -49.5], [-48.6, 48.9], ctx, { ...opts, freehand: true })!.rule).toBe('free');
  });

  it('an existing crease wins when the drag lines up with it', () => {
    const r = fold(createSheet({ sizeMm: 100 }), { line: { p: [0, 0], d: [0, 1] }, seed: [25, 0], layers: 'all', direction: 'valley' });
    if (!r.ok) throw new Error('fold');
    const c = snapContext(snapshot(r.state));
    const s = snapFold([-45, 10], [44.4, 10.6], c, opts)!;
    expect(s.rule).toBe(0);
    expect(Math.abs(s.line.p[0])).toBeLessThan(1e-9);
  });
});

describe('candidates', () => {
  const opts = { line: lineThrough([0, 0], [0, 1]), seed: [10, 0] as Vec2, layersAtSeed: 3 };

  it('lists top, k and all layers, and both reverse folds', () => {
    expect(candidateMoves(opts).map((c) => c.kind)).toEqual(['fold-top', 'fold-layers', 'fold-all', 'inside-reverse', 'outside-reverse']);
  });

  it('on a closed flap, reverse folds come first; otherwise the top layer', () => {
    const all = candidateMoves(opts).map((candidate) => ({ candidate, ok: true }));
    expect(orderCandidates(all, { allLayers: false }).map((x) => x.candidate.kind)[0]).toBe('inside-reverse');
    const plain = all.map((x) => ({ ...x, ok: !x.candidate.kind.includes('reverse') }));
    expect(orderCandidates(plain, { allLayers: false })[0]!.candidate.kind).toBe('fold-top');
    expect(orderCandidates(plain, { allLayers: true })[0]!.candidate.kind).toBe('fold-all');
  });

  it('keeps the first one when nothing is valid, so its refusal can be shown', () => {
    const none = candidateMoves(opts).map((candidate) => ({ candidate, ok: false }));
    expect(orderCandidates(none, { allLayers: false })).toHaveLength(1);
  });
});

describe('crease or grab', () => {
  // Book fold (spine at x = 0), creased? no: soft. Then precrease across it at y = 20.
  const base = createSheet({ sizeMm: 100 });
  const r1 = fold(base, { line: { p: [0, 0], d: [0, 1] }, seed: [25, 0], layers: 'all', direction: 'valley' });
  if (!r1.ok) throw new Error('fold');
  const r2 = fold(r1.state, { line: { p: [0, 20], d: [1, 0] }, seed: [-25, 40], layers: 'all', direction: 'valley' });
  if (!r2.ok) throw new Error('fold 2');
  const r3 = fold(r2.state, { line: { p: [0, 20], d: [1, 0] }, seed: [-25, 5], layers: 2, direction: 'valley' });
  if (!r3.ok) throw new Error(`unfold ${r3.reason}`);
  const snap = snapshot(r3.state);
  const ctx = { edges: foldedEdges(snap), precreases: precreaseLines(snap) };
  const opts = { decideMm: 2, nearMm: 3 };

  it('waits for enough motion', () => {
    expect(classifyStroke([0, -20], [0, -19], ctx, opts).kind).toBe('pending');
  });
  it('along a fold creases it', () => {
    expect(classifyStroke([0.5, -20], [0.5, -10], ctx, opts).kind).toBe('crease');
  });
  it('across a fold away from a precrease grabs', () => {
    expect(classifyStroke([-0.5, -20], [-15, -20], ctx, opts).kind).toBe('grab');
  });
  it('pushing into the paper by a precrease is a push', () => {
    const s = classifyStroke([-0.2, 22], [-10, 22], ctx, opts);
    expect(s.kind).toBe('push');
  });
});
