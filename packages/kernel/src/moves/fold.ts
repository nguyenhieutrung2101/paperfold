import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';
import { applyHalfTurn, isRejection, prepareHalfTurn, sweepBlockers } from './foldCore.ts';
import { type FoldParams, type MoveResult, reject } from './types.ts';

/**
 * Fold the picked-up layers 180° about a straight line (valley: up and over, toward the
 * viewer; mountain: down and under).
 *
 * 1. Selection: the layers under the grab point, top k or all.
 * 2. Moving set: flood fill from the grabbed faces, on the grabbed side of the line,
 *    across every crease except ones lying on the fold line (brief, section 3).
 * 3. Refuse if the fill reached layers under the grab that weren't picked up ('joined'),
 *    or a held face would move ('held').
 * 4. Sweep check: a flat 180° rotation lifts every moving point off the table plane
 *    immediately, so a stationary layer lying over (valley) or under (mountain) a moving
 *    layer anywhere they overlap is in the way ('tucked'). Nothing else on the table can be
 *    hit: in the zero-thickness flat model the moving sheet sweeps the open half-space.
 * 5. Layer order is rewritten locally: the moving stack is reversed and laid on top (valley)
 *    or underneath (mountain) where it lands; everything else keeps its order. We never
 *    solve flat-foldability from scratch (NP-hard: Bern and Hayes 1996).
 * 6. Fold angles are re-derived from the result, placements are re-derived from the crease
 *    graph, and every invariant the move could touch is checked. Any violation refuses
 *    the move (fail closed).
 */
export function fold(state: KernelState, params: FoldParams): MoveResult {
  const prep = prepareHalfTurn(state, params.line, params.seed, params.layers, params.holds);
  if (isRejection(prep)) return prep;
  const dir: 1 | -1 = params.direction === 'valley' ? 1 : -1;

  const blockers = sweepBlockers(state, prep, dir);
  if (isRejection(blockers)) return blockers;
  if (blockers.length > 0) return reject('tucked', blockers);

  const order = state.folded.layerOrder;
  const built = applyHalfTurn(state, prep, ({ xMoves, yMoves, px, py }) => {
    // The moving stack lands on top (valley) or underneath (mountain).
    if (xMoves !== yMoves) return xMoves ? dir : dir === 1 ? -1 : 1;
    const o = px === py ? undefined : orderOf(order, px, py);
    if (o === undefined) return undefined;
    // Moving faces are turned over together, so their order flips; stationary ones keep it.
    return xMoves ? (o === 1 ? -1 : 1) : o;
  });
  if (isRejection(built)) return built;

  return {
    ok: true,
    state: built.state,
    transition: {
      kind: 'fold',
      line: built.line,
      direction: dir,
      moving: built.moving,
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
      fromDeg: 0,
      toDeg: 180,
    },
  };
}
