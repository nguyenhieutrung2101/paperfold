import { createSheet, fold, signedDistance, snapshot } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { creaseLines, guessFold, landmarks } from './index.ts';

const opts = { radiusMm: 3, freehand: false };

describe('point-to-point folding', () => {
  const snap = snapshot(createSheet({ sizeMm: 100 }));
  const marks = landmarks(snap);

  it('finds corners and edge midpoints', () => {
    expect(marks.filter((m) => m.kind === 'corner')).toHaveLength(4);
    expect(marks.filter((m) => m.kind === 'midpoint')).toHaveLength(4);
  });

  it('snaps a near-corner drag to the exact diagonal', () => {
    const g = guessFold([49, 49.5], [-48.8, -49.2], marks, [], opts)!;
    expect(g.snappedFrom?.point).toEqual([50, 50]);
    expect(g.snappedTo?.point).toEqual([-50, -50]);
    expect(Math.abs(signedDistance(g.line, [50, -50]))).toBeLessThan(1e-9);
    expect(signedDistance(g.line, g.seed)).toBeGreaterThan(0);
  });

  it('freehand skips snapping', () => {
    const g = guessFold([49, 49.5], [-48.8, -49.2], marks, [], { ...opts, freehand: true })!;
    expect(g.snappedFrom).toBeNull();
  });

  it('snaps onto an existing crease to unfold along it', () => {
    const r = fold(createSheet({ sizeMm: 100 }), {
      line: { p: [0, 0], d: [0, 1] },
      seed: [25, 0],
      layers: 'all',
      direction: 'valley',
    });
    if (!r.ok) throw new Error('fold failed');
    const s = snapshot(r.state);
    // Drag the flap's corner back out, slightly off.
    const g = guessFold([-45, 10], [44.6, 10.4], landmarks(s), creaseLines(s), opts)!;
    expect(g.onCrease).toBe(true);
    expect(Math.abs(g.line.p[0])).toBeLessThan(1e-9);
    expect(signedDistance(g.line, g.seed)).toBeGreaterThan(0);
  });

  it('ignores drags too short to define a line', () => {
    expect(guessFold([0, 0], [0.1, 0], marks, [], opts)).toBeNull();
  });
});
