import { describe, expect, it } from 'vitest';
import { applyMove, checkInvariants, createSheet, flatView, type KernelState, lineThrough, type Move, recognize, reflectPoint, stackAt, type Vec2 } from '../src/index.ts';

const run = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type}: ${r.reason} ${r.detail ?? ''}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return r;
};

/** The incenter of a triangle. */
function incenter(A: Vec2, B: Vec2, C: Vec2): Vec2 {
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]);
  const b = Math.hypot(A[0] - C[0], A[1] - C[1]);
  const c = Math.hypot(A[0] - B[0], A[1] - B[1]);
  return [(a * A[0] + b * B[0] + c * C[0]) / (a + b + c), (a * A[1] + b * B[1] + c * C[1]) / (a + b + c)];
}

describe('rabbit ear', () => {
  it('on one layer: the sides fold in on the bisectors and the ear lies between them', () => {
    const s = createSheet({ sizeMm: 150 });
    // The triangle of the sheet past its diagonal: the tip at the corner (75, 75), the base on
    // the diagonal from (-75, 75) to (75, -75).
    const A: Vec2 = [-75, 75];
    const B: Vec2 = [75, -75];
    const C: Vec2 = [75, 75];
    const r = run(s, { type: 'rabbitEar', params: { tip: C, base: [A, B], seed: [60, 60] } });
    expect(r.transition.kind).toBe('rabbitEar');
    expect(recognize(s, r.state).name).toBe('rabbit-ear');
    const I = incenter(A, B, C);
    // The tip lands on the base, reflected over A's bisector, on the far side of the middle.
    const tip = reflectPoint(lineThrough(A, I), C);
    const v = flatView(r.state)!;
    expect(v.faceIds.some((f) => v.poly.get(f)!.some((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 1e-6))).toBe(true);
    // Beside the middle of the base, the sides and the ear lie over it.
    const st = stackAt(r.state, [I[0] - 2, I[1] - 6]);
    expect(st.ok && st.faces.length).toBeGreaterThanOrEqual(3);
    if (r.transition.kind !== 'rabbitEar') throw new Error('kind');
    // Top to bottom where the ear lies: side a, the ear, side b, the base.
    const D: Vec2 = [0, 0];
    const probe: Vec2 = [(D[0] + tip[0]) / 2 + (I[0] - D[0]) * 0.2, (D[1] + tip[1]) / 2 + (I[1] - D[1]) * 0.2];
    const at = stackAt(r.state, probe);
    if (!at.ok) throw new Error('no order');
    const tr = r.transition;
    const part = (f: number) => (tr.a.includes(f) ? 'a' : tr.ear.includes(f) ? 'ear' : tr.b.includes(f) ? 'b' : 'base');
    expect(at.faces.map(part).join(' ')).toBe('a ear b base');
  });

  it('on both layers of a folded triangle, to either side', () => {
    const s = createSheet({ sizeMm: 150 });
    const tri = run(s, { type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [40, -40], layers: 'all', direction: 'valley' } }).state;
    // The triangle (-75,-75), (75,75), (-75,75): the ear at its top-right corner, the base its
    // left edge.
    for (const side of ['a', 'b'] as const) {
      const r = run(tri, { type: 'rabbitEar', params: { tip: [75, 75], base: [[-75, 75], [-75, -75]], seed: [50, 60], layers: 'all', side } });
      expect(recognize(tri, r.state).name).toBe('rabbit-ear');
    }
  });
});
