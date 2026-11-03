import { centroid, signedArea } from '../geometry/polygon.ts';
import { applyMaterial, compose, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, getVertex, materialPolygon } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { orderOf } from './order.ts';
import type { KernelState } from './types.ts';

export type Equivalence = { readonly same: true } | { readonly same: false; readonly why: string };

/**
 * Are two states the same folded paper? Same faces (matched by where they are in the
 * sheet, not by id), each placed the same way, the same folded creases with the same
 * angles, and the same layer order. Crease memory (sharpness, rest angles, unfolded creases)
 * and ids don't count: two ways of making the same fold compare equal.
 *
 * Used to check that build steps replay to the design, that a precrease-then-push reverse
 * fold equals the direct one, and (Phase 2) follow-along.
 */
export interface EquivalenceOptions {
  readonly tolMm?: number;
  /** Ignore where the whole model sits on the table (a common rigid motion). */
  readonly upToRigidMotion?: boolean;
}

export function sameFoldedState(a: KernelState, b: KernelState, options: EquivalenceOptions = {}): Equivalence {
  const tolMm = options.tolMm ?? 1e-4;
  const keyOf = (s: KernelState, f: FaceId) => {
    const poly = materialPolygon(s.cp, f);
    return { c: centroid(poly), area: signedArea(poly) };
  };
  const facesA = [...a.cp.faces.keys()];
  const facesB = [...b.cp.faces.keys()];
  if (facesA.length !== facesB.length) return { same: false, why: `${facesA.length} faces vs ${facesB.length}` };
  const match = new Map<FaceId, FaceId>();
  const keysB = facesB.map((f) => ({ f, ...keyOf(b, f) }));
  for (const fa of facesA) {
    const ka = keyOf(a, fa);
    const hit = keysB.find(
      (k) => Math.hypot(k.c[0] - ka.c[0], k.c[1] - ka.c[1]) <= tolMm && Math.abs(k.area - ka.area) <= tolMm * 100,
    );
    if (!hit) return { same: false, why: `No face like ${fa} at ${ka.c.map((x) => x.toFixed(3)).join(',')}` };
    match.set(fa, hit.f);
  }
  // Placements: the face's material vertices land at the same world points (optionally
  // after moving all of `a` rigidly so its first face lines up).
  let shift: Rigid3 | null = null;
  if (options.upToRigidMotion) {
    const [fa0, fb0] = [...match.entries()][0]!;
    shift = compose(b.folded.placements.get(fb0)!, invertRigid(a.folded.placements.get(fa0)!));
  }
  for (const [fa, fb] of match) {
    for (const p of materialPolygon(a.cp, fa)) {
      const ta = shift ? compose(shift, a.folded.placements.get(fa)!) : a.folded.placements.get(fa)!;
      const pa = applyMaterial(ta, p);
      const pb = applyMaterial(b.folded.placements.get(fb)!, p);
      if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) > tolMm) {
        return { same: false, why: `Face ${fa} sits somewhere else` };
      }
    }
  }
  // Folded creases: every sample point of a folded crease in one is on a crease with the
  // same angle in the other (subdivisions may differ).
  const folded = (s: KernelState) => {
    const adj = adjacency(s.cp);
    return [...s.cp.creases.values()]
      .filter((c) => c.angleDeg !== 0 && adj.edgeFaces.get(c.id)!.right !== null && adj.edgeFaces.get(c.id)!.left !== null)
      .map((c) => ({ a: getVertex(s.cp, c.v[0]), b: getVertex(s.cp, c.v[1]), angle: c.angleDeg }));
  };
  const covered = (p: Vec2, angle: number, list: ReturnType<typeof folded>) =>
    list.some((c) => {
      if (c.angle !== angle) return false;
      const dx = c.b[0] - c.a[0];
      const dy = c.b[1] - c.a[1];
      const l2 = dx * dx + dy * dy;
      const t = ((p[0] - c.a[0]) * dx + (p[1] - c.a[1]) * dy) / l2;
      if (t < -1e-9 || t > 1 + 1e-9) return false;
      return Math.abs((p[0] - c.a[0]) * dy - (p[1] - c.a[1]) * dx) / Math.sqrt(l2) <= tolMm;
    });
  const fa = folded(a);
  const fb = folded(b);
  for (const [x, y, name] of [
    [fa, fb, 'first'],
    [fb, fa, 'second'],
  ] as const) {
    for (const c of x) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t];
        if (!covered(p, c.angle, y)) return { same: false, why: `A ${c.angle}° crease of the ${name} state is missing` };
      }
    }
  }
  // Layer order of matched pairs. A turn-over flips every relation; up to rigid motion,
  // compare in the frame where the model faces the same way.
  const flip = shift !== null && shift.r[4] < 0 ? -1 : 1;
  if (a.folded.layerOrder.size !== b.folded.layerOrder.size) {
    return { same: false, why: `${a.folded.layerOrder.size} layer relations vs ${b.folded.layerOrder.size}` };
  }
  const ids = [...match.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const oa = orderOf(a.folded.layerOrder, ids[i]!, ids[j]!);
      const ob = orderOf(b.folded.layerOrder, match.get(ids[i]!)!, match.get(ids[j]!)!);
      if (oa !== undefined && ob !== undefined ? oa * flip !== ob : oa !== ob) return { same: false, why: `Faces ${ids[i]} and ${ids[j]} stack differently` };
    }
  }
  return { same: true };
}

/** Inverse of a rigid transform. */
export function invertRigid(a: Rigid3): Rigid3 {
  const r = a.r;
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]] as const;
  return {
    r: rt,
    t: [
      -(rt[0] * a.t[0] + rt[1] * a.t[1] + rt[2] * a.t[2]),
      -(rt[3] * a.t[0] + rt[4] * a.t[1] + rt[5] * a.t[2]),
      -(rt[6] * a.t[0] + rt[7] * a.t[1] + rt[8] * a.t[2]),
    ],
  };
}
