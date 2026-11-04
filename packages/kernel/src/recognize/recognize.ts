import { compose, frontUp, type Rigid3 } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { centroid, containsStrictly } from '../geometry/polygon.ts';
import { adjacency, getVertex, materialPolygon } from '../paper/creasePattern.ts';
import type { EdgeId, FaceId, VertexId } from '../paper/types.ts';
import { orderOf } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';

export type MoveName =
  | 'valley-fold'
  | 'mountain-fold'
  | 'unfold'
  | 'inside-reverse-fold'
  | 'outside-reverse-fold'
  | 'squash-fold'
  | 'petal-fold'
  | 'pleat'
  | 'inside-crimp'
  | 'outside-crimp'
  | 'rabbit-ear'
  | 'swivel'
  | 'crease'
  | 'turn-over'
  | 'rotate'
  | 'fold';

export interface Recognition {
  readonly name: MoveName;
  /** 0..1. Below 0.5 the UI says plain "Fold": a wrong name is worse than none. */
  readonly confidence: number;
}

/** Below this, show a generic name. */
export const NAME_CONFIDENCE = 0.5;

interface Seg {
  readonly id: EdgeId;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly angle: number;
  readonly left: FaceId;
  readonly right: FaceId;
  readonly v: readonly [VertexId, VertexId];
}

function interiorCreases(s: KernelState): Seg[] {
  const adj = adjacency(s.cp);
  const out: Seg[] = [];
  for (const c of s.cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    out.push({
      id: c.id,
      a: getVertex(s.cp, c.v[0]),
      b: getVertex(s.cp, c.v[1]),
      angle: c.angleDeg,
      left: ef.left,
      right: ef.right,
      v: c.v,
    });
  }
  return out;
}

/** The old crease that contains this new segment (same line, covering it), if any. */
function containing(seg: Seg, old: readonly Seg[], tol: number): Seg | null {
  for (const o of old) {
    const dx = o.b[0] - o.a[0];
    const dy = o.b[1] - o.a[1];
    const l = Math.hypot(dx, dy);
    const off = (p: Vec2) => Math.abs((p[0] - o.a[0]) * dy - (p[1] - o.a[1]) * dx) / l;
    if (off(seg.a) > tol || off(seg.b) > tol) continue;
    const t = (p: Vec2) => ((p[0] - o.a[0]) * dx + (p[1] - o.a[1]) * dy) / (l * l);
    const ta = t(seg.a);
    const tb = t(seg.b);
    const e = tol / l;
    if (Math.min(ta, tb) >= -e && Math.max(ta, tb) <= 1 + e) return o;
  }
  return null;
}

/**
 * Name a committed move from what changed, not from what was asked for (brief, section 6,
 * "Post-hoc naming"): the crease-pattern diff (new creases, refolded precreases, unfolds,
 * flipped assignments), which faces moved, and layer order.
 *
 * Reverse folds are recognized by their vertex signature: at P a folded edge is cut by two
 * new creases and its part toward the tip flips. Inside, the new creases take the spine's
 * original sign (three of one kind, one of the other, with the odd one the flipped spine);
 * outside, the opposite sign.
 */
