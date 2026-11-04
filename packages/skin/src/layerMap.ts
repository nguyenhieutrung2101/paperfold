import {
  applyPlaneIso,
  type FaceId,
  invertPlaneIso,
  planeIsoOf,
  type Snapshot,
  type Vec2,
} from '@paperfold/kernel';

/**
 * What each face can see of the layers around it, in its own sheet coordinates (u, v in 0..1,
 * the paper texture's coordinates), for drawing (Phase 2 readability, plan 2):
 *
 * - **above**: the faces lying on it. Their outlines, blurred, darken the face just past their
 *   edges: the contact shadow every visible step of paper casts.
 * - **below**: the faces under it. Their edges press a faint ridge into the face (visible in raking
 *   light), and their count says how many layers light passes through (the lightbox).
 * - **edges**: the face's own folded and cut edges, for a light rim on folds and a dark line on cuts.
 *
 * Pure geometry from the snapshot; the renderer rasterizes it once per state.
 */
export interface LayerMapFace {
  readonly face: FaceId;
  readonly clip: readonly Vec2[];
  readonly above: ReadonlyArray<readonly Vec2[]>;
  readonly below: ReadonlyArray<readonly Vec2[]>;
  readonly folded: ReadonlyArray<readonly [Vec2, Vec2]>;
  readonly raw: ReadonlyArray<readonly [Vec2, Vec2]>;
}

export interface LayerMapData {
  readonly key: string;
  readonly faces: readonly LayerMapFace[];
  /** Sheet size (mm) the coordinates are divided by: blur radii in mm convert with it. */
  readonly sizeMm: number;
}

const cache = new WeakMap<Snapshot, LayerMapData>();

export function layerMapData(snap: Snapshot): LayerMapData {
  const hit = cache.get(snap);
  if (hit) return hit;
  const size = snap.sizeMm;
  const isos = new Map(snap.faces.map((f) => [f.id, planeIsoOf(f.placement)]));
  const world = new Map(snap.faces.map((f) => [f.id, f.material.map((p) => applyPlaneIso(isos.get(f.id)!, p))]));
  const above = new Map<FaceId, FaceId[]>();
  const below = new Map<FaceId, FaceId[]>();
  for (const f of snap.faces) {
    above.set(f.id, []);
    below.set(f.id, []);
  }
  // Rows are [f, g, s]: s = +1 when f lies above g.
  for (const [f, g, s] of snap.layerOrder) {
    const [hi, lo] = s === 1 ? [f, g] : [g, f];
    above.get(lo)!.push(hi);
    below.get(hi)!.push(lo);
  }
  const folded = new Map<FaceId, Array<[Vec2, Vec2]>>();
  const raw = new Map<FaceId, Array<[Vec2, Vec2]>>();
  for (const c of snap.creases) {
    const uv = (p: Vec2): Vec2 => [p[0] / size, p[1] / size];
    if (c.left === null || c.right === null) {
      const f = (c.left ?? c.right)!;
      let list = raw.get(f);
      if (!list) raw.set(f, (list = []));
      list.push([uv(c.a), uv(c.b)]);
    } else if (Math.abs(c.angleDeg) === 180) {
      for (const f of [c.left, c.right]) {
        let list = folded.get(f);
        if (!list) folded.set(f, (list = []));
        list.push([uv(c.a), uv(c.b)]);
      }
    }
  }
  const faces: LayerMapFace[] = snap.faces.map((f) => {
    const inv = invertPlaneIso(isos.get(f.id)!);
    const toUv = (g: FaceId) => world.get(g)!.map((p) => {
      const m = applyPlaneIso(inv, p);
      return [m[0] / size, m[1] / size] as Vec2;
    });
    return {
      face: f.id,
      clip: f.material.map((p) => [p[0] / size, p[1] / size] as Vec2),
      above: above.get(f.id)!.map(toUv),
      below: below.get(f.id)!.map(toUv),
      folded: folded.get(f.id) ?? [],
      raw: raw.get(f.id) ?? [],
    };
  });
  const data = { key: snap.hash, faces, sizeMm: size };
  cache.set(snap, data);
  return data;
}
