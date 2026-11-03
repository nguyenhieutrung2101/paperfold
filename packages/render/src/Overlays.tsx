import { Line } from '@react-three/drei';
import type { Vec2 } from '@paperfold/kernel';

const toWorld = (p: Vec2, y: number): [number, number, number] => [p[0], y, -p[1]];

export interface FoldLineProps {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly height: number;
  readonly kind: 'valley' | 'mountain';
  readonly color: string;
}

/**
 * Diagram-style fold line drawn on the paper (Yoshizawa–Randlett): dashed for a valley
 * fold, dash-dot for a mountain fold.
 */
export function FoldLine({ a, b, height, kind, color }: FoldLineProps) {
  if (kind === 'valley') {
    return (
      <Line points={[toWorld(a, height), toWorld(b, height)]} color={color} lineWidth={2} dashed dashSize={4} gapSize={2.5} />
    );
  }
  // Dash-dot: draw dashes and dots as separate dashed lines offset along the line.
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const segs: Array<[[number, number, number], [number, number, number]]> = [];
  for (let t = 0; t < len; t += 8) {
    const t1 = Math.min(len, t + 4);
    segs.push([toWorld([a[0] + (dx * t) / len, a[1] + (dy * t) / len], height), toWorld([a[0] + (dx * t1) / len, a[1] + (dy * t1) / len], height)]);
    const td = t + 5.6;
    if (td + 0.8 < len) {
      segs.push([
        toWorld([a[0] + (dx * td) / len, a[1] + (dy * td) / len], height),
        toWorld([a[0] + (dx * (td + 0.8)) / len, a[1] + (dy * (td + 0.8)) / len], height),
      ]);
    }
  }
  return (
    <>
      {segs.map((s, i) => (
        <Line key={i} points={s} color={color} lineWidth={2} />
      ))}
    </>
  );
}

export interface OutlineProps {
  readonly polygons: ReadonlyArray<readonly Vec2[]>;
  readonly height: number;
  readonly color: string;
  readonly opacity?: number;
}

/** Faint outline of where the flap will land. */
export function GhostOutline({ polygons, height, color, opacity = 0.55 }: OutlineProps) {
  return (
    <>
      {polygons.map((poly, i) => (
        <Line
          key={i}
          points={[...poly, poly[0]!].map((p) => toWorld(p, height))}
          color={color}
          lineWidth={1.5}
          transparent
          opacity={opacity}
        />
      ))}
    </>
  );
}

export interface RingProps {
  readonly at: Vec2;
  readonly height: number;
  readonly radius: number;
  readonly color: string;
}

/** Small ring on a snapped landmark. */
export function SnapRing({ at, height, radius, color }: RingProps) {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(toWorld([at[0] + Math.cos(a) * radius, at[1] + Math.sin(a) * radius], height));
  }
  return <Line points={pts} color={color} lineWidth={2} />;
}

export interface ArrowProps {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly height: number;
  readonly color: string;
  /** valley: filled head; mountain: open head; both: heads at both ends (fold and unfold). */
  readonly kind: 'valley' | 'mountain' | 'both';
  /** 0..1: how much of the arrow to draw (it grows along its path). */
  readonly progress?: number;
}

/**
 * Yoshizawa–Randlett fold arrow: an arc over the paper from where the paper is to where it
 * goes. Valley arrows have a filled head, mountain arrows a hollow one.
 */
export function FoldArrow({ from, to, height, color, kind, progress = 1 }: ArrowProps) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  const lift = Math.min(40, len * 0.3);
  const n = 32;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= Math.round(n * progress); i++) {
    const t = i / n;
    pts.push([from[0] + dx * t, height + Math.sin(Math.PI * t) * lift, -(from[1] + dy * t)]);
  }
  if (pts.length < 2) return null;
  const head = (tip: [number, number, number], prev: [number, number, number], filled: boolean) => {
    const vx = tip[0] - prev[0];
    const vz = tip[2] - prev[2];
    const vy = tip[1] - prev[1];
    const l = Math.hypot(vx, vy, vz) || 1;
    const ux = vx / l;
    const uy = vy / l;
    const uz = vz / l;
    // Perpendicular in the horizontal plane.
    const px = -uz;
    const pz = ux;
    const s = 5;
    const a: [number, number, number] = [tip[0] - ux * s + px * s * 0.55, tip[1] - uy * s, tip[2] - uz * s + pz * s * 0.55];
    const b: [number, number, number] = [tip[0] - ux * s - px * s * 0.55, tip[1] - uy * s, tip[2] - uz * s - pz * s * 0.55];
    return filled ? (
      <Line points={[a, tip, b, a]} color={color} lineWidth={3} />
    ) : (
      <Line points={[a, tip, b]} color={color} lineWidth={2} />
    );
  };
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  return (
    <>
      <Line points={pts} color={color} lineWidth={2} />
      {progress >= 0.98 && head(last, prev, kind !== 'mountain')}
      {progress >= 0.98 && kind === 'both' && head(pts[0]!, pts[1]!, true)}
    </>
  );
}

/** Push arrow (reverse folds, sinks): a hollow arrow pressing on the spine. */
export function PushArrow({ at, dir, height, color }: { readonly at: Vec2; readonly dir: Vec2; readonly height: number; readonly color: string }) {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const u: Vec2 = [dir[0] / l, dir[1] / l];
  const p: Vec2 = [-u[1], u[0]];
  const L = 16;
  const W = 3.2;
  const H = 6.5;
  // The arrow starts at `at` and points along `dir`.
  const base = at;
  const tip: Vec2 = [at[0] + u[0] * L, at[1] + u[1] * L];
  const neck: Vec2 = [tip[0] - u[0] * (L * 0.45), tip[1] - u[1] * (L * 0.45)];
  const pt = (q: Vec2, s: number): [number, number, number] => [q[0] + p[0] * s, height, -(q[1] + p[1] * s)];
  const outline = [pt(tip, 0), pt(neck, H), pt(neck, W), pt(base, W), pt(base, -W), pt(neck, -W), pt(neck, -H), pt(tip, 0)];
  return <Line points={outline} color={color} lineWidth={2.5} />;
}
