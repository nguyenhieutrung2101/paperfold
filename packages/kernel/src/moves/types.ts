import type { Line2 } from '../geometry/line.ts';
import type { Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import type { EdgeId, FaceId, OpId } from '../paper/types.ts';
import type { Grip, KernelState } from '../state/types.ts';

/** A line on the table plane, as plain data (direction need not be unit). */
export interface PlaneLine {
  readonly p: Vec2;
  readonly d: Vec2;
}

export interface FoldParams {
  /** The fold line on the table plane. */
  readonly line: PlaneLine;
  /** Where the paper was grabbed (table plane). Its side of the line moves. */
  readonly seed: Vec2;
  /** How many layers under the grab to pick up, counted from the top, or all of them. */
  readonly layers: number | 'all';
  /** valley: the moving part swings up toward the viewer; mountain: down and under. */
  readonly direction: 'valley' | 'mountain';
  /** Where the other hand presses (table plane). Faces under a hold can't move. */
  readonly holds?: readonly Vec2[];
}

export interface ReverseFoldParams {
  /** ℓ: crosses the flap's folded edge (spine) and cuts off the tip, or lies on a precrease. */
  readonly line: PlaneLine;
  /** A point on the tip (the part that moves). */
  readonly seed: Vec2;
  readonly kind: 'inside' | 'outside';
  /** Layers of the flap under the seed; default all. */
  readonly layers?: number | 'all';
  readonly holds?: readonly Vec2[];
}

export interface BurnishParams {
  /** The folded edge to crease, as a line on the table plane. */
  readonly line: PlaneLine;
  /** Range along the line (mm from line.p, along line.d). Omit for the whole crease. */
  readonly from?: number;
  readonly to?: number;
  /** How much sharper, 0..1. Passes add up. */
  readonly amount: number;
}

export interface TurnOverParams {
  /** 'side' flips left-right (F), 'top' flips top-bottom (Shift+F). */
  readonly axis: 'side' | 'top';
}

export interface RotateParams {
  /** Counter-clockwise as seen from above. */
  readonly degrees: number;
}

export type Move =
  | { readonly type: 'fold'; readonly params: FoldParams }
  | { readonly type: 'reverseFold'; readonly params: ReverseFoldParams }
  | { readonly type: 'burnish'; readonly params: BurnishParams }
  | { readonly type: 'turnOver'; readonly params: TurnOverParams }
  | { readonly type: 'rotate'; readonly params: RotateParams };

export type MoveType = Move['type'];

/**
 * Why a move was refused. apps/web maps each code to one short hint (strings.en.ts).
 */
export type ReasonCode =
  /** The grab point isn't on the paper. */
  | 'missed'
  /** Zero-length drag, grab point on the fold line, line misses the paper. */
  | 'degenerate'
  /** The fold reaches layers that weren't picked up: they're joined by an existing fold. */
  | 'joined'
  /** A layer that would move is under one that wouldn't. */
  | 'tucked'
  /** Something is in the path of the motion (3D sweep, Phase 1+). */
  | 'blocked'
  /** A held (pinned) face would have to move. */
  | 'held'
  /** The stack is too thick to crease that sharp. */
  | 'too-thick'
  /** The motion would stretch or tear the paper. */
  | 'tear'
  /** Not supported by this phase of the kernel. */
  | 'unsupported'
  /** The kernel produced an invalid state and refused to commit it (fail closed). */
  | 'internal';

export interface Rejection {
  readonly ok: false;
  readonly reason: ReasonCode;
  /** Faces that block the move, for the warm glow. */
  readonly blockers: readonly FaceId[];
  readonly detail?: string;
  /** For 'joined': how many layers would make a plain fold possible. */
  readonly suggestLayers?: number;
}

/**
 * The exact motion of a committed move. The skin animates exactly this
 * (brief, section 3, "Moves are transactions").
 */
export type Transition =
  | {
      readonly kind: 'fold';
      /** The hinge line on the table plane; its left side is the side that moved. */
      readonly line: Line2;
      /** +1 the moving faces swung up (valley side toward the viewer), −1 down. */
      readonly direction: 1 | -1;
      /** Faces of the NEW state that rotate. */
      readonly moving: readonly FaceId[];
      /** New face -> the old face it came from (identity for faces that weren't split). */
      readonly parentOf: ReadonlyMap<FaceId, FaceId>;
      /** Placement of every new face before the motion. */
      readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
      /** Creases this fold made. */
      readonly newCreases: readonly EdgeId[];
      readonly fromDeg: 0;
      readonly toDeg: 180;
    }
  | {
      readonly kind: 'reverse';
      readonly reverse: 'inside' | 'outside';
      /** ℓ on the table plane; its left side is the tip that moved. */
      readonly line: Line2;
      /** Faces of the NEW state that moved (the tip). */
      readonly moving: readonly FaceId[];
      /** Tip faces attached to the flap's top side, and to its bottom side. */
      readonly top: readonly FaceId[];
      readonly bottom: readonly FaceId[];
      /** Stationary flap faces on its top side and bottom side (they open to let the tip through). */
      readonly flapTop: readonly FaceId[];
      readonly flapBottom: readonly FaceId[];
      /** The spine through P, pointing from P into the flap's body. */
      readonly spine: Line2;
      readonly parentOf: ReadonlyMap<FaceId, FaceId>;
      readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
      readonly newCreases: readonly EdgeId[];
    }
  | { readonly kind: 'burnish'; readonly edges: readonly EdgeId[] }
  | { readonly kind: 'turnOver'; readonly axis: Line2 }
  | { readonly kind: 'rotate'; readonly center: Vec2; readonly degrees: number };

export interface Success {
  readonly ok: true;
  readonly state: KernelState;
  readonly transition: Transition;
}

export type MoveResult = Success | Rejection;

export type StateHash = string;

export interface MoveLabel {
  readonly name: string;
  readonly confidence: number;
}

/** One entry of the op log. */
export interface Op {
  readonly id: OpId;
  readonly move: Move;
  /** Where the user pinched (material + world). */
  readonly grab?: Grip;
  /** Where the other hand pressed. */
  readonly holds: readonly Grip[];
  readonly before: StateHash;
  readonly after: StateHash;
  readonly label?: MoveLabel;
}

export function reject(
  reason: ReasonCode,
  blockers: readonly FaceId[] = [],
  extra: { detail?: string; suggestLayers?: number } = {},
): Rejection {
  return { ok: false, reason, blockers, ...extra };
}
