import { compose, halfTurn, planeDirToWorld, planeToWorld, rotationAbout, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import type { FaceId } from '../paper/types.ts';
import { flatView, type FlatView } from '../state/flat.ts';
import type { KernelState } from '../state/types.ts';
import { checkInvariants } from '../validate/invariants.ts';
import { type MoveResult, reject, type RotateParams, type TurnOverParams } from './types.ts';

/** Center of the model's footprint on the table. */
export function footprintCenter(view: FlatView): Vec2 {
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
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function transformAll(state: KernelState, w: Rigid3, flipOrder: boolean): KernelState {
  const placements = new Map<FaceId, Rigid3>();
  for (const [f, tr] of state.folded.placements) placements.set(f, compose(w, tr));
  let layerOrder = state.folded.layerOrder;
  if (flipOrder) {
    const flipped = new Map<string, 1 | -1>();
    for (const [k, s] of layerOrder) flipped.set(k, s === 1 ? -1 : 1);
    layerOrder = flipped;
  }
  return {
    ...state,
    folded: { ...state.folded, placements, layerOrder },
    next: { ...state.next, op: state.next.op + 1 },
  };
}

/**
 * Turn the whole model over, side to side or top to bottom, about its footprint center.
 * Everything that was on top is now underneath; fold angles don't change (they're
 * material-relative).
 */
export function turnOver(state: KernelState, params: TurnOverParams): MoveResult {
  const view = flatView(state);
  if (!view) return reject('unsupported');
  const c = footprintCenter(view);
  const d: Vec2 = params.axis === 'side' ? [0, 1] : [1, 0];
  const next = transformAll(state, halfTurn(planeToWorld(c), planeDirToWorld(d)), true);
  const v = checkInvariants(next);
  if (v.length) return reject('internal', [], { detail: v.map((x) => x.message).join('; ') });
  return { ok: true, state: next, transition: { kind: 'turnOver', axis: { p: c, d } } };
}

/** Rotate the model on the table about its footprint center (counter-clockwise from above). */
export function rotate(state: KernelState, params: RotateParams): MoveResult {
  const view = flatView(state);
  if (!view) return reject('unsupported');
  if (!Number.isFinite(params.degrees)) return reject('degenerate');
  const c = footprintCenter(view);
  const next = transformAll(state, rotationAbout(planeToWorld(c), [0, 1, 0], (params.degrees * Math.PI) / 180), false);
  const v = checkInvariants(next);
  if (v.length) return reject('internal', [], { detail: v.map((x) => x.message).join('; ') });
  return { ok: true, state: next, transition: { kind: 'rotate', center: c, degrees: params.degrees } };
}
