import type { Line2, Move, Vec2 } from '@paperfold/kernel';

export type CandidateKind = 'fold-top' | 'fold-layers' | 'fold-all' | 'inside-reverse' | 'outside-reverse';

export interface Candidate {
  readonly kind: CandidateKind;
  readonly move: Move;
  /** For plain folds: how many layers. */
  readonly layers: number;
}

export interface CandidateOptions {
  readonly line: Line2;
  /** The grab point, on the moving side, strictly on the paper. */
  readonly seed: Vec2;
  /** How many layers lie under the grab. */
  readonly layersAtSeed: number;
  readonly holds?: readonly Vec2[];
  readonly direction?: 'valley' | 'mountain';
}

/**
 * Every move one drag could mean (brief, section 6, "Live intent"): a plain fold of the top
 * layer, of k layers or of all of them, and inside and outside reverse folds. The kernel
 * validates each; `orderCandidates` decides which one shows and what Tab cycles through.
 */
export function candidateMoves(o: CandidateOptions): Candidate[] {
  const line = { p: o.line.p, d: o.line.d };
  const holds = o.holds ?? [];
  const out: Candidate[] = [];
  const plain = (layers: number | 'all', kind: CandidateKind, n: number): Candidate => ({
    kind,
    layers: n,
    move: { type: 'fold', params: { line, seed: o.seed, layers, direction: o.direction ?? 'valley', holds } },
  });
  out.push(plain(1, 'fold-top', 1));
  for (let k = 2; k < o.layersAtSeed; k++) out.push(plain(k, 'fold-layers', k));
  if (o.layersAtSeed > 1) out.push(plain('all', 'fold-all', o.layersAtSeed));
  if (o.layersAtSeed > 1) {
    for (const kind of ['inside', 'outside'] as const) {
      out.push({
        kind: kind === 'inside' ? 'inside-reverse' : 'outside-reverse',
        layers: o.layersAtSeed,
        move: { type: 'reverseFold', params: { line, seed: o.seed, kind, holds } },
      });
    }
  }
  return out;
}

/**
 * The order candidates show in. On a closed flap, a swing of the tip is a reverse fold
 * first: inside, then outside, then a plain fold through both layers, then the top layer
 * (brief, section 5). Otherwise the top layer comes first (Shift: all layers first).
 * Invalid candidates drop out; if nothing is valid, the first one stays so its refusal can
 * be explained.
 */
export function orderCandidates<T extends { readonly candidate: Candidate; readonly ok: boolean }>(
  list: readonly T[],
  opts: { readonly allLayers: boolean; readonly preferred?: CandidateKind },
): T[] {
  const reverseOk = list.some((x) => x.ok && (x.candidate.kind === 'inside-reverse' || x.candidate.kind === 'outside-reverse'));
  const rank = (c: Candidate): number => {
    if (reverseOk) {
      const order: CandidateKind[] = ['inside-reverse', 'outside-reverse', 'fold-all', 'fold-top', 'fold-layers'];
      return order.indexOf(c.kind) * 100 + c.layers;
    }
    if (opts.allLayers) return c.kind === 'fold-all' ? 0 : c.kind === 'fold-top' ? 100 : c.kind === 'fold-layers' ? 200 + c.layers : 900;
    return c.kind === 'fold-top' ? 0 : c.kind === 'fold-layers' ? 100 + c.layers : c.kind === 'fold-all' ? 300 : 900;
  };
  const sorted = [...list].sort((a, b) => rank(a.candidate) - rank(b.candidate));
  // Remember the user's recent choice: if it's valid now, it leads.
  if (opts.preferred) {
    const i = sorted.findIndex((x) => x.ok && x.candidate.kind === opts.preferred);
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  }
  const valid = sorted.filter((x) => x.ok);
  return valid.length > 0 ? valid : sorted.slice(0, 1);
}
