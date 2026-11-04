import {
  applyPlaneIso,
  compose,
  type FaceId,
  IDENTITY,
  planeIsoOf,
  type Rigid3,
  rotationAbout,
  type Snapshot,
  type Vec2,
  type Vec3,
} from '@paperfold/kernel';

/**
 * Relaxed folds (Phase 1 polish): paper you haven't pressed flat. Every flap with nothing lying
 * on it springs a little open about its fold, the way a real model sits on the table, so you can
 * see its layers and folds. Flaps on flaps open on top of their parent's opening.
 *
 * A flap here is the paper beyond one folded edge that would lift if you opened that edge: the
 * upper face at the edge and everything joined to it without crossing the edge's line. It opens
 * only if it's joined to the rest along that line alone and nothing else lies on top of it, so
 * the motion is a rigid turn up into empty space: it can't tear or pass through paper.
 * APPROXIMATION: real flaps also curl; how far each opens is a look, not a measured spring
 * (ADR-015 placeholders).
 */
export interface RelaxPlan {
  readonly flaps: ReadonlyArray<{ readonly faces: ReadonlySet<FaceId>; readonly angle: number; readonly rest: number }>;
  /**
   * World motion of a face (applied to its 3D position, height included). `amount` 0..1 blends
   * from the resting spring (each crease's own rest angle, when `rest` is on) to fully relaxed.
   * Flaps containing any face in `skip` stay put (a fold in motion owns those).
   */
  transformOf(face: FaceId, amount: number, rest?: boolean, skip?: ReadonlySet<FaceId>): Rigid3;
}

/** Relaxed: the far end of a flap rises at most this much, and nothing opens wider than this. */
const MAX_LIFT_MM = 22;
const MAX_ANGLE = (18 * Math.PI) / 180;
/** Resting: a flap's own weight keeps its far end within this of the layer below. */
const REST_LIFT_MM = 3;

interface Flap {
  readonly faces: Set<FaceId>;
  readonly axisP: Vec3;
  readonly axisD: Vec3;
  /** Signed: the sign turns the flap up. */
  readonly angle: number;
  readonly rest: number;
}

const cache = new WeakMap<Snapshot, Map<number, RelaxPlan>>();

export function planRelax(snap: Snapshot, heights: ReadonlyMap<FaceId, number>, gapMm: number): RelaxPlan {
  let byGap = cache.get(snap);
  if (!byGap) cache.set(snap, (byGap = new Map()));
  const hit = byGap.get(gapMm);
  if (hit) return hit;
  const plan = build(snap, heights);
  byGap.set(gapMm, plan);
  return plan;
}

