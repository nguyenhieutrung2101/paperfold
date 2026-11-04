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
import { axiom3, imageOf } from './axioms.ts';
import type { Surface } from './surface.ts';

/**
 * Common folds, found up front (Phase 1 polish): where the grabbed point usually goes. Most
 * folds land on a corner, the middle of the sheet or of an edge, or bring an edge onto another
 * edge or a crease (in half, to the center line, a kite fold). Each target knows its fold line
 * and where the grabbed point lands; the drag snaps to the nearest one from well away, and the
 * targets are drawn so you can see them.
 */
export type TargetKind = 'half' | 'center' | 'corner' | 'midpoint' | 'crease-point' | 'edge-to-edge' | 'edge-to-crease';

export interface FoldTarget {
  readonly key: string;
  readonly kind: TargetKind;
  readonly line: Line2;
  /** Where the grabbed point lands. */
  readonly landing: Vec2;
  /** How strongly it pulls (1: corners, the center, folding in half). */
  readonly strength: number;
  /** Landmarks to ring when it's chosen. */
  readonly marks: readonly Vec2[];
  /** For edge alignment: the line the edge lands on, as a segment to highlight. */
  readonly guide?: readonly [Vec2, Vec2];
}

interface Seg {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly line: Line2;
  /** An outer edge of the model (raw or folded) or a crease lying on the paper. */
  readonly kind: 'edge' | 'crease';
}

export interface TargetContext {
  readonly points: ReadonlyArray<{ readonly point: Vec2; readonly kind: 'corner' | 'center' | 'midpoint' | 'crease-point' }>;
  readonly segs: readonly Seg[];
  /** The middle of the sheet as it lies now (if it's on top), for "in half". */
  readonly center: Vec2 | null;
}

