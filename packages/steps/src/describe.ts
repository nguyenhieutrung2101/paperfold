import { flatView, type KernelState, type Vec2 } from '@paperfold/kernel';
import type { Direction, Place } from './types.ts';

/** Outline of the model on the table: convex hull of every face vertex. */
export function footprintHull(state: KernelState): Vec2[] {
  const view = flatView(state);
  if (!view) return [];
  return footprintHullOf([...view.vertexWorld.values()]);
}

/** Convex hull of points (counter-clockwise). */
export function footprintHullOf(points: readonly Vec2[]): Vec2[] {
  // Snap to a 1e-6 mm grid and drop duplicates first: copies of one corner that differ by
  // rounding noise would otherwise sort out of line order and knock real corners off the hull.
  const seen = new Map<string, Vec2>();
  for (const q of points) {
    const r: Vec2 = [Math.round(q[0] * 1e6) / 1e6, Math.round(q[1] * 1e6) / 1e6];
    seen.set(`${r[0]},${r[1]}`, r);
  }
  const pts = [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Describe a point of the model relative to the current view, the way a diagram caption
 * would: "the bottom corner", "the left edge", "the middle".
 */
export function placeOf(state: KernelState, p: Vec2, hull = footprintHull(state), near = 1.5): Place {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of hull) {
    minX = Math.min(minX, q[0]);
    maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]);
    maxY = Math.max(maxY, q[1]);
  }
  const u = (p[0] - minX) / Math.max(1e-9, maxX - minX);
  const w = (p[1] - minY) / Math.max(1e-9, maxY - minY);
  const h: Place['h'] = u < 0.34 ? 'left' : u > 0.66 ? 'right' : 'center';
  const v: Place['v'] = w < 0.34 ? 'bottom' : w > 0.66 ? 'top' : 'middle';
  let what: Place['what'] = 'point';
  if (hull.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= near)) what = 'corner';
  else {
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!;
      const b = hull[(i + 1) % hull.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l === 0) continue;
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (l * l);
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l;
      if (t >= 0 && t <= 1 && d <= near) {
        what = 'edge';
        break;
      }
    }
  }
  return { v, h, what };
}

/** Which way something travels, in screen terms (the default view is top-down, y up). */
export function directionOf(from: Vec2, to: Vec2): Direction {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const l = Math.hypot(dx, dy) || 1;
  const x = dx / l;
  const y = dy / l;
  if (Math.abs(x) > 0.38 && Math.abs(y) > 0.38) return `${y > 0 ? 'up' : 'down'}-${x > 0 ? 'right' : 'left'}`;
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 'up' : 'down';
  return x > 0 ? 'right' : 'left';
}
