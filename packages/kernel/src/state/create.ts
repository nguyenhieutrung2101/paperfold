import { rigidFromPlaneIso } from '../geometry/rigid.ts';
import { signedArea } from '../geometry/polygon.ts';
import { toleranceFor } from '../geometry/tolerance.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { edgeKey } from '../paper/creasePattern.ts';
import type { Crease, CreasePattern, EdgeId, Face, FaceId, Paper, VertexId } from '../paper/types.ts';
import type { KernelState } from './types.ts';

export interface SheetOptions {
  /** Side of the default square in mm. */
  readonly sizeMm?: number;
  /** Custom convex outline (mm). Overrides sizeMm. */
  readonly outline?: readonly Vec2[];
  readonly thicknessMm?: number;
  readonly stiffness?: number;
  readonly frontColor?: string;
  readonly backColor?: string;
}

export const DEFAULT_PAPER = {
  sizeMm: 150,
  thicknessMm: 0.08,
  stiffness: 0.35,
  frontColor: '#c8553d',
  backColor: '#f3efe6',
} as const;

function squareOutline(size: number): Vec2[] {
  return [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
}

/** A fresh, flat, unfolded sheet lying front-up on the table, centered on the origin. */
export function createSheet(options: SheetOptions = {}): KernelState {
  let outline = options.outline ? [...options.outline] : squareOutline(options.sizeMm ?? DEFAULT_PAPER.sizeMm);
  if (outline.length < 3) throw new RangeError('A sheet needs at least three corners');
  if (signedArea(outline) < 0) outline = outline.reverse();

  const paper: Paper = {
    outline,
    thicknessMm: options.thicknessMm ?? DEFAULT_PAPER.thicknessMm,
    stiffness: options.stiffness ?? DEFAULT_PAPER.stiffness,
    front: { color: options.frontColor ?? DEFAULT_PAPER.frontColor },
    back: { color: options.backColor ?? DEFAULT_PAPER.backColor },
  };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  const size = Math.max(maxX - minX, maxY - minY);

  const vertices = new Map<VertexId, Vec2>();
  const creases = new Map<EdgeId, Crease>();
  const edgeIndex = new Map<string, EdgeId>();
  outline.forEach((p, i) => vertices.set(i, p));
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = i;
    const b = (i + 1) % n;
    creases.set(i, {
      id: i,
      v: [a, b],
      assignment: 'B',
      angleDeg: 0,
      restAngleDeg: 0,
      sharpness: [],
      createdBy: null,
    });
    edgeIndex.set(edgeKey(a, b), i);
  }
  const face: Face = { id: 0, verts: outline.map((_, i) => i) };
  const faces = new Map<FaceId, Face>([[0, face]]);
  const cp: CreasePattern = { vertices, creases, faces, edgeIndex };

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const placement = rigidFromPlaneIso({ a: 1, b: 0, c: 0, d: 1, tx: -cx, ty: -cy });

  return {
    paper,
    cp,
    folded: { placements: new Map([[0, placement]]), layerOrder: new Map(), holds: [] },
    next: { vertex: n, edge: n, face: 1, op: 1 },
    tol: toleranceFor(size),
  };
}
