/**
 * Tolerances are relative to the paper size (brief, section 3, "Robustness").
 *
 * Two bands, on purpose:
 *
 * - `weld`: a vertex this close to a fold line IS on it, and the cut goes through it.
 *   Kept tiny (rounding-error scale) because a welded vertex that is really off the
 *   line tilts the crease through it, and a tilted short crease would swing the faces
 *   beyond it far out of place.
 * - `len`: lengths, widths and gaps at or below this are zero for every "does it have
 *   positive length/area" decision and for validation comparisons. A fold line that
 *   passes between `weld` and a few `len` of a vertex would cut a sliver thinner than
 *   anything we can reason about, so the fold refuses it (snapping avoids it in the UI).
 *
 * Every side-of-line decision goes through `side()` in line.ts: the band first, then an
 * exact orientation predicate outside it.
 */
export interface Tolerance {
  /** Lengths (mm) at or below this are treated as zero. */
  readonly len: number;
  /** Points (mm) this close to a fold line are welded onto it. */
  readonly weld: number;
  /** Angles (radians) at or below this are treated as zero. */
  readonly angle: number;
}

/** 1e-6 of the sheet size: 0.15 µm on a 150 mm sheet. */
export const RELATIVE_LENGTH_TOLERANCE = 1e-6;
/** 1e-9 of the sheet size: well above double rounding, far below anything physical. */
export const RELATIVE_WELD_TOLERANCE = 1e-9;

export function toleranceFor(sizeMm: number): Tolerance {
  if (!(sizeMm > 0)) throw new RangeError('Paper size must be positive');
  return { len: sizeMm * RELATIVE_LENGTH_TOLERANCE, weld: sizeMm * RELATIVE_WELD_TOLERANCE, angle: 1e-7 };
}
