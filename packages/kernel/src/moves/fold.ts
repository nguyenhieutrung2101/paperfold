import { compose } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { orderOf } from '../state/order.ts';
import { flapsCross, poseProblems, posedPlacements, poseRotation } from '../state/pose.ts';
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
export function fold(withPoses: KernelState, params: FoldParams): MoveResult {
  // The flat paper folds as always; flaps standing open are checked after (state/pose.ts).
  const poses = withPoses.poses ?? [];
  const state: KernelState = poses.length > 0 ? (({ poses: _, ...flat }) => flat)(withPoses) : withPoses;
  const prep = prepareHalfTurn(state, params.line, params.seed, params.layers, params.holds);
  if (isRejection(prep)) return prep;
  for (const p of poses) {
    const hit = p.faces.filter((f) => prep.moving.has(f));
    if (hit.length > 0) return reject('posed', hit, { detail: 'The fold would move a flap that stands open' });
  }
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

  const angle = params.angleDeg ?? 180;
  if (!(angle > 0 && angle <= 180)) return reject('degenerate', [], { detail: 'A fold goes between 0° and 180°' });
  let next = built.state;
  if (poses.length > 0) {
    // Flaps standing open stay as they are: the fold may not move or split them, or pass
    // through them on the way.
    for (const p of poses) {
      for (const f of p.faces) {
        const a = state.folded.placements.get(f)!;
        const b = next.folded.placements.get(f);
        if (!b || !next.cp.faces.has(f) || a.r.some((x, i) => Math.abs(x - b.r[i]!) > 1e-9) || a.t.some((x, i) => Math.abs(x - b.t[i]!) > 1e-6)) {
          return reject('posed', [...p.faces], { detail: 'The fold would move a flap that stands open' });
        }
      }
    }
    const open = posedPlacements(withPoses);
    const posedFaces = poses.flatMap((p) => [...p.faces]);
    for (let deg = 10; deg < angle + 10; deg += 10) {
      const turn = poseRotation({ hinge: built.line, openDeg: dir * Math.min(deg, angle) });
      const at = new Map(built.moving.map((f) => [f, compose(turn, built.startPlacements.get(f)!)]));
      const hit = flapsCross(next, built.moving, posedFaces, at, open);
      if (hit) return reject('blocked', hit, { detail: 'A flap standing open is in the way' });
    }
    next = { ...next, poses };
    const problems = poseProblems(next);
    if (problems.length > 0) return reject('blocked', problems[0]!.faces, { detail: problems[0]!.message });
  }
  if (angle < 180) {
    if (dir !== 1) return reject('unsupported', [], { detail: 'Only a valley fold can stop partway' });
    // The flap stands open from where the fold lays it: turned back up about the same line.
    const hinge = { p: built.line.p, d: [-built.line.d[0], -built.line.d[1]] as Vec2 };
    next = { ...next, poses: [...(next.poses ?? []), { hinge, faces: [...built.moving], openDeg: 180 - angle }] };
    const problems = poseProblems(next);
    if (problems.length > 0) return reject('blocked', problems[0]!.faces, { detail: problems[0]!.message });
  }

  return {
    ok: true,
    state: next,
    transition: {
      kind: 'fold',
      line: built.line,
      direction: dir,
      moving: built.moving,
      parentOf: built.parentOf,
      startPlacements: built.startPlacements,
      newCreases: built.newCreases,
      fromDeg: 0,
      toDeg: angle,
    },
  };
}
