import { type Candidate, type CandidateKind, candidateMoves, orderCandidates } from '@paperfold/intent';
import {
  applyMaterial,
  applyMove,
  applyPlaneIso,
  canRedo,
  canUndo,
  createHistory,
  createSheet,
  currentState,
  type FaceId,
  type FoldParams,
  fromFold,
  goTo,
  type Grip,
  type History,
  invertPlaneIso,
  type KernelState,
  type Move,
  type MoveName,
  type NodeId,
  perform,
  planeIsoOf,
  type PlaneLine,
  type ReasonCode,
  recognize,
  redo,
  type SheetOptions,
  type Snapshot,
  snapshot,
  stackAt,
  stackLevels,
  toFold,
  type Transition,
  undo,
  type Vec2,
} from '@paperfold/kernel';
import type { MotionTransition } from '@paperfold/skin';
import { buildSteps, designLog, type HandSide, type Step } from '@paperfold/steps';

/** A tiny top view of a state for the timeline: face outlines bottom to top, 0..1 box. */
export interface Thumb {
  readonly polys: ReadonlyArray<readonly number[]>;
  readonly frontUp: readonly boolean[];
}

export interface TimelineEntry {
  readonly id: NodeId;
  /** The recognized move name (plain "fold" when unsure); "start" for the flat sheet. */
  readonly label: MoveName | 'start';
  readonly current: boolean;
  readonly thumb: Thumb;
}

