import { type Line2, signedDistance } from '../geometry/line.ts';
import { compose, planeDirToWorld, planeToWorld, type Rigid3, rotationAbout } from '../geometry/rigid.ts';
import type { Vec2, Vec3 } from '../geometry/vec.ts';
import { adjacency, getVertex, materialPolygon } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { flatView } from './flat.ts';
import { orderOf } from './order.ts';
import type { FlapPose, KernelState } from './types.ts';

/**
 * Partial angles (Phase 2, "partial-angle hinge moves"): a flap left standing open.
 *
 * The kernel's state stays flat: it is the paper as it lies with every fold made, and a pose
 * says that one free flap of it stands open by some angle about its hinge, turned up toward
 * the viewer. A flap can stand open only if it is free: on top of everything it overlaps, and
 * joined to the rest only along the hinge (so it turns rigidly). Open flaps must not run into
 * each other, where they stand or on the way there.
 *
 * APPROXIMATION: the paper's thickness is ignored when open flaps are checked against each
 * other (they are thin plates), and the way there is checked every 10°, not as a swept volume.
 * Moves that could disturb an open flap are refused rather than worked out (lay it down first).
 */

const UP: Vec3 = [0, 1, 0];

/** The rotation that stands a pose's flap open (world, applied after its flat placement). */
export function poseRotation(pose: Pick<FlapPose, 'hinge' | 'openDeg'>, openDeg = pose.openDeg, height = 0): Rigid3 {
  const o = planeToWorld(pose.hinge.p, height);
  const d = planeDirToWorld(pose.hinge.d);
  const from = planeDirToWorld([-pose.hinge.d[1], pose.hinge.d[0]]);
  const c: Vec3 = [d[1] * from[2] - d[2] * from[1], d[2] * from[0] - d[0] * from[2], d[0] * from[1] - d[1] * from[0]];
  const sgn = c[0] * UP[0] + c[1] * UP[1] + c[2] * UP[2] >= 0 ? 1 : -1;
  return rotationAbout(o, d, (sgn * openDeg * Math.PI) / 180);
}

/** Every face's world placement with open flaps standing open. */
export function posedPlacements(state: KernelState): Map<FaceId, Rigid3> {
  const out = new Map(state.folded.placements);
  for (const p of state.poses ?? []) {
    const r = poseRotation(p);
    for (const f of p.faces) {
      const pl = out.get(f);
      if (pl) out.set(f, compose(r, pl));
    }
  }
  return out;
}

const apply = (t: Rigid3, p: Vec3): Vec3 => [
  t.r[0] * p[0] + t.r[1] * p[1] + t.r[2] * p[2] + t.t[0],
  t.r[3] * p[0] + t.r[4] * p[1] + t.r[5] * p[2] + t.t[1],
  t.r[6] * p[0] + t.r[7] * p[1] + t.r[8] * p[2] + t.t[2],
];

/** A face's outline in world, pulled in a little (so faces that only touch don't collide). */
function faceIn3D(state: KernelState, f: FaceId, placement: Rigid3, inset = 0.3): Vec3[] {
  const poly = materialPolygon(state.cp, f);
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map((p) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, l - inset) / l;
    return apply(placement, [cx + dx * k, cy + dy * k, 0]);
  });
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Does the segment p→q cross triangle abc (strictly)? */
function segHitsTri(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const n = cross(sub(b, a), sub(c, a));
  const dp = dot(n, sub(p, a));
  const dq = dot(n, sub(q, a));
  if ((dp > 0 && dq > 0) || (dp < 0 && dq < 0) || dp === dq) return false;
  const t = dp / (dp - dq);
  const x: Vec3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const s1 = dot(n, cross(sub(b, a), sub(x, a)));
  const s2 = dot(n, cross(sub(c, b), sub(x, b)));
  const s3 = dot(n, cross(sub(a, c), sub(x, c)));
  return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0);
}

/** Do two convex 3D polygons cross each other? */
export function polygonsCross(A: readonly Vec3[], B: readonly Vec3[]): boolean {
  const tris = (P: readonly Vec3[]) => P.slice(1, -1).map((_, i) => [P[0]!, P[i + 1]!, P[i + 2]!] as const);
  const ta = tris(A);
  const tb = tris(B);
  for (const [a, b, c] of tb) {
    for (let i = 0; i < A.length; i++) if (segHitsTri(A[i]!, A[(i + 1) % A.length]!, a, b, c)) return true;
  }
  for (const [a, b, c] of ta) {
    for (let i = 0; i < B.length; i++) if (segHitsTri(B[i]!, B[(i + 1) % B.length]!, a, b, c)) return true;
  }
  return false;
}

