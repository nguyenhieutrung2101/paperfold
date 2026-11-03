import { type Line2, type Side, signedDistance } from '../geometry/line.ts';
import { lerp2, type Vec2 } from '../geometry/vec.ts';
import { adjacency, edgeKey, getVertex } from '../paper/creasePattern.ts';
import { subSpans } from '../paper/spans.ts';
import type { Crease, CreasePattern, EdgeId, Face, FaceId, OpId, VertexId } from '../paper/types.ts';
import type { IdCounters } from '../state/types.ts';

export interface SplitResult {
  readonly cp: CreasePattern;
  readonly next: IdCounters;
  /** Old face -> its pieces on the left (+) and right (−) of the line. */
  readonly pieces: ReadonlyMap<FaceId, { readonly plus: FaceId; readonly minus: FaceId }>;
  readonly newCreases: readonly EdgeId[];
}

export class SplitError extends Error {}

/**
 * Cut faces along a line (given on the table plane) and add a crease along each cut.
 *
 * `vside` classifies every existing vertex against the line using its canonical world
 * position, so all faces sharing a vertex agree. A vertex within tolerance of the line is
 * on it (0) and becomes a crease endpoint as-is: that's the vertex weld of brief section 3.
 * Edges crossed strictly get one new vertex, computed once per edge and shared by both
 * faces on that edge so no T-junctions appear.
 */
export function splitFaces(
  cp: CreasePattern,
  next: IdCounters,
  l: Line2,
  vertexWorld: ReadonlyMap<VertexId, Vec2>,
  vside: ReadonlyMap<VertexId, Side>,
  toSplit: readonly FaceId[],
  opId: OpId,
): SplitResult {
  const vertices = new Map(cp.vertices);
  const creases = new Map(cp.creases);
  const faces = new Map(cp.faces);
  const edgeIndex = new Map(cp.edgeIndex);
  const sides = new Map<VertexId, Side>(vside);
  let { vertex: nextV, edge: nextE, face: nextF } = next;
  const adj = adjacency(cp);

  // 1. Edges crossed strictly by the line, each split once.
  const crossed = new Set<EdgeId>();
  for (const f of toSplit) {
    const verts = cp.faces.get(f)!.verts;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!;
      const b = verts[(i + 1) % verts.length]!;
      if (vside.get(a)! * vside.get(b)! === -1) crossed.add(cp.edgeIndex.get(edgeKey(a, b))!);
    }
  }
  for (const e of [...crossed].sort((x, y) => x - y)) {
    const c = cp.creases.get(e)!;
    const [a, b] = c.v;
    const da = signedDistance(l, vertexWorld.get(a)!);
    const db = signedDistance(l, vertexWorld.get(b)!);
    const t = da / (da - db);
    const m = nextV++;
    vertices.set(m, lerp2(getVertex(cp, a), getVertex(cp, b), t));
    sides.set(m, 0);
    creases.delete(e);
    edgeIndex.delete(edgeKey(a, b));
    const e1: Crease = { ...c, id: nextE++, v: [a, m], sharpness: subSpans(c.sharpness, 0, t) };
    const e2: Crease = { ...c, id: nextE++, v: [m, b], sharpness: subSpans(c.sharpness, t, 1) };
    creases.set(e1.id, e1);
    creases.set(e2.id, e2);
    edgeIndex.set(edgeKey(a, m), e1.id);
    edgeIndex.set(edgeKey(m, b), e2.id);
    const ef = adj.edgeFaces.get(e)!;
    for (const fid of [ef.left, ef.right]) {
      if (fid === null) continue;
      const face = faces.get(fid)!;
      const vs = face.verts;
      const out: VertexId[] = [];
      for (let i = 0; i < vs.length; i++) {
        const x = vs[i]!;
        const y = vs[(i + 1) % vs.length]!;
        out.push(x);
        if ((x === a && y === b) || (x === b && y === a)) out.push(m);
      }
      faces.set(fid, { id: fid, verts: out });
    }
  }

  // 2. Cut each face into its two pieces.
  const pieces = new Map<FaceId, { plus: FaceId; minus: FaceId }>();
  const newCreases: EdgeId[] = [];
  for (const f of [...toSplit].sort((x, y) => x - y)) {
    const verts = faces.get(f)!.verts;
    const s = verts.map((v) => sides.get(v)!);
    const n = verts.length;
    const neighborSign = (i: number, step: 1 | -1): Side => {
      for (let k = 1; k < n; k++) {
        const v = s[(i + step * k + n * k) % n]!;
        if (v !== 0) return v;
      }
      return 0;
    };
    const plus: VertexId[] = [];
    const minus: VertexId[] = [];
    for (let i = 0; i < n; i++) {
      const v = verts[i]!;
      const si = s[i]!;
      if (si > 0) plus.push(v);
      else if (si < 0) minus.push(v);
      else {
        // An on-line vertex belongs to a piece only if it borders that piece; a vertex
        // that merely touches the line from one side stays with that side.
        const p = neighborSign(i, -1);
        const q = neighborSign(i, 1);
        const inPlus = p > 0 || q > 0;
        const inMinus = p < 0 || q < 0;
        if (inPlus || !inMinus) plus.push(v);
        if (inMinus || !inPlus) minus.push(v);
      }
    }
    const shared = plus.filter((v) => minus.includes(v));
    if (shared.length !== 2 || plus.length < 3 || minus.length < 3) {
      throw new SplitError(`Face ${f} doesn't split cleanly along the fold line`);
    }
    // Orient the new crease along the plus piece's CCW boundary (plus piece on its left).
    let v0 = shared[0]!;
    let v1 = shared[1]!;
    const i0 = plus.indexOf(v0);
    if (plus[(i0 + 1) % plus.length] !== v1) [v0, v1] = [v1, v0];
    const plusId = nextF++;
    const minusId = nextF++;
    faces.delete(f);
    const plusFace: Face = { id: plusId, verts: plus };
    const minusFace: Face = { id: minusId, verts: minus };
    faces.set(plusId, plusFace);
    faces.set(minusId, minusFace);
    const crease: Crease = {
      id: nextE++,
      v: [v0, v1],
      assignment: 'U',
      angleDeg: 0,
      restAngleDeg: 0,
      sharpness: [],
      createdBy: opId,
    };
    if (edgeIndex.has(edgeKey(v0, v1))) throw new SplitError(`Edge ${v0}-${v1} already exists`);
    creases.set(crease.id, crease);
    edgeIndex.set(edgeKey(v0, v1), crease.id);
    newCreases.push(crease.id);
    pieces.set(f, { plus: plusId, minus: minusId });
  }

  return {
    cp: { vertices, creases, faces, edgeIndex },
    next: { ...next, vertex: nextV, edge: nextE, face: nextF },
    pieces,
    newCreases,
  };
}
