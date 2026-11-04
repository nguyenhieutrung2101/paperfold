import { applyMove, createSheet, type KernelState, type Move, snapshot, type Snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { faceHeights, planRelax, skinParamsFor, skinPoint } from '../src/index.ts';

const must = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type} refused: ${r.reason}`);
  return r.state;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({ type: 'fold', params: { line: { p, d }, seed, layers, direction: 'valley' } });

const sheet = createSheet({ sizeMm: 150 });
const triangle = must(sheet, fold([0, 0], [1, 1], [40, -40]));
const blintz = [
  fold([37.5, -37.5], [1, 1], [70, -70], 1),
  fold([37.5, 37.5], [1, -1], [70, 70], 1),
  fold([-37.5, 37.5], [1, 1], [-70, 70], 1),
  fold([-37.5, -37.5], [1, -1], [-70, -70], 1),
].reduce(must, sheet);
// The open corner of the triangle folded over both layers: it wraps them and locks them.
const locked = must(triangle, fold([-37.5, 37.5], [1, 1], [-60, 60]));

function plan(snap: Snapshot) {
  const params = skinParamsFor(snap.paper, 'real');
  const gap = params.layerGapMm * 4;
  return planRelax(snap, faceHeights(snap, gap), gap);
}

function worstGap(snap: Snapshot, relax: number, rest = false): number {
  const params = { ...skinParamsFor(snap.paper, 'real'), restOpen: rest };
  let worst = 0;
  for (const c of snap.creases) {
    if (c.left === null || c.right === null) continue;
    for (const t of [0, 0.5, 1]) {
      const p: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t];
      const a = skinPoint(snap, params, c.left, p, undefined, relax);
      const b = skinPoint(snap, params, c.right, p, undefined, relax);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return worst;
}

const highest = (snap: Snapshot, relax: number, rest = false) => {
  const params = { ...skinParamsFor(snap.paper, 'real'), restOpen: rest };
  let top = 0;
  for (const f of snap.faces) for (const p of f.material) top = Math.max(top, skinPoint(snap, params, f.id, p, undefined, relax)[1]);
  return top;
};

describe('relaxed folds', () => {
  it('the diagonal fold springs open: the top layer lifts, the crease stays joined', () => {
    const snap = snapshot(triangle);
    expect(plan(snap).flaps).toHaveLength(1);
    expect(highest(snap, 1)).toBeGreaterThan(15);
    expect(highest(snap, 0)).toBeLessThan(1);
    expect(worstGap(snap, 1)).toBeLessThan(1);
  });

  it('a blintz opens like a flower: all four corner flaps lift', () => {
    const snap = snapshot(blintz);
    expect(plan(snap).flaps).toHaveLength(4);
    expect(highest(snap, 1)).toBeGreaterThan(10);
    expect(worstGap(snap, 1)).toBeLessThan(1);
  });

  it('a flap held down by another layer stays flat', () => {
    const snap = snapshot(locked);
    const p = plan(snap);
    // Only the outermost corner layer is free; the triangle's top layer is wrapped by it.
    expect(p.flaps).toHaveLength(1);
    expect(worstGap(snap, 1)).toBeLessThan(1);
  });

  it('real paper rests a few degrees open: a free flap at its crease rest angle, at most about 3 mm up', () => {
    const creased = must(triangle, { type: 'burnish', params: { line: { p: [0, 0], d: [1, 1] }, amount: 1 } });
    const snap = snapshot(creased);
    const resting = highest(snap, 0, true);
    expect(resting).toBeGreaterThan(0.5);
    expect(resting).toBeLessThan(3.6);
    expect(worstGap(snap, 0, true)).toBeLessThan(1);
    // Ideal paper (and the flat frame) don't spring open.
    expect(highest(snap, 0, false)).toBeLessThan(1);
  });

  it('halfway is halfway', () => {
    const snap = snapshot(triangle);
    const h1 = highest(snap, 1);
    const h05 = highest(snap, 0.5);
    expect(h05).toBeGreaterThan(h1 * 0.3);
    expect(h05).toBeLessThan(h1 * 0.7);
  });
});
