import { type Line2, lineThrough, signedDistance } from '../geometry/line.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency, faceEdges } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { stackLevels } from '../state/levels.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { applyHalfTurn, isRejection, prepareHalfTurn } from './foldCore.ts';
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
  const P = spines[0]!.p;
  for (const s of spines) {
    if (Math.hypot(s.p[0] - P[0], s.p[1] - P[1]) > 100 * tol.len) {
      return reject('unsupported', [], { detail: 'The line crosses more than one folded edge' });
    }
  }

  // 2. Split the picked-up stack at its innermost spine: the flap's gap.
  const index = new Map(seeds.map((f, i) => [f, i]));
  let gap = -1;
  let best = Infinity;
  for (const s of spines) {
    const i = index.get(s.a);
    const j = index.get(s.b);
    if (i === undefined || j === undefined || Math.abs(i - j) !== 1) continue;
    const g = Math.min(i, j);
    const score = Math.abs(g + 1 - seeds.length / 2);
    if (score < best || (score === best && g < gap)) {
      best = score;
      gap = g;
    }
  }
  if (gap < 0) return reject('unsupported', [], { detail: 'Grab the flap where all its layers are' });

  // 3. Every moving face's side: seeds by position, the rest through their own creases
  //    (never across a fold along the spine, which is what joins the two sides).
  const group = new Map<FaceId, Side>();
  seeds.forEach((f, i) => group.set(f, i <= gap ? 'T' : 'B'));
  const spineLine = spines[0]!.line;
  const onSpine = (v0: number, v1: number) =>
    Math.abs(signedDistance(spineLine, view.vertexWorld.get(v0)!)) <= tol.len &&
    Math.abs(signedDistance(spineLine, view.vertexWorld.get(v1)!)) <= tol.len;
  const queue = [...seeds];
  for (let qi = 0; qi < queue.length; qi++) {
    const f = queue[qi]!;
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      if (g === null || !moving.has(g) || group.has(g)) continue;
      if (Math.abs(c.angleDeg) === 180 && onSpine(c.v[0], c.v[1])) continue;
      group.set(g, group.get(f)!);
      queue.push(g);
    }
  }
  for (const f of moving) {
    if (!group.has(f)) return reject('unsupported', [f], { detail: 'Part of the tip belongs to neither side' });
  }

  // 4. Where every stationary layer sits relative to the flap.
  const levels = stackLevels(state);
  const tSeeds = seeds.slice(0, gap + 1);
  const bSeeds = seeds.slice(gap + 1);
  const gapLevel = (levels.get(seeds[gap]!)! + levels.get(seeds[gap + 1]!)!) / 2;
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

  // The new order of a moving face m against a stationary face in place `p`: +1 = m above.
  const landing = (m: Side, p: Place): 1 | -1 | undefined => {
    if (p === 'gap') return undefined;
    if (p === 'above') return -1;
    if (p === 'below') return 1;
    if (kind === 'inside') return p === 'T' ? -1 : 1;
    return m === 'T' ? 1 : -1;
  };

  let refusedGap = false;
  const built = applyHalfTurn(state, prep, ({ xMoves, yMoves, px, py, x, y }) => {
    if (xMoves && yMoves) {
      const o = orderOf(order, px, py);
      if (o === undefined) return undefined;
      return group.get(px) === group.get(py) ? (o === 1 ? -1 : 1) : o;
    }
    if (!xMoves && !yMoves) return px === py ? undefined : orderOf(order, px, py);
    const [m, sNew, mParent, sParent] = xMoves ? [x, y, px, py] : [y, x, py, px];
    void m;
    // The stationary face: its own side if it is part of the flap, else where it sits.
    const place: Place = moving.has(sParent)
      ? group.get(sParent)!
      : (partnerSide.get(sNew) ?? placeOf(sParent));
    const o = landing(group.get(mParent)!, place);
    if (o === undefined) refusedGap = true;
    if (o === undefined) return undefined;
    return xMoves ? o : o === 1 ? -1 : 1;
  });
  if (refusedGap) return reject('unsupported', [], { detail: 'Another layer is tucked inside the flap' });
  if (isRejection(built)) return built.reason === 'internal' ? reject('blocked', built.blockers, built.detail !== undefined ? { detail: built.detail } : {}) : built;

  // Sides of the new faces, for the skin's motion and for the steps.
  const top: FaceId[] = [];
  const bottom: FaceId[] = [];
  const flapTop: FaceId[] = [];
  const flapBottom: FaceId[] = [];
  const movingNew = new Set(built.moving);
  for (const f of built.state.cp.faces.keys()) {
    const parent = built.parentOf.get(f)!;
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
    state: built.state,
    transition: {
      kind: 'reverse',
      reverse: kind,
      line: built.line,
      moving: built.moving,
      top: sortIds(top),
      bottom: sortIds(bottom),
      flapTop: sortIds(flapTop),
      flapBottom: sortIds(flapBottom),
      spine: { p: P, d: away },
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
    },
  };
}
