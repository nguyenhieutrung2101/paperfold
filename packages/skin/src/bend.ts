/**
 * Cross-section of one layer of a fold in motion (brief, section 4).
 *
 * Work in the plane perpendicular to the fold line: X is the horizontal distance from the
 * line toward where the moving part started (+), Y is height above the table. A material
 * point that started at distance x ≥ 0 from the line, on a layer whose mid-surface sits at
 * h0 before the fold and h1 after it, is placed at bendPoint(x, ...) when the fold has
 * turned by theta (0..π).
 *
 * Soft folds are developable bends: an uncreased fold wraps a cylinder of radius
 * R = r0 + rho around the fold line, where rho is the soft radius and r0 = |h1 − h0| / 2
 * is half the stack it wraps around (r_i = r_0 + i·t, so outer layers wrap inner ones).
 * Paper within rho·theta of the line rides the arc at unit speed (arc length = material
 * length: a cylinder is developable, no stretch), the rest stays flat and rigid. Material
 * spent on the arc comes off the flap: that's creep, and it shrinks as the crease sharpens.
 *
 * The thickness part of the arc (angle theta·r0/R, next to the stationary layer) carries no
 * material: it is drawn as a fillet. APPROXIMATION: that adds about r0·theta of paper per
 * folded layer (about 1.6 mm for the outermost of 16 layers of kami). Phase 2 thickness accommodation removes it.
 *
 * When rho = 0, or for layers that move the "wrong" way for a wrap (an unfold, where the
 * layer ends lower than it started on a valley), the layer turns rigidly about the axis
 * midway between its start and end heights, which lands it exactly at h1.
 */
export interface BendLayer {
  /** Start mid-surface height (mm). */
  readonly h0: number;
  /** End mid-surface height (mm). */
  readonly h1: number;
  /** +1 the moving part swings up (valley side toward the viewer), −1 down. */
  readonly sigma: 1 | -1;
}

export function bendPoint(x: number, layer: BendLayer, theta: number, rho: number): [number, number] {
  const { h0, h1, sigma } = layer;
  if (rho <= 0 || sigma * (h1 - h0) < 0) {
    const H = (h0 + h1) / 2;
    const rx = x;
    const ry = h0 - H;
    const a = sigma * theta;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [rx * c - ry * s, H + rx * s + ry * c];
  }
  const r0 = Math.abs(h1 - h0) / 2;
  const R = r0 + rho;
  const cy = h0 + sigma * R;
  const phiF = (theta * r0) / R;
  const m = rho * theta;
  if (x <= m) {
    const phi = phiF + x / R;
    return [R * Math.sin(phi), cy - sigma * R * Math.cos(phi)];
  }
  const e = x - m;
  return [R * Math.sin(theta) + e * Math.cos(theta), cy - sigma * R * Math.cos(theta) + sigma * e * Math.sin(theta)];
}

/** Unit tangent d(bendPoint)/dx: the direction the paper runs, away from the fold line. */
export function bendTangent(x: number, layer: BendLayer, theta: number, rho: number): [number, number] {
  const { h0, h1, sigma } = layer;
  if (rho <= 0 || sigma * (h1 - h0) < 0) {
    const a = sigma * theta;
    return [Math.cos(a), Math.sin(a)];
  }
  const r0 = Math.abs(h1 - h0) / 2;
  const R = r0 + rho;
  const m = rho * theta;
  const phi = x <= m ? (theta * r0) / R + x / R : theta;
  return [Math.cos(phi), sigma * Math.sin(phi)];
}

/** Material length the arc consumes: how far the flap's edge creeps toward the fold. */
export function creep(theta: number, rho: number): number {
  return rho * theta;
}
