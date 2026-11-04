import { applyMove, createSheet, type KernelState, type Move, signedDistance, snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { foldedEdges, foldTargets, pickTarget, surfaceOf, targetContext, zoneAt } from './index.ts';

const must = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type} refused: ${r.reason}`);
  return r.state;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({ type: 'fold', params: { line: { p, d }, seed, layers, direction: 'valley' } });
const ctxOf = (s: KernelState) => {
  const snap = snapshot(s);
  return targetContext(snap, surfaceOf(snap));
};
const on = (l: { p: Vec2; d: Vec2 }, p: Vec2) => Math.abs(signedDistance(l, p)) < 1e-6;

// 100 mm sheet, corners (±50, ±50).
const sheet = createSheet({ sizeMm: 100 });
// Precreased in half both ways and on one diagonal: center lines and a diagonal to line things up with.
const pre = [fold([0, 0], [0, 1], [25, 3]), fold([0, 0], [0, 1], [-25, 3], 1), fold([0, 0], [1, 0], [3, 25]), fold([0, 0], [1, 0], [3, -25], 1)].reduce(must, sheet);
const preDiag = [fold([0, 0], [1, 1], [25, -25]), fold([0, 0], [1, 1], [-25, 25], 1)].reduce(must, sheet);

describe('common folds', () => {
  it('a corner goes to the other corners (in half), the center and the middles of the edges', () => {
    const t = foldTargets([50, -50], ctxOf(sheet), { onEdgeMm: 1 });
    const kinds = new Map(t.map((x) => [`${x.landing[0]},${x.landing[1]}`, x.kind]));
    expect(kinds.get('-50,50')).toBe('half'); // diagonal
    expect(kinds.get('-50,-50')).toBe('half'); // book fold
    expect(kinds.get('0,0')).toBe('center');
    expect(kinds.get('0,50')).toBe('midpoint');
  });

  it('snaps from well away, with the strongest pull for halves and the center', () => {
    const t = foldTargets([50, -50], ctxOf(sheet), { onEdgeMm: 1 });
    const pick = pickTarget(t, [-44, 45], 9, null)!;
    expect(pick.target.kind).toBe('half');
    expect(on(pick.target.line, [50, 50]) && on(pick.target.line, [-50, -50])).toBe(true);
    expect(pickTarget(t, [3, -2.5], 9, null)!.target.kind).toBe('center');
    expect(pickTarget(t, [20, 20], 9, null)).toBeNull();
  });

  it('holds a chosen target until the pointer is clearly elsewhere', () => {
    const t = foldTargets([50, -50], ctxOf(sheet), { onEdgeMm: 1 });
    const first = pickTarget(t, [-50, 44], 9, null)!;
    // A little past where it would let go of a fresh pick: still the corner.
    const held = pickTarget(t, [-40, 50], 9, first.target.key)!;
    expect(held.target.key).toBe(first.target.key);
  });

  it('an edge goes onto the center crease (cupboard fold)', () => {
    const t = foldTargets([10, -50], ctxOf(pre), { onEdgeMm: 1 });
    const pick = pickTarget(t, [12, 3], 9, null)!;
    expect(pick.target.kind).toBe('edge-to-crease');
    expect(on(pick.target.line, [0, -25]) && on(pick.target.line, [40, -25])).toBe(true);
  });

  it('an edge onto the opposite edge is folding in half', () => {
    const t = foldTargets([10, -50], ctxOf(sheet), { onEdgeMm: 1 });
    const pick = pickTarget(t, [8, 47], 9, null)!;
    expect(pick.target.kind).toBe('half');
    expect(on(pick.target.line, [0, 0]) && Math.abs(pick.target.line.d[1])).toBeLessThan(1e-9);
  });

  it('a corner brings its edge onto the diagonal (kite fold)', () => {
    const t = foldTargets([50, -50], ctxOf(preDiag), { onEdgeMm: 1 });
    // The bottom edge onto the diagonal y = x: the corner lands 100 mm along it from (-50, -50).
    const landing: Vec2 = [-50 + 100 / Math.SQRT2, -50 + 100 / Math.SQRT2];
    const pick = pickTarget(t, [landing[0] + 2, landing[1] - 1], 9, null)!;
    expect(pick.target.kind).toBe('edge-to-crease');
    expect(Math.hypot(pick.target.landing[0] - landing[0], pick.target.landing[1] - landing[1])).toBeLessThan(1e-6);
    expect(on(pick.target.line, [-50, -50])).toBe(true);
  });
});

describe('a blintz: four corners to the center', () => {
  it('corners pressed a few millimetres inside all land exactly on the center', () => {
    let s: KernelState = createSheet({ sizeMm: 150 });
    const corners: Vec2[] = [[75, -75], [75, 75], [-75, 75], [-75, -75]];
    for (const c of corners) {
      const snap = snapshot(s);
      const surface = surfaceOf(snap);
      // A mouse press about 6 mm inside the corner: it pinches that corner.
      const press: Vec2 = [c[0] - Math.sign(c[0]) * 4.2, c[1] - Math.sign(c[1]) * 4.2];
      const zone = zoneAt(press, surface, foldedEdges(snap), { cornerMm: 8, nearMm: 3 });
      expect(zone.kind).toBe('corner');
      const grab = zone.kind === 'corner' ? zone.point : press;
      const pick = pickTarget(foldTargets(grab, targetContext(snap, surface), { onEdgeMm: 3 }), [3, -2.5], 12.6, null)!;
      expect(pick.target.kind).toBe('center');
      expect(Math.hypot(pick.target.landing[0], pick.target.landing[1])).toBeLessThan(1e-9);
      s = must(s, fold(pick.target.line.p, pick.target.line.d, press, 1));
    }
    // Every corner tip is exactly at the middle.
    const tips = snapshot(s).faces.length;
    expect(tips).toBe(5);
  });
});
