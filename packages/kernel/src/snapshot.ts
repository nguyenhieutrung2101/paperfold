import { frontUp, type Rigid3 } from './geometry/rigid.ts';
import type { Vec2 } from './geometry/vec.ts';
import { adjacency, getVertex } from './paper/creasePattern.ts';
import type { Assignment, EdgeId, FaceId, OpId, Paper, Span, VertexId } from './paper/types.ts';
import { parsePairKey } from './state/order.ts';
import type { KernelState } from './state/types.ts';
import { stateHash } from './history/hash.ts';

export interface SnapshotFace {
  readonly id: FaceId;
  readonly verts: readonly VertexId[];
  /** Material polygon, CCW. */
  readonly material: readonly Vec2[];
  readonly placement: Rigid3;
  readonly frontUp: boolean;
}

export interface SnapshotCrease {
  readonly id: EdgeId;
  readonly v: readonly [VertexId, VertexId];
  readonly a: Vec2;
  readonly b: Vec2;
  /** Face with v[0] -> v[1] on its CCW boundary, and the one across. */
  readonly left: FaceId | null;
  readonly right: FaceId | null;
  readonly assignment: Assignment;
  readonly angleDeg: number;
  readonly restAngleDeg: number;
  readonly sharpness: readonly Span[];
  readonly createdBy: OpId | null;
}

/**
 * Plain-data view of a kernel state for the skin and renderer. It crosses the worker
 * boundary by structured clone and contains everything the skin needs, nothing it could
 * use to change the kernel's decisions.
 */
export interface Snapshot {
  readonly hash: string;
  readonly paper: Paper;
  readonly sizeMm: number;
  readonly faces: readonly SnapshotFace[];
  readonly creases: readonly SnapshotCrease[];
  /** [f, g, +1] means f lies above g in world (+Y). Only overlapping pairs. */
  readonly layerOrder: ReadonlyArray<readonly [FaceId, FaceId, 1 | -1]>;
}

export function snapshot(state: KernelState): Snapshot {
  const { cp } = state;
  const adj = adjacency(cp);
  const faces: SnapshotFace[] = [...cp.faces.values()]
    .sort((a, b) => a.id - b.id)
    .map((f) => {
      const placement = state.folded.placements.get(f.id)!;
      return {
        id: f.id,
        verts: f.verts,
        material: f.verts.map((v) => getVertex(cp, v)),
        placement,
        frontUp: frontUp(placement),
      };
    });
  const creases: SnapshotCrease[] = [...cp.creases.values()]
    .sort((a, b) => a.id - b.id)
    .map((c) => {
      const ef = adj.edgeFaces.get(c.id)!;
      return {
        id: c.id,
        v: c.v,
        a: getVertex(cp, c.v[0]),
        b: getVertex(cp, c.v[1]),
        left: ef.left,
        right: ef.right,
        assignment: c.assignment,
        angleDeg: c.angleDeg,
        restAngleDeg: c.restAngleDeg,
        sharpness: c.sharpness,
        createdBy: c.createdBy,
      };
    });
  const layerOrder = [...state.folded.layerOrder.entries()].map(([k, s]) => {
    const [f, g] = parsePairKey(k);
    return [f, g, s] as const;
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of state.paper.outline) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return {
    hash: stateHash(state),
    paper: state.paper,
    sizeMm: Math.max(maxX - minX, maxY - minY),
    faces,
    creases,
    layerOrder,
  };
}
