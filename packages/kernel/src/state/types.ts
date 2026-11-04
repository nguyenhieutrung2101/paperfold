import type { Line2 } from '../geometry/line.ts';
import type { Rigid3 } from '../geometry/rigid.ts';
import type { Tolerance } from '../geometry/tolerance.ts';
import type { Vec2, Vec3 } from '../geometry/vec.ts';
import type { CreasePattern, FaceId, Paper } from '../paper/types.ts';
import type { PairKey } from './order.ts';

/** A point pinned by the second hand. Pinned faces can't move (Phase 1 UI; enforced by fold now). */
export interface Hold {
  readonly face: FaceId;
  readonly material: Vec2;
}

/** Where a hand touched the paper, in both spaces. Recorded on ops for the build steps. */
export interface Grip {
  readonly face: FaceId;
  readonly material: Vec2;
  readonly world: Vec3;
}

export interface FoldedState {
  /** Material -> world rigid transform for every face. */
  readonly placements: ReadonlyMap<FaceId, Rigid3>;
  /**
   * Pairwise layer order of faces that lie flat on each other with positive-area overlap.
   * Key pairKey(f, g) (f < g); value +1 means f is above g in world (+Y), −1 below.
   *
   * This is FOLD's faceOrders with a world-up reference instead of a per-face normal;
   * io/fold.ts converts (see DECISIONS.md, ADR-007).
   */
  readonly layerOrder: ReadonlyMap<PairKey, 1 | -1>;
  readonly holds: readonly Hold[];
}

/**
 * A free flap left standing open (Phase 2, partial angles; state/pose.ts): turned up about its
 * hinge from where the flat state has it.
 */
export interface FlapPose {
  /** The hinge on the table plane, with the flap on its left in the flat state. */
  readonly hinge: Line2;
  readonly faces: readonly FaceId[];
  /** How far it stands open, in degrees: more than 0 (lying folded), less than 180 (lying open). */
  readonly openDeg: number;
}

export interface IdCounters {
  readonly vertex: number;
  readonly edge: number;
  readonly face: number;
  readonly op: number;
}

/**
 * The kernel's complete, immutable state. Every move returns a new one; unchanged
 * vertices, creases, faces and placements are shared by reference with the old one.
 */
export interface KernelState {
  readonly paper: Paper;
  readonly cp: CreasePattern;
  readonly folded: FoldedState;
  readonly next: IdCounters;
  readonly tol: Tolerance;
  /** Flaps left standing open (none: the paper lies flat). */
  readonly poses?: readonly FlapPose[];
}
