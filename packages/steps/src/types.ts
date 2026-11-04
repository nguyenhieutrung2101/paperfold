import type { BaseName, FaceId, KernelState, Line2, Move, MoveName, OpId, Transition, Vec2 } from '@paperfold/kernel';

export type StepKind = 'fold' | 'precrease' | 'unfold' | 'reverse' | 'squash' | 'petal' | 'pleat' | 'crimp' | 'rabbit-ear' | 'crease' | 'turn-over' | 'rotate';

/** Where something is, in words the app can phrase: "the bottom corner", "the left edge". */
export interface Place {
  readonly v: 'top' | 'middle' | 'bottom';
  readonly h: 'left' | 'center' | 'right';
  readonly what: 'corner' | 'edge' | 'point' | 'tip';
}

export type Direction = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

/**
 * Caption as data. The app turns it into one short sentence with strings.en.ts, so every
 * word the user reads lives in one file (brief, section 8).
 */
export type Caption =
  | {
      readonly kind: 'fold';
      readonly from: Place;
      readonly dir: Direction;
      readonly to: Place | null;
      readonly mountain: boolean;
      /** Stop partway, at this angle (the flap stands open). */
      readonly stopDeg?: number;
    }
  | { readonly kind: 'precrease'; readonly from: Place; readonly dir: Direction; readonly to: Place | null }
  | { readonly kind: 'unfold'; readonly from: Place }
  | { readonly kind: 'reverse'; readonly reverse: 'inside' | 'outside'; readonly tip: Place }
  | { readonly kind: 'squash' }
  | { readonly kind: 'pleat'; readonly swivel?: boolean }
  | { readonly kind: 'crimp'; readonly reverse: 'inside' | 'outside' }
  | { readonly kind: 'rabbit-ear'; readonly tip: Place }
  | { readonly kind: 'petal'; readonly tip: Place }
  | { readonly kind: 'turn-over'; readonly axis: 'side' | 'top' }
  | { readonly kind: 'rotate'; readonly degrees: number }
  | { readonly kind: 'crease' };

/** Yoshizawa–Randlett diagram symbols, on the table plane of the step's starting state. */
export type DiagramSymbol =
  | { readonly kind: 'valley-line' | 'mountain-line'; readonly a: Vec2; readonly b: Vec2 }
  | {
      readonly kind: 'valley-arrow' | 'mountain-arrow' | 'fold-unfold-arrow';
      readonly from: Vec2;
      readonly to: Vec2;
    }
  | { readonly kind: 'push-arrow'; readonly at: Vec2; readonly dir: Vec2 }
  | { readonly kind: 'turn-over'; readonly axis: 'side' | 'top' }
  | { readonly kind: 'rotate'; readonly degrees: number };

export type HandSide = 'left' | 'right';

/** Pose library (brief, section 7): pinch, flat fingertips, index push, fingernail slide. */
export type HandPose = 'pinch' | 'hold' | 'push' | 'nail';

export interface HandPlan {
  /** The hand that moves the paper: where it pinches (or pushes), in both spaces. */
  readonly folding: {
    readonly hand: HandSide;
    readonly pose: 'pinch' | 'push';
    readonly at: Vec2;
    /** The pinched point of paper, so the hand can follow it through the motion. */
    readonly face: FaceId;
    readonly material: Vec2;
  } | null;
  /** The other hand pressing the stationary part, near the fold, outside the flap's path. */
  readonly holding: { readonly hand: HandSide; readonly pose: 'hold'; readonly at: Vec2 } | null;
  /** Fingernail slide from the middle of the fold outward. */
  readonly crease: { readonly a: Vec2; readonly b: Vec2 } | null;
  /** Folds behind lift the model a little so the folding hand can reach under it. */
  readonly liftModel: boolean;
}

export interface Step {
  readonly index: number;
  readonly kind: StepKind;
  readonly name: MoveName;
  /** Confident enough to show a move-name chip. */
  readonly named: boolean;
  readonly caption: Caption;
  /** The kernel moves this step replays, in order. */
  readonly moves: readonly Move[];
  readonly opIds: readonly OpId[];
  readonly before: KernelState;
  readonly after: KernelState;
  /** The main move's exact transition, for the player to animate. */
  readonly transition: Transition | null;
  /** The main move's fold line (table plane, before state), if it has one. */
  readonly line: Line2 | null;
  readonly creased: boolean;
  readonly symbols: readonly DiagramSymbol[];
  readonly hands: HandPlan;
  /** This step makes a traditional base. */
  readonly base?: BaseName;
  /** The same as an earlier step, on the back or on the other side ("repeat"). */
  readonly repeat?: { readonly of: number; readonly behind: boolean };
}

/** How hard a design is to fold, 1 (very easy) to 5 (complex), from its moves and layers. */
export interface Difficulty {
  readonly level: 1 | 2 | 3 | 4 | 5;
  /** The weighted move count it comes from (for the curious). */
  readonly score: number;
}

export interface StepsResult {
  readonly steps: readonly Step[];
  readonly difficulty: Difficulty;
  /** Replaying every step from a flat sheet reproduces the design. */
  readonly verified: boolean;
  /** When the cleaned-up sequence didn't replay, the step that broke (steps are then uncompressed). */
  readonly brokenAt?: number;
}
