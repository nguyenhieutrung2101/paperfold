/**
 * @paperfold/intent: turns pointer, touch and pen input into candidate moves. It decides
 * what you meant; the kernel decides what's possible.
 *
 * - snap.ts: point-to-point folding snapped by the Huzita–Justin axioms 1–5 and 7.
 * - candidates.ts: every move one drag could mean, and their order (Tab cycles).
 * - gestures.ts: crease strokes vs grabs, and pushing a spine in along a precrease.
 */
export * from './axioms.ts';
export * from './snap.ts';
export * from './candidates.ts';
export * from './gestures.ts';
import type { SnapContext } from './snap.ts';
import {
  applyPlaneIso,
  cross2,
  type Line2,
  perpendicularBisector,
  planeIsoOf,
  signedDistance,
  type Snapshot,
  type Vec2,
} from '@paperfold/kernel';

export interface Landmark {
  readonly point: Vec2;
  readonly kind: 'corner' | 'midpoint';
}

/** World-plane landmarks: every vertex, and midpoints of raw edges and creases. */
export function landmarks(snap: Snapshot): Landmark[] {
  const out: Landmark[] = [];
  const seen = new Set<string>();
  const key = (p: Vec2) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const push = (point: Vec2, kind: Landmark['kind']) => {
    const k = key(point);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ point, kind });
  };
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  for (const f of snap.faces) {
    const iso = planeIsoOf(f.placement);
    for (const p of f.material) push(applyPlaneIso(iso, p), 'corner');
  }
  for (const c of snap.creases) {
    const f = byId.get((c.left ?? c.right)!)!;
    const iso = planeIsoOf(f.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'midpoint');
  }
  return out;
}

/** The nearest landmark within `radius` (mm), preferring corners over midpoints. */
export function snapPoint(p: Vec2, marks: readonly Landmark[], radius: number): Landmark | null {
  let best: Landmark | null = null;
  let bestScore = Infinity;
  for (const m of marks) {
    const d = Math.hypot(m.point[0] - p[0], m.point[1] - p[1]);
    if (d > radius) continue;
    const score = d * (m.kind === 'corner' ? 0.6 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** World-plane lines of every interior crease (deduplicated). */
export function creaseLines(snap: Snapshot): Line2[] {
  const out: Line2[] = [];
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  for (const c of snap.creases) {
    if (c.left === null || c.right === null) continue;
    const iso = planeIsoOf(byId.get(c.left)!.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const line: Line2 = { p: a, d: [dx / l, dy / l] };
    if (out.some((o) => Math.abs(cross2(o.d, line.d)) < 1e-9 && Math.abs(signedDistance(o, a)) < 1e-6)) continue;
    out.push(line);
  }
  return out;
}

export interface FoldGuess {
  /** The fold line on the table plane. */
  readonly line: Line2;
  /** The grab point (moving side). */
  readonly seed: Vec2;
  readonly snappedFrom: Landmark | null;
  readonly snappedTo: Landmark | null;
  /** True when the line was snapped onto an existing crease. */
  readonly onCrease: boolean;
}

export interface SnapOptions {
  /** Snap radius in mm (about 12 screen px at the current zoom). */
  readonly radiusMm: number;
  /** Ctrl/Cmd: freehand, no snapping. */
  readonly freehand: boolean;
}

/**
 * Point-to-point fold: the grabbed point `from` lands on `to`. Returns null for a drag
 * too short to define a line.
 */
export function guessFold(
  from: Vec2,
  to: Vec2,
  marks: readonly Landmark[],
  creases: readonly Line2[],
  opts: SnapOptions,
): FoldGuess | null {
  const sf = opts.freehand ? null : snapPoint(from, marks, opts.radiusMm);
  const st = opts.freehand ? null : snapPoint(to, marks, opts.radiusMm);
  const a = sf?.point ?? from;
  const b = st?.point ?? to;
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < Math.max(1e-3, opts.radiusMm / 4)) return null;
  let line = perpendicularBisector(a, b);
  let onCrease = false;
  if (!opts.freehand) {
    // Prefer an existing crease when the bisector nearly matches it near the grab.
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let bestD = Infinity;
    for (const c of creases) {
      const angle = Math.abs(cross2(c.d, line.d));
      if (angle > 0.07) continue;
      const d = Math.abs(signedDistance(c, mid));
      if (d < opts.radiusMm && d < bestD) {
        bestD = d;
        // Keep the grab point on the left (moving) side.
        const flip = signedDistance(c, from) < 0;
        line = flip ? { p: c.p, d: [-c.d[0], -c.d[1]] } : c;
        onCrease = true;
      }
    }
  }
  return { line, seed: from, snappedFrom: sf, snappedTo: st, onCrease };
}

/** Everything snapping needs from a snapshot: landmarks, edge lines, crease lines. */
export function snapContext(snap: Snapshot): SnapContext {
  const points = landmarks(snap).map((l) => ({ point: l.point, kind: l.kind }));
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  const lines: Line2[] = [];
  for (const c of snap.creases) {
    const iso = planeIsoOf(byId.get((c.left ?? c.right)!)!.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const line: Line2 = { p: a, d: [dx / l, dy / l] };
    if (lines.some((o) => Math.abs(cross2(o.d, line.d)) < 1e-9 && Math.abs(signedDistance(o, a)) < 1e-6)) continue;
    lines.push(line);
  }
  return { points, lines, creases: creaseLines(snap) };
}
