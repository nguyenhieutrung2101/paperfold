import {
  applyPlaneIso,
  planeIsoOf,
  sampleSpans,
  type Snapshot,
  type Span,
} from '@paperfold/kernel';
import type { FoldMotion, FoldTransition, PaperMode } from '@paperfold/skin';
import type { ActiveFold } from '../store.ts';

export const TIMING = {
  fold: 520,
  settle: 380,
  crease: 460,
} as const;

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

interface Segment {
  readonly ua: number;
  readonly ub: number;
  readonly spans: readonly Span[];
}

/** The kernel's sharpness and rest angle along the fold's new creases. */
export interface CreaseProfile {
  readonly at: (u: number) => number;
  readonly uMin: number;
  readonly uMax: number;
  /** Largest rest angle magnitude among the new creases (degrees). */
  readonly restDeg: number;
  readonly fullySharp: boolean;
}

export function creaseProfile(snap: Snapshot, tr: FoldTransition): CreaseProfile {
  const segments: Segment[] = [];
  let restDeg = 0;
  let fullySharp = true;
  const ids = new Set(tr.newCreases);
  const l = tr.line;
  for (const c of snap.creases) {
    if (!ids.has(c.id)) continue;
    const face = c.left ?? c.right;
    if (face === null) continue;
    const start = tr.startPlacements.get(face);
    if (!start) continue;
    const iso = planeIsoOf(start);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    const ua = (a[0] - l.p[0]) * l.d[0] + (a[1] - l.p[1]) * l.d[1];
    const ub = (b[0] - l.p[0]) * l.d[0] + (b[1] - l.p[1]) * l.d[1];
    segments.push({ ua, ub, spans: c.sharpness });
    restDeg = Math.max(restDeg, Math.abs(c.restAngleDeg));
    const covered = c.sharpness.reduce((sum, s) => sum + (s.value >= 1 ? s.to - s.from : 0), 0);
    if (covered < 1 - 1e-9) fullySharp = false;
  }
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const s of segments) {
    uMin = Math.min(uMin, s.ua, s.ub);
    uMax = Math.max(uMax, s.ua, s.ub);
  }
  const at = (u: number) => {
    let best = 0;
    for (const s of segments) {
      const lo = Math.min(s.ua, s.ub);
      const hi = Math.max(s.ua, s.ub);
      if (u < lo || u > hi || hi - lo <= 0) continue;
      best = Math.max(best, sampleSpans(s.spans, (u - s.ua) / (s.ub - s.ua)));
    }
    return best;
  };
  if (segments.length === 0) return { at: () => 1, uMin: 0, uMax: 0, restDeg: 180, fullySharp: true };
  return { at, uMin, uMax, restDeg: restDeg || 180, fullySharp };
}

export interface MotionFrame {
  readonly motion: FoldMotion | null;
  /** True while something is still changing (keep rebuilding frames). */
  readonly animating: boolean;
}

/**
 * The fold's pose at time `now`: swing over soft (the kernel's validated half-turn),
 * spring back toward the kernel's rest angle, and when creased, sharpen from the middle
 * outward the way a fingernail runs along a fold.
 */
export function foldPose(active: ActiveFold, snap: Snapshot, now: number, mode: PaperMode): MotionFrame {
  const reduce = reducedMotion();
  const k = reduce ? 0.35 : 1;
  const profile = creaseProfile(snap, active.transition);
  const t = now - active.startedAt;
  const ideal = mode === 'ideal';
  const restTheta = ideal ? Math.PI : (profile.restDeg * Math.PI) / 180;

  let theta: number;
  let animating = true;
  if (t < TIMING.fold * k) {
    theta = Math.PI * easeInOut(clamp01(t / (TIMING.fold * k)));
  } else if (t < (TIMING.fold + TIMING.settle) * k) {
    const s = easeOut(clamp01((t - TIMING.fold * k) / (TIMING.settle * k)));
    theta = Math.PI + (restTheta - Math.PI) * s;
  } else {
    theta = restTheta;
    animating = false;
  }

  let sharpnessAt = profile.at;
  if (active.creasedAt !== null) {
    const tc = clamp01((now - active.creasedAt) / (TIMING.crease * k));
    const mid = (profile.uMin + profile.uMax) / 2;
    const half = (profile.uMax - profile.uMin) / 2 + 1e-6;
    const ramp = Math.max(4, half * 0.25);
    const reach = (half + ramp) * easeOut(tc);
    const base = profile.at;
    // Not yet sharp in the kernel's eyes? The sweep still shows the finger passing.
    sharpnessAt = (u: number) => Math.max(base(u) * tc, clamp01((reach - Math.abs(u - mid)) / ramp));
    const restCreased = Math.PI;
    theta = theta + (restCreased - theta) * easeOut(tc);
    animating = tc < 1;
    if (!animating && profile.fullySharp) return { motion: null, animating: false };
  } else if (ideal && !animating) {
    return { motion: null, animating: false };
  }

  return {
    motion: { before: active.before, transition: active.transition, theta, sharpnessAt },
    animating,
  };
}
