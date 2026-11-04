import type { LayerMapData } from '@paperfold/skin';
import { DataTexture, LinearFilter, RGBAFormat, type Texture } from 'three';
import { type LayerRaster, rasterizeLayerMap } from './layerRaster.ts';

/**
 * The layer map as two textures in sheet coordinates (the paper's own UVs), rebuilt once per
 * state (Phase 2 readability):
 *
 * - A: R contact shadow (the faces lying on this one, blurred, so they darken just past their
 *   edges), G ridge (edges of the faces underneath, softened: a faint bump in raking light),
 *   B rim (this face's folded edges, softened: the shader rounds them off and they catch light).
 * - B: R layers below, G layers above (each step is 32/255), B this face's cut edges (a thin line).
 *
 * The data only describes the side of each face that's facing up; the shader uses it there.
 */
export interface LayerTextures {
  readonly key: string;
  readonly a: Texture;
  readonly b: Texture;
  dispose(): void;
}

/** Textures from a raster (made here or in a worker). */
export function layerTexturesFrom(r: LayerRaster): LayerTextures {
  const tex = (d: Uint8Array) => {
    const t = new DataTexture(d, r.res, r.res, RGBAFormat);
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const a = tex(r.a);
  const b = tex(r.b);
  return {
    key: r.key,
    a,
    b,
    dispose() {
      a.dispose();
      b.dispose();
    },
  };
}

/** Rasterize and upload on this thread. */
export function buildLayerTextures(data: LayerMapData, res?: number): LayerTextures {
  return layerTexturesFrom(rasterizeLayerMap(data, res));
}
