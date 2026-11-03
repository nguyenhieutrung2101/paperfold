import {
  add3,
  applyMaterial,
  applyPlaneIso,
  clipHalfPlane,
  cross3,
  dot3,
  type FaceId,
  frontUp,
  invertPlaneIso,
  leftNormal,
  type Line2,
  len3,
  type Paper,
  planeDirToWorld,
  planeIsoOf,
  type Rigid3,
  scale3,
  type Snapshot,
  type SnapshotCrease,
  sub3,
  type Transition,
  type Vec2,
  type Vec3,
} from '@paperfold/kernel';
import { type BendLayer, bendPoint, bendTangent } from './bend.ts';
import { faceHeights } from './heights.ts';
import { type MeshData, MeshBuilder } from './meshBuilder.ts';

export interface SkinParams {
  /** Visual gap between stacked layers (mm). For real paper: its thickness. */
  readonly layerGapMm: number;
  /** Thickness drawn on raw edges (mm). */
  readonly thicknessMm: number;
  /** Bend radius of an uncreased fold (mm); 0 for ideal paper. */
  readonly softRadiusMm: number;
  /** Width of the shading groove along unfolded creases (mm). */
  readonly grooveWidthMm: number;
}

export type PaperMode = 'real' | 'ideal';

/**
 * Real paper: true thickness, soft bends that scale with stiffness.
 * Ideal paper: (nearly) zero thickness, no softness. A small gap stays so layers
 * never z-fight.
 */
export function skinParamsFor(paper: Paper, mode: PaperMode): SkinParams {
  if (mode === 'ideal') return { layerGapMm: 0.02, thicknessMm: 0.02, softRadiusMm: 0, grooveWidthMm: 0.6 };
  return {
    layerGapMm: paper.thicknessMm,
    thicknessMm: paper.thicknessMm,
    softRadiusMm: 1 + 4 * paper.stiffness,
    grooveWidthMm: 0.8,
  };
}

export type FoldTransition = Extract<Transition, { kind: 'fold' }>;

/** A fold in motion: the kernel's validated transition at angle theta. */
export interface FoldMotion {
  readonly before: Snapshot;
  readonly transition: FoldTransition;
  /** Radians, 0 (start) .. π (flat on the other side). */
  readonly theta: number;
  /** Crease sharpness 0..1 at coordinate u along transition.line. */
  readonly sharpnessAt: (u: number) => number;
}

export interface SkinFrame {
  readonly paper: MeshData;
  readonly edges: MeshData;
  /** Highest point of the paper (mm): the grab plane for raycasts. */
  readonly topHeight: number;
}

interface FaceMapper {
  readonly moving: boolean;
  pos(p: Vec2): Vec3;
  /** Unit vector of the material front (+w) at p. */
  normal(p: Vec2): Vec3;
}

const UP: Vec3 = [0, 1, 0];
const EPS = 1e-3;

function staticMapper(tr: Rigid3, height: number): FaceMapper {
  const n: Vec3 = [tr.r[2], tr.r[5], tr.r[8]];
  return {
    moving: false,
    pos: (p) => {
      const w = applyMaterial(tr, p);
      return [w[0], w[1] + height, w[2]];
    },
    normal: () => n,
  };
}

/**
 * A moving face during a fold. When the crease is sharper in some places than others, the
 * sharpest section pins the rigid flap (radius rhoPin) and softer sections puff out into a
 * larger loop that blends back into the flap within `blend` mm of the arc.
 * APPROXIMATION: the blend zone is not developable (it stretches by up to the radius
 * difference); with uniform sharpness the bend is exactly developable.
 */