const STRENGTH: Record<TargetKind, number> = {
  half: 1,
  center: 1,
  corner: 1,
  midpoint: 0.85,
  'edge-to-edge': 0.85,
  'edge-to-crease': 0.85,
  'crease-point': 0.7,
};

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const key2 = (p: Vec2) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)}`;

/** What the targets are made from, once per snapshot. */
export function targetContext(snap: Snapshot, surface: Surface): TargetContext {
  const byId = new Map(snap.faces.map((f) => [f.id, f]));
  const segs: Seg[] = [];
  const seenSeg = new Set<string>();
  for (const c of snap.creases) {
    const face = byId.get((c.left ?? c.right)!)!;
    const iso = planeIsoOf(face.placement);
    const a = applyPlaneIso(iso, c.a);
    const b = applyPlaneIso(iso, c.b);
    if (dist(a, b) < 1e-6) continue;
    const k = [key2(a), key2(b)].sort().join('|');
    if (seenSeg.has(k)) continue;
    seenSeg.add(k);
    const folded = c.left !== null && c.right !== null && Math.abs(c.angleDeg) === 180;
    const raw = c.left === null || c.right === null;
    // Lines you can see and line things up with: the outline (raw and folded edges) and creases.
    // Visible when one of its own faces is on top just beside it (the line itself sits on the
    // faces' boundary); an edge under another layer is hidden.
    const d: Vec2 = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const side = (k: number) => surface.topAt([mid[0] - d[1] * k, mid[1] + d[0] * k]);
    const tops = [side(0.3), side(-0.3)];
    const visible = tops.some((t) => t !== null && (t === c.left || t === c.right));
    if (!visible) continue;
    segs.push({ a, b, line: { p: a, d }, kind: raw || folded ? 'edge' : 'crease' });
  }
  // Points: the middle of the sheet, corners you can pinch, middles of the visible edges and
  // creases, crease meetings. Points closer than half a millimetre are one point, and the first
  // kind wins: the middle of the sheet stays "the center" even when flap tips meet there.
  const points: Array<{ point: Vec2; kind: 'corner' | 'center' | 'midpoint' | 'crease-point' }> = [];
  const push = (point: Vec2, kind: (typeof points)[number]['kind']) => {
    if (points.some((q) => dist(q.point, point) < 0.5)) return;
    points.push({ point, kind });
  };
  // The middle of the sheet, where it lies now, if that part is on top.
  let center: Vec2 | null = null;
  const outline = snap.paper.outline;
  const mc: Vec2 = [outline.reduce((s, p) => s + p[0], 0) / outline.length, outline.reduce((s, p) => s + p[1], 0) / outline.length];
  for (const f of snap.faces) {
    if (!insideConvex(f.material, mc)) continue;
    const w = applyPlaneIso(planeIsoOf(f.placement), mc);
    if (surface.topAt(w) === f.id) center = w;
    break;
  }
  if (center) push(center, 'center');
  for (const c of surface.corners) push(c, 'corner');
  // The middle of each whole visible edge or crease, not of every piece a crease cuts it into.
  for (const m of mergeCollinear(segs)) push([(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2], m.kind === 'edge' ? 'midpoint' : 'crease-point');
  // Where visible creases cross each other or an edge, inside the paper.
  const creases = segs.filter((s) => s.kind === 'crease');
  for (const c of creases) {
    for (const s of segs) {
      if (s === c) continue;
      const x = segmentHit(c, s);
      if (x) push(x, 'crease-point');
    }
  }
  return { points, segs, center };
}

/**
 * Every common fold for a grab at g: g onto each point (axiom 2), and, when g is on an edge (or
 * is a corner, on two), that edge onto each other edge or crease (axiom 3; parallel lines fold
 * at the line midway).
 */
export function foldTargets(g: Vec2, ctx: TargetContext, opts: { readonly onEdgeMm: number }): FoldTarget[] {
  const out: FoldTarget[] = [];
  const tol = 1e-6;
  const half = (line: Line2) => ctx.center !== null && Math.abs(signedDistance(line, ctx.center)) < 0.5;
  for (const t of ctx.points) {
    if (dist(t.point, g) < 1) continue;
    const line = perpendicularBisector(g, t.point);
    const kind: TargetKind = (t.kind === 'corner' || t.kind === 'midpoint') && half(line) ? 'half' : t.kind;
    out.push({ key: `p:${key2(t.point)}`, kind, line, landing: t.point, strength: STRENGTH[kind], marks: [t.point] });
  }
  // The edges the grab is on.
  const grabbed = ctx.segs.filter((s) => s.kind === 'edge' && onSegment(g, s, opts.onEdgeMm));
  for (const e of grabbed) {
    // The grabbed point on the edge itself, so the edge lands exactly on the target line.
    const gp = project(g, e.line);
    for (const s of ctx.segs) {
      if (s === e) continue;
      const parallel = Math.abs(cross2(e.line.d, s.line.d)) < 1e-6;
      if (parallel && Math.abs(signedDistance(s.line, e.a)) < tol) continue; // same line
      const lines: Line2[] = parallel
        ? [{ p: [(gp[0] + project(gp, s.line)[0]) / 2, (gp[1] + project(gp, s.line)[1]) / 2], d: e.line.d }]
        : axiom3(e.line, s.line);
      for (const line of lines) {
        if (Math.abs(signedDistance(line, gp)) < 1e-6) continue;
        const landing = imageOf(line, gp);
        // It has to land on the line you can see, not on its extension off the paper.
        if (!onSegment(landing, s, 1)) continue;
        const kind: TargetKind = s.kind === 'crease' ? 'edge-to-crease' : half(line) ? 'half' : 'edge-to-edge';
        out.push({
          key: `l:${key2(e.a)}${key2(e.b)}>${key2(s.a)}${key2(s.b)}:${key2(line.d)}`,
          kind,
          line,
          landing,
          strength: STRENGTH[kind],
          marks: [],
          guide: [s.a, s.b],
        });
      }
    }
  }
  return out;
}

export interface TargetPick {
  readonly target: FoldTarget;
  /** Distance to the landing over the target's reach: below 1 snaps. */
  readonly score: number;
}

/**
 * The target the pointer is going for. Each pulls from `radiusMm` times its strength. Once one
 * is chosen it holds until the pointer is clearly elsewhere (so it doesn't flicker between two).
 */
export function pickTarget(targets: readonly FoldTarget[], pointer: Vec2, radiusMm: number, prevKey: string | null): TargetPick | null {
  let best: TargetPick | null = null;
  let prev: TargetPick | null = null;
  for (const t of targets) {
    const score = dist(pointer, t.landing) / (radiusMm * t.strength);
    if (t.key === prevKey) prev = { target: t, score };
    if (!best || score < best.score) best = { target: t, score };
  }
  if (prev && prev.score < 1.4 && (!best || best.score > prev.score - 0.35)) return prev;
  return best && best.score < 1 ? best : null;
}

/** Join pieces of the same kind that continue each other along one line. */
function mergeCollinear(segs: readonly Seg[]): Seg[] {
  const out: Seg[] = [];
  const used = new Set<number>();
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const s = segs[i]!;
    let lo = 0;
    let hi = dist(s.a, s.b);
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue;
        const t = segs[j]!;
        if (t.kind !== s.kind || Math.abs(cross2(t.line.d, s.line.d)) > 1e-6 || Math.abs(signedDistance(s.line, t.a)) > 1e-6) continue;
        const ta = (t.a[0] - s.a[0]) * s.line.d[0] + (t.a[1] - s.a[1]) * s.line.d[1];
        const tb = (t.b[0] - s.a[0]) * s.line.d[0] + (t.b[1] - s.a[1]) * s.line.d[1];
        const tlo = Math.min(ta, tb);
        const thi = Math.max(ta, tb);
        if (tlo > hi + 1e-6 || thi < lo - 1e-6) continue; // not touching
        lo = Math.min(lo, tlo);
        hi = Math.max(hi, thi);
        used.add(j);
        grew = true;
      }
    }
    const a: Vec2 = [s.a[0] + s.line.d[0] * lo, s.a[1] + s.line.d[1] * lo];
    const b: Vec2 = [s.a[0] + s.line.d[0] * hi, s.a[1] + s.line.d[1] * hi];
    out.push({ a, b, line: { p: a, d: s.line.d }, kind: s.kind });
  }
  return out;
}

function project(p: Vec2, l: Line2): Vec2 {
  const t = (p[0] - l.p[0]) * l.d[0] + (p[1] - l.p[1]) * l.d[1];
  return [l.p[0] + l.d[0] * t, l.p[1] + l.d[1] * t];
}

function onSegment(p: Vec2, s: Seg, tolMm: number): boolean {
  if (Math.abs(signedDistance(s.line, p)) > tolMm) return false;
  const len = dist(s.a, s.b);
  const t = (p[0] - s.a[0]) * s.line.d[0] + (p[1] - s.a[1]) * s.line.d[1];
  return t >= -tolMm && t <= len + tolMm;
}

function segmentHit(s: Seg, t: Seg): Vec2 | null {
  const den = cross2(s.line.d, t.line.d);
  if (Math.abs(den) < 1e-9) return null;
  const w: Vec2 = [t.a[0] - s.a[0], t.a[1] - s.a[1]];
  const u = cross2(w, t.line.d) / den;
  const p: Vec2 = [s.a[0] + s.line.d[0] * u, s.a[1] + s.line.d[1] * u];
  return onSegment(p, s, 1e-6) && onSegment(p, t, 1e-6) ? p : null;
}

function insideConvex(poly: readonly Vec2[], q: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