export function recognize(before: KernelState, after: KernelState): Recognition {
  const tol = after.tol.len * 10;

  // Rigid motions of the whole model: turn over or rotate.
  const sameTopology =
    before.cp.faces.size === after.cp.faces.size &&
    [...before.cp.faces.keys()].every((f) => after.cp.faces.has(f)) &&
    before.cp.creases.size === after.cp.creases.size;
  if (sameTopology) {
    const f0 = [...before.cp.faces.keys()][0]!;
    const w = relative(before.folded.placements.get(f0)!, after.folded.placements.get(f0)!);
    const rigid = [...before.cp.faces.keys()].every((f) =>
      close(compose(w, before.folded.placements.get(f)!), after.folded.placements.get(f)!, tol),
    );
    const moved = !close(before.folded.placements.get(f0)!, after.folded.placements.get(f0)!, tol);
    if (rigid && moved) {
      const flipped = frontUp(before.folded.placements.get(f0)!) !== frontUp(after.folded.placements.get(f0)!);
      return { name: flipped ? 'turn-over' : 'rotate', confidence: 0.99 };
    }
    if (rigid && !moved) {
      // Sharper anywhere along a fold, not just at its sharpest point: a second stroke on
      // another part of a creased fold is still a crease.
      const total = (spans: readonly { from: number; to: number; value: number }[]) =>
        spans.reduce((sum, sp) => sum + (sp.to - sp.from) * sp.value, 0);
      const sharper = [...after.cp.creases.values()].some((c) => {
        const o = before.cp.creases.get(c.id);
        return o !== undefined && total(c.sharpness) > total(o.sharpness) + 1e-12;
      });
      if (sharper) return { name: 'crease', confidence: 0.95 };
    }
  }

  const oldSegs = interiorCreases(before);
  type Kind = 'created' | 'refolded' | 'unfolded' | 'flipped' | 'same';
  const kinds = new Map<EdgeId, { kind: Kind; seg: Seg; was: number }>();
  for (const seg of interiorCreases(after)) {
    const o = containing(seg, oldSegs, tol);
    const was = o ? o.angle : 0;
    let kind: Kind;
    if (!o) kind = seg.angle !== 0 ? 'created' : 'same';
    else if (was === 0 && seg.angle !== 0) kind = 'refolded';
    else if (was !== 0 && seg.angle === 0) kind = 'unfolded';
    else if (was !== 0 && seg.angle === -was) kind = 'flipped';
    else kind = 'same';
    kinds.set(seg.id, { kind, seg, was });
  }
  const of = (k: Kind) => [...kinds.values()].filter((x) => x.kind === k);
  const made = [...of('created'), ...of('refolded')];
  const flipped = of('flipped');
  const unfolded = of('unfolded');

  if (flipped.length > 0 && made.length > 0 && unfolded.length === 0) {
    // Reverse-fold vertices: where a flipped crease meets new folds.
    const madeIds = new Set(made.map((m) => m.seg.id));
    const adj = adjacency(after.cp);
    let inside = 0;
    let outside = 0;
    let odd = 0;
    // Per flipped crease: its reverse-fold ends, and whether the paper past each stayed put.
    let crimp: 'inside' | 'outside' | null = null;
    for (const f of flipped) {
      const ends: Array<{ kind: 'inside' | 'outside'; still: boolean }> = [];
      for (const v of f.seg.v) {
        const around = (adj.vertexEdges.get(v) ?? []).filter((e) => after.cp.creases.get(e)!.angleDeg !== 0);
        const news = around.filter((e) => madeIds.has(e));
        if (news.length !== 2 || around.length !== 4) continue;
        const spineIn = around.find((e) => e !== f.seg.id && !madeIds.has(e));
        if (spineIn === undefined) continue;
        const a = Math.sign(after.cp.creases.get(spineIn)!.angleDeg);
        const signs = news.map((e) => Math.sign(after.cp.creases.get(e)!.angleDeg));
        if (signs[0] !== signs[1] || Math.sign(f.seg.angle) !== -a) {
          odd++;
          continue;
        }
        const kind = signs[0] === a ? 'inside' : 'outside';
        if (kind === 'inside') inside++;
        else outside++;
        const ef = adj.edgeFaces.get(spineIn)!;
        ends.push({ kind, still: ef.left !== null && !movedFace(before, after, ef.left, tol) });
      }
      // A crimp: a stretch of folded edge flips between two reverse folds, one of each kind; it
      // is named by the one next to the paper that stayed.
      if (ends.length === 2 && ends[0]!.kind !== ends[1]!.kind) crimp = (ends.find((e) => e.still) ?? ends[0]!).kind;
    }
    if (crimp && odd === 0) return { name: crimp === 'inside' ? 'inside-crimp' : 'outside-crimp', confidence: 0.85 };
    if (inside > 0 && outside === 0 && odd === 0) return { name: 'inside-reverse-fold', confidence: 0.92 };
    if (outside > 0 && inside === 0 && odd === 0) return { name: 'outside-reverse-fold', confidence: 0.92 };
    return { name: 'fold', confidence: 0.3 };
  }

  if (made.length > 0 && flipped.length === 0 && unfolded.length === 0) {
    // A pleat: two parts moved, one turned over and one not (it went over twice).
    const motions = movedMotions(before, after, tol);
    if (motions.length === 2 && motions.filter((m) => m.flips).length === 1) {
      // A swivel: the part past both lines turns about the point where they meet, on the paper.
      const w = motions.find((m) => !m.flips)!.w;
      const c = pivotOf(w);
      if (c && onPaper(before, c, tol * 10)) return { name: 'swivel', confidence: 0.8 };
      return { name: 'pleat', confidence: 0.85 };
    }
    // A rabbit ear: two sides turned over and the ear turned twice, its four new creases
    // meeting at one point.
    if (motions.length === 3 && motions.filter((m) => m.flips).length === 2) {
      const adj = adjacency(after.cp);
      const madeIds = new Set(made.map((m) => m.seg.id));
      const hub = [...new Set(made.flatMap((m) => [...m.seg.v]))].some((v) => (adj.vertexEdges.get(v) ?? []).filter((e) => madeIds.has(e)).length >= 4);
      if (hub) return { name: 'rabbit-ear', confidence: 0.85 };
    }
    // A plain fold: which way did the moving part go, as seen by the viewer?
    for (const m of made) {
      const { left, right } = m.seg;
      const lMoved = movedFace(before, after, left, tol);
      if (lMoved === movedFace(before, after, right, tol)) continue;
      const moverFace = lMoved ? left : right;
      const stayFace = lMoved ? right : left;
      const o = orderOf(after.folded.layerOrder, moverFace, stayFace);
      if (o === undefined) continue;
      return { name: o === 1 ? 'valley-fold' : 'mountain-fold', confidence: 0.9 };
    }
    return { name: 'fold', confidence: 0.4 };
  }

  if (made.length > 0 && unfolded.length > 0) {
    // Squash and petal folds unfold some folds and make others, meeting at a few points of
    // the paper: a squash at one (the spine opens, the halfway creases fold, the hinge opens or
    // closes), a petal at two (at each, a folded edge opens; the hinge and two kite creases fold).
    const adj = adjacency(after.cp);
    const madeIds = new Set(made.map((m) => m.seg.id));
    const openIds = new Set(unfolded.map((m) => m.seg.id));
    const verts = new Set<VertexId>([...made, ...unfolded].flatMap((m) => [...m.seg.v]));
    let hubs = 0;
    for (const v of verts) {
      const around = adj.vertexEdges.get(v) ?? [];
      const nMade = around.filter((e) => madeIds.has(e)).length;
      const nOpen = around.filter((e) => openIds.has(e)).length;
      if (nOpen >= 1 && nMade >= 2 && nOpen + nMade >= 4) hubs++;
    }
    if (hubs === 1) return { name: 'squash-fold', confidence: 0.85 };
    if (hubs === 2) return { name: 'petal-fold', confidence: 0.85 };
    return { name: 'fold', confidence: 0.3 };
  }

  if (unfolded.length > 0 && made.length === 0 && flipped.length === 0) return { name: 'unfold', confidence: 0.9 };
  return { name: 'fold', confidence: 0.3 };
}

