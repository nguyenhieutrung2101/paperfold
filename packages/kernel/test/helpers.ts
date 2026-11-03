import {
  applyMove,
  checkInvariants,
  createSheet,
  flatView,
  type FoldParams,
  type KernelState,
  type Move,
  type MoveResult,
  type Vec2,
} from '../src/index.ts';

/** A 100 mm square centered on the origin: table coordinates x, y in [-50, 50]. */
export function sheet(): KernelState {
  return createSheet({ sizeMm: 100 });
}

export function foldMove(p: Vec2, d: Vec2, seed: Vec2, layers: FoldParams['layers'] = 'all', direction: FoldParams['direction'] = 'valley'): Move {
  return { type: 'fold', params: { line: { p, d }, seed, layers, direction } };
}

export function mustApply(state: KernelState, move: Move): KernelState {
  const r = applyMove(state, move);
  if (!r.ok) throw new Error(`Move refused: ${r.reason} ${r.detail ?? ''}`);
  const v = checkInvariants(r.state);
  if (v.length) throw new Error(`Invalid result: ${v.map((x) => x.message).join('; ')}`);
  return r.state;
}

export function apply(state: KernelState, move: Move): MoveResult {
  return applyMove(state, move);
}

/** Vertical book fold: right half over onto the left half. */
export function bookFold(s = sheet()): KernelState {
  return mustApply(s, foldMove([0, 0], [0, 1], [25, 0]));
}

export function faceCount(s: KernelState): number {
  return s.cp.faces.size;
}

/** Footprint of the folded model on the table. */
export function footprint(s: KernelState): { minX: number; maxX: number; minY: number; maxY: number } {
  const v = flatView(s)!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of v.box.values()) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, maxX, minY, maxY };
}
