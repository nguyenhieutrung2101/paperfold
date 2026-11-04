import {
  applyMaterial,
  applyPlaneIso,
  compose,
  cross3,
  dot3,
  type FaceId,
  IDENTITY,
  planeDirToWorld,
  planeIsoOf,
  planeToWorld,
  type Rigid3,
  rotationAbout,
  signedDistance,
  type Snapshot,
  type Transition,
  type Vec2,
  type Vec3,
} from '@paperfold/kernel';

type ReverseTransition = Extract<Transition, { kind: 'reverse' }>;

/**
 * How a reverse fold moves, without tearing the paper anywhere (Phase 1 polish).
 *
 * A stiff tip can only get inside (or around) a closed flap if the flap opens flat first: the
 * vertex where the reverse fold meets the spine is a degree-4 vertex, and its rigid motion from
 * "tip outside" to "tip reversed" passes through the unfolded state. So, when the flap's top
 * side can open freely:
 *
 * 1. **Open:** the top side (its flap layers, the tip layers on it, and everything attached to
 *    them) swings open about the spine until it lies flat.
 * 2. **Refold:** it closes again while the two tip layers fold along the reverse-fold line, each
 *    about its own hinge, kept joined along the tip's spine by the closed-form degree-4 motion
 *    (both hinges and both spines meet at P, so matching the tip spine's direction is enough).
 *    An outside reverse fold wraps the bottom tip under the flap, so the model rises a little
 *    to keep it off the table.
 *
 * When the top side can't open (something of the bottom side lies over it, like a corner folded
 * over both layers), the tip's layers swing over together as one piece and tuck in as they land.
 * APPROXIMATION: real paper would open locally and flex instead (Phase 2, with bending).
 */
export interface ReversePlan {
  readonly mode: 'kinematic' | 'swing';
  /** Faces that move at some point (they get finer meshes and fillets). */
  readonly moves: ReadonlySet<FaceId>;
  /** World motion applied to a face's start position at progress k (0..1). */
  pose(face: FaceId, k: number): Rigid3;
  /** Whole-model rise at progress k (mm), so a tip wrapping under clears the table. */
  lift(k: number): number;
}

const UP: Vec3 = [0, 1, 0];
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const rotDir = (r: Rigid3, v: Vec3): Vec3 => [
  r.r[0] * v[0] + r.r[1] * v[1] + r.r[2] * v[2],
  r.r[3] * v[0] + r.r[4] * v[1] + r.r[5] * v[2],
  r.r[6] * v[0] + r.r[7] * v[1] + r.r[8] * v[2],
];
/** Signed angle turning `from` to `to` about unit axis `u` (both taken perpendicular to it). */
function angleAbout(u: Vec3, from: Vec3, to: Vec3): number {
  const a = norm([from[0] - u[0] * dot3(from, u), from[1] - u[1] * dot3(from, u), from[2] - u[2] * dot3(from, u)]);
  const b = norm([to[0] - u[0] * dot3(to, u), to[1] - u[1] * dot3(to, u), to[2] - u[2] * dot3(to, u)]);
  return Math.atan2(dot3(u, cross3(a, b)), dot3(a, b));
}

const cache = new WeakMap<ReverseTransition, ReversePlan>();

export function planReverse(snap: Snapshot, tr: ReverseTransition): ReversePlan {
  const hit = cache.get(tr);
  if (hit) return hit;
  const plan = build(snap, tr);
  cache.set(tr, plan);
  return plan;
}

