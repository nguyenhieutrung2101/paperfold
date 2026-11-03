import type { Vec2 } from '../geometry/vec.ts';

export type VertexId = number;
export type EdgeId = number;
export type FaceId = number;
export type OpId = number;

/** FOLD edge assignments: mountain, valley, flat, unassigned, border. */
export type Assignment = 'M' | 'V' | 'F' | 'U' | 'B';

export interface Appearance {
  /** CSS color of this side. */
  readonly color: string;
}

export interface Paper {
  /** Material-space outline in mm, counter-clockwise, convex. Square by default. */
  readonly outline: readonly Vec2[];
  readonly thicknessMm: number;
  /** 0 (foil-soft) .. 1 (card-stiff). Drives springback and soft-bend radius. */
  readonly stiffness: number;
  readonly front: Appearance;
  readonly back: Appearance;
}

/**
 * Piecewise-constant value along an edge, parameterized 0..1 from crease.v[0] to crease.v[1].
 * Spans are sorted, non-overlapping, and only cover non-zero values.
 */
export interface Span {
  readonly from: number;
  readonly to: number;
  readonly value: number;
}

/**
 * An edge of the crease pattern. Raw edges of the sheet are creases too, with assignment 'B'.
 *
 * Sign convention (material-front, FOLD edges_foldAngle): + valley, − mountain.
 */
export interface Crease {
  readonly id: EdgeId;
  /** Endpoints. The face whose CCW boundary runs v[0] -> v[1] is the edge's "left" face. */
  readonly v: readonly [VertexId, VertexId];
  /**
   * Last folded direction. A crease at 0° keeps its M/V assignment: that is its memory
   * (brief, section 3, "Robustness"). 'B' for raw edges.
   */
  readonly assignment: Assignment;
  /** Current signed fold angle in degrees. Phase 0 states are flat: 0 or ±180. */
  readonly angleDeg: number;
  /** Where the crease relaxes when nobody holds it. */
  readonly restAngleDeg: number;
  /** 0..1 along the edge; creasing raises it where you pressed. Empty = fully soft. */
  readonly sharpness: readonly Span[];
  /** The op that made this crease (null for the sheet's raw edges). */
  readonly createdBy: OpId | null;
}

/** A face of the crease pattern: a convex polygon, vertices counter-clockwise in material space. */
export interface Face {
  readonly id: FaceId;
  readonly verts: readonly VertexId[];
}

/**
 * The crease pattern: a planar subdivision of the sheet in material space.
 *
 * It is a half-edge structure in all but name: each face's CCW vertex cycle lists its
 * half-edges, and `edgeIndex` pairs every half-edge with its twin through the shared
 * crease. We keep it as flat immutable maps (not pointer-linked records) so that states
 * share structure and serialize trivially (see DECISIONS.md, ADR-006).
 */
export interface CreasePattern {
  readonly vertices: ReadonlyMap<VertexId, Vec2>;
  readonly creases: ReadonlyMap<EdgeId, Crease>;
  readonly faces: ReadonlyMap<FaceId, Face>;
  /** "min,max" vertex pair -> crease id. */
  readonly edgeIndex: ReadonlyMap<string, EdgeId>;
}