function build(snap: Snapshot, heights: ReadonlyMap<FaceId, number>): RelaxPlan {
  const size = Math.max(1, snap.sizeMm);
  const tol = 1e-6 * size;
  const above = new Map<string, boolean>();
  for (const [f, g, s] of snap.layerOrder) {
    above.set(`${f},${g}`, s === 1);
    above.set(`${g},${f}`, s !== 1);
  }
  const isAbove = (f: FaceId, g: FaceId) => above.get(`${f},${g}`) === true;

  // World segments of every interior crease, and which ones are folded.
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  interface Edge {
    readonly a: Vec2;
    readonly b: Vec2;
    readonly left: FaceId;
    readonly right: FaceId;
    readonly folded: boolean;
    /** How far the crease springs open from flat when nothing holds it (radians). */
    readonly spring: number;
  }
  const edges: Edge[] = [];
  for (const c of snap.creases) {
    if (c.left === null || c.right === null) continue;
    const iso = planeIsoOf(byId.get(c.left)!.placement);
    const spring = Math.abs(c.angleDeg) === 180 ? Math.max(0, ((180 - Math.abs(c.restAngleDeg)) * Math.PI) / 180) : 0;
    edges.push({ a: applyPlaneIso(iso, c.a), b: applyPlaneIso(iso, c.b), left: c.left, right: c.right, folded: Math.abs(c.angleDeg) === 180, spring });
  }
  const nbr = new Map<FaceId, Array<{ g: FaceId; e: Edge }>>();
  for (const e of edges) {
    for (const [f, g] of [[e.left, e.right], [e.right, e.left]] as const) {
      let list = nbr.get(f);
      if (!list) nbr.set(f, (list = []));
      list.push({ g, e });
    }
  }
  const onLine = (e: Edge, a: Vec2, d: Vec2) => {
    const off = (p: Vec2) => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]);
    return off(e.a) <= tol && off(e.b) <= tol;
  };
  const worldVerts = (f: FaceId): Vec2[] => {
    const face = byId.get(f)!;
    const iso = planeIsoOf(face.placement);
    return face.material.map((p) => applyPlaneIso(iso, p));
  };

  const flaps: Flap[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!e.folded) continue;
    const upper = isAbove(e.left, e.right) ? e.left : e.right;
    const lower = upper === e.left ? e.right : e.left;
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    if (len < 1e-6) continue;
    const d: Vec2 = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len];
    // The flap: the upper face and everything joined to it, not across this line.
    const group = new Set<FaceId>([upper]);
    const queue = [upper];
    let joined = false;
    while (queue.length > 0 && !joined) {
      const f = queue.pop()!;
      for (const { g, e: x } of nbr.get(f) ?? []) {
        if (group.has(g) || onLine(x, e.a, d)) continue;
        if (g === lower) {
          joined = true;
          break;
        }
        group.add(g);
        queue.push(g);
      }
    }
    if (joined) continue;
    // Joined to the rest along this line only? (No crease from the group to the outside off it.)
    let separable = true;
    for (const f of group) {
      for (const { g, e: x } of nbr.get(f) ?? []) if (!group.has(g) && !onLine(x, e.a, d)) separable = false;
    }
    if (!separable) continue;
    const key = [...group].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    // Free: nothing outside the flap lies on top of it.
    let free = true;
    for (const [f, g, s] of snap.layerOrder) {
      const fi = group.has(f);
      const gi = group.has(g);
      if (fi === gi) continue;
      const top = s === 1 ? f : g;
      if (!group.has(top)) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    // How far it opens: a little, less for long flaps (their weight holds them down).
    let reach = 0;
    for (const f of group) {
      for (const p of worldVerts(f)) reach = Math.max(reach, Math.abs((p[0] - e.a[0]) * d[1] - (p[1] - e.a[1]) * d[0]));
    }
    if (reach < 1e-3) continue;
    const angle = Math.min(MAX_ANGLE, Math.asin(Math.min(1, MAX_LIFT_MM / reach)));
    const rest = Math.min(e.spring, Math.asin(Math.min(1, REST_LIFT_MM / reach)));
    // The hinge: the fold line, midway between the two layers it joins.
    const h = ((heights.get(upper) ?? 0) + (heights.get(lower) ?? 0)) / 2;
    const axisP: Vec3 = [e.a[0], h, -e.a[1]];
    const axisD: Vec3 = [d[0], 0, -d[1]];
    // Turn the way that lifts the flap.
    const probe = worldVerts(upper).reduce((best, p) => {
      const o = Math.abs((p[0] - e.a[0]) * d[1] - (p[1] - e.a[1]) * d[0]);
      return o > best.o ? { p, o } : best;
    }, { p: e.a as Vec2, o: -1 }).p;
    const r = rotationAbout(axisP, axisD, 0.3);
    const lifted = r.r[3] * probe[0] + r.r[4] * h + r.r[5] * -probe[1] + r.t[1];
    const sgn = lifted >= h ? 1 : -1;
    flaps.push({ faces: group, axisP, axisD, angle: sgn * angle, rest: sgn * rest });
  }

  // Keep a nested family (each flap inside another or apart from it): larger first.
  flaps.sort((a, b) => b.faces.size - a.faces.size);
  const kept: Flap[] = [];
  for (const f of flaps) {
    const ok = kept.every((k) => [...f.faces].every((x) => k.faces.has(x)) || [...f.faces].every((x) => !k.faces.has(x)));
    if (ok) kept.push(f);
  }

  const transformOf = (face: FaceId, amount: number, rest = false, skip?: ReadonlySet<FaceId>): Rigid3 => {
    if (amount <= 0 && !rest) return IDENTITY;
    // Inner flaps first (they turn about their own hinge), then the flaps they ride on.
    let t: Rigid3 = IDENTITY;
    for (let i = kept.length - 1; i >= 0; i--) {
      const f = kept[i]!;
      if (!f.faces.has(face)) continue;
      if (skip && [...skip].some((x) => f.faces.has(x))) continue;
      const a = (rest ? f.rest * (1 - amount) : 0) + f.angle * amount;
      if (a !== 0) t = compose(rotationAbout(f.axisP, f.axisD, a), t);
    }
    return t;
  };
  return { flaps: kept.map((f) => ({ faces: f.faces, angle: Math.abs(f.angle), rest: Math.abs(f.rest) })), transformOf };
}
