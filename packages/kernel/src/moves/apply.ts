import type { KernelState } from '../state/types.ts';
import { burnish } from './burnish.ts';
import { fold } from './fold.ts';
import { petalFold } from './petal.ts';
import { reverseFold } from './reverse.ts';
import { squashFold } from './squash.ts';
import { rotate, turnOver } from './turn.ts';
import type { Move, MoveResult } from './types.ts';

/** Apply any move. Pure: the input state is never modified. */
export function applyMove(state: KernelState, move: Move): MoveResult {
  switch (move.type) {
    case 'fold':
      return fold(state, move.params);
    case 'reverseFold':
      return reverseFold(state, move.params);
    case 'squash':
      return squashFold(state, move.params);
    case 'petal':
      return petalFold(state, move.params);
    case 'burnish':
      return burnish(state, move.params);
    case 'turnOver':
      return turnOver(state, move.params);
    case 'rotate':
      return rotate(state, move.params);
  }
}
