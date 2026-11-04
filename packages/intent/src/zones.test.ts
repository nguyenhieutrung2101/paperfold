import {
  applyMove,
  createSheet,
  type KernelState,
  lineThrough,
  type Move,
  reflectPoint,
  sameFoldedState,
  snapshot,
  type Vec2,
} from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { classifyStroke, foldedEdges, precreaseLines, pushFold, snapContext, surfaceOf, zoneAt } from './index.ts';

const must = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type} refused: ${r.reason} ${r.detail ?? ''}`);
  return r.state;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers, direction: 'valley' },
});
const close = (a: Vec2, b: Vec2, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

// Square folded on the diagonal: triangle A(-50,-50), B(50,50), C(-50,50); spine AB, paper above it.
const triangle = must(createSheet({ sizeMm: 100 }), fold([0, 0], [1, 1], [25, -25]));
const zoneOpts = { cornerMm: 4, nearMm: 3 };

function setup(s: KernelState) {
  const snap = snapshot(s);
  return { snap, surface: surfaceOf(snap), edges: foldedEdges(snap), precreases: precreaseLines(snap), ctx: snapContext(snap) };
}

describe('the model seen from above', () => {
  it('finds the corners you can pinch, and only those', () => {
    const { surface } = setup(triangle);
    const want: Vec2[] = [[-50, -50], [50, 50], [-50, 50]];
    expect(surface.corners).toHaveLength(3);
    for (const w of want) expect(surface.corners.some((c) => close(c, w))).toBe(true);
  });

  it('a precrease meeting the folded edge makes no corner there', () => {
    const P: Vec2 = [20, 20];
    const d: Vec2 = [15, 30];
    const seed: Vec2 = [35, 40];
    const folded = must(triangle, fold(P, d, seed));
    const pre = must(folded, fold(P, d, reflectPoint(lineThrough(P, [35, 50]), seed), 2));
    const { surface } = setup(pre);
    expect(surface.corners).toHaveLength(3);
    expect(surface.corners.some((c) => close(c, P))).toBe(false);
  });
});

describe('where a press lands', () => {
  const t = setup(triangle);

  it('a corner wins over the folded edge it sits on', () => {
    const z = zoneAt([-49, -49.5], t.surface, t.edges, zoneOpts);
    expect(z.kind).toBe('corner');
  });
  it('on the folded edge, away from its ends', () => {
    expect(zoneAt([0.5, -0.5], t.surface, t.edges, zoneOpts).kind).toBe('folded-edge');
    expect(zoneAt([0, 1], t.surface, t.edges, zoneOpts).kind).toBe('folded-edge');
  });
  it('anywhere else is the paper', () => {
    expect(zoneAt([-30, 20], t.surface, t.edges, zoneOpts).kind).toBe('paper');
  });
  it('a folded edge hidden under a layer is just paper', () => {
    // Inside reverse fold at B: the tip's own spine runs inside, under the flap.
    const s = must(triangle, { type: 'reverseFold', params: { line: { p: [20, 20], d: [15, 30] }, seed: [35, 40], kind: 'inside' } });
    const u = setup(s);
    expect(zoneAt([22.1, 35], u.surface, u.edges, zoneOpts).kind).toBe('paper');
  });
});

describe('what a stroke means', () => {
  const t = setup(triangle);
  const o = { decideMm: 2 };
  const edge = zoneAt([0.5, -0.5], t.surface, t.edges, zoneOpts);
  const corner = zoneAt([-49, -49.5], t.surface, t.edges, zoneOpts);

  it('waits for enough motion', () => {
    expect(classifyStroke([0, 0], [0.5, 0.5], edge, o).kind).toBe('pending');
  });
  it('a corner dragged along the folded edge is picked up, not creased', () => {
    expect(classifyStroke([-49, -49.5], [-30, -30.5], corner, o).kind).toBe('grab');
  });
  it('along a folded edge creases it; across it pushes it', () => {
    expect(classifyStroke([0.5, -0.5], [10.5, 9.5], edge, o).kind).toBe('crease');
    expect(classifyStroke([0.5, -0.5], [-5, 6], edge, o).kind).toBe('push');
    expect(classifyStroke([0.5, -0.5], [6, -5], edge, o).kind).toBe('push');
  });
});

describe('pushing a folded edge makes a reverse fold, no precrease needed', () => {
  const t = setup(triangle);
  const edge = (() => {
    const z = zoneAt([40.3, 39.7], t.surface, t.edges, zoneOpts);
    if (z.kind !== 'folded-edge') throw new Error('not on the edge');
    return z.edge;
  })();
  const opts = { radiusMm: 2, nearMm: 3, freehand: false };

  it('inward: the pressed point goes where you push, and the tip tucks inside', () => {
    const line = lineThrough([20, 20], [35, 50]);
    const to = reflectPoint(line, [40, 40]);
    const push = pushFold([40.3, 39.7], to, edge, { snap: t.ctx, precreases: t.precreases }, opts)!;
    expect(push.kind).toBe('inside');
    expect(push.precrease).toBe(false);
    expect(push.theta).toBeCloseTo(Math.PI, 6);
    const s = must(triangle, { type: 'reverseFold', params: { line: push.line, seed: push.seed, kind: push.kind } });
    const direct = must(triangle, { type: 'reverseFold', params: { line: { p: [20, 20], d: [15, 30] }, seed: [35, 40], kind: 'inside' } });
    expect(sameFoldedState(s, direct)).toEqual({ same: true });
  });

  it('outward: the tip wraps around the outside', () => {
    const line = lineThrough([20, 20], [-22.8, 50]);
    const to = reflectPoint(line, [40, 40]);
    const push = pushFold([40.3, 39.7], to, edge, { snap: t.ctx, precreases: t.precreases }, opts)!;
    expect(push.kind).toBe('outside');
    const s = applyMove(triangle, { type: 'reverseFold', params: { line: push.line, seed: push.seed, kind: push.kind } });
    expect(s.ok).toBe(true);
  });

  it('beside a precrease, the push follows the precrease and its depth', () => {
    const P: Vec2 = [20, 20];
    const d: Vec2 = [15, 30];
    const seed: Vec2 = [35, 40];
    const folded = must(triangle, fold(P, d, seed));
    const pre = must(folded, fold(P, d, reflectPoint(lineThrough(P, [35, 50]), seed), 2));
    const u = setup(pre);
    const z = zoneAt([21.5, 20.8], u.surface, u.edges, zoneOpts);
    if (z.kind !== 'folded-edge') throw new Error('not on the edge');
    const shallow = pushFold([21.5, 20.8], [19, 23.5], z.edge, { snap: u.ctx, precreases: u.precreases }, opts)!;
    const deep = pushFold([21.5, 20.8], [14, 28], z.edge, { snap: u.ctx, precreases: u.precreases }, opts)!;
    expect(shallow.precrease).toBe(true);
    expect(Math.abs(shallow.line.d[0] * 30 - shallow.line.d[1] * 15)).toBeLessThan(1e-6);
    expect(deep.theta).toBeGreaterThan(shallow.theta);
    const s = must(pre, { type: 'reverseFold', params: { line: deep.line, seed: deep.seed, kind: deep.kind } });
    const direct = must(triangle, { type: 'reverseFold', params: { line: { p: P, d }, seed, kind: 'inside' } });
    expect(sameFoldedState(s, direct)).toEqual({ same: true });
  });
});
