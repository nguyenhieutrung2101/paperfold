/**
 * Placeholder material model for crease memory and springback.
 *
 * APPROXIMATION (Phase 0): these are hand-tuned curves, not measured data. They give the
 * right qualitative behavior (stiffer paper springs back more, sharp creases stay put,
 * thick stacks can't go fully sharp) and live in one place so Phase 2 paper presets can
 * replace them.
 */

/** Degrees an uncreased fold opens when let go, for stiffness 0..1. */
export function springbackDeg(stiffness: number): number {
  return 8 + 30 * clamp01(stiffness);
}

/** Rest angle magnitude of a folded crease with the given peak sharpness. */
export function foldedRestDeg(stiffness: number, sharpness: number): number {
  return 180 - springbackDeg(stiffness) * (1 - clamp01(sharpness));
}

/** Degrees of memory an unfolded crease keeps (visible under raking light). */
export function memoryDeg(sharpness: number): number {
  return 2 + 6 * clamp01(sharpness);
}

/** How sharp a crease can get through n stacked layers. */
export function maxSharpness(layers: number): number {
  if (layers <= 8) return 1;
  return Math.max(0.3, 1 - (layers - 8) / 40);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
