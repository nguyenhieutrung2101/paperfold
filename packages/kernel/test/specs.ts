import fc from 'fast-check';
import { flatView, perpendicularBisector, side, type KernelState, type Move, type Vec2 } from '../src/index.ts';

/**
 * A move described by unit-interval numbers, interpreted against whatever state it is
 * applied to. Line modes deliberately produce degenerate input: lines through existing
 * vertices, along existing creases, and corner-to-corner bisectors.
 */
export interface MoveSpec {
  readonly kind: 'fold' | 'turnOver' | 'rotate' | 'burnish';
  readonly lineMode: 0 | 1 | 2 | 3;
  readonly a: number;
  readonly b: number;
  readonly angle: number;
  readonly i: number;
  readonly j: number;
  readonly face: number;
  readonly w: readonly [number, number, number];
  readonly layers: 1 | 2 | 3 | 'all';
  readonly valley: boolean;
}

export const specArb: fc.Arbitrary<MoveSpec> = fc.record({
  kind: fc.constantFrom('fold', 'fold', 'fold', 'fold', 'fold', 'fold', 'turnOver', 'rotate', 'burnish'),
  lineMode: fc.constantFrom(0, 0, 1, 2, 3, 3),
  a: fc.double({ min: 0, max: 1, noNaN: true }),
  b: fc.double({ min: 0, max: 1, noNaN: true }),
  angle: fc.double({ min: 0, max: 1, noNaN: true }),
  i: fc.nat(),
  j: fc.nat(),
  face: fc.nat(),
  w: fc.tuple(
    fc.double({ min: 0.05, max: 1, noNaN: true }),
    fc.double({ min: 0.05, max: 1, noNaN: true }),
    fc.double({ min: 0.05, max: 1, noNaN: true }),
  ),
  layers: fc.constantFrom(1, 2, 3, 'all'),
  valley: fc.boolean(),
}) as fc.Arbitrary<MoveSpec>;

/** Turn a spec into a concrete move for this state, or null if it doesn't make one. */
export function toMove(state: KernelState, spec: MoveSpec): Move | null {
  const view = flatView(state);
  if (!view) return null;
  if (spec.kind === 'turnOver') return { type: 'turnOver', params: { axis: spec.valley ? 'side' : 'top' } };
  if (spec.kind === 'rotate') return { type: 'rotate', params: { degrees: spec.valley ? 45 : -90 } };

  const verts = [...view.vertexWorld.values()];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of view.box.values()) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const vi = verts[spec.i % verts.length]!;
  const vj = verts[spec.j % verts.length]!;
  let p: Vec2;
  let d: Vec2;
  switch (spec.lineMode) {
    case 0: // anywhere, any angle
      p = [minX + spec.a * (maxX - minX), minY + spec.b * (maxY - minY)];
      d = [Math.cos(spec.angle * Math.PI), Math.sin(spec.angle * Math.PI)];
      break;
    case 1: // through two existing vertices (often along an existing crease)
      if (Math.hypot(vj[0] - vi[0], vj[1] - vi[1]) < 1e-3) return null;
      p = vi;
      d = [vj[0] - vi[0], vj[1] - vi[1]];
      break;
    case 2: // through a vertex at a multiple of 22.5°
      p = vi;
      d = [Math.cos(Math.round(spec.angle * 8) * (Math.PI / 8)), Math.sin(Math.round(spec.angle * 8) * (Math.PI / 8))];
      break;
    default: {
      // point to point: vertex onto vertex
      if (Math.hypot(vj[0] - vi[0], vj[1] - vi[1]) < 1e-3) return null;
      const l = perpendicularBisector(vi, vj);
      p = l.p;
      d = l.d;
    }
  }
  const l = { p, d: ((): Vec2 => { const n = Math.hypot(d[0], d[1]); return [d[0] / n, d[1] / n]; })() };
  if (spec.kind === 'burnish') {
    return { type: 'burnish', params: { line: l, from: -spec.a * 100, to: spec.b * 100, amount: spec.angle } };
  }
  // Only folds whose line actually crosses the model (lines along its outside are turn-overs).
  let pos = false;
  let neg = false;
  for (const q of verts) {
    const sd = side(l, q, state.tol);
    pos ||= sd > 0;
    neg ||= sd < 0;
  }
  if (!pos || !neg) return null;
  // Seed: a point inside a face, by positive barycentric weights.
  const ids = view.faceIds;
  const poly = view.poly.get(ids[spec.face % ids.length]!)!;
  const w = [spec.w[0], spec.w[1], spec.w[2]];
  let sx = 0;
  let sy = 0;
  let sw = 0;
  poly.forEach((q, k) => {
    const wk = w[k % 3]! + 0.01 * k;
    sx += q[0] * wk;
    sy += q[1] * wk;
    sw += wk;
  });
  const seed: Vec2 = [sx / sw, sy / sw];
  if (side({ p: l.p, d: l.d }, seed, state.tol) === 0) return null;
  return {
    type: 'fold',
    params: { line: l, seed, layers: spec.layers, direction: spec.valley || spec.a < 0.7 ? 'valley' : 'mountain' },
  };
}

