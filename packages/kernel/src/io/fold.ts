import { applyMaterial, frontUp, type Mat3, type Rigid3 } from '../geometry/rigid.ts';
import { toleranceFor } from '../geometry/tolerance.ts';
import type { Vec2, Vec3 } from '../geometry/vec.ts';
import { adjacency, edgeKey, getVertex } from '../paper/creasePattern.ts';
import type { Assignment, Crease, EdgeId, Face, FaceId, Paper, Span, VertexId } from '../paper/types.ts';
import { parsePairKey } from '../state/order.ts';
import type { KernelState } from '../state/types.ts';

/**
 * FOLD file format (Demaine, Ku, Lang: https://github.com/edemaine/fold), spec 1.2.
 *
 * The top-level frame is the crease pattern (2D, material space) with each crease's
 * remembered M/V assignment. file_frames[0] is the folded form (3D world coordinates,
 * current assignments and fold angles, faceOrders). "paperfold:state" carries the exact
 * kernel state so export -> import round-trips bit for bit (FOLD allows namespaced keys).
 */
export interface FoldFile {
  readonly file_spec: number;
  readonly file_creator: string;
  readonly file_classes: readonly string[];
  readonly frame_title?: string;
  readonly frame_classes?: readonly string[];
  readonly frame_attributes?: readonly string[];
  readonly frame_unit?: string;
  readonly vertices_coords?: ReadonlyArray<readonly number[]>;
  readonly edges_vertices?: ReadonlyArray<readonly [number, number]>;
  readonly edges_assignment?: readonly Assignment[];
  readonly edges_foldAngle?: readonly number[];
  readonly faces_vertices?: ReadonlyArray<readonly number[]>;
  readonly faceOrders?: ReadonlyArray<readonly [number, number, number]>;
  readonly file_frames?: ReadonlyArray<Record<string, unknown>>;
  readonly 'paperfold:state'?: ExactState;
}

type CreaseRow = [EdgeId, VertexId, VertexId, Assignment, number, number, number | null, Array<[number, number, number]>];

interface ExactState {
  readonly version: 1;
  readonly paper: Paper;
  readonly vertices: Array<[VertexId, number, number]>;
  readonly creases: CreaseRow[];
  readonly faces: Array<[FaceId, VertexId[]]>;
  readonly placements: Array<[FaceId, number[], number[]]>;
  readonly layerOrder: Array<[string, 1 | -1]>;
  readonly holds: Array<[FaceId, number, number]>;
  readonly next: [number, number, number, number];
}

const byId = <T>(m: ReadonlyMap<number, T>): Array<[number, T]> => [...m.entries()].sort((a, b) => a[0] - b[0]);

