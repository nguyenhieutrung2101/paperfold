/// <reference lib="webworker" />
import { type LayerRaster, rasterizeLayerMap } from '@paperfold/render/raster';
import type { LayerMapData } from '@paperfold/skin';

/**
 * Rasterizes layer maps off the main thread (tens of milliseconds each, once per state), so a
 * fold never stutters while its shadows are drawn.
 */
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<{ readonly data: LayerMapData; readonly res: number }>) => {
  let r: LayerRaster;
  try {
    r = rasterizeLayerMap(e.data.data, e.data.res);
  } catch (err) {
    self.postMessage({ key: e.data.data.key, error: String(err) });
    return;
  }
  self.postMessage(r, [r.a.buffer, r.b.buffer]);
};
