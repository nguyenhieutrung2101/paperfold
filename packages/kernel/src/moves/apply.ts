import type { KernelState } from '../state/types.ts';
import { burnish } from './burnish.ts';
import { fold } from './fold.ts';
import { petalFold } from './petal.ts';
import { crimpFold, pleatFold } from './pleat.ts';
import { rabbitEarFold } from './rabbit.ts';
import { reverseFold } from './reverse.ts';
import { squashFold } from './squash.ts';
import { rotate, turnOver } from './turn.ts';
import { rotatePose } from '../state/pose.ts';
import { type Move, type MoveResult, reject } from './types.ts';

/** Apply any move. Pure: the input state is never modified. */
export function applyMove(state: KernelState, move: Move): MoveResult {
  const poses = state.poses ?? [];
  if (poses.length > 0 && move.type !== 'fold' && move.type !== 'rotate') {
    // Only folds (checked against the open flaps) and turning the model on the table work
    // around a flap that stands open.
    return reject('posed', poses.flatMap((p) => [...p.faces]), { detail: 'Lay the open flaps down first' });
  }
  if (poses.length > 0 && move.type === 'rotate') {
    // Turn the flat paper, then the open flaps' hinges with it.
    const { poses: _, ...flat } = state;
    const r = rotate(flat, move.params);
    if (!r.ok || r.transition.kind !== 'rotate') return r;
    const { center, degrees } = r.transition;
    return { ...r, state: { ...r.state, poses: poses.map((p) => rotatePose(p, center, degrees)) } };
  }
  return dispatch(state, move);
}

function dispatch(state: KernelState, move: Move): MoveResult {
  switch (move.type) {
    case 'fold':
      return fold(state, move.params);
    case 'reverseFold':
      return reverseFold(state, move.params);
    case 'squash':
      return squashFold(state, move.params);
    case 'petal':
      return petalFold(state, move.params);
    case 'pleat':
      return pleatFold(state, move.params);
    case 'crimp':
      return crimpFold(state, move.params);
    case 'rabbitEar':
      return rabbitEarFold(state, move.params);
    case 'burnish':
      return burnish(state, move.params);
    case 'turnOver':
      return turnOver(state, move.params);
    case 'rotate':
      return rotate(state, move.params);
  }
}