/**
 * The point (table plane) a motion that keeps the paper's side up turns about, if it turns
 * (a pure slide has none). World: x right, y up, table plane (x, -z).
 */
function pivotOf(w: Rigid3): Vec2 | null {
  // Rotation about the vertical axis: [c 0 s; 0 1 0; -s 0 c].
  const c = w.r[0];
  const s = w.r[2];
  if (Math.abs(1 - c) < 1e-6 && Math.abs(s) < 1e-6) return null;
  // (I - R)·o = t in the x-z plane.
  const a = 1 - c;
  const b = -s;
  const m = [a, b, s, a] as const; // rows of I - R restricted to (x, z)
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const x = (w.t[0] * m[3] - m[1] * w.t[2]) / det;
  const z = (m[0] * w.t[2] - w.t[0] * m[2]) / det;
  return [x, -z];
}

/** Is p on the model's paper, or within tol of its outline? */
function onPaper(s: KernelState, p: Vec2, tol: number): boolean {
  for (const [f, pl] of s.folded.placements) {
    const poly = materialPolygon(s.cp, f).map((q) => {
      const w = [pl.r[0] * q[0] + pl.r[1] * q[1] + pl.t[0], pl.r[6] * q[0] + pl.r[7] * q[1] + pl.t[2]];
      return [w[0]!, -w[1]!] as Vec2;
    });
    let inside = true;
    let sign = 0;
    for (let i = 0; i < poly.length && inside; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (cr / l > tol) sign = sign || 1;
      if (cr / l < -tol) sign = sign || -1;
      if ((cr / l > tol && sign < 0) || (cr / l < -tol && sign > 0)) inside = false;
    }
    if (inside) return true;
  }
  return false;
}