/** What's wrong with a state's open flaps, if anything (empty: fine). */
export function poseProblems(state: KernelState): Array<{ faces: FaceId[]; message: string }> {
  const poses = state.poses ?? [];
  if (poses.length === 0) return [];
  const out: Array<{ faces: FaceId[]; message: string }> = [];
  const view = flatView(state);
  if (!view) return [{ faces: [], message: 'Open flaps need a flat model under them' }];
  const adj = adjacency(state.cp);
  const tol = state.tol.len * 10;
  const posed = new Map<FaceId, number>();
  poses.forEach((p, i) => p.faces.forEach((f) => posed.set(f, i)));
  for (const [i, p] of poses.entries()) {
    if (!(p.openDeg > 0 && p.openDeg < 180)) out.push({ faces: [...p.faces], message: 'An open flap stands between 0° and 180°' });
    const own = new Set(p.faces);
    const gone = p.faces.filter((f) => !state.cp.faces.has(f));
    if (gone.length > 0) {
      out.push({ faces: gone, message: 'An open flap has a face that no longer exists' });
      continue;
    }
    // Joined to the rest only along the hinge.
    for (const c of state.cp.creases.values()) {
      const ef = adj.edgeFaces.get(c.id)!;
      if (ef.left === null || ef.right === null) continue;
      if (own.has(ef.left) === own.has(ef.right)) continue;
      const a = view.vertexWorld.get(c.v[0])!;
      const b = view.vertexWorld.get(c.v[1])!;
      if (Math.abs(signedDistance(p.hinge, a)) > tol || Math.abs(signedDistance(p.hinge, b)) > tol) {
        out.push({ faces: [ef.left, ef.right], message: 'An open flap is joined to the paper away from its hinge' });
      }
    }
    // Free: on top of everything it overlaps that isn't part of it.
    for (const f of p.faces) {
      for (const g of state.cp.faces.keys()) {
        if (own.has(g)) continue;
        const o = orderOf(state.folded.layerOrder, f, g);
        if (o === -1 && posed.get(g) !== i) out.push({ faces: [f, g], message: 'Something lies on an open flap' });
      }
    }
  }
  if (out.length > 0) return out;
  // Open flaps don't run into each other where they stand.
  const placed = posedPlacements(state);
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const hit = flapsCross(state, poses[i]!.faces, poses[j]!.faces, placed, placed);
      if (hit) out.push({ faces: hit, message: 'Two open flaps run into each other' });
    }
  }
  return out;
}

/** The first pair of faces (one from each set) that cross, under the given placements. */
export function flapsCross(
  state: KernelState,
  a: readonly FaceId[],
  b: readonly FaceId[],
  pa: ReadonlyMap<FaceId, Rigid3>,
  pb: ReadonlyMap<FaceId, Rigid3>,
): FaceId[] | null {
  const near = (f: FaceId, g: FaceId) => {
    // Faces that share a vertex are allowed to touch there.
    const vf = new Set(state.cp.faces.get(f)!.verts);
    return state.cp.faces.get(g)!.verts.some((v) => vf.has(v));
  };
  for (const f of a) {
    const A = faceIn3D(state, f, pa.get(f)!);
    for (const g of b) {
      if (f === g || near(f, g)) continue;
      if (polygonsCross(A, faceIn3D(state, g, pb.get(g)!))) return [f, g];
    }
  }
  return null;
}

/** A pose's hinge after the whole model turns about `center` by `degrees` in the table plane. */
export function rotatePose(p: FlapPose, center: Vec2, degrees: number): FlapPose {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const q = [p.hinge.p[0] - center[0], p.hinge.p[1] - center[1]];
  const hp: Vec2 = [center[0] + c * q[0]! - s * q[1]!, center[1] + s * q[0]! + c * q[1]!];
  const hd: Vec2 = [c * p.hinge.d[0] - s * p.hinge.d[1], s * p.hinge.d[0] + c * p.hinge.d[1]];
  return { ...p, hinge: { p: hp, d: hd } as Line2 };
}

/** Vertices for a face's world outline under a placement (for callers that sweep). */
export function vertexWorld(state: KernelState, f: FaceId, placement: Rigid3): Vec3[] {
  return state.cp.faces.get(f)!.verts.map((v) => {
    const m = getVertex(state.cp, v);
    return apply(placement, [m[0], m[1], 0]);
  });
}
