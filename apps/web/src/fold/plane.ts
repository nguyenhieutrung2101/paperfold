import {
  applyPlaneIso,
  containsStrictly,
  type Line2,
  planeIsoOf,
  signedArea,
  type Snapshot,
  toleranceFor,
  type Vec2,
} from '@paperfold/kernel';

/** Each face's outline on the table plane, counter-clockwise. */
export function facePolygons(snap: Snapshot): Array<{ id: number; poly: Vec2[] }> {
  return snap.faces.map((f) => {
    const iso = planeIsoOf(f.placement);
    const poly = f.material.map((p) => applyPlaneIso(iso, p));
    return { id: f.id, poly: signedArea(poly) < 0 ? poly.reverse() : poly };
  });
}

const tol = toleranceFor(1);

export function onPaper(snap: Snapshot, p: Vec2): boolean {
  return facePolygons(snap).some((f) => containsStrictly(f.poly, p, tol));
}

export function layersAt(snap: Snapshot, p: Vec2): number {
  return facePolygons(snap).filter((f) => containsStrictly(f.poly, p, tol)).length;
}

export interface Footprint {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function footprint(snap: Snapshot): Footprint {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of facePolygons(snap)) {
    for (const p of f.poly) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** The part of a line inside the footprint box (grown by `pad`), or null. */
export function clipLineToBox(l: Line2, box: Footprint, pad: number): [Vec2, Vec2] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const lo = [box.minX - pad, box.minY - pad];
  const hi = [box.maxX + pad, box.maxY + pad];
  for (let k = 0; k < 2; k++) {
    const p = l.p[k]!;
    const d = l.d[k]!;
    if (Math.abs(d) < 1e-12) {
      if (p < lo[k]! || p > hi[k]!) return null;
      continue;
    }
    const a = (lo[k]! - p) / d;
    const b = (hi[k]! - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [
    [l.p[0] + l.d[0] * t0, l.p[1] + l.d[1] * t0],
    [l.p[0] + l.d[0] * t1, l.p[1] + l.d[1] * t1],
  ];
}

/**
 * The grab point for a press at p: p itself when it's on the paper, else the nearest
 * point just inside the paper if that's within `margin` mm, else null.
 */
export function grabPoint(snap: Snapshot, p: Vec2, margin: number): Vec2 | null {
  const polys = facePolygons(snap);
  // Strictly inside by more than the kernel's length tolerance (1e-6 of the sheet), or the
  // kernel reads it as on the edge: anything closer than INSET gets nudged in like a near miss.
  const INSET = 0.05;
  const inside = polys.some((f) => containsStrictly(f.poly, p, tol));
  if (inside && polys.every((f) => !containsStrictly(f.poly, p, tol) || edgeDistance(f.poly, p) > INSET)) return p;
  let best: Vec2 | null = null;
  let bestD = inside ? INSET : margin;
  for (const { poly } of polys) {
    const c = poly.reduce((acc, q) => [acc[0] + q[0] / poly.length, acc[1] + q[1] / poly.length] as Vec2, [0, 0] as Vec2);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const q: Vec2 = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) {
        bestD = d;
        // Nudge 0.05 mm toward the face's middle so the grab is strictly inside.
        const cx = c[0] - q[0];
        const cy = c[1] - q[1];
        const l = Math.hypot(cx, cy) || 1;
        best = [q[0] + (cx / l) * INSET, q[1] + (cy / l) * INSET];
      }
    }
  }
  return best;
}

/** Distance from p to the nearest edge of a polygon. */
function edgeDistance(poly: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]));
  }
  return best;
}
