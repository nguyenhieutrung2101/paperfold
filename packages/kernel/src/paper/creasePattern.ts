import type { Vec2 } from '../geometry/vec.ts';
import type { CreasePattern, EdgeId, Face, FaceId, VertexId } from './types.ts';

export function edgeKey(a: VertexId, b: VertexId): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

export function getVertex(cp: CreasePattern, v: VertexId): Vec2 {
  const p = cp.vertices.get(v);
  if (!p) throw new Error(`Unknown vertex ${v}`);
  return p;
}

export function getFace(cp: CreasePattern, f: FaceId): Face {
  const face = cp.faces.get(f);
  if (!face) throw new Error(`Unknown face ${f}`);
  return face;
}

export function edgeBetween(cp: CreasePattern, a: VertexId, b: VertexId): EdgeId {
  const e = cp.edgeIndex.get(edgeKey(a, b));
  if (e === undefined) throw new Error(`No edge between ${a} and ${b}`);
  return e;
}

export function materialPolygon(cp: CreasePattern, f: FaceId): Vec2[] {
  return getFace(cp, f).verts.map((v) => getVertex(cp, v));
}

/** Faces on either side of a crease. `left` runs v[0] -> v[1] along its CCW boundary. */
export interface EdgeFaces {
  readonly left: FaceId | null;
  readonly right: FaceId | null;
}

export interface Adjacency {
  readonly edgeFaces: ReadonlyMap<EdgeId, EdgeFaces>;
  /** Faces around each vertex, unordered. */
  readonly vertexFaces: ReadonlyMap<VertexId, readonly FaceId[]>;
  /** Creases at each vertex, unordered. */
  readonly vertexEdges: ReadonlyMap<VertexId, readonly EdgeId[]>;
}

const adjacencyCache = new WeakMap<CreasePattern, Adjacency>();

/** Derived incidence (cached per immutable crease pattern). */
export function adjacency(cp: CreasePattern): Adjacency {
  const cached = adjacencyCache.get(cp);
  if (cached) return cached;
  const left = new Map<EdgeId, FaceId>();
  const right = new Map<EdgeId, FaceId>();
  const vertexFaces = new Map<VertexId, FaceId[]>();
  for (const face of cp.faces.values()) {
    const n = face.verts.length;
    for (let i = 0; i < n; i++) {
      const a = face.verts[i]!;
      const b = face.verts[(i + 1) % n]!;
      const e = edgeBetween(cp, a, b);
      const crease = cp.creases.get(e)!;
      const target = crease.v[0] === a ? left : right;
      if (target.has(e)) throw new Error(`Edge ${e} has two faces on the same side`);
      target.set(e, face.id);
      let list = vertexFaces.get(a);
      if (!list) vertexFaces.set(a, (list = []));
      list.push(face.id);
    }
  }
  const edgeFaces = new Map<EdgeId, EdgeFaces>();
  const vertexEdges = new Map<VertexId, EdgeId[]>();
  for (const c of cp.creases.values()) {
    edgeFaces.set(c.id, { left: left.get(c.id) ?? null, right: right.get(c.id) ?? null });
    for (const v of c.v) {
      let list = vertexEdges.get(v);
      if (!list) vertexEdges.set(v, (list = []));
      list.push(c.id);
    }
  }
  const result: Adjacency = { edgeFaces, vertexFaces, vertexEdges };
  adjacencyCache.set(cp, result);
  return result;
}

/** The face across crease e from face f, or null for a raw edge. */
export function faceAcross(cp: CreasePattern, e: EdgeId, f: FaceId): FaceId | null {
  const ef = adjacency(cp).edgeFaces.get(e);
  if (!ef) throw new Error(`Unknown edge ${e}`);
  if (ef.left === f) return ef.right;
  if (ef.right === f) return ef.left;
  throw new Error(`Face ${f} is not on edge ${e}`);
}

/** Creases on the boundary of f, in CCW order (edge i runs verts[i] -> verts[i+1]). */
export function faceEdges(cp: CreasePattern, f: FaceId): EdgeId[] {
  const verts = getFace(cp, f).verts;
  return verts.map((a, i) => edgeBetween(cp, a, verts[(i + 1) % verts.length]!));
}