function build(snap: Snapshot, tr: ReverseTransition): ReversePlan {
  const moving = new Set(tr.moving);
  const topTips = new Set(tr.top);
  const P = tr.spine.p;
  const Pw = planeToWorld(P);
  const tol = 1e-6 * Math.max(1, snap.sizeMm);
  const startOf = (f: FaceId) => tr.startPlacements.get(f) ?? snap.faces.find((x) => x.id === f)!.placement;
  const worldPoly = (f: FaceId): Vec2[] => {
    const face = snap.faces.find((x) => x.id === f)!;
    const iso = planeIsoOf(startOf(f));
    return face.material.map((p) => applyPlaneIso(iso, p));
  };

  // The tip swinging over as one piece: tear-free, used when the flap can't open.
  const swing = (): ReversePlan => {
    const d = planeDirToWorld(tr.line.d);
    const lp = planeToWorld(tr.line.p);
    // Turn so the tip rises first (its side of the line goes up).
    const tip = tr.moving.length > 0 ? worldPoly(tr.moving[0]!) : [P];
    const c = tip.reduce((a, p) => [a[0] + p[0] / tip.length, a[1] + p[1] / tip.length] as Vec2, [0, 0] as Vec2);
    const probe = planeToWorld(c);
    const sgn = apply3(rotationAbout(lp, d, Math.PI / 2), probe)[1] >= 0 ? 1 : -1;
    return {
      mode: 'swing',
      moves: moving,
      pose: (f, k) => (moving.has(f) ? rotationAbout(lp, d, sgn * Math.PI * k) : IDENTITY),
      lift: () => 0,
    };
  };

  // The spine line and the flap's side of it.
  const b = norm(planeDirToWorld(tr.spine.d)); // from P into the body
  const onSpine = (a: Vec2, c: Vec2) => Math.abs(signedDistance(tr.spine, a)) <= tol && Math.abs(signedDistance(tr.spine, c)) <= tol;
  const flapPts = tr.flapTop.flatMap(worldPoly);
  if (flapPts.length === 0) return swing();
  const fc = flapPts.reduce((a, p) => [a[0] + p[0] / flapPts.length, a[1] + p[1] / flapPts.length] as Vec2, [0, 0] as Vec2);
  const off = planeToWorld(fc);
  const rel: Vec3 = [off[0] - Pw[0], 0, off[2] - Pw[2]];
  const nIn = norm([rel[0] - b[0] * dot3(rel, b), 0, rel[2] - b[2] * dot3(rel, b)]);

  // The top side: its flap faces and everything joined to them, not across the spine line.
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  const nbr = new Map<FaceId, Array<{ g: FaceId; spine: boolean }>>();
  for (const c of snap.creases) {
    if (c.left === null || c.right === null) continue;
    const fl = byId.get(c.left)!;
    const iso = planeIsoOf(startOf(fl.id));
    const spine = onSpine(applyPlaneIso(iso, c.a), applyPlaneIso(iso, c.b));
    for (const [f, g] of [[c.left, c.right], [c.right, c.left]] as const) {
      let list = nbr.get(f);
      if (!list) nbr.set(f, (list = []));
      list.push({ g, spine });
    }
  }
  const bottomSide = new Set([...tr.flapBottom, ...tr.bottom]);
  const topSide = new Set<FaceId>([...tr.flapTop, ...tr.top]);
  const queue = [...topSide];
  while (queue.length > 0) {
    const f = queue.pop()!;
    for (const { g, spine } of nbr.get(f) ?? []) {
      if (spine || topSide.has(g)) continue;
      if (moving.has(g) && !topTips.has(g)) continue; // the bottom tip: joined along the tip's spine
      if (bottomSide.has(g)) return swing(); // the two sides are joined elsewhere: can't open
      topSide.add(g);
      queue.push(g);
    }
  }
  // Locked: something not on the top side lies over it (a flap folded over both layers).
  const stationaryTop = [...topSide].filter((f) => !moving.has(f));
  const topSet = new Set(stationaryTop);
  for (const [f, g, s] of snap.layerOrder) {
    const fIn = topSet.has(f);
    const gIn = topSet.has(g);
    if (fIn === gIn || moving.has(f) || moving.has(g)) continue;
    const above = s === 1 ? f : g; // s = +1: f above g
    if (!topSet.has(above)) return swing();
  }

  // The reverse-fold line from P into the paper, and the tip's spine.
  let u = norm(planeDirToWorld(tr.line.d));
  if (dot3(u, nIn) < 0) u = [-u[0], -u[1], -u[2]];
  const t0: Vec3 = [-b[0], -b[1], -b[2]];
  const cosA = dot3(u, t0);
  if (Math.abs(cosA) < 1e-3 || Math.abs(Math.abs(cosA) - 1) < 1e-6) return swing(); // degenerate vertex

  // Phase 1 turns the top side up about the spine: pick the sense that lifts the flap.
  const sgn = apply3(rotationAbout(Pw, b, Math.PI / 2), [Pw[0] + nIn[0], Pw[1], Pw[2] + nIn[2]])[1] - Pw[1] >= 0 ? 1 : -1;
  const open = (phi: number) => rotationAbout(Pw, b, sgn * phi);
  const inside = tr.reverse === 'inside';
  const finalTurn = rotationAbout(Pw, u, Math.PI);

  // Phase 2: with the top side open by phi, where are the two tips?
  const tips = (phi: number): { top: Rigid3; bottom: Rigid3 } => {
    if (phi < 1e-6) return { top: finalTurn, bottom: finalTurn };
    const R1 = open(phi);
    const lT = norm(rotDir(R1, u));
    const g = dot3(u, lT);
    if (1 + g < 1e-9) return { top: finalTurn, bottom: finalTurn };
    const a = cosA / (1 + g);
    const w = cross3(u, lT);
    const w2 = Math.max(1e-12, 1 - g * g);
    const d = Math.sqrt(Math.max(0, (1 - 2 * a * a * (1 + g)) / w2));
    const vp: Vec3 = norm([a * (u[0] + lT[0]) + d * w[0], a * (u[1] + lT[1]) + d * w[1], a * (u[2] + lT[2]) + d * w[2]]);
    const vm: Vec3 = norm([a * (u[0] + lT[0]) - d * w[0], a * (u[1] + lT[1]) - d * w[1], a * (u[2] + lT[2]) - d * w[2]]);
    // Inside: the tip goes up into the opening; outside: it wraps around, under.
    const v = inside === dot3(vp, UP) >= dot3(vm, UP) ? vp : vm;
    const beta = angleAbout(u, t0, v);
    const gamma = angleAbout(lT, t0, v);
    return { bottom: rotationAbout(Pw, u, beta), top: compose(rotationAbout(Pw, lT, gamma), R1) };
  };

  const phiAt = (k: number) => (k <= 0.5 ? Math.PI * ease(k / 0.5) : Math.PI * (1 - ease((k - 0.5) / 0.5)));
  const pose = (f: FaceId, k: number): Rigid3 => {
    if (k >= 1) return moving.has(f) ? finalTurn : IDENTITY;
    const phi = phiAt(k);
    if (k <= 0.5) return topSide.has(f) ? open(phi) : IDENTITY;
    if (moving.has(f)) {
      const t = tips(phi);
      return topTips.has(f) ? t.top : t.bottom;
    }
    return topSide.has(f) ? open(phi) : IDENTITY;
  };

  // An outside reverse fold wraps the bottom tip under: raise the model just enough.
  const tipVerts = tr.bottom.flatMap((f) => {
    const face = byId.get(f)!;
    const st = startOf(f);
    return face.material.map((p) => applyMaterial(st, p));
  });
  const lift = (k: number) => {
    if (inside || k <= 0.5 || k >= 1) return 0;
    let low = 0;
    for (const f of tr.bottom) {
      const r = pose(f, k);
      for (const p of tipVerts) low = Math.min(low, apply3(r, p)[1]);
      break; // every bottom tip shares one motion
    }
    return -low;
  };

  return { mode: 'kinematic', moves: new Set([...moving, ...topSide]), pose, lift };
}

function apply3(r: Rigid3, p: Vec3): Vec3 {
  return [
    r.r[0] * p[0] + r.r[1] * p[1] + r.r[2] * p[2] + r.t[0],
    r.r[3] * p[0] + r.r[4] * p[1] + r.r[5] * p[2] + r.t[1],
    r.r[6] * p[0] + r.r[7] * p[1] + r.r[8] * p[2] + r.t[2],
  ];
}
