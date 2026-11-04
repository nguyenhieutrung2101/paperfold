import { describe, expect, it } from 'vitest';
import { applyMove, checkInvariants, createSheet, type KernelState, type Move, posedPlacements, type Vec2 } from '../src/index.ts';

const run = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type}: ${r.reason} ${r.detail ?? ''}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return r;
};
const corner = (p: Vec2, d: Vec2, seed: Vec2, angleDeg?: number): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers: 1, direction: 'valley', ...(angleDeg !== undefined ? { angleDeg } : {}) },
});

/** Where a material point of the sheet is in the world, with open flaps standing open. */
function worldOf(s: KernelState, m: Vec2): [number, number, number] {
  const placed = posedPlacements(s);
  for (const [f, face] of s.cp.faces) {
    const poly = face.verts.map((v) => s.cp.vertices.get(v)!);
    const inside = poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      return (b[0] - a[0]) * (m[1] - a[1]) - (b[1] - a[1]) * (m[0] - a[0]) >= -1e-9;
    });
    if (!inside) continue;
    const t = placed.get(f)!;
    return [t.r[0] * m[0] + t.r[1] * m[1] + t.t[0], t.r[3] * m[0] + t.r[4] * m[1] + t.t[1], t.r[6] * m[0] + t.r[7] * m[1] + t.t[2]];
  }
  throw new Error('not on the paper');
}

describe('partial angles: a flap left standing open', () => {
  // The sheet's material runs 0..150; world x = m - 75, table y = m - 75.
  it('a corner folded to 90° stands straight up over its fold line', () => {
    const s = createSheet({ sizeMm: 150 });
    // Fold the top-right corner along x + y = 100 (table plane), stopping at 90°.
    const r = run(s, corner([50, 50], [1, -1], [70, 70], 90));
    expect(r.transition.kind === 'fold' && r.transition.toDeg).toBe(90);
    expect(r.state.poses).toHaveLength(1);
    // The corner (material 150, 150) was at table (75, 75): it now stands above the line, at
    // its distance from it (25/√2·2 = 35.36 mm) straight up.
    const w = worldOf(r.state, [150, 150]);
    expect(w[1]).toBeCloseTo(Math.hypot(25, 25), 6);
    expect(w[0]).toBeCloseTo(50, 6);
    expect(-w[2]).toBeCloseTo(50, 6);
  });

  it('two flaps stand open side by side; a third that would hit one is refused', () => {
    const s = createSheet({ sizeMm: 150 });
    const a = run(s, corner([50, 50], [1, -1], [70, 70], 90)).state;
    const b = run(a, corner([-50, -50], [1, -1], [-70, -70], 120)).state;
    expect(b.poses).toHaveLength(2);
    // Folding the top half down over the middle line would sweep through the standing corner.
    const half = applyMove(b, { type: 'fold', params: { line: { p: [0, 30], d: [1, 0] }, seed: [-60, 60], layers: 1, direction: 'valley' } });
    expect(half.ok).toBe(false);
  });

  it('a fold whose paper would swing through a standing flap is blocked', () => {
    const s = createSheet({ sizeMm: 150 });
    const a = run(s, corner([50, 50], [1, -1], [70, 70], 90)).state;
    // The lower-left half over the diagonal: on its way over it passes where the corner stands.
    const r = applyMove(a, { type: 'fold', params: { line: { p: [0, 0], d: [1, -1] }, seed: [-60, -60], layers: 1, direction: 'valley' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('blocked');
    // A small corner fold far from it is fine.
    run(a, corner([-60, -60], [1, -1], [-70, -70]));
  });

  it('moves that would disturb an open flap are refused; turning the model takes it along', () => {
    const s = createSheet({ sizeMm: 150 });
    const a = run(s, corner([50, 50], [1, -1], [70, 70], 60)).state;
    const turn = applyMove(a, { type: 'turnOver', params: { axis: 'side' } });
    expect(turn.ok).toBe(false);
    if (!turn.ok) expect(turn.reason).toBe('posed');
    const before = worldOf(a, [150, 150]);
    const r = run(a, { type: 'rotate', params: { degrees: 90 } });
    const after = worldOf(r.state, [150, 150]);
    // Same height; turned a quarter about the middle in the table plane.
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(after[0]).toBeCloseTo(before[2], 6);
    expect(after[2]).toBeCloseTo(-before[0], 6);
  });

  it('a flap with something on it can\'t stand open; mountain folds can\'t stop partway', () => {
    const s = createSheet({ sizeMm: 150 });
    const half = run(s, { type: 'fold', params: { line: { p: [0, 0], d: [0, 1] }, seed: [50, 0], layers: 'all', direction: 'valley' } }).state;
    // The bottom layer's corner, with the top layer lying on it.
    const under = applyMove(half, { type: 'fold', params: { line: { p: [-50, 50], d: [1, 1] }, seed: [-70, 70], layers: 'all', direction: 'mountain', angleDeg: 90 } });
    expect(under.ok).toBe(false);
  });
});

describe('a standing flap in a FOLD file', () => {
  it('round-trips exactly, and the folded frame has the flap standing', async () => {
    const { toFold, fromFold, stateHash } = await import('../src/index.ts');
    const s = createSheet({ sizeMm: 150 });
    const a = run(s, corner([50, 50], [1, -1], [70, 70], 90)).state;
    const file = toFold(a);
    const back = fromFold(JSON.parse(JSON.stringify(file)));
    expect(back.ok).toBe(true);
    if (back.ok) expect(stateHash(back.state)).toBe(stateHash(a));
    const frame = file.file_frames[0]!;
    // The hinge is folded 90°, and the corner is 35 mm up.
    expect(frame.edges_foldAngle!.some((x) => Math.abs(Math.abs(x) - 90) < 1e-9)).toBe(true);
    expect(Math.max(...frame.vertices_coords.map((v) => v[1]!))).toBeCloseTo(Math.hypot(25, 25), 6);
  });
});
