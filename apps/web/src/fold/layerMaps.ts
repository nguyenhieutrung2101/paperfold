import { buildLayerTextures, type LayerRaster, layerTexturesFrom, type LayerTextures } from '@paperfold/render';
import type { Snapshot } from '@paperfold/kernel';
import { layerMapData } from '@paperfold/skin';

const RES = 768;
/** States kept: the one on the table, the one a fold is landing on, and a step or two of undo. */
const KEEP = 6;

/**
 * The layer maps (shadows, ridges, rims, counts) for recent states. Built in a worker when the
 * browser has OffscreenCanvas, else on the main thread after the current frame. `onReady` fires
 * when a requested map arrives.
 */
export class LayerMaps {
  private readonly cache = new Map<string, LayerTextures>();
  private readonly pending = new Set<string>();
  private worker: Worker | null = null;
  private failed = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined';
  private disposed = false;
  private readonly onReady: () => void;

  constructor(onReady: () => void) {
    this.onReady = onReady;
  }

  /** The map for this state if it's ready; otherwise null, and it's on its way. */
  get(snap: Snapshot): LayerTextures | null {
    const hit = this.cache.get(snap.hash);
    if (hit) {
      // Most recently used last.
      this.cache.delete(snap.hash);
      this.cache.set(snap.hash, hit);
      return hit;
    }
    this.request(snap);
    return null;
  }

  request(snap: Snapshot): void {
    if (this.disposed || this.cache.has(snap.hash) || this.pending.has(snap.hash)) return;
    this.pending.add(snap.hash);
    const data = layerMapData(snap);
    if (!this.failed) {
      try {
        this.ensureWorker().postMessage({ data, res: RES });
        return;
      } catch {
        this.failed = true;
      }
    }
    setTimeout(() => {
      if (this.disposed) return;
      this.store(snap.hash, buildLayerTextures(data, 512));
    }, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./layers.worker.ts', import.meta.url), { type: 'module', name: 'paperfold-layers' });
    w.onmessage = (e: MessageEvent<LayerRaster | { key: string; error: string }>) => {
      if (this.disposed) return;
      const r = e.data;
      if ('error' in r) {
        // This browser's worker can't draw: draw on the main thread from now on.
        this.failed = true;
        this.pending.delete(r.key);
        this.onReady();
        return;
      }
      this.store(r.key, layerTexturesFrom(r));
    };
    w.onerror = () => {
      this.failed = true;
      this.pending.clear();
      this.onReady();
    };
    this.worker = w;
    return w;
  }

  private store(key: string, t: LayerTextures): void {
    this.pending.delete(key);
    this.cache.set(key, t);
    while (this.cache.size > KEEP) {
      const [k, old] = this.cache.entries().next().value!;
      this.cache.delete(k);
      old.dispose();
    }
    this.onReady();
  }
}
