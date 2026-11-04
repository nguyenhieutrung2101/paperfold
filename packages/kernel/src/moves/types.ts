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
  /**
   * How far to fold, in degrees (default 180: flat). Less leaves the flap standing open at
   * that angle (state/pose.ts); valley folds of a free flap only.
   */
  readonly angleDeg?: number;
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

export interface SquashParams {
  /** The hinge the flap turns on (usually a folded edge), as a line on the table plane. */
  readonly hinge: PlaneLine;
  /** A point on the flap. */
  readonly seed: Vec2;
  /** Layers of the flap under the seed; default all. */
  readonly layers?: number | 'all';
  readonly holds?: readonly Vec2[];
}

export interface PetalParams {
  /** The line the petal lifts on, across the top layer(s), as a line on the table plane. */
  readonly hinge: PlaneLine;
  /** A point on the petal near its tip (the corner that lifts). */
  readonly seed: Vec2;
  /** Layers lifted under the seed; default 1. */
  readonly layers?: number;
  readonly holds?: readonly Vec2[];
}

export interface PleatParams {
  /** The valley line (first), and the mountain line (second), on the table plane. */
  readonly first: PlaneLine;
  readonly second: PlaneLine;
  /** A point past the second line (on the part that ends up on top). */
  readonly seed: Vec2;
  readonly layers?: number | 'all';
  readonly holds?: readonly Vec2[];
}

export interface CrimpParams {
  /** Two lines across a closed flap; the seed is past the second. */
  readonly first: PlaneLine;
  readonly second: PlaneLine;
  readonly seed: Vec2;
  readonly kind?: 'inside' | 'outside';
  readonly holds?: readonly Vec2[];
}

export interface RabbitEarParams {
  /** The triangle (table plane): its tip, and the two ends of its base. */
  readonly tip: Vec2;
  readonly base: readonly [Vec2, Vec2];
  /** A point on the triangle's paper (near the tip). */
  readonly seed: Vec2;
  /** How many layers of the triangle move together. */
  readonly layers?: number | 'all';
  /** Which end of the base the ear lies toward: 'b' (the second, default) or 'a'. */
  readonly side?: 'a' | 'b';
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
  | { readonly type: 'squash'; readonly params: SquashParams }
  | { readonly type: 'petal'; readonly params: PetalParams }
  | { readonly type: 'pleat'; readonly params: PleatParams }
  | { readonly type: 'crimp'; readonly params: CrimpParams }
  | { readonly type: 'rabbitEar'; readonly params: RabbitEarParams }
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
  /** A crease that changes nothing: it's already that sharp there. */
  | 'unchanged'
  /** A flap stands open: this move would have to go through it or move it (lay it down first). */
  | 'posed'
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
      /** 180, or less when the flap was left standing open. */
      readonly toDeg: number;
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
  | {
      readonly kind: 'squash';
      /** From O along the flap's own edge on the hinge. */
      readonly hinge: Line2;
      /** From O along the spine (the flap's folded edge) before the move. */
      readonly spine: Line2;
      /** From O halfway between the two: the new creases. */
      readonly bisector: Line2;
      readonly moving: readonly FaceId[];
      /** Top side: by the hinge (turns over it), and by the spine (folds over the bisector, then the hinge). */
      readonly tNear: readonly FaceId[];
      readonly tFar: readonly FaceId[];
      /** Bottom side: by the spine (folds over the bisector); by the hinge (stays). */
      readonly bFar: readonly FaceId[];
      readonly bNear: readonly FaceId[];
      readonly parentOf: ReadonlyMap<FaceId, FaceId>;
      readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
      readonly newCreases: readonly EdgeId[];
    }
  | {
      readonly kind: 'petal';
      /** The hinge, from X to Y. */
      readonly hinge: Line2;
      readonly x: Vec2;
      readonly y: Vec2;
      /** Unit directions of the folded edges from X and from Y, away from the hinge. */
      readonly edgeX: Vec2;
      readonly edgeY: Vec2;
      /** The petal's tip before the move. */
      readonly apex: Vec2;
      readonly moving: readonly FaceId[];
      /** The petal (turns over the hinge). */
      readonly center: readonly FaceId[];
      /** Its sides, by X and by Y (fold in on the kite lines, then turn with the petal). */
      readonly sideX: readonly FaceId[];
      readonly sideY: readonly FaceId[];
      /** The layers under the sides (fold in on the kite lines). */
      readonly innerX: readonly FaceId[];
      readonly innerY: readonly FaceId[];
      readonly parentOf: ReadonlyMap<FaceId, FaceId>;
      readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
      readonly newCreases: readonly EdgeId[];
    }
  | {
      /**
       * A pleat (two folds made as one step), or a crimp (both sides of a flap pleated at
       * once). The strip between the lines turns over the first; the part past the second turns
       * over both.
       */
      readonly kind: 'pleat' | 'crimp';
      /** Crimps only. */
      readonly reverse?: 'inside' | 'outside';
      /** The two lines (table plane, before the move), each with the part that moves on its left. */
      readonly first: Line2;
      readonly second: Line2;
      readonly moving: readonly FaceId[];
      /** The strip between the lines (turns over the first), and the part past the second. */
      readonly middle: readonly FaceId[];
      readonly far: readonly FaceId[];
      readonly parentOf: ReadonlyMap<FaceId, FaceId>;
      readonly startPlacements: ReadonlyMap<FaceId, Rigid3>;
      readonly newCreases: readonly EdgeId[];
    }
  | {
      /** A rabbit ear: two sides fold in on the bisectors and the ear lies between them. */
      readonly kind: 'rabbitEar';
      readonly tip: Vec2;
      /** The base's end whose side runs on into the ear, and the end the ear lies toward. */
      readonly sideA: Vec2;
      readonly sideB: Vec2;
      /** The incenter (where the four creases meet), and the foot of the ear's crease on side B. */
      readonly center: Vec2;
      readonly foot: Vec2;
      readonly moving: readonly FaceId[];
      readonly a: readonly FaceId[];
      readonly b: readonly FaceId[];
      readonly ear: readonly FaceId[];
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
