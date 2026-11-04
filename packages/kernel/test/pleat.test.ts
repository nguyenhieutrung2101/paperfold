import { describe, expect, it } from 'vitest';
import { applyMove, checkInvariants, createSheet, flatView, type KernelState, lineThrough, type Move, recognize, reflectPoint, stackAt, type Vec2 } from '../src/index.ts';

const run = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type}: ${r.reason} ${r.detail ?? ''}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return r;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2): Move => ({ type: 'fold', params: { line: { p, d }, seed, layers: 'all', direction: 'valley' } });

describe('pleat', () => {
  it('folds a strip under: three layers between the lines, the far part translated back', () => {
    const s = createSheet({ sizeMm: 150 });
    // Valley at x = 20, mountain at x = 40, seed at x = 60.
    const r = run(s, { type: 'pleat', params: { first: { p: [20, 0], d: [0, 1] }, second: { p: [40, 0], d: [0, 1] }, seed: [60, 0] } });
    expect(r.transition.kind).toBe('pleat');
    const v = flatView(r.state)!;
    const xs = v.faceIds.flatMap((f) => v.poly.get(f)!.map((p) => p[0]));
    // The sheet got 40 mm shorter: it now runs from -75 to 35.
    expect(Math.min(...xs)).toBeCloseTo(-75, 6);
    expect(Math.max(...xs)).toBeCloseTo(35, 6);
    const st = stackAt(r.state, [10, 0]);
    expect(st.ok && st.faces.length).toBe(3);
    expect(recognize(s, r.state).name).toBe('pleat');
  });
});

describe('crimp', () => {
  it('two reverse folds turn the tip of a closed flap and keep it closed', () => {
    const s = createSheet({ sizeMm: 100 });
    const tri = run(s, fold([0, 0], [1, 1], [25, -25])).state;
    // Across the flap near the top-right tip, the second line a little further out.
    const r = run(tri, {
      type: 'crimp',
      params: { first: { p: [15, 15], d: [1, 2] }, second: { p: [25, 25], d: [1, 2] }, seed: [40, 44], kind: 'inside' },
    });
    expect(r.transition.kind).toBe('crimp');
    expect(recognize(tri, r.state).name).toBe('inside-crimp');
  });

  // Lines leaning toward the tip allow only an inside crimp; leaning back over the flap, only
  // an outside one (the strip's folded edge would cut through the flap otherwise).
  const cases = {
    inside: { first: { p: [10, 10] as Vec2, d: [1, 3] as Vec2 }, second: { p: [20, 20] as Vec2, d: [1, 1.5] as Vec2 } },
    outside: { first: { p: [10, 10] as Vec2, d: [-0.866, 0.5] as Vec2 }, second: { p: [20, 20] as Vec2, d: [-0.94, 0.342] as Vec2 } },
  };
  const at = (p: Vec2, d: Vec2) => lineThrough(p, [p[0] + d[0], p[1] + d[1]]);

  for (const kind of ['inside', 'outside'] as const) {
    it(`${kind}: turns the tip over both lines and nests the parts`, () => {
      const s = createSheet({ sizeMm: 100 });
      const tri = run(s, fold([0, 0], [1, 1], [25, -25])).state;
      const { first, second } = cases[kind];
      const r = run(tri, { type: 'crimp', params: { first, second, seed: [40, 44], kind } });
      expect(recognize(tri, r.state).name).toBe(`${kind}-crimp`);
      // The tip turned over both lines (a rotation about where they meet), and its two sides
      // are each the way up they were.
      const tip = reflectPoint(at(first.p, first.d), reflectPoint(at(second.p, second.d), [50, 50]));
      const v = flatView(r.state)!;
      const far = r.transition.kind === 'crimp' ? r.transition.far : [];
      const mid = r.transition.kind === 'crimp' ? r.transition.middle : [];
      expect(far.length).toBe(2);
      expect(far.some((f) => v.poly.get(f)!.some((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 1e-6))).toBe(true);
      expect(far.map((f) => v.frontUp.get(f)).sort()).toEqual([false, true]);
      // Where all three parts overlap: inside, the strip is between the flap's near sides and
      // the far part between the strip's; outside, each wraps around the one before.
      let deepest: string[] = [];
      for (let x = -50; x <= 50; x += 2.5) {
        for (let y = -50; y <= 50; y += 2.5) {
          const st = stackAt(r.state, [x + 0.3, y + 0.7]);
          if (st.ok && st.faces.length > deepest.length) deepest = st.faces.map((f) => (far.includes(f) ? 'far' : mid.includes(f) ? 'mid' : 'near'));
        }
      }
      expect(deepest.join(' ')).toBe(kind === 'inside' ? 'near mid far far mid near' : 'far mid near near mid far');
      // The other kind doesn't fit these lines: refused, not made into something else.
      const other = applyMove(tri, { type: 'crimp', params: { first, second, seed: [40, 44], kind: kind === 'inside' ? 'outside' : 'inside' } });
      expect(other.ok).toBe(false);
    });
  }
});
