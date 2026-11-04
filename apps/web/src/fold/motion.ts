import {
  applyPlaneIso,
  planeIsoOf,
  sampleSpans,
  type Snapshot,
  type Span,
} from '@paperfold/kernel';
import { type FoldMotion, motionLine, type MotionTransition, type PaperMode } from '@paperfold/skin';
import type { CreaseOverlay } from '../store.ts';
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

export function creaseProfile(snap: Snapshot, tr: MotionTransition): CreaseProfile {
  const segments: Segment[] = [];
  let restDeg = 0;
  let fullySharp = true;
  const ids = new Set(tr.newCreases);
  const l = motionLine(tr);
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
  if (segments.length === 0) return { at: () => 1, uMin: 0, uMax: 0, restDeg: 180, fullySharp: true };
  const raw = (u: number) => {
    let best = 0;
    for (const s of segments) {
      const lo = Math.min(s.ua, s.ub);
      const hi = Math.max(s.ua, s.ub);
      if (u < lo || u > hi || hi - lo <= 0) continue;
      best = Math.max(best, sampleSpans(s.spans, (u - s.ua) / (s.ub - s.ua)));
    }
    return best;
  };
  // Paper is stiff: sharpness changes along a fold over a few millimetres, not in a step.
  // Pre-sample on a 0.5 mm grid and smooth with a ±5 mm triangle.
  const step = 0.5;
  const from = Math.min(uMin, uMax) - 6;
  const n = Math.max(2, Math.ceil((Math.max(uMin, uMax) + 6 - from) / step));
  const grid = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) grid[i] = raw(from + i * step);
  const radius = Math.round(5 / step);
  const smoothGrid = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    let sum = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j > n) continue;
      const wk = radius + 1 - Math.abs(k);
      sum += grid[j]! * wk;
      w += wk;
    }
    smoothGrid[i] = Math.max(grid[i]! * 0.6, sum / w);
  }
  const at = (u: number) => {
    const f = (u - from) / step;
    if (f <= 0 || f >= n) return grid[Math.max(0, Math.min(n, Math.round(f)))]!;
    const i = Math.floor(f);
    const t = f - i;
    return smoothGrid[i]! * (1 - t) + smoothGrid[i + 1]! * t;
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
/** A crease stroke on this fold's line adds sharpness where the finger has passed. */
function withOverlay(base: (u: number) => number, tr: MotionTransition, overlay: CreaseOverlay | null): (u: number) => number {
  if (!overlay) return base;
  const l = motionLine(tr);
  const o = overlay.line;
  if (Math.abs(l.d[0] * o.d[1] - l.d[1] * o.d[0]) > 1e-3) return base;
  if (Math.abs((o.p[0] - l.p[0]) * l.d[1] - (o.p[1] - l.p[1]) * l.d[0]) > 0.05) return base;
  // Overlay coordinates are along its own line; map to this line's u.
  const shift = (o.p[0] - l.p[0]) * l.d[0] + (o.p[1] - l.p[1]) * l.d[1];
  const sign = o.d[0] * l.d[0] + o.d[1] * l.d[1] > 0 ? 1 : -1;
  const a = shift + sign * overlay.lo;
  const b = shift + sign * overlay.hi;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return (u) => Math.max(base(u), u >= lo - 2 && u <= hi + 2 ? overlay.value : 0);
}

export function foldPose(
  active: ActiveFold,
  snap: Snapshot,
  now: number,
  mode: PaperMode,
  overlay: CreaseOverlay | null = null,
): MotionFrame {
  const reduce = reducedMotion();
  const k = reduce ? 0.35 : 1;
  const raw = creaseProfile(snap, active.transition);
  const profile = { ...raw, at: withOverlay(raw.at, active.transition, overlay) };
  const t = now - active.startedAt;
  const ideal = mode === 'ideal';
  // A reverse fold's tip is held inside (or around) the flap, and a squash or petal fold is
  // held by its own layers: they don't spring back. They move in stages: a little longer.
  const reverse = active.transition.kind !== 'fold';
  const restTheta = ideal || reverse ? Math.PI : (profile.restDeg * Math.PI) / 180;

  let theta: number;
  let animating = true;
  // From a live drag the paper is already most of the way over: land from there.
  const from = clamp01((active.fromTheta ?? 0) / Math.PI) * Math.PI;
  // A reverse fold opens the flap and refolds it: give it a little longer.
  const foldMs = TIMING.fold * (reverse ? 1.7 : 1) * k * Math.max(0.25, (Math.PI - from) / Math.PI);
  if (t < foldMs) {
    const e = from > 0 ? easeOut(clamp01(t / foldMs)) : easeInOut(clamp01(t / foldMs));
    theta = from + (Math.PI - from) * e;
  } else if (t < foldMs + TIMING.settle * k) {
    const s = easeOut(clamp01((t - foldMs) / (TIMING.settle * k)));
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
    // A creased fold still springs back a degree or two (paper/physics.ts); ideal paper doesn't.
    const restCreased = ideal ? Math.PI : (profile.restDeg * Math.PI) / 180;
    theta = theta + (restCreased - theta) * easeOut(tc);
    animating = tc < 1;
    if (!animating && profile.fullySharp) return { motion: null, animating: false };
  } else if (ideal && !animating) {
    return { motion: null, animating: false };
  } else if (overlay) {
    animating = true;
  }

  return {
    motion: { before: active.before, transition: active.transition, theta, sharpnessAt },
    animating,
  };
}
