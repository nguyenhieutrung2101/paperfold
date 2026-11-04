import type { Line2, Move, PlaneLine, Snapshot, Vec2 } from '@paperfold/kernel';

/**
 * The mirror tool (Phase 2): with it on, every fold is followed by its mirror image across the
 * model's middle line, the way symmetric models are folded ("repeat on the other side").
 *
 * The mirror line is the model's own line of symmetry closest to the screen's vertical (its
 * outline must map onto itself), or the vertical through its middle when it has none.
 */
export function mirrorAxis(snap: Snapshot): Line2 {
  const pts: Vec2[] = [];
  for (const f of snap.faces) {
    const iso = f.placement;
    for (const m of f.material) {
      // Table plane of a flat placement: x = world x, y = −world z.
      const wx = iso.r[0] * m[0] + iso.r[1] * m[1] + iso.t[0];
      const wz = iso.r[6] * m[0] + iso.r[7] * m[1] + iso.t[2];
      pts.push([wx, -wz]);
    }
  }
  const hull = convexHull(pts);
  const c = hull.reduce((a, p) => [a[0] + p[0] / hull.length, a[1] + p[1] / hull.length] as Vec2, [0, 0] as Vec2);
  const size = Math.max(1, ...hull.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  const dirs: Vec2[] = [[0, 1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [1, 0]];
  for (const d of dirs) {
    const ax: Line2 = { p: c, d };
    const ok = hull.every((p) => {
      const q = reflect(ax, p);
      return hull.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-3 * size);
    });
    if (ok) return ax;
  }
  return { p: c, d: [0, 1] };
}

function reflect(l: Line2, q: Vec2): Vec2 {
  const dx = q[0] - l.p[0];
  const dy = q[1] - l.p[1];
  const t = dx * l.d[0] + dy * l.d[1];
  return [l.p[0] + 2 * t * l.d[0] - dx, l.p[1] + 2 * t * l.d[1] - dy];
}

const reflectDir = (l: Line2, d: Vec2): Vec2 => {
  const t = d[0] * l.d[0] + d[1] * l.d[1];
  return [2 * t * l.d[0] - d[0], 2 * t * l.d[1] - d[1]];
};

const mirrorLine = (ax: Line2, l: PlaneLine): PlaneLine => ({ p: reflect(ax, l.p), d: reflectDir(ax, l.d) });

/** The same line (within a hair)? Then a fold along it has no separate mirror image. */
function sameLine(a: PlaneLine, b: PlaneLine): boolean {
  const la = Math.hypot(a.d[0], a.d[1]) || 1;
  const lb = Math.hypot(b.d[0], b.d[1]) || 1;
  const cross = (a.d[0] * b.d[1] - a.d[1] * b.d[0]) / (la * lb);
  const off = ((b.p[0] - a.p[0]) * a.d[1] - (b.p[1] - a.p[1]) * a.d[0]) / la;
  return Math.abs(cross) < 1e-6 && Math.abs(off) < 1e-3;
}

/** The mirror image of a fold-like move, or null if it has none (or is its own). */
export function mirrorMove(move: Move, ax: Line2): Move | null {
  const pts = (hs: readonly Vec2[] | undefined) => (hs ?? []).map((h) => reflect(ax, h));
  switch (move.type) {
    case 'fold': {
      const line = mirrorLine(ax, move.params.line);
      if (sameLine(line, move.params.line)) return null;
      return { type: 'fold', params: { ...move.params, line, seed: reflect(ax, move.params.seed), holds: pts(move.params.holds) } };
    }
    case 'reverseFold': {
      const line = mirrorLine(ax, move.params.line);
      if (sameLine(line, move.params.line)) return null;
      return { type: 'reverseFold', params: { ...move.params, line, seed: reflect(ax, move.params.seed), holds: pts(move.params.holds) } };
    }
    case 'squash':
    case 'petal': {
      const hinge = mirrorLine(ax, move.params.hinge);
      if (sameLine(hinge, move.params.hinge)) return null;
      return { type: move.type, params: { ...move.params, hinge, seed: reflect(ax, move.params.seed), holds: pts(move.params.holds) } } as Move;
    }
    case 'pleat':
    case 'crimp': {
      const first = mirrorLine(ax, move.params.first);
      if (sameLine(first, move.params.first)) return null;
      return { type: move.type, params: { ...move.params, first, second: mirrorLine(ax, move.params.second), seed: reflect(ax, move.params.seed), holds: pts(move.params.holds) } } as Move;
    }
    case 'rabbitEar': {
      const tip = reflect(ax, move.params.tip);
      if (Math.hypot(tip[0] - move.params.tip[0], tip[1] - move.params.tip[1]) < 1e-3) return null;
      const base: [Vec2, Vec2] = [reflect(ax, move.params.base[0]), reflect(ax, move.params.base[1])];
      return { type: 'rabbitEar', params: { ...move.params, tip, base, seed: reflect(ax, move.params.seed), holds: pts(move.params.holds) } };
    }
    default:
      return null;
  }
}

export function convexHull(points: readonly Vec2[]): Vec2[] {
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
