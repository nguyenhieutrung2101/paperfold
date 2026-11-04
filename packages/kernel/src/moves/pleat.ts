import { type Line2, line as makeLine, lineThrough, reflectPoint, signedDistance } from '../geometry/line.ts';
import { centroid } from '../geometry/polygon.ts';
import { compose, halfTurnAboutPlaneLine, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { stackAt } from '../state/flat.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { fold } from './fold.ts';
import { isRejection, prepareHalfTurn } from './foldCore.ts';
import { applyMultiMotion, type MotionGroup } from './multi.ts';
import { type CrimpParams, type MoveResult, type PlaneLine, type PleatParams, reject } from './types.ts';

/** The second line seen after the first fold has turned it over the first. */
function across(first: PlaneLine, second: PlaneLine): { line: PlaneLine; map: (p: Vec2) => Vec2 } {
  const l1 = makeLine(first.p, first.d);
  const map = (p: Vec2) => reflectPoint(l1, p);
  const p = map(second.p);
  const q = map([second.p[0] + second.d[0], second.p[1] + second.d[1]]);
  return { line: { p, d: [q[0] - p[0], q[1] - p[1]] }, map };
}

/**
 * Pleat (brief, section 6): a valley fold on the first line and a mountain fold on the second,
 * made together, so the strip between them lies folded under the part beyond. Exactly: fold
 * everything past the first line over (valley), then fold the part past the second line back
 * (it now lies on top), and both are validated like any fold.
 */
export function pleatFold(state: KernelState, params: PleatParams): MoveResult {
  let first;
  try {
    first = makeLine(params.first.p, params.first.d);
    makeLine(params.second.p, params.second.d);
  } catch {
    return reject('degenerate', [], { detail: 'A pleat line has no direction' });
  }
  const a = fold(state, { line: first, seed: params.seed, layers: params.layers ?? 'all', direction: 'valley', ...(params.holds ? { holds: params.holds } : {}) });
  if (!a.ok) return a;
  const { line, map } = across(params.first, params.second);
  const seed2 = map(params.seed);
  // The part past the second line is now on top: pick up the layers that just moved there.
  const st = stackAt(a.state, seed2);
  if (!st.ok || st.faces.length === 0) return reject('degenerate', [], { detail: 'The second pleat line misses the folded part' });
  const moved = new Set(a.transition.kind === 'fold' ? a.transition.moving : []);
  let k = 0;
  while (k < st.faces.length && moved.has(st.faces[k]!)) k++;
  if (k === 0) return reject('degenerate', [], { detail: 'The second pleat line misses the folded part' });
  const b = fold(a.state, { line, seed: seed2, layers: k, direction: 'valley' });
  if (!b.ok) return b;
  const ta = a.transition;
  const tb = b.transition;
  if (ta.kind !== 'fold' || tb.kind !== 'fold') return reject('internal', [], { detail: 'A pleat is two folds' });
  // One transition for both folds, from the sheet before the pleat to the sheet after it.
  const movedA = new Set(ta.moving);
  const movedB = new Set(tb.moving);
  const parentOf = new Map<FaceId, FaceId>();
  const startPlacements = new Map<FaceId, Rigid3>();
  const middle: FaceId[] = [];
  const far: FaceId[] = [];
  for (const f of b.state.cp.faces.keys()) {
    const pa = tb.parentOf.get(f) ?? f;
    const p0 = ta.parentOf.get(pa) ?? pa;
    parentOf.set(f, p0);
    startPlacements.set(f, state.folded.placements.get(p0)!);
    if (movedB.has(f)) far.push(f);
    else if (movedA.has(pa)) middle.push(f);
  }
  const l2 = makeLine(params.second.p, params.second.d);
  const s2 = signedDistance(l2, params.seed) < 0 ? { p: l2.p, d: [-l2.d[0], -l2.d[1]] as Vec2 } : l2;
  return {
    ok: true,
    state: b.state,
    transition: {
      kind: 'pleat',
      first: ta.line,
      second: s2,
      moving: [...middle, ...far],
      middle,
      far,
      parentOf,
      startPlacements,
      newCreases: [...new Set([...ta.newCreases, ...tb.newCreases])].filter((e) => b.state.cp.creases.has(e)),
    },
  };
}

const LINKED = new Set(['tMid tNear', 'bMid bNear', 'tFar tMid', 'bFar bMid', 'bMid tMid', 'bFar tFar']);

/**
 * Crimp (brief, section 6): a pleat through a closed flap, both of its sides at once, so the
 * flap stays closed and its far part turns. Geometrically each side pleats like paper does
 * (the strip between the lines turns over the first line, the part beyond turns over both);
 * what makes it a crimp is the stacking: inside, the strip goes into the flap, between its two
 * sides, and the part beyond goes in between the strip's; outside, each wraps around the one
 * before. Two reverse folds made at once. Layer order from the constraint solver, as for squash and petal.
 */
export function crimpFold(state: KernelState, params: CrimpParams): MoveResult {
  const kind = params.kind ?? 'inside';
  const prep = prepareHalfTurn(state, params.first, params.seed, 'all', params.holds);
  if (isRejection(prep)) return prep;
  const { view, vside, moving, seeds } = prep;
  const l1 = prep.line;
  let l2: Line2;
  try {
    l2 = makeLine(params.second.p, params.second.d);
  } catch {
    return reject('degenerate', [], { detail: 'A crimp line has no direction' });
  }
  // The second line, oriented so the part past it (the seed's side) is on its left.
  if (signedDistance(l2, params.seed) < 0) l2 = { p: l2.p, d: [-l2.d[0], -l2.d[1]] };
  const tol = state.tol;
  const adj = adjacency(state.cp);

  // The flap's two sides: split the stack at the innermost folded edge crossing the first line.
  const index = new Map(seeds.map((f, i) => [f, i]));
  let gap = -1;
  let best = Infinity;
  let spine: Line2 | null = null;
  for (const c of state.cp.creases.values()) {
    if (Math.abs(c.angleDeg) !== 180) continue;
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null || !moving.has(ef.left) || !moving.has(ef.right)) continue;
    if (vside.get(c.v[0])! * vside.get(c.v[1])! !== -1) continue;
    const i = index.get(ef.left);
    const j = index.get(ef.right);
    if (i === undefined || j === undefined || Math.abs(i - j) !== 1) continue;
    const g = Math.min(i, j);
    const score = Math.abs(g + 1 - seeds.length / 2);
    if (score < best) {
      best = score;
      gap = g;
      spine = lineThrough(view.vertexWorld.get(c.v[0])!, view.vertexWorld.get(c.v[1])!);
    }
  }
  if (gap < 0 || !spine) return reject('unsupported', [], { detail: 'A crimp needs a closed flap across both lines' });
  const sl = spine;
  const sideOf = new Map<FaceId, 'T' | 'B'>();
  seeds.forEach((f, i) => sideOf.set(f, i <= gap ? 'T' : 'B'));
  const onSpine = (v0: number, v1: number) =>
    Math.abs(signedDistance(sl, view.vertexWorld.get(v0)!)) <= tol.len && Math.abs(signedDistance(sl, view.vertexWorld.get(v1)!)) <= tol.len;
  const q = [...seeds];
  for (let qi = 0; qi < q.length; qi++) {
    const f = q[qi]!;
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || !moving.has(g) || sideOf.has(g)) continue;
      if (Math.abs(c.angleDeg) === 180 && onSpine(c.v[0], c.v[1])) continue;
      sideOf.set(g, sideOf.get(f)!);
      q.push(g);
    }
  }
  for (const f of moving) if (!sideOf.has(f)) return reject('unsupported', [f], { detail: 'Part of the flap belongs to neither side' });

  const H1 = halfTurnAboutPlaneLine(l1);
  const H2 = halfTurnAboutPlaneLine(l2);
  const groups: Record<string, MotionGroup> = {
    tMid: { id: 'tMid', motion: H1 },
    bMid: { id: 'bMid', motion: H1 },
    tFar: { id: 'tFar', motion: compose(H1, H2) },
    bFar: { id: 'bFar', motion: compose(H1, H2) },
  };
  // Where each part goes, as a height. Each side of the flap zigzags like a pleat (near, strip,
  // far), and its near part runs past the second line, so the far part can't come back over
  // it: inside, the strip tucks in between the near sides and the far part in between the
  // strip's; outside, the strip wraps around the near part and the far part around the strip.
  const level: Record<string, number> =
    kind === 'inside' ? { tNear: 0, tMid: -2, tFar: -4, bFar: -6, bMid: -8, bNear: -10 } : { tFar: 4, tMid: 2, tNear: 0, bNear: -10, bMid: -12, bFar: -14 };
  const order = state.folded.layerOrder;
  const partOf = (orig: FaceId, g: MotionGroup | null): string | null => {
    if (g) return g.id;
    if (!moving.has(orig)) return null;
    return sideOf.get(orig) === 'T' ? 'tNear' : 'bNear';
  };
  const built = applyMultiMotion(state, {
    cuts: [
      { line: l1, faces: (_f, orig) => moving.has(orig) },
      { line: l2, faces: (_f, orig, poly) => moving.has(orig) && signedDistance(l1, centroid(poly)) > 0 },
    ],
    groupOf: (_f, orig, poly) => {
      if (!moving.has(orig)) return null;
      const c = centroid(poly);
      if (signedDistance(l1, c) <= 0) return null;
      const far = signedDistance(l2, c) > 0;
      const t = sideOf.get(orig) === 'T';
      return groups[(t ? 't' : 'b') + (far ? 'Far' : 'Mid')]!;
    },
    // The pairs that make it a crimp and not a pleat of the whole flap: each part with the part
    // it is creased to, and the two sides of the strip and of the far part. Firm, so a crimp the
    // lines don't allow (inside, when they lean back over the flap) is refused.
    fixed: (_x, _y, gx, gy, ox, oy) => {
      const px = partOf(ox, gx);
      const py = partOf(oy, gy);
      if (px === null || py === null) return undefined;
      const pair = [px, py].sort().join(' ');
      if (!LINKED.has(pair)) return undefined;
      return level[px]! > level[py]! ? 1 : -1;
    },
    hint: (_x, _y, gx, gy, ox, oy) => {
      const px = partOf(ox, gx);
      const py = partOf(oy, gy);
      if (px === null || py === null) {
        // Paper outside the flap: moving parts stay on their side of it.
        const o = orderOf(order, ox, oy);
        return o;
      }
      const lx = level[px]!;
      const ly = level[py]!;
      return lx === ly ? orderOf(order, ox, oy) : lx > ly ? 1 : -1;
    },
  });
  if (isRejection(built)) return built;
  return {
    ok: true,
    state: built.state,
    transition: {
      kind: 'crimp',
      reverse: kind,
      first: l1,
      second: l2,
      moving: built.moving,
      middle: [...built.groups].filter(([, g]) => g === 'tMid' || g === 'bMid').map(([f]) => f),
      far: [...built.groups].filter(([, g]) => g === 'tFar' || g === 'bFar').map(([f]) => f),
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
    },
  };
}
