import type { Span } from './types.ts';

/**
 * Piecewise-constant values along an edge (used for crease sharpness).
 * Spans are sorted, disjoint, within [0, 1], and omit zero values.
 */

export function sampleSpans(spans: readonly Span[], t: number): number {
  for (const s of spans) {
    if (t >= s.from && t <= s.to) return s.value;
  }
  return 0;
}

export function maxSpan(spans: readonly Span[]): number {
  let m = 0;
  for (const s of spans) m = Math.max(m, s.value);
  return m;
}

/** Length-weighted mean over [0, 1]. */
export function meanSpan(spans: readonly Span[]): number {
  let total = 0;
  for (const s of spans) total += (s.to - s.from) * s.value;
  return total;
}

/** Raise values on [from, to] by `amount`, never above `cap`, never lowering existing values. */
export function raiseSpans(spans: readonly Span[], from: number, to: number, amount: number, cap: number): Span[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(1, Math.max(from, to));
  if (hi <= lo || amount <= 0) return [...spans];
  // Breakpoints from existing spans plus the new range.
  const cuts = new Set<number>([0, 1, lo, hi]);
  for (const s of spans) {
    cuts.add(s.from);
    cuts.add(s.to);
  }
  const xs = [...cuts].filter((x) => x >= 0 && x <= 1).sort((a, b) => a - b);
  const out: Span[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!;
    const b = xs[i + 1]!;
    if (b <= a) continue;
    const mid = (a + b) / 2;
    let v = sampleSpans(spans, mid);
    if (mid >= lo && mid <= hi) v = Math.max(v, Math.min(cap, v + amount));
    if (v <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.to === a && last.value === v) out[out.length - 1] = { from: last.from, to: b, value: v };
    else out.push({ from: a, to: b, value: v });
  }
  return out;
}

/** Restrict spans to [a, b] of the parent edge and re-parameterize to [0, 1] (used when an edge splits). */
export function subSpans(spans: readonly Span[], a: number, b: number): Span[] {
  const out: Span[] = [];
  const w = b - a;
  if (!(w > 0)) return out;
  for (const s of spans) {
    const lo = Math.max(s.from, a);
    const hi = Math.min(s.to, b);
    if (hi > lo) out.push({ from: (lo - a) / w, to: (hi - a) / w, value: s.value });
  }
  return out;
}

/** The same spans seen from the other end of the edge. */
export function reverseSpans(spans: readonly Span[]): Span[] {
  return spans.map((s) => ({ from: 1 - s.to, to: 1 - s.from, value: s.value })).reverse();
}