function bendMapper(
  start: Rigid3,
  l: Line2,
  layer: BendLayer,
  theta: number,
  rhoAt: (u: number) => number,
  rhoPin: number,
  blend: number,
): FaceMapper {
  const iso = planeIsoOf(start);
  const nrm = leftNormal(l);
  const a3 = planeDirToWorld(l.d);
  const n3 = planeDirToWorld(nrm);
  const sign = frontUp(start) ? 1 : -1;
  const local = (p: Vec2) => {
    const q = applyPlaneIso(iso, p);
    const rx = q[0] - l.p[0];
    const ry = q[1] - l.p[1];
    return { u: rx * l.d[0] + ry * l.d[1], x: rx * nrm[0] + ry * nrm[1] };
  };
  const section = (u: number, x: number): [number, number] => {
    const rho = rhoAt(u);
    const pin = bendPoint(x, layer, theta, rhoPin);
    if (Math.abs(rho - rhoPin) < 1e-9) return pin;
    const loose = bendPoint(x, layer, theta, rho);
    const arc = rho * theta;
    let w = 1;
    if (x > arc) {
      const t = Math.min(1, (x - arc) / blend);
      w = 1 - t * t * (3 - 2 * t);
    }
    return [pin[0] + (loose[0] - pin[0]) * w, pin[1] + (loose[1] - pin[1]) * w];
  };
  const toWorld = (u: number, X: number, Y: number): Vec3 => {
    const px = l.p[0] + l.d[0] * u + nrm[0] * X;
    const py = l.p[1] + l.d[1] * u + nrm[1] * X;
    return [px, Y, -py];
  };
  return {
    moving: true,
    pos: (p) => {
      const { u, x } = local(p);
      const [X, Y] = section(u, x);
      return toWorld(u, X, Y);
    },
    normal: (p) => {
      const { u, x } = local(p);
      let tx: number;
      let ty: number;
      if (Math.abs(rhoAt(u) - rhoPin) < 1e-9) {
        [tx, ty] = bendTangent(x, layer, theta, rhoPin);
      } else {
        const h = 0.02;
        const a = section(u, x - h);
        const b = section(u, x + h);
        tx = b[0] - a[0];
        ty = b[1] - a[1];
      }
      const t3 = add3(scale3(n3, tx), scale3(UP, ty));
      const c = cross3(a3, t3);
      const k = sign / (len3(c) || 1);
      return [c[0] * k, c[1] * k, c[2] * k];
    },
  };
}

