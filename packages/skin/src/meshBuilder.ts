import type { Vec2, Vec3 } from '@paperfold/kernel';

/** Flat typed arrays ready for a GPU buffer. Positions in mm, world space (Y up). */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Material coordinates divided by the sheet size: the paper texture sticks to the paper. */
  readonly uvs: Float32Array;
  /** Kernel face id per vertex (for highlighting faces, e.g. a blocking layer). */
  readonly faceIds: Float32Array;
  readonly indices: Uint32Array;
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly fid: number[] = [];
  private readonly idx: number[] = [];

  private readonly uvScale: number;

  constructor(uvScale: number) {
    this.uvScale = uvScale;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(p: Vec3, n: Vec3, material: Vec2, face: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(material[0] / this.uvScale, material[1] / this.uvScale);
    this.fid.push(face);
    return this.pos.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      uvs: new Float32Array(this.uv),
      faceIds: new Float32Array(this.fid),
      indices: new Uint32Array(this.idx),
    };
  }
}