export interface View {
  readonly snapshot: Snapshot;
  readonly timeline: readonly TimelineEntry[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type Refusal = {
  readonly ok: false;
  readonly reason: ReasonCode;
  readonly blockers: readonly number[];
  readonly suggestLayers?: number;
};

export type PerformResult =
  | { readonly ok: true; readonly view: View; readonly before: Snapshot; readonly transition: Transition; readonly name: MoveName }
  | Refusal;

export interface LabScene {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly transition: Transition;
}

/** One drag, as the pointer sees it right now. */
export interface DragQuery {
  readonly line: PlaneLine;
  /** The press point: strictly on the paper, on the moving side. */
  readonly seed: Vec2;
  readonly holds: readonly Vec2[];
  readonly allLayers: boolean;
  /** Tab presses so far: which alternative to show. */
  readonly index: number;
  /** The kind the user picked last time (it leads when it's valid). */
  readonly preferred?: CandidateKind;
  /** Only these kinds (the push gesture is always an inside reverse fold). */
  readonly only?: readonly CandidateKind[];
}

export interface CandidateStatus {
  readonly kind: CandidateKind;
  readonly layers: number;
  readonly ok: boolean;
  readonly reason?: ReasonCode;
}

export interface DragPreview {
  /** Valid alternatives in Tab order (or the refused first one, if none is valid). */
  readonly candidates: readonly CandidateStatus[];
  readonly selected: number;
  /** The selected move, its result and its exact transition (when valid). */
  readonly preview: {
    readonly move: Move;
    readonly after: Snapshot;
    readonly transition: MotionTransition;
    readonly name: MoveName;
    readonly confident: boolean;
  } | null;
  readonly refusal: Refusal | null;
}

/** Plain-data build steps for the player (no kernel states cross the boundary). */
export interface PlayerStep {
  readonly index: number;
  readonly kind: Step['kind'];
  readonly name: MoveName;
  readonly named: boolean;
  readonly caption: Step['caption'];
  readonly symbols: Step['symbols'];
  readonly hands: Step['hands'];
  readonly creased: boolean;
  readonly before: Snapshot;
  /** Right after the step's main move (before any creasing or unfolding in the same step). */
  readonly main: Snapshot;
  readonly after: Snapshot;
  readonly transition: Transition | null;
}

export interface StepsView {
  readonly steps: readonly PlayerStep[];
  readonly verified: boolean;
  readonly brokenAt?: number;
}

function refusal(r: { reason: ReasonCode; blockers: readonly number[]; suggestLayers?: number }): Refusal {
  return {
    ok: false,
    reason: r.reason,
    blockers: [...r.blockers],
    ...(r.suggestLayers !== undefined ? { suggestLayers: r.suggestLayers } : {}),
  };
}

/** Where a hand touched, in both spaces: the top face under the point. */
function gripAt(state: KernelState, p: Vec2): Grip | null {
  const st = stackAt(state, p);
  if (!st.ok || st.faces.length === 0) return null;
  const face: FaceId = st.faces[0]!;
  const tr = state.folded.placements.get(face)!;
  const material = applyPlaneIso(invertPlaneIso(planeIsoOf(tr)), p);
  return { face, material, world: applyMaterial(tr, material) };
}

/**
 * The kernel's home in the worker. It owns the history; the UI thread only ever sees
 * snapshots and transitions (structured-cloned), never kernel state it could change.
 */
export class KernelHost {
  private history: History = createHistory(createSheet());
  private thumbs = new WeakMap<KernelState, Thumb>();
  private names = new WeakMap<KernelState, MoveName>();
  private exploreCache: { key: string; results: Array<{ candidate: Candidate; ok: boolean; result: ReturnType<typeof applyMove> }> } | null = null;

  reset(options: SheetOptions): View {
    this.history = createHistory(createSheet(options));
    this.exploreCache = null;
    return this.view();
  }

  current(): View {
    return this.view();
  }

  /**
   * Every move this drag could mean, validated by the kernel, in Tab order, with the
   * selected one's result and exact transition for the live preview (brief, section 6,
   * "Live intent").
   */
  explore(q: DragQuery): DragPreview {
    const state = currentState(this.history);
    const key = JSON.stringify([q.line, q.seed, q.holds, q.only ?? null, this.history.current]);
    if (!this.exploreCache || this.exploreCache.key !== key) {
      const st = stackAt(state, q.seed);
      const layers = st.ok ? st.faces.length : 1;
      let cands = candidateMoves({ line: { p: q.line.p, d: q.line.d }, seed: q.seed, layersAtSeed: layers, holds: q.holds });
      // Keep the list short on deep stacks: top, all, a couple of k, and the reverse folds.
      cands = cands.filter((c) => c.kind !== 'fold-layers' || c.layers <= 3);
      if (q.only) cands = cands.filter((c) => q.only!.includes(c.kind));
      const results = cands.map((candidate) => {
        const result = applyMove(state, candidate.move);
        return { candidate, ok: result.ok, result };
      });
      this.exploreCache = { key, results };
    }
    const ordered = orderCandidates(this.exploreCache.results, {
      allLayers: q.allLayers,
      ...(q.preferred ? { preferred: q.preferred } : {}),
    });
    const selected = ordered.length === 0 ? 0 : ((q.index % ordered.length) + ordered.length) % ordered.length;
    const pick = ordered[selected];
    const candidates = ordered.map((x) => ({
      kind: x.candidate.kind,
      layers: x.candidate.layers,
      ok: x.ok,
      ...(x.result.ok ? {} : { reason: x.result.reason }),
    }));
    if (!pick || !pick.result.ok) {
      return { candidates, selected, preview: null, refusal: pick && !pick.result.ok ? refusal(pick.result) : null };
    }
    const tr = pick.result.transition;
    if (tr.kind !== 'fold' && tr.kind !== 'reverse') return { candidates, selected, preview: null, refusal: null };
    const named = recognize(state, pick.result.state);
    return {
      candidates,
      selected,
      preview: {
        move: pick.candidate.move,
        after: snapshot(pick.result.state),
        transition: tr,
        name: named.name,
        confident: named.confidence >= 0.5,
      },
      refusal: null,
    };
  }

  /** Commit a move; the grab and holds (table plane) are recorded for the build steps. */
  perform(move: Move, extras: { grab?: Vec2; holds?: readonly Vec2[] } = {}): PerformResult {
    const state = currentState(this.history);
    const before = snapshot(state);
    const grab = extras.grab ? gripAt(state, extras.grab) : null;
    const holds = (extras.holds ?? []).map((h) => gripAt(state, h)).filter((g): g is Grip => g !== null);
    const r = perform(this.history, move, { ...(grab ? { grab } : {}), holds });
    if (!r.ok) return refusal(r);
    this.history = r.history;
    this.exploreCache = null;
    const named = recognize(state, currentState(this.history));
    return {
      ok: true,
      view: this.view(),
      before,
      transition: r.transition,
      name: named.confidence >= 0.5 ? named.name : 'fold',
    };
  }

  undo(): View {
    this.history = undo(this.history);
    this.exploreCache = null;
    return this.view();
  }

  redo(): View {
    this.history = redo(this.history);
    this.exploreCache = null;
    return this.view();
  }

  goTo(id: NodeId): View {
    this.history = goTo(this.history, id);
    this.exploreCache = null;
    return this.view();
  }

  /** Build steps for the current branch (brief, section 7). */
  steps(handedness: HandSide): StepsView {
    const result = buildSteps(designLog(this.history), { handedness });
    return {
      steps: result.steps.map((s) => ({
        index: s.index,
        kind: s.kind,
        name: s.name,
        named: s.named,
        caption: s.caption,
        symbols: s.symbols,
        hands: s.hands,
        creased: s.creased,
        before: snapshot(s.before),
        main: (() => {
          const r = s.moves[0] ? applyMove(s.before, s.moves[0]) : null;
          return snapshot(r && r.ok ? r.state : s.after);
        })(),
        after: snapshot(s.after),
        transition: s.transition,
      })),
      verified: result.verified,
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
    };
  }

  exportFold(title: string): string {
    return JSON.stringify(toFold(currentState(this.history), title), null, 1);
  }

  importFold(text: string): View | { readonly error: 'bad-file' } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'bad-file' };
    }
    const r = fromFold(parsed);
    if (!r.ok) return { error: 'bad-file' };
    this.history = createHistory(r.state);
    this.exploreCache = null;
    return this.view();
  }

  /**
   * Bend lab: a sheet pre-folded into `layers` layers, and a candidate fold of all of them
   * along a line through the middle of the stack at `angleDeg` from vertical.
   */
  labScene(options: SheetOptions, layers: 1 | 2 | 4 | 8, angleDeg: number): LabScene {
    let s: KernelState = createSheet(options);
    const size = Math.max(...s.paper.outline.map((p) => Math.max(p[0], p[1])));
    const prefolds: FoldParams[] = [
      { line: { p: [0, 0], d: [0, 1] }, seed: [size / 4, 0], layers: 'all', direction: 'valley' },
      { line: { p: [0, 0], d: [1, 0] }, seed: [-size / 4, size / 4], layers: 'all', direction: 'valley' },
      { line: { p: [-size / 4, 0], d: [0, 1] }, seed: [-size / 2 + 2, -size / 4], layers: 'all', direction: 'valley' },
    ];
    const count = layers === 1 ? 0 : layers === 2 ? 1 : layers === 4 ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const r = applyMove(s, { type: 'fold', params: prefolds[i]! });
      if (!r.ok) throw new Error(`Lab prefold ${i} refused: ${r.reason}`);
      s = r.state;
    }
    const snap = snapshot(s);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of snap.faces) {
      const iso = planeIsoOf(f.placement);
      for (const p of f.material) {
        const q = applyPlaneIso(iso, p);
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
      }
    }
    const c: Vec2 = [(minX + maxX) / 2, (minY + maxY) / 2];
    const a = (angleDeg * Math.PI) / 180;
    const d: Vec2 = [Math.sin(a), Math.cos(a)];
    const n: Vec2 = [-d[1], d[0]];
    const reach = Math.min(maxX - minX, maxY - minY) / 4;
    const seed: Vec2 = [c[0] + n[0] * reach, c[1] + n[1] * reach];
    const r = applyMove(s, { type: 'fold', params: { line: { p: c, d }, seed, layers: 'all', direction: 'valley' } });
    if (!r.ok) throw new Error(`Lab fold refused: ${r.reason}`);
    return { before: snap, after: snapshot(r.state), transition: r.transition };
  }

  /** The move's name for the timeline, recognized once per state. */
  private nameOf(before: KernelState, after: KernelState): MoveName {
    const cached = this.names.get(after);
    if (cached) return cached;
    const r = recognize(before, after);
    const name = r.confidence >= 0.5 ? r.name : 'fold';
    this.names.set(after, name);
    return name;
  }

  private thumbOf(state: KernelState): Thumb {
    const cached = this.thumbs.get(state);
    if (cached) return cached;
    const levels = stackLevels(state);
    const faces = [...state.cp.faces.values()].sort((a, b) => levels.get(a.id)! - levels.get(b.id)! || a.id - b.id);
    const raw = faces.map((f) => {
      const tr = state.folded.placements.get(f.id)!;
      const iso = planeIsoOf(tr);
      return { pts: f.verts.map((v) => applyPlaneIso(iso, state.cp.vertices.get(v)!)), up: tr.r[5] > 0 };
    });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of raw) {
      for (const p of f.pts) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    // Normalize against the sheet size so thumbnails share a scale (folding shrinks the model).
    const size = Math.max(...state.paper.outline.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.45;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const thumb: Thumb = {
      polys: raw.map((f) => f.pts.flatMap((p) => [0.5 + (p[0] - cx) / size, 0.5 - (p[1] - cy) / size])),
      frontUp: raw.map((f) => f.up),
    };
    this.thumbs.set(state, thumb);
    return thumb;
  }

  private view(): View {
    const h = this.history;
    // The visible line: root to current, then on along the redo path.
    const ids: NodeId[] = [];
    let n = h.nodes.get(h.current);
    while (n) {
      ids.unshift(n.id);
      n = n.parent === null ? undefined : h.nodes.get(n.parent);
    }
    let next = h.redoTo.get(h.current);
    while (next !== undefined) {
      ids.push(next);
      next = h.redoTo.get(next);
    }
    const timeline = ids.map((id) => {
      const node = h.nodes.get(id)!;
      const parent = node.parent === null ? undefined : h.nodes.get(node.parent);
      return {
        id,
        label: parent ? this.nameOf(parent.state, node.state) : ('start' as const),
        current: id === h.current,
        thumb: this.thumbOf(node.state),
      };
    });
    return { snapshot: snapshot(currentState(h)), timeline, canUndo: canUndo(h), canRedo: canRedo(h) };
  }
}