const normalize3 = (v: Vec3): Vec3 => {
  const l = len3(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Unit right normal of a -> b in material space: out of the face whose CCW boundary runs a -> b. */
function outward(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/**
 * Where the skin puts a material point of a face (mid-surface, world mm). Exposed for
 * tests and for hit-testing; buildFrame uses the same mappers.
 */
export function skinPoint(snap: Snapshot, params: SkinParams, face: FaceId, p: Vec2, motion?: FoldMotion): Vec3 {
  return faceMappers(snap, params, motion).mappers.get(face)!.pos(p);
}

function faceMappers(snap: Snapshot, params: SkinParams, motion?: FoldMotion) {
  const after = faceHeights(snap, params.layerGapMm);
  const mappers = new Map<FaceId, FaceMapper>();
  let topHeight = 0;
  let rhoMax = 0;
  let rhoAt: (u: number) => number = () => 0;
  if (motion) {
    const before = faceHeights(motion.before, params.layerGapMm);
    const tr = motion.transition;
    const k = Math.min(1, Math.max(0, motion.theta / Math.PI));
    const moving = new Set(tr.moving);
    rhoAt = (u) => params.softRadiusMm * (1 - Math.min(1, Math.max(0, motion.sharpnessAt(u))));
    // The sharpest section pins the flap.
    let rhoPin = Infinity;
    for (let i = 0; i <= 256; i++) rhoPin = Math.min(rhoPin, rhoAt(-snap.sizeMm * 2 + (snap.sizeMm * 4 * i) / 256));
    const blend = Math.max(12, 4 * params.softRadiusMm);
    for (const f of snap.faces) {
      const parent = tr.parentOf.get(f.id) ?? f.id;
      const h1 = after.get(f.id)!;
      const h0 = before.get(parent) ?? h1;
      const start = tr.startPlacements.get(f.id) ?? f.placement;
      if (moving.has(f.id)) {
        mappers.set(
          f.id,
          bendMapper(start, tr.line, { h0, h1, sigma: tr.direction }, motion.theta, rhoAt, rhoPin, blend),
        );
      } else {
        mappers.set(f.id, staticMapper(start, h0 + (h1 - h0) * k));
      }
      topHeight = Math.max(topHeight, h0, h1);
    }
    for (let i = 0; i <= 32; i++) rhoMax = Math.max(rhoMax, rhoAt(-snap.sizeMm * 2 + (snap.sizeMm * 4 * i) / 32));
    topHeight += 2 * rhoMax;
  } else {
    for (const f of snap.faces) {
      const h = after.get(f.id)!;
      mappers.set(f.id, staticMapper(f.placement, h));
      topHeight = Math.max(topHeight, h);
    }
  }
  return { mappers, topHeight, rhoMax };
}

/**
 * Build the paper's geometry for a kernel snapshot, optionally with a fold in motion.
 * The skin only reads the kernel's state; it never changes what the kernel decided.
 */
export function buildFrame(snap: Snapshot, params: SkinParams, motion?: FoldMotion): SkinFrame {
  const { mappers, topHeight, rhoMax } = faceMappers(snap, params, motion);
  const line: Line2 | null = motion ? motion.transition.line : null;

  const paper = new MeshBuilder(snap.sizeMm);
  const edges = new MeshBuilder(snap.sizeMm);
  const creasesByFace = new Map<FaceId, SnapshotCrease[]>();
  for (const c of snap.creases) {
    for (const f of [c.left, c.right]) {
      if (f === null) continue;
      let list = creasesByFace.get(f);
      if (!list) creasesByFace.set(f, (list = []));
      list.push(c);
    }
  }

  for (const f of snap.faces) {
    const m = mappers.get(f.id)!;
    const creases = creasesByFace.get(f.id) ?? [];
    if (m.moving && line && motion) {
      emitMovingFace(paper, f.id, f.material, motion.transition.startPlacements.get(f.id) ?? f.placement, line, m, {
        arcLength: rhoMax * motion.theta,
        blendLength: Math.max(12, 4 * params.softRadiusMm),
        sizeMm: snap.sizeMm,
        variesAlong: sharpnessVaries(motion, snap.sizeMm),
      });
    } else {
      emitStaticFace(paper, f.id, f.material, m, grooves(f.id, creases), params.grooveWidthMm);
    }
    for (const c of creases) {
      if (c.left !== null && c.right !== null) continue;
      emitEdgeWall(edges, f.id, c, m, params.thicknessMm, m.moving ? 17 : 2);
    }
  }

  for (const c of snap.creases) {
    if (c.left === null || c.right === null) continue;
    const mA = mappers.get(c.left)!;
    const mB = mappers.get(c.right)!;
    emitFillet(paper, c, mA, mB, mA.moving || mB.moving ? 13 : 2);
  }

  return { paper: paper.build(), edges: edges.build(), topHeight };
}

function sharpnessVaries(motion: FoldMotion, size: number): boolean {
  const s0 = motion.sharpnessAt(-size);
  for (let i = 1; i <= 32; i++) {
    if (Math.abs(motion.sharpnessAt(-size + (2 * size * i) / 32) - s0) > 1e-6) return true;
  }
  return false;
}

interface Groove {
  readonly a: Vec2;
  readonly b: Vec2;
  /** Out of the face, in material space. */
  readonly out: Vec2;
  /** Signed half residual angle (radians): + valley memory tilts toward the crease. */
  readonly tilt: number;
}

/** Unfolded creases with memory: a few degrees of residual fold, shown as shading. */
function grooves(face: FaceId, creases: readonly SnapshotCrease[]): Groove[] {
  const out: Groove[] = [];
  for (const c of creases) {
    if (c.left === null || c.right === null || c.angleDeg !== 0) continue;
    if (c.assignment !== 'M' && c.assignment !== 'V') continue;
    const tilt = ((c.restAngleDeg / 2) * Math.PI) / 180;
    if (tilt === 0) continue;
    // Orient a -> b along this face's CCW boundary.
    const [a, b] = c.left === face ? [c.a, c.b] : [c.b, c.a];
    out.push({ a, b, out: outward(a, b), tilt });
  }
  return out;
}

function emitStaticFace(
  mb: MeshBuilder,
  face: FaceId,
  material: readonly Vec2[],
  m: FaceMapper,
  gs: readonly Groove[],
  grooveWidth: number,
): void {
  const flat = m.normal(material[0]!);
  const regions: Vec2[][] = [];
  let rest: Vec2[] = [...material];
  for (const g of gs) {
    // Inset line parallel to the crease, grooveWidth inside the face.
    const p: Vec2 = [g.a[0] - g.out[0] * grooveWidth, g.a[1] - g.out[1] * grooveWidth];
    const d: Vec2 = [g.b[0] - g.a[0], g.b[1] - g.a[1]];
    const l = Math.hypot(d[0], d[1]);
    if (l === 0) continue;
    const inset: Line2 = { p, d: [d[0] / l, d[1] / l] };
    // Left of a->b (shifted inward) is the face interior.
    const strip = clipHalfPlane(rest, inset, -1);
    const inner = clipHalfPlane(rest, inset, 1);
    if (strip.length >= 3) regions.push(strip);
    rest = inner;
    if (rest.length < 3) break;
  }
  if (rest.length >= 3) regions.push(rest);

  const normalAt = (p: Vec2): Vec3 => {
    if (gs.length === 0) return flat;
    let v: Vec3 = flat;
    for (const g of gs) {
      const dx = p[0] - g.a[0];
      const dy = p[1] - g.a[1];
      const dist = -(dx * g.out[0] + dy * g.out[1]);
      const w = 1 - dist / grooveWidth;
      if (w <= 0) continue;
      const k = Math.sin(g.tilt) * Math.min(1, w);
      // Material out-vector carried to world by the face's rigid placement.
      const o = sub3(m.pos([p[0] + g.out[0], p[1] + g.out[1]]), m.pos(p));
      v = add3(v, scale3(normalize3(o), k));
    }
    return normalize3(v);
  };

  for (const poly of regions) {
    const ids = poly.map((p) => mb.vertex(m.pos(p), normalAt(p), p, face));
    for (let i = 1; i + 1 < ids.length; i++) mb.triangle(ids[0]!, ids[i]!, ids[i + 1]!);
  }
}

function emitMovingFace(
  mb: MeshBuilder,
  face: FaceId,
  material: readonly Vec2[],
  start: Rigid3,
  l: Line2,
  m: FaceMapper,
  opts: { arcLength: number; blendLength: number; sizeMm: number; variesAlong: boolean },
): void {
  // Slice in start-plane coordinates, parallel to the fold line through the arc zone.
  const iso = planeIsoOf(start);
  const inv = invertPlaneIso(iso);
  const plane = material.map((p) => applyPlaneIso(iso, p));
  const nrm = leftNormal(l);
  const xs: number[] = [];
  if (opts.arcLength > 1e-6) {
    const steps = Math.max(8, Math.min(48, Math.ceil(opts.arcLength / 0.15)));
    for (let i = 0; i <= steps; i++) xs.push((opts.arcLength * i) / steps);
    if (opts.variesAlong) {
      // Where soft sections blend back into the pinned flap.
      for (let i = 1; i <= 12; i++) xs.push(opts.arcLength + (opts.blendLength * i) / 12);
    }
  }
  const us: number[] = [];
  if (opts.variesAlong) {
    // Only where this face is: about 3 mm apart along the fold line.
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of plane) {
      const u = (q[0] - l.p[0]) * l.d[0] + (q[1] - l.p[1]) * l.d[1];
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
    const n = Math.min(160, Math.ceil((hi - lo) / 3));
    for (let i = 1; i < n; i++) us.push(lo + ((hi - lo) * i) / n);
  }
  let cells: Vec2[][] = [plane];
  const cut = (polys: Vec2[][], p: Vec2, d: Vec2): Vec2[][] => {
    const out: Vec2[][] = [];
    const ln: Line2 = { p, d };
    for (const poly of polys) {
      const left = clipHalfPlane(poly, ln, 1);
      const right = clipHalfPlane(poly, ln, -1);
      if (left.length >= 3) out.push(left);
      if (right.length >= 3) out.push(right);
    }
    return out;
  };
  for (const x of xs) {
    if (x <= 0) continue;
    cells = cut(cells, [l.p[0] + nrm[0] * x, l.p[1] + nrm[1] * x], l.d);
  }
  for (const u of us) {
    cells = cut(cells, [l.p[0] + l.d[0] * u, l.p[1] + l.d[1] * u], nrm);
  }
  for (const cell of cells) {
    const ids = cell.map((q) => {
      const p = applyPlaneIso(inv, q);
      return mb.vertex(m.pos(p), m.normal(p), p, face);
    });
    for (let i = 1; i + 1 < ids.length; i++) mb.triangle(ids[0]!, ids[i]!, ids[i + 1]!);
  }
}

/**
 * Join two faces across a crease where their skins don't meet: the rounded folded edge
 * (outer layers wrapping inner ones), the hinge of a fold in motion, or a small ramp
 * between layers at different heights. A cubic Bézier tangent to both faces, close to a
 * circular arc.
 */
function emitFillet(mb: MeshBuilder, c: SnapshotCrease, mA: FaceMapper, mB: FaceMapper, samples: number): void {
  const out = outward(c.a, c.b); // from the left face (A) into B
  const ss: number[] = [];
  for (let i = 0; i < samples; i++) ss.push(i / (samples - 1));
  const rows: Array<{ pts: Vec3[]; nA: Vec3; mat: Vec2 }> = [];
  let maxGap = 0;
  for (const s of ss) {
    const p: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * s, c.a[1] + (c.b[1] - c.a[1]) * s];
    const pa = mA.pos(p);
    const pb = mB.pos(p);
    maxGap = Math.max(maxGap, len3(sub3(pb, pa)));
    const ta = normalize3(sub3(mA.pos([p[0] + out[0] * EPS, p[1] + out[1] * EPS]), pa));
    const tb = normalize3(sub3(mB.pos([p[0] - out[0] * EPS, p[1] - out[1] * EPS]), pb));
    const chord = len3(sub3(pb, pa));
    const cosTurn = Math.max(-1, Math.min(1, -dot3(ta, tb)));
    const turn = Math.acos(cosTurn);
    let k: number;
    if (turn < 1e-3) k = chord / 3;
    else {
      const r = chord / (2 * Math.sin(turn / 2));
      k = (4 / 3) * Math.tan(turn / 4) * r;
    }
    const p1 = add3(pa, scale3(ta, k));
    const p2 = add3(pb, scale3(tb, k));
    const pts: Vec3[] = [];
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const u = 1 - t;
      pts.push([
        u * u * u * pa[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * pb[0],
        u * u * u * pa[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * pb[1],
        u * u * u * pa[2] + 3 * u * u * t * p1[2] + 3 * u * t * t * p2[2] + t * t * t * pb[2],
      ]);
    }
    rows.push({ pts, nA: mA.normal(p), mat: p });
  }
  if (maxGap < 1e-4) return;
  const face = c.left!;
  const ids: number[][] = rows.map((row, i) => {
    const next = rows[Math.min(i + 1, rows.length - 1)]!;
    const prev = rows[Math.max(i - 1, 0)]!;
    return row.pts.map((pt, j) => {
      const tj = sub3(row.pts[Math.min(j + 1, row.pts.length - 1)]!, row.pts[Math.max(j - 1, 0)]!);
      const along = sub3(next.pts[j]!, prev.pts[j]!);
      let nrm = normalize3(cross3(tj, along));
      // Same side as face A's front where the fillet leaves A.
      const ref = sub3(row.pts[1]!, row.pts[0]!);
      const start = normalize3(cross3(ref, along));
      if (dot3(start, row.nA) < 0) nrm = scale3(nrm, -1);
      return mb.vertex(pt, nrm, row.mat, face);
    });
  });
  for (let i = 0; i + 1 < ids.length; i++) {
    for (let j = 0; j + 1 < ids[i]!.length; j++) {
      const a = ids[i]![j]!;
      const b = ids[i + 1]![j]!;
      const cc = ids[i + 1]![j + 1]!;
      const d = ids[i]![j + 1]!;
      orientedQuad(mb, rows, a, b, cc, d, i, j);
    }
  }
}

function orientedQuad(
  mb: MeshBuilder,
  rows: Array<{ pts: Vec3[]; nA: Vec3 }>,
  a: number,
  b: number,
  c: number,
  d: number,
  i: number,
  j: number,
): void {
  // Geometric normal of (a, b, c) vs the shading normal decides the winding.
  const pa = rows[i]!.pts[j]!;
  const pb = rows[i + 1]!.pts[j]!;
  const pc = rows[i + 1]!.pts[j + 1]!;
  const geo = cross3(sub3(pb, pa), sub3(pc, pa));
  const along = sub3(pb, pa);
  const ref = cross3(sub3(rows[i]!.pts[j + 1]!, pa), along);
  const want = dot3(ref, rows[i]!.nA) >= 0 ? 1 : -1;
  if (dot3(geo, ref) * want >= 0) {
    mb.triangle(a, b, c);
    mb.triangle(a, c, d);
  } else {
    mb.triangle(a, c, b);
    mb.triangle(a, d, c);
  }
}

/** The visible thickness of a raw edge. */
function emitEdgeWall(
  mb: MeshBuilder,
  face: FaceId,
  c: SnapshotCrease,
  m: FaceMapper,
  thickness: number,
  samples: number,
): void {
  const [a, b] = c.left === face ? [c.a, c.b] : [c.b, c.a];
  const out = outward(a, b);
  const half = thickness / 2;
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i < samples; i++) {
    const s = i / (samples - 1);
    const p: Vec2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
    const pos = m.pos(p);
    const n = m.normal(p);
    const o = normalize3(sub3(m.pos([p[0] + out[0] * EPS, p[1] + out[1] * EPS]), pos));
    top.push(mb.vertex(add3(pos, scale3(n, half)), o, p, face));
    bottom.push(mb.vertex(add3(pos, scale3(n, -half)), o, p, face));
  }
  for (let i = 0; i + 1 < samples; i++) {
    // a -> b runs CCW around the face as seen from its front; outward faces away from it.
    mb.triangle(bottom[i]!, bottom[i + 1]!, top[i + 1]!);
    mb.triangle(bottom[i]!, top[i + 1]!, top[i]!);
  }
}
