/**
 * @paperfold/kernel: the single source of truth for the paper's exact state.
 * Pure TypeScript, deterministic, no DOM, no three.js.
 */
export * from './geometry/vec.ts';
export * from './geometry/tolerance.ts';
export * from './geometry/predicates.ts';
export * from './geometry/line.ts';
export * from './geometry/polygon.ts';
export * from './geometry/rigid.ts';

export * from './paper/types.ts';
export * from './paper/creasePattern.ts';
export * from './paper/spans.ts';
export * from './paper/physics.ts';

export * from './state/types.ts';
export * from './state/create.ts';
export * from './state/order.ts';
export * from './state/flat.ts';
export * from './state/derive.ts';
export * from './state/levels.ts';
export * from './state/equivalence.ts';
export * from './state/solveOrder.ts';

export * from './moves/types.ts';
export { fold } from './moves/fold.ts';
export { reverseFold } from './moves/reverse.ts';
export { squashFold } from './moves/squash.ts';
export { petalFold } from './moves/petal.ts';
export { applyMultiMotion, type Cut, type MotionGroup, type MultiBuild, type MultiSpec } from './moves/multi.ts';
export * from './moves/foldCore.ts';
export { burnish } from './moves/burnish.ts';
export { turnOver, rotate, footprintCenter } from './moves/turn.ts';
export { applyMove } from './moves/apply.ts';

export * from './validate/invariants.ts';
export * from './recognize/recognize.ts';

export * from './history/hash.ts';
export * from './history/history.ts';

export * from './io/fold.ts';
export * from './snapshot.ts';
