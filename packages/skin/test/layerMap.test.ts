import { applyMove, applyPlaneIso, createSheet, type KernelState, type Move, planeIsoOf, snapshot, type Snapshot, type Vec2 } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { layerMapData } from '../src/index.ts';

const must = (s: KernelState, m: Move) => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`${m.type} refused: ${r.reason}`);
  return r.state;
};
const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({ type: 'fold', params: { line: { p, d }, seed, layers, direction: 'valley' } });
const reverse = (p: Vec2, q: Vec2, corner: Vec2, kind: 'inside' | 'outside'): Move => ({
  type: 'reverseFold',
  params: { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, seed: [(p[0] + q[0] + corner[0]) / 3, (p[1] + q[1] + corner[1]) / 3], kind },
});

const inside = (poly: readonly Vec2[], p: Vec2) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const centroid = (poly: readonly Vec2[]): Vec2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

/** At each face's middle, the map's layers below + above + 1 equals the faces stacked there. */
function countsAgree(snap: Snapshot) {
  const data = layerMapData(snap);
  const world = snap.faces.map((f) => f.material.map((p) => applyPlaneIso(planeIsoOf(f.placement), p)));
  for (const [i, f] of snap.faces.entries()) {
    const m = data.faces[i]!;
    // Just off the middle, so the point never sits exactly on another layer's edge.
    const c = centroid(f.material);
    const q: Vec2 = [c[0] + 0.31, c[1] + 0.17];
    expect(inside(f.material, q)).toBe(true);
    const uv: Vec2 = [q[0] / snap.sizeMm, q[1] / snap.sizeMm];
    const fromMap = 1 + m.below.filter((p) => inside(p, uv)).length + m.above.filter((p) => inside(p, uv)).length;
    const at = applyPlaneIso(planeIsoOf(f.placement), q);
    const stacked = world.filter((w) => inside(w, at)).length;
    expect(fromMap).toBe(stacked);
  }
}

const sheet = createSheet({ sizeMm: 150 });
const triangle = must(sheet, fold([0, 0], [1, 1], [40, -40]));
const blintz = [
  fold([37.5, -37.5], [1, 1], [70, -70], 1),
  fold([37.5, 37.5], [1, -1], [70, 70], 1),
  fold([-37.5, 37.5], [1, 1], [-70, 70], 1),
  fold([-37.5, -37.5], [1, -1], [-70, -70], 1),
].reduce(must, sheet);
// A strip folded up, then the top folded down over it: the strip's edge lies hidden mid-flap.
const tucked = must(must(sheet, fold([0, -25], [1, 0], [0, -60])), fold([0, 37.5], [1, 0], [0, 60]));
const small = createSheet({ sizeMm: 100 });
const tri100 = must(small, fold([0, 0], [1, 1], [25, -25]));
const insideRev = must(tri100, reverse([20, 20], [35, 50], [50, 50], 'inside'));
const outsideRev = must(tri100, reverse([-20, -20], [-50, 22.8], [-50, -50], 'outside'));

describe('layer map', () => {
  it('a diagonal fold: the top layer has one below, the bottom one above, both share the folded edge', () => {
    const snap = snapshot(triangle);
    const data = layerMapData(snap);
    expect(data.faces).toHaveLength(2);
    const counts = data.faces.map((f) => [f.below.length, f.above.length].join('/')).sort();
    expect(counts).toEqual(['0/1', '1/0']);
    for (const f of data.faces) {
      expect(f.folded).toHaveLength(1);
      expect(f.raw).toHaveLength(2);
    }
  });

  it('a blintz: the middle has four flaps on it, each flap one layer under it', () => {
    const data = layerMapData(snapshot(blintz));
    const middle = data.faces.find((f) => f.above.length === 4);
    expect(middle).toBeDefined();
    expect(data.faces.filter((f) => f.below.length === 1 && f.above.length === 0)).toHaveLength(4);
  });

  it('a hidden edge: the top flap sees the strip underneath (its ridge)', () => {
    const snap = snapshot(tucked);
    const data = layerMapData(snap);
    // Some face has two layers under part of it: the base and the hidden strip.
    expect(Math.max(...data.faces.map((f) => f.below.length))).toBe(2);
  });

  for (const [name, state] of [
    ['diagonal', triangle],
    ['blintz', blintz],
    ['tucked strip', tucked],
    ['inside reverse fold', insideRev],
    ['outside reverse fold', outsideRev],
  ] as const) {
    it(`counts match the stack everywhere: ${name}`, () => countsAgree(snapshot(state)));
  }

  it('is computed once per state', () => {
    const snap = snapshot(blintz);
    expect(layerMapData(snap)).toBe(layerMapData(snap));
  });
});