/** The distinct rigid motions the faces that moved went through (world, before to after). */
function movedMotions(before: KernelState, after: KernelState, tol: number): Array<{ w: Rigid3; flips: boolean }> {
  const out: Array<{ w: Rigid3; flips: boolean }> = [];
  const identity: Rigid3 = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  for (const f of after.cp.faces.keys()) {
    const c = centroid(materialPolygon(after.cp, f));
    for (const g of before.cp.faces.keys()) {
      if (!containsStrictly(materialPolygon(before.cp, g), c, before.tol)) continue;
      const a = before.folded.placements.get(g)!;
      const b = after.folded.placements.get(f)!;
      const w = relative(a, b);
      if (!close(w, identity, tol) && !out.some((o) => close(o.w, w, tol))) out.push({ w, flips: frontUp(a) !== frontUp(b) });
      break;
    }
  }
  return out;
}

/** Did this face of `after` move? Compared with the old face that held its material. */
function movedFace(before: KernelState, after: KernelState, f: FaceId, tol: number): boolean {
  const poly = materialPolygon(after.cp, f);
  const c = centroid(poly);
  for (const g of before.cp.faces.keys()) {
    if (containsStrictly(materialPolygon(before.cp, g), c, before.tol)) {
      return !close(before.folded.placements.get(g)!, after.folded.placements.get(f)!, tol);
    }
  }
  return false;
}

/** W with W ∘ a = b. */
function relative(a: Rigid3, b: Rigid3): Rigid3 {
  // a⁻¹ = (Rᵀ, −Rᵀt)
  const r = a.r;
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]] as const;
  const t = [
    -(rt[0] * a.t[0] + rt[1] * a.t[1] + rt[2] * a.t[2]),
    -(rt[3] * a.t[0] + rt[4] * a.t[1] + rt[5] * a.t[2]),
    -(rt[6] * a.t[0] + rt[7] * a.t[1] + rt[8] * a.t[2]),
  ] as const;
  return compose(b, { r: rt, t });
}

function close(a: Rigid3, b: Rigid3, tol: number): boolean {
  for (let i = 0; i < 9; i++) if (Math.abs(a.r[i]! - b.r[i]!) > 1e-6) return false;
  for (let i = 0; i < 3; i++) if (Math.abs(a.t[i]! - b.t[i]!) > tol * 10) return false;
  return true;
}
