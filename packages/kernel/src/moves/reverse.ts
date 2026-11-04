import { type Line2, lineThrough, signedDistance } from '../geometry/line.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { centroid } from '../geometry/polygon.ts';
import { halfTurnAboutPlaneLine } from '../geometry/rigid.ts';
import { stackLevels } from '../state/levels.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { isRejection, prepareHalfTurn } from './foldCore.ts';
import { applyMultiMotion, type MotionGroup } from './multi.ts';
import { type MoveResult, type ReverseFoldParams, reject } from './types.ts';

type Side = 'T' | 'B';
type Place = Side | 'above' | 'below' | 'gap';

/**
 * Inside and outside reverse folds (brief, section 6).
 *
 * Setup: a flap of two layers (or nested stacks) joined along a folded edge, the spine S.
 * The line ℓ crosses S at P and cuts off the tip. Geometrically the tip ends where a plain
 * fold through every layer would put it: reflected across ℓ. What differs is how layers
 * re-stack, and that is all this move decides:
 *
 * - The flap splits at its innermost spine into a top side (T) and a bottom side (B). Every
 *   tip layer belongs to the side it is attached to.
 * - Each side's tip layers land in reverse order among themselves (each layer folds about ℓ
 *   individually, so their folds nest), and the two sides keep their relative order.
 * - Inside: the whole tip lands in the flap's gap, below every top-side layer and above
 *   every bottom-side layer. The tip's spine turns inside out (V -> M).
 * - Outside: the top side's tip wraps over the outermost top layer, the bottom side's under
 *   the outermost bottom layer.
 * - Stationary layers outside the flap keep their side: the tip lands under anything above
 *   the flap and over anything below it.
 *
 * Everything then goes through the same derivation and validation as a plain fold, so a
 * reverse fold that would leave the paper inconsistent is refused, never committed. The
 * same move covers both gestures: ℓ crossing the spine (the tip is cut along ℓ) and ℓ
 * lying on a precrease (the cut already exists).
 */
