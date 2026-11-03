import { cross2, type Line2, perpendicularBisector, signedDistance, type Vec2 } from '@paperfold/kernel';
import { axiom1, axiom2, axiom3, axiom4, axiom5, axiom7, imageOf } from './axioms.ts';

export interface SnapPoint {
  readonly point: Vec2;
  readonly kind: 'corner' | 'midpoint';
}

export interface SnapContext {
  /** Corners, crease ends and intersections, midpoints of edges and creases. */
  readonly points: readonly SnapPoint[];
  /** Raw edges, folded edges and creases, as lines on the table plane. */
  readonly lines: readonly Line2[];
  /** Existing creases: fold lines in their own right (refold, unfold, precreases). */
  readonly creases: readonly Line2[];
}

/** Which rule produced the fold line. 0 = an existing crease. */
export type SnapRule = 0 | 1 | 2 | 3 | 4 | 5 | 7 | 'angle' | 'free';

export interface SnappedFold {
  readonly line: Line2;
  /** The grabbed point (snapped to a landmark when one is near). */
  readonly grab: Vec2;
  /** Where the fold puts the grabbed point. */
  readonly image: Vec2;
  readonly rule: SnapRule;
  /** Landmarks the snap used: draw a small ring on each. */
  readonly marks: readonly Vec2[];
}

export interface SnapOptions {
  /** About 12 screen pixels, in mm at the current zoom. */
  readonly radiusMm: number;
  /** Ctrl/Cmd held: no snapping. */
  readonly freehand: boolean;
}

/** Simplest first (brief: prefer the simplest axiom). */
const PRIORITY: Record<string, number> = { '0': 0, '2': 1, '1': 2, '5': 3, '4': 4, '3': 5, '7': 6, angle: 7 };

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lineDist = (l: Line2, p: Vec2) => Math.abs(signedDistance(l, p));

function nearestPoint(points: readonly SnapPoint[], p: Vec2, radius: number): SnapPoint | null {
  let best: SnapPoint | null = null;
  let score = Infinity;
  for (const s of points) {
    const d = dist(s.point, p);
    if (d > radius) continue;
    const k = d * (s.kind === 'corner' ? 0.6 : 1);
    if (k < score) {
      score = k;
      best = s;
    }
  }
  return best;
}

/**
 * Snap a point-to-point drag (brief, section 5, "Snapping"): the grabbed point snaps to a
 * landmark; then every candidate fold line from the Huzita–Justin axioms over nearby
 * landmarks and lines is judged by one test, where it would put the grabbed point compared
 * with where the pointer is, within the snap radius. The simplest rule wins; with nothing
 * nearby, the angle snaps softly to 22.5° steps.
 */
export function snapFold(from: Vec2, to: Vec2, ctx: SnapContext, opts: SnapOptions): SnappedFold | null {
  const r = opts.radiusMm;
  const grabMark = opts.freehand ? null : nearestPoint(ctx.points, from, r);
  const g = grabMark?.point ?? from;
  if (dist(g, to) < Math.max(1e-3, r / 4)) return null;
  const raw = perpendicularBisector(g, to);
  if (opts.freehand) return { line: raw, grab: g, image: to, rule: 'free', marks: [] };

  interface Cand {
    readonly line: Line2;
    readonly rule: Exclude<SnapRule, 'free'>;
    readonly marks: readonly Vec2[];
  }
  const cands: Cand[] = [];
  const add = (lines: Line2[], rule: Cand['rule'], marks: Vec2[]) => {
    for (const line of lines) cands.push({ line, rule, marks });
  };
  const nearTo = ctx.points.filter((p) => dist(p.point, to) <= r);
  const nearLine = ctx.points.filter((p) => lineDist(raw, p.point) <= r && dist(p.point, g) > r).slice(0, 12);
  const linesNearTo = ctx.lines.filter((l) => lineDist(l, to) <= r);
  const perpTo = ctx.lines.filter((m) => Math.abs(cross2(m.d, raw.d)) < Math.sin((6 * Math.PI) / 180));
  const grabLines = ctx.lines.filter((l) => lineDist(l, g) <= r * 0.5);

  for (const c of ctx.creases) add([c], 0, []);
  for (const p of nearTo) add(axiom2(g, p.point), 2, [p.point]);
  for (let i = 0; i < nearLine.length; i++) {
    for (let j = i + 1; j < nearLine.length; j++) add(axiom1(nearLine[i]!.point, nearLine[j]!.point), 1, [nearLine[i]!.point, nearLine[j]!.point]);
  }
  for (const p of nearLine) for (const l of linesNearTo) add(axiom5(g, p.point, l), 5, [p.point]);
  for (const p of nearLine) for (const m of perpTo) add(axiom4(p.point, m), 4, [p.point]);
  for (const e of grabLines) for (const l of linesNearTo) if (e !== l) add(axiom3(e, l), 3, []);
  for (const l of linesNearTo) for (const m of perpTo) if (l !== m) add(axiom7(g, l, m), 7, []);
  // Soft angle snap: 22.5° steps, through the raw line's midpoint.
  const ang = Math.atan2(raw.d[1], raw.d[0]);
  const step = Math.PI / 8;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) < (2.5 * Math.PI) / 180) add([{ p: raw.p, d: [Math.cos(snapped), Math.sin(snapped)] }], 'angle', []);

  let best: { c: Cand; image: Vec2; d: number } | null = null;
  for (const c of cands) {
    if (lineDist(c.line, g) < 1e-6) continue; // the grabbed point must move
    const image = imageOf(c.line, g);
    const d = dist(image, to);
    if (d > r) continue;
    if (
      !best ||
      PRIORITY[String(c.rule)]! < PRIORITY[String(best.c.rule)]! ||
      (PRIORITY[String(c.rule)] === PRIORITY[String(best.c.rule)] && d < best.d)
    ) {
      best = { c, image, d };
    }
  }
  const grabMarks = grabMark ? [grabMark.point] : [];
  if (!best) return { line: raw, grab: g, image: to, rule: 'free', marks: grabMarks };
  return { line: best.c.line, grab: g, image: best.image, rule: best.c.rule, marks: [...grabMarks, ...best.c.marks] };
}
