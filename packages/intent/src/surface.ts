import { applyPlaneIso, type FaceId, planeIsoOf, type Snapshot, type Vec2 } from '@paperfold/kernel';
import type { FoldedEdge } from './gestures.ts';

interface FacePoly {
  readonly id: FaceId;
  /** World (table plane) polygon, counter-clockwise. */
  readonly poly: readonly Vec2[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The model as seen from above: which layer is on top where, and the corners you can pinch.
 * Built once per snapshot.
 */
export interface Surface {
  /** Faces whose interior holds q, top first. */
  stackAt(q: Vec2): FaceId[];
  topAt(q: Vec2): FaceId | null;
  /**
   * Corners you can pinch: points where the visible paper's outline turns (the model's
   * silhouette corners, and the corners of flaps lying on top). Not where an unfolded
   * crease merely meets an edge.
   */
  readonly corners: readonly Vec2[];
}

const SAMPLES = 16;

export function surfaceOf(snap: Snapshot): Surface {
  // World polygons, made counter-clockwise (a face lying back up runs the other way).
  const faces: FacePoly[] = snap.faces.map((f) => {
    const iso = planeIsoOf(f.placement);
    let poly = f.material.map((p) => applyPlaneIso(iso, p));
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) poly = [...poly].reverse();
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return { id: f.id, poly, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  });

  // Pairwise layer order: rows are [f, g, s] with s = +1 when f is above g.
  const order = new Map<string, boolean>();
  for (const [f, g, s] of snap.layerOrder) {
    order.set(`${f},${g}`, s === 1);
    order.set(`${g},${f}`, s !== 1);
  }
  const above = (f: FaceId, g: FaceId) => order.get(`${f},${g}`) === true;

  // A coarse grid of face boxes, so a point query only looks at nearby faces.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of faces) {
    minX = Math.min(minX, f.minX);
    minY = Math.min(minY, f.minY);
    maxX = Math.max(maxX, f.maxX);
    maxY = Math.max(maxY, f.maxY);
  }
  const N = 24;
  const cw = Math.max(1e-6, (maxX - minX) / N);
  const ch = Math.max(1e-6, (maxY - minY) / N);
  const grid: FacePoly[][] = Array.from({ length: N * N }, () => []);
  const cell = (v: number, lo: number, c: number) => Math.max(0, Math.min(N - 1, Math.floor((v - lo) / c)));
  for (const f of faces) {
    for (let i = cell(f.minX, minX, cw); i <= cell(f.maxX, minX, cw); i++) {
      for (let j = cell(f.minY, minY, ch); j <= cell(f.maxY, minY, ch); j++) grid[i * N + j]!.push(f);
    }
  }
  const eps = 1e-7 * Math.max(1, snap.sizeMm);
  const inside = (f: FacePoly, q: Vec2) => {
    if (q[0] < f.minX - eps || q[0] > f.maxX + eps || q[1] < f.minY - eps || q[1] > f.maxY + eps) return false;
    const p = f.poly;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) <= eps * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
    }
    return true;
  };
  const stackAt = (q: Vec2): FaceId[] => {
    if (q[0] < minX || q[0] > maxX || q[1] < minY || q[1] > maxY) return [];
    const hits = grid[cell(q[0], minX, cw) * N + cell(q[1], minY, ch)]!.filter((f) => inside(f, q)).map((f) => f.id);
    // Top first: insertion by the pairwise order (overlapping faces always have one).
    const out: FaceId[] = [];
    for (const h of hits) {
      let i = 0;
      while (i < out.length && above(out[i]!, h)) i++;
      out.splice(i, 0, h);
    }
    return out;
  };
  const topAt = (q: Vec2): FaceId | null => stackAt(q)[0] ?? null;

  // Faces joined by unfolded creases lie flat together: one visible sheet.
  const parent = new Map<FaceId, FaceId>(faces.map((f) => [f.id, f.id]));
  const find = (x: FaceId): FaceId => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const c of snap.creases) {
    if (c.left === null || c.right === null || c.angleDeg !== 0) continue;
    parent.set(find(c.left), find(c.right));
  }

  // Corners: around each vertex, how much of a small circle does one visible sheet cover?
  // A corner covers less than about 145° of it; a straight edge covers half.
  const at = new Map<string, { p: Vec2; faces: Set<FaceId> }>();
  for (const f of faces) {
    for (const p of f.poly) {
      const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
      const e = at.get(k);
      if (e) e.faces.add(f.id);
      else at.set(k, { p, faces: new Set([f.id]) });
    }
  }
  const r = Math.max(0.3, snap.sizeMm * 0.004);
  const corners: Vec2[] = [];
  for (const { p, faces: incident } of at.values()) {
    const comps = new Set([...incident].map(find));
    const count = new Map<FaceId, number>();
    for (let i = 0; i < SAMPLES; i++) {
      const a = ((i + 0.5) / SAMPLES) * Math.PI * 2;
      const top = topAt([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]);
      if (top === null) continue;
      const c = find(top);
      if (comps.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
    }
    for (const n of count.values()) {
      if (n > 0 && n / SAMPLES <= 0.4) {
        corners.push(p);
        break;
      }
    }
  }
  return { stackAt, topAt, corners };
}

/** Where a press lands: what it can mean depends on it. */
export type PressZone =
  | { readonly kind: 'corner'; readonly point: Vec2 }
  | { readonly kind: 'folded-edge'; readonly edge: FoldedEdge }
  | { readonly kind: 'paper' };

export interface ZoneOptions {
  /** How close to a corner counts as on it (about 14 px, in mm). Corners win over edges. */
  readonly cornerMm: number;
  /** How close to a folded edge counts as on it (about 10 px, in mm). */
  readonly nearMm: number;
}

function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const q: Vec2 = [a[0] + dx * t, a[1] + dy * t];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/**
 * Sort a press into a zone (Phase 1 polish, plan 1): a corner (you pinch it), a folded edge you
 * can see (you push across it or run along it), or anywhere else on the paper (you pick it up).
 * Corners win: a corner that sits on a folded edge is still a corner.
 */
export function zoneAt(p: Vec2, surface: Surface, edges: readonly FoldedEdge[], opts: ZoneOptions): PressZone {
  let corner: Vec2 | null = null;
  let cd = opts.cornerMm;
  for (const c of surface.corners) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d <= cd) {
      cd = d;
      corner = c;
    }
  }
  if (corner) return { kind: 'corner', point: corner };
  let best: FoldedEdge | null = null;
  let bd = opts.nearMm;
  for (const e of edges) {
    const { q, d } = nearestOnSegment(p, e.a, e.b);
    if (d > bd) continue;
    // Only an edge you can see: just inside it, one of its own two faces is on top.
    const probe: Vec2 = [q[0] + e.inward[0] * 0.4, q[1] + e.inward[1] * 0.4];
    const top = surface.topAt(probe);
    if (top === null || (top !== e.faces[0] && top !== e.faces[1])) continue;
    bd = d;
    best = e;
  }
  if (best) return { kind: 'folded-edge', edge: best };
  return { kind: 'paper' };
}