export function reverseFold(state: KernelState, params: ReverseFoldParams): MoveResult {
  const prep = prepareHalfTurn(state, params.line, params.seed, params.layers ?? 'all', params.holds);
  if (isRejection(prep)) return prep;
  const { view, vside, moving, seeds } = prep;
  const tol = state.tol;
  const adj = adjacency(state.cp);
  const order = state.folded.layerOrder;

  // 1. The spine: folded creases inside the tip that reach the line.
  interface Spine {
    readonly a: FaceId;
    readonly b: FaceId;
    readonly line: Line2;
    readonly p: Vec2;
  }
  const spines: Spine[] = [];
  for (const c of state.cp.creases.values()) {
    if (Math.abs(c.angleDeg) !== 180) continue;
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null || !moving.has(ef.left) || !moving.has(ef.right)) continue;
    const s0 = vside.get(c.v[0])!;
    const s1 = vside.get(c.v[1])!;
    const touches = (s0 === 0) !== (s1 === 0);
    const crosses = s0 * s1 === -1;
    if (!touches && !crosses) continue;
    const w0 = view.vertexWorld.get(c.v[0])!;
    const w1 = view.vertexWorld.get(c.v[1])!;
    let p: Vec2;
    if (crosses) {
      const d0 = signedDistance(prep.line, w0);
      const d1 = signedDistance(prep.line, w1);
      const t = d0 / (d0 - d1);
      p = [w0[0] + (w1[0] - w0[0]) * t, w0[1] + (w1[1] - w0[1]) * t];
    } else {
      p = s0 === 0 ? w0 : w1;
    }
    spines.push({ a: ef.left, b: ef.right, line: lineThrough(w0, w1), p });
  }
  if (spines.length === 0) return reject('unsupported', [], { detail: 'No folded edge crosses the line: not a closed flap' });

  // 2. Split the picked-up stack at its innermost spine: the fold that joins the flap's two
  //    sides nearest the middle of the stack. Its two faces needn't be next to each other
  //    (a narrowed flap has its folded-in sides between them); layers in between join the
  //    side they're attached to. Other folded edges the line crosses (a narrowed flap's
  //    folded sides) belong to one side or the other.
  const index = new Map(seeds.map((f, i) => [f, i]));
  interface Split {
    readonly lo: number;
    readonly hi: number;
    readonly p: Vec2;
    readonly score: number;
  }
  const candidates: Split[] = [];
  for (const s of spines) {
    const i = index.get(s.a);
    const j = index.get(s.b);
    if (i === undefined || j === undefined) continue;
    const lo0 = Math.min(i, j);
    const hi0 = Math.max(i, j);
    // Nearest the middle of the stack first; then the spine with fewer layers between.
    const score = Math.abs((lo0 + hi0 + 1) / 2 - seeds.length / 2) * 100 + (hi0 - lo0);
    candidates.push({ lo: lo0, hi: hi0, p: s.p, score });
  }
  candidates.sort((x, y) => x.score - y.score || x.lo - y.lo);
  if (candidates.length === 0) {
    const P0 = spines[0]!.p;
    const many = spines.some((s) => Math.hypot(s.p[0] - P0[0], s.p[1] - P0[1]) > 100 * tol.len);
    return reject('unsupported', [], { detail: many ? 'The line crosses more than one folded edge' : 'Grab the flap where all its layers are' });
  }

  // 3. Every moving face's side: seeds by position, the rest through their own creases
  //    (never across a fold along the spine, which is what joins the two sides). The first
  //    split that gives every moving face a side wins.
  type Chosen = { split: Split; group: Map<FaceId, Side>; spineLine: Line2 };
  let chosen: Chosen | null = null;
  let fallback: Chosen | null = null;
  // Strict: no fold along the spine line is crossed (nested flaps). Relaxed: only the
  // chosen spine fold separates the sides; other folds on that line belong to one side
  // (a narrowed flap's inner folds).
  outer: for (const cand of candidates) {
    for (const strict of [true, false]) {
      const at = cand.p;
      const spineSet = spines.filter((s) => Math.hypot(s.p[0] - at[0], s.p[1] - at[1]) <= 100 * tol.len);
      const pairA = seeds[cand.lo]!;
      const pairB = seeds[cand.hi]!;
      const g0 = new Map<FaceId, Side>();
      seeds.forEach((f, i) => {
        if (i <= cand.lo) g0.set(f, 'T');
        else if (i >= cand.hi) g0.set(f, 'B');
      });
      if (!strict) {
        // Only the two faces of the spine are placed; the rest follow their creases.
        g0.clear();
        g0.set(pairA, 'T');
        g0.set(pairB, 'B');
      }
      const sl = spineSet[0]!.line;
      const onSpine = (v0: number, v1: number) =>
        Math.abs(signedDistance(sl, view.vertexWorld.get(v0)!)) <= tol.len &&
        Math.abs(signedDistance(sl, view.vertexWorld.get(v1)!)) <= tol.len;
      const blocks = (f: FaceId, g: FaceId, c: { angleDeg: number; v: readonly [number, number] }) => {
        if (Math.abs(c.angleDeg) !== 180 || !onSpine(c.v[0], c.v[1])) return false;
        return strict || (f === pairA && g === pairB) || (f === pairB && g === pairA);
      };
      const queue = [...g0.keys()];
      let consistent = true;
      for (let qi = 0; qi < queue.length && consistent; qi++) {
        const f = queue[qi]!;
        for (const e of faceEdges(state.cp, f)) {
          const c = state.cp.creases.get(e)!;
          const ef = adj.edgeFaces.get(e)!;
          const g = ef.left === f ? ef.right : ef.left;
          if (g === null || !moving.has(g)) continue;
          if (blocks(f, g, c)) continue;
          // Joined other than along the spine: same side, or this isn't the flap's spine.
          if (g0.has(g)) {
            if (g0.get(g) !== g0.get(f)) consistent = false;
            continue;
          }
          g0.set(g, g0.get(f)!);
          queue.push(g);
        }
      }
      // The sides must also stack as sides: every top-side seed above every bottom-side one.
      const order = seeds.map((f) => g0.get(f));
      const firstB = order.indexOf('B');
      const lastT = order.lastIndexOf('T');
      const complete = [...moving].every((f) => g0.has(f));
      if (consistent && complete && (firstB < 0 || lastT < firstB)) {
        chosen = { split: cand, group: g0, spineLine: sl };
        break outer;
      }
      // Phase 1's rule as the fallback: the strict split nearest the middle that reaches
      // every face (nested flaps can be joined around the outside as well).
      if (strict && complete && !fallback) fallback = { split: cand, group: g0, spineLine: sl };
    }
  }
  chosen ??= fallback;
  if (!chosen) return reject('unsupported', [], { detail: 'Part of the tip belongs to neither side' });
  const { lo, hi } = chosen.split;
  const P = chosen.split.p;
  const group = chosen.group;
  const spineLine = chosen.spineLine;

  // 4. Where every stationary layer sits relative to the flap.
  const levels = stackLevels(state);
  const tSeeds = seeds.filter((f) => group.get(f) === 'T');
  const bSeeds = seeds.filter((f) => group.get(f) === 'B');
  const gapLevel = (levels.get(seeds[lo]!)! + levels.get(seeds[hi]!)!) / 2;
  const placeOf = (g: FaceId): Place => {
    if (group.has(g)) return group.get(g)!;
    const rel = (list: readonly FaceId[], s: 1 | -1) => list.some((f) => orderOf(order, g, f) === s);
    const aboveT = rel(tSeeds, 1);
    const belowT = rel(tSeeds, -1);
    const aboveB = rel(bSeeds, 1);
    const belowB = rel(bSeeds, -1);
    if (aboveT && belowT) return 'T';
    if (aboveB && belowB) return 'B';
    if (belowT && aboveB) return 'gap';
    if (aboveT || aboveB) return belowB ? 'gap' : 'above';
    if (belowT || belowB) return 'below';
    const w = wall.get(g);
    if (w === 'T' || w === 'B') return w;
    const lv = levels.get(g)!;
    return lv > gapLevel ? 'above' : 'below';
  };

  const kind = params.kind;
  // Stationary flap faces next to the tip across the line take the tip's side.
  const partnerSide = new Map<FaceId, Side>();
  for (const f of moving) {
    if (prep.cls.get(f) === 'cross') continue;
    for (const e of faceEdges(state.cp, f)) {
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g !== null && !moving.has(g)) partnerSide.set(g, group.get(f)!);
    }
  }
  // The flap's two walls run on past it: paper joined flat to a wall's stationary part (a
  // flap tucked in behind the top side, say) belongs to that wall, wherever it lies.
  const wall = new Map<FaceId, Side | 'both'>();
  {
    const q: Array<[FaceId, Side]> = [];
    for (const f of moving) if (prep.cls.get(f) === 'cross') q.push([f, group.get(f)!]);
    for (const [g, sd] of partnerSide) q.push([g, sd]);
    const mark = (g: FaceId, sd: Side) => {
      const cur = wall.get(g);
      if (cur === sd || cur === 'both') return false;
      wall.set(g, cur === undefined ? sd : 'both');
      return true;
    };
    for (let qi = 0; qi < q.length; qi++) {
      const [f, sd] = q[qi]!;
      for (const e of faceEdges(state.cp, f)) {
        if (state.cp.creases.get(e)!.angleDeg !== 0) continue;
        const ef = adj.edgeFaces.get(e)!;
        const g = ef.left === f ? ef.right : ef.left;
        if (g === null || moving.has(g)) continue;
        if (mark(g, sd)) q.push([g, sd]);
      }
    }
  }

  // The new order of a moving face m against a stationary face in place `p`: +1 = m above.
  const landing = (m: Side, p: Place): 1 | -1 | undefined => {
    if (p === 'gap') return undefined;
    if (p === 'above') return -1;
    if (p === 'below') return 1;
    if (kind === 'inside') return p === 'T' ? -1 : 1;
    return m === 'T' ? 1 : -1;
  };

  // Every pair the move can change is decided by the constraint solver, preferring the rule
  // above wherever it has an answer. Where the rule is right, propagation reproduces it
  // exactly; where another layer lies inside the flap (a tucked flap, say) or the rule only
  // has a guess, the paper's own constraints decide.
  const H = halfTurnAboutPlaneLine(prep.line);
  const gT: MotionGroup = { id: 'T', motion: H };
  const gB: MotionGroup = { id: 'B', motion: H };
  // Where the tip lands against a stationary face: decided by the move when the face is part
  // of the flap or touches it; only a guess (its wall, its level) otherwise.
  const decided = (so: FaceId): Place | null => {
    if (moving.has(so)) return group.get(so)!;
    const p = partnerSide.get(so);
    if (p) return p;
    const rel = (list: readonly FaceId[], sg: 1 | -1) => list.some((f) => orderOf(order, so, f) === sg);
    if (rel(tSeeds, 1) || rel(tSeeds, -1) || rel(bSeeds, 1) || rel(bSeeds, -1)) return placeOf(so);
    return null;
  };
  const answer = (gx: MotionGroup | null, gy: MotionGroup | null, ox: FaceId, oy: FaceId, soft: boolean): 1 | -1 | undefined => {
    if (gx && gy) return soft ? undefined : orderOf(order, ox, oy);
    if (!gx && !gy) return undefined;
    const [m, so] = gx ? [gx, oy] : [gy!, ox];
    const d = decided(so);
    const place = d ?? (soft ? placeOf(so) : null);
    if (place === null || (d !== null && soft)) return undefined;
    const o = landing(m.id as Side, place);
    if (o === undefined) return undefined;
    return gx ? o : o === 1 ? -1 : 1;
  };
  const multi = applyMultiMotion(state, {
    cuts: [{ line: prep.line, faces: (_f, orig) => moving.has(orig) }],
    groupOf: (_f, orig, poly) => {
      if (!moving.has(orig) || signedDistance(prep.line, centroid(poly)) <= 0) return null;
      return group.get(orig) === 'T' ? gT : gB;
    },
    // Tip layers on different sides keep their order (inside a side, the motion turns them).
    fixed: (_x, _y, gx, gy, ox, oy) => answer(gx, gy, ox, oy, false),
    hint: (_x, _y, gx, gy, ox, oy) => answer(gx, gy, ox, oy, true),
  });
  if (isRejection(multi)) {
    return multi.reason === 'internal' ? reject('blocked', multi.blockers, multi.detail !== undefined ? { detail: multi.detail } : {}) : multi;
  }
  const result = multi;

  // Sides of the new faces, for the skin's motion and for the steps.
  const top: FaceId[] = [];
  const bottom: FaceId[] = [];
  const flapTop: FaceId[] = [];
  const flapBottom: FaceId[] = [];
  const movingNew = new Set(result.moving);
  for (const f of result.state.cp.faces.keys()) {
    const parent = result.parentOf.get(f)!;
    const side = movingNew.has(f) ? group.get(parent) : moving.has(parent) ? group.get(parent) : partnerSide.get(f);
    if (side === undefined) continue;
    if (movingNew.has(f)) (side === 'T' ? top : bottom).push(f);
    else (side === 'T' ? flapTop : flapBottom).push(f);
  }
  const sortIds = (a: FaceId[]) => a.sort((x, y) => x - y);
  // The spine line through P, pointing away from the tip (into the flap's body).
  const sd = spineLine.d;
  const away: Vec2 = signedDistance(prep.line, [P[0] + sd[0], P[1] + sd[1]]) < 0 ? sd : [-sd[0], -sd[1]];

  return {
    ok: true,
    state: result.state,
    transition: {
      kind: 'reverse',
      reverse: kind,
      line: prep.line,
      moving: result.moving,
      top: sortIds(top),
      bottom: sortIds(bottom),
      flapTop: sortIds(flapTop),
      flapBottom: sortIds(flapBottom),
      spine: { p: P, d: away },
      parentOf: result.parentOf,
      startPlacements: result.startPlacements,
      newCreases: result.newCreases,
    },
  };
}
