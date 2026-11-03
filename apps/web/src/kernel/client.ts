import { type Remote, wrap } from 'comlink';
import type { KernelHost } from './api.ts';

export type KernelClient = Remote<KernelHost>;

let client: KernelClient | null = null;

/** The single kernel worker for this page. */
export function kernel(): KernelClient {
  if (!client) {
    const worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module', name: 'paperfold-kernel' });
    client = wrap<KernelHost>(worker);
  }
  return client;
}
