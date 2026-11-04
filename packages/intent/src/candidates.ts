import type { Line2, Move, Vec2 } from '@paperfold/kernel';

export type CandidateKind =
  | 'fold-top'
  | 'fold-layers'
  | 'fold-all'
  | 'inside-reverse'
  | 'outside-reverse'
  | 'squash'
  | 'petal'
  | 'pleat'
  | 'inside-crimp'
  | 'outside-crimp'
  | 'rabbit-ear';

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
  /**
   * Folded edges of the picked-up flap that it could be squashed on (a squash turns on the
   * flap's own hinge, not on the drag's line). None: no squash candidates.
   */
  readonly squashHinges?: readonly Line2[];
  /**
   * Where a pleat or crimp along this drag would fold back (a line past the drag's line, on
   * the side that moves, usually a precrease). None: no pleat or crimp candidates.
   */
  readonly secondLine?: Line2;
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
    // The top layer's corner, when it can't fold alone, lifts as a petal on the same line.
    out.push({ kind: 'petal', layers: 1, move: { type: 'petal', params: { hinge: line, seed: o.seed, layers: 1, holds } } });
    // A closed flap can be squashed flat on one of its folded edges.
    for (const h of o.squashHinges ?? []) {
      for (let k = 2; k <= o.layersAtSeed; k++) {
        out.push({ kind: 'squash', layers: k, move: { type: 'squash', params: { hinge: { p: h.p, d: h.d }, seed: o.seed, layers: k, holds } } });
      }
    }
    for (const kind of ['inside', 'outside'] as const) {
      out.push({
        kind: kind === 'inside' ? 'inside-reverse' : 'outside-reverse',
        layers: o.layersAtSeed,
        move: { type: 'reverseFold', params: { line, seed: o.seed, kind, holds } },
      });
    }
  }
  if (o.secondLine) {
    const second = { p: o.secondLine.p, d: o.secondLine.d };
    out.push({ kind: 'pleat', layers: o.layersAtSeed, move: { type: 'pleat', params: { first: line, second, seed: o.seed, layers: 'all', holds } } });
    if (o.layersAtSeed > 1) {
      for (const kind of ['inside', 'outside'] as const) {
        out.push({ kind: kind === 'inside' ? 'inside-crimp' : 'outside-crimp', layers: o.layersAtSeed, move: { type: 'crimp', params: { first: line, second, seed: o.seed, kind, holds } } });
      }
    }
  }
  return out;
}

/** What the press and the user's choices say about the order. */
export interface OrderOptions {
  /** Shift: every layer first. */
  readonly allLayers: boolean;
  /** How many layers the hover showed and the scroll picked (plain folds start there). */
  readonly layers?: number;
  /** Kinds that lead, in this order (a push on a folded edge leads with its reverse fold). */
  readonly lead?: readonly CandidateKind[];
  /** What the user picked last time for this kind of press: it leads when it's valid. */
  readonly preferred?: CandidateKind;
}

/**
 * The order candidates show in (Phase 1 polish, plan 1). Where you press decides the first
 * guess: a corner or the paper folds the layers you picked up (then more layers, then fewer),
 * with reverse folds last; a push on a folded edge leads with its reverse fold, then folds
 * every layer. Invalid candidates drop out; if nothing is valid, the first one stays so its
 * refusal can be explained.
 */
export function orderCandidates<T extends { readonly candidate: Candidate; readonly ok: boolean }>(
  list: readonly T[],
  opts: OrderOptions,
): T[] {
  const lead = opts.lead ?? [];
  const k = opts.layers ?? 1;
  const rank = (c: Candidate): number => {
    const li = lead.indexOf(c.kind);
    if (li >= 0) return li;
    const base = 100;
    if (c.kind === 'petal') return base + (k === 1 ? 0.5 : 500);
    if (c.kind === 'squash') return base + 600 + c.layers;
    if (c.kind === 'pleat') return base + 700;
    if (c.kind === 'rabbit-ear') return base + 650 + (c.layers === 1 ? 1 : 0);
    if (c.kind === 'inside-crimp') return base + 950;
    if (c.kind === 'outside-crimp') return base + 951;
    if (c.kind === 'inside-reverse') return base + 900;
    if (c.kind === 'outside-reverse') return base + 901;
    if (opts.allLayers) return base + (c.kind === 'fold-all' ? 0 : 500 - c.layers);
    // Plain folds: the picked count first, then more layers, then fewer.
    return base + (c.layers >= k ? c.layers - k : 400 + (k - c.layers));
  };
  const sorted = [...list].sort((a, b) => rank(a.candidate) - rank(b.candidate));
  if (opts.preferred) {
    const i = sorted.findIndex((x) => x.ok && x.candidate.kind === opts.preferred);
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  }
  const valid = sorted.filter((x) => x.ok);
  return valid.length > 0 ? valid : sorted.slice(0, 1);
}