export function toFold(state: KernelState, title = 'Paperfold model'): FoldFile {
  const { cp } = state;
  const vIds = [...cp.vertices.keys()].sort((a, b) => a - b);
  const vIndex = new Map(vIds.map((v, i) => [v, i]));
  const eIds = [...cp.creases.keys()].sort((a, b) => a - b);
  const fIds = [...cp.faces.keys()].sort((a, b) => a - b);
  const fIndex = new Map(fIds.map((f, i) => [f, i]));
  const adj = adjacency(cp);

  // Folded coordinates: every vertex maps to one world point (connectivity); use a face around it.
  const folded: Vec3[] = vIds.map((v) => {
    const f = Math.min(...(adj.vertexFaces.get(v) ?? [fIds[0]!]));
    return applyMaterial(state.folded.placements.get(f)!, getVertex(cp, v));
  });

  const faceOrders: Array<[number, number, number]> = [];
  for (const [key, s] of [...state.folded.layerOrder.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [f, g] = parsePairKey(key);
    // Internal s: +1 = f above g in world. FOLD: +1 = f on the side of g's normal.
    const gUp = frontUp(state.folded.placements.get(g)!);
    faceOrders.push([fIndex.get(f)!, fIndex.get(g)!, gUp ? s : -s]);
  }

  const currentAssignment = (c: Crease): Assignment =>
    c.assignment === 'B' ? 'B' : c.angleDeg > 0 ? 'V' : c.angleDeg < 0 ? 'M' : 'F';

  return {
    file_spec: 1.2,
    file_creator: 'Paperfold',
    file_classes: ['singleModel'],
    frame_title: title,
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
    frame_unit: 'mm',
    vertices_coords: vIds.map((v) => [...getVertex(cp, v)]),
    edges_vertices: eIds.map((e) => {
      const c = cp.creases.get(e)!;
      return [vIndex.get(c.v[0])!, vIndex.get(c.v[1])!] as const;
    }),
    edges_assignment: eIds.map((e) => cp.creases.get(e)!.assignment),
    faces_vertices: fIds.map((f) => cp.faces.get(f)!.verts.map((v) => vIndex.get(v)!)),
    file_frames: [
      {
        frame_title: 'Folded form',
        frame_classes: ['foldedForm'],
        frame_attributes: ['3D'],
        frame_inherit: true,
        frame_parent: 0,
        vertices_coords: folded.map((p) => [...p]),
        edges_assignment: eIds.map((e) => currentAssignment(cp.creases.get(e)!)),
        edges_foldAngle: eIds.map((e) => cp.creases.get(e)!.angleDeg),
        faceOrders,
      },
    ],
    'paperfold:state': exactState(state),
  };
}

function exactState(state: KernelState): ExactState {
  const { cp, folded, next, paper } = state;
  return {
    version: 1,
    paper: {
      outline: paper.outline.map((p) => [p[0], p[1]] as const),
      thicknessMm: paper.thicknessMm,
      stiffness: paper.stiffness,
      front: { color: paper.front.color },
      back: { color: paper.back.color },
    },
    vertices: byId(cp.vertices).map(([id, p]) => [id, p[0], p[1]]),
    creases: byId(cp.creases).map(([id, c]) => [
      id,
      c.v[0],
      c.v[1],
      c.assignment,
      c.angleDeg,
      c.restAngleDeg,
      c.createdBy,
      c.sharpness.map((s) => [s.from, s.to, s.value]),
    ]),
    faces: byId(cp.faces).map(([id, f]) => [id, [...f.verts]]),
    placements: byId(folded.placements).map(([id, tr]) => [id, [...tr.r], [...tr.t]]),
    layerOrder: [...folded.layerOrder.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    holds: folded.holds.map((h) => [h.face, h.material[0], h.material[1]]),
    next: [next.vertex, next.edge, next.face, next.op],
  };
}

export type ImportResult =
  | { readonly ok: true; readonly state: KernelState }
  | { readonly ok: false; readonly reason: 'not-fold' | 'unsupported' };

/**
 * Open a .fold file. Phase 0 reads files Paperfold wrote (exact state). Plain FOLD crease
 * patterns from other tools arrive with crease-pattern import in Phase 3.
 */
export function fromFold(input: unknown): ImportResult {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'not-fold' };
  const file = input as FoldFile;
  if (typeof file.file_spec !== 'number' && !('paperfold:state' in file)) return { ok: false, reason: 'not-fold' };
  const exact = file['paperfold:state'];
  if (!exact || exact.version !== 1) return { ok: false, reason: 'unsupported' };
  return { ok: true, state: fromExact(exact) };
}

function fromExact(x: ExactState): KernelState {
  const vertices = new Map<VertexId, Vec2>(x.vertices.map(([id, u, v]) => [id, [u, v] as const]));
  const creases = new Map<EdgeId, Crease>();
  const edgeIndex = new Map<string, EdgeId>();
  for (const [id, a, b, assignment, angleDeg, restAngleDeg, createdBy, spans] of x.creases) {
    const sharpness: Span[] = spans.map(([from, to, value]) => ({ from, to, value }));
    creases.set(id, { id, v: [a, b], assignment, angleDeg, restAngleDeg, sharpness, createdBy });
    edgeIndex.set(edgeKey(a, b), id);
  }
  const faces = new Map<FaceId, Face>(x.faces.map(([id, verts]) => [id, { id, verts }]));
  const placements = new Map<FaceId, Rigid3>(
    x.placements.map(([id, r, t]) => [id, { r: r as unknown as Mat3, t: t as unknown as Vec3 }]),
  );
  const paper: Paper = {
    outline: x.paper.outline.map((p) => [p[0], p[1]] as const),
    thicknessMm: x.paper.thicknessMm,
    stiffness: x.paper.stiffness,
    front: { color: x.paper.front.color },
    back: { color: x.paper.back.color },
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of paper.outline) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return {
    paper,
    cp: { vertices, creases, faces, edgeIndex },
    folded: {
      placements,
      layerOrder: new Map(x.layerOrder),
      holds: x.holds.map(([face, u, v]) => ({ face, material: [u, v] as const })),
    },
    next: { vertex: x.next[0], edge: x.next[1], face: x.next[2], op: x.next[3] },
    tol: toleranceFor(Math.max(maxX - minX, maxY - minY)),
  };
}
