import {
  applyMove,
  applyPlaneIso,
  canRedo,
  canUndo,
  createHistory,
  createSheet,
  currentState,
  fromFold,
  goTo,
  type FoldParams,
  type History,
  type KernelState,
  type Move,
  type NodeId,
  perform,
  planeIsoOf,
  redo,
  type ReasonCode,
  type SheetOptions,
  type Snapshot,
  snapshot,
  toFold,
  type Transition,
  undo,
  type Vec2,
} from '@paperfold/kernel';

export interface TimelineEntry {
  readonly id: NodeId;
  readonly label: string;
  readonly current: boolean;
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

export type PreviewResult =
  | {
      readonly ok: true;
      /** Where the moving faces land, on the table plane. */
      readonly landing: ReadonlyArray<readonly Vec2[]>;
      readonly movingCount: number;
    }
  | Refusal;

export type PerformResult =
  | { readonly ok: true; readonly view: View; readonly before: Snapshot; readonly transition: Transition }
  | Refusal;

export interface LabScene {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly transition: Transition;
}

function refusal(r: { reason: ReasonCode; blockers: readonly number[]; suggestLayers?: number }): Refusal {
  return {
    ok: false,
    reason: r.reason,
    blockers: [...r.blockers],
    ...(r.suggestLayers !== undefined ? { suggestLayers: r.suggestLayers } : {}),
  };
}

/**
 * The kernel's home in the worker. It owns the history; the UI thread only ever sees
 * snapshots and transitions (structured-cloned), never kernel state it could change.
 */
export class KernelHost {
  private history: History = createHistory(createSheet());

  reset(options: SheetOptions): View {
    this.history = createHistory(createSheet(options));
    return this.view();
  }

  current(): View {
    return this.view();
  }

  /** Validate a fold without committing it: the ghost preview. */
  preview(params: FoldParams): PreviewResult {
    const state = currentState(this.history);
    const r = applyMove(state, { type: 'fold', params });
    if (!r.ok) return refusal(r);
    if (r.transition.kind !== 'fold') return { ok: true, landing: [], movingCount: 0 };
    const landing = r.transition.moving.map((f) => {
      const face = r.state.cp.faces.get(f)!;
      const iso = planeIsoOf(r.state.folded.placements.get(f)!);
      return face.verts.map((v) => applyPlaneIso(iso, r.state.cp.vertices.get(v)!));
    });
    return { ok: true, landing, movingCount: landing.length };
  }

  perform(move: Move): PerformResult {
    const before = snapshot(currentState(this.history));
    const r = perform(this.history, move);
    if (!r.ok) return refusal(r);
    this.history = r.history;
    return { ok: true, view: this.view(), before, transition: r.transition };
  }

  undo(): View {
    this.history = undo(this.history);
    return this.view();
  }

  redo(): View {
    this.history = redo(this.history);
    return this.view();
  }

  goTo(id: NodeId): View {
    this.history = goTo(this.history, id);
    return this.view();
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
    // Footprint center, then a line through it; the far side (away from the spine) moves.
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
      return { id, label: node.op ? node.op.move.type : 'start', current: id === h.current };
    });
    return { snapshot: snapshot(currentState(h)), timeline, canUndo: canUndo(h), canRedo: canRedo(h) };
  }
}
