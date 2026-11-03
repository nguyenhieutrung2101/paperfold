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
