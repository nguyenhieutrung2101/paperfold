import { type Candidate, type CandidateKind, candidateMoves, orderCandidates } from '@paperfold/intent';
import {
  adjacency,
  applyMaterial,
  lineThrough,
  line as makeLine,
  signedDistance,
  applyMove,
  containsStrictly,
  faceEdges,
  flatView,
  materialPolygon,
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
  recognizeBase,
  matchesState,
  type BaseName,
  redo,
  type SheetOptions,
  type Snapshot,
  snapshot,
  stackAt,
  stackLevels,
  toFold,
  toFoldSteps,
  type Transition,
  undo,
  type Vec2,
} from '@paperfold/kernel';
import type { MotionTransition } from '@paperfold/skin';
import { buildSteps, designLog, type HandSide, type Step, stepsSvg } from '@paperfold/steps';
import { stepText, strings } from '../strings.en.ts';

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
  /** The traditional base this state is, if any. */
  readonly base: BaseName | null;
  /** Other ways folded from the same state: which one this is, and the next one along. */
  readonly branch: { readonly index: number; readonly count: number; readonly next: NodeId } | null;
}

export interface View {
  readonly snapshot: Snapshot;
  /** The traditional base the current state is, if any. */
  readonly base: BaseName | null;
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
  /** Scroll, Tab and 1–4 so far: which alternative to show. */
  readonly index: number;
  /** How many layers the hover showed and the scroll picked (plain folds start there). */
  readonly layers?: number;
  /** Kinds that lead (a push on a folded edge leads with its reverse fold). */
  readonly lead?: readonly CandidateKind[];
  /** The kind the user picked last time for this kind of press (it leads when it's valid). */
  readonly preferred?: CandidateKind;
}

/** Hovering a corner: lift the layers you'd pick up a little, so you can see them. */
export interface PeekQuery {
  readonly corner: Vec2;
  /** Layers asked for; the answer may take more when fewer can't move on their own. */
  readonly layers: number;
}

export interface PeekResult {
  /** Layers the curl actually lifts. */
  readonly layers: number;
  /** The fewest layers that can move here on their own (the rest are joined to them). */
  readonly min: number;
  /** Layers under the corner. */
  readonly total: number;
  readonly preview: { readonly after: Snapshot; readonly transition: MotionTransition } | null;
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
    /** Where the pressed point ends up (table plane): how far along a squash the drag is. */
    readonly landing: Vec2 | null;
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
  readonly base: BaseName | null;
  readonly repeat: { readonly of: number; readonly behind: boolean } | null;
}

/** One step of follow-along: what to do, and its diagram. */
export interface FollowStep {
  readonly text: string;
  readonly svg: string;
}

export interface StepsView {
  readonly steps: readonly PlayerStep[];
  readonly verified: boolean;
  readonly brokenAt?: number;
  readonly difficulty: { readonly level: 1 | 2 | 3 | 4 | 5; readonly score: number };
}

/** Lines of the folded edges around the top `k` layers under p: where a flap could squash. */
function squashHinges(state: KernelState, p: Vec2, k: number): PlaneLine[] {
  const view = flatView(state);
  const st = stackAt(state, p);
  if (!view || !st.ok) return [];
  const adj = adjacency(state.cp);
  const out: PlaneLine[] = [];
  const tol = state.tol.len * 100;
  for (const f of st.faces.slice(0, k)) {
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      if (ef.left === null || ef.right === null || Math.abs(c.angleDeg) !== 180) continue;
      const a = view.vertexWorld.get(c.v[0])!;
      const b = view.vertexWorld.get(c.v[1])!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < tol) continue;
      const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const same = out.some((h) => Math.abs((a[0] - h.p[0]) * h.d[1] - (a[1] - h.p[1]) * h.d[0]) < tol && Math.abs(d[0] * h.d[1] - d[1] * h.d[0]) < 1e-6);
      if (!same) out.push({ p: a, d });
    }
  }
  return out;
}

/**
 * Where a pleat or crimp along the drag's line folds back: the nearest precrease past the line
 * on the side that moves (within 20° of it, wholly on that side, with the grab point beyond
 * it), as you'd fold one on paper; with none, a parallel line halfway to the grab point.
 */
function pleatLine(state: KernelState, line: PlaneLine, seed: Vec2): PlaneLine | null {
  let l;
  try {
    l = makeLine(line.p, line.d);
  } catch {
    return null;
  }
  let ds = signedDistance(l, seed);
  if (Math.abs(ds) < 6) return null;
  if (ds < 0) {
    l = { p: l.p, d: [-l.d[0], -l.d[1]] as Vec2 };
    ds = -ds;
  }
  const n: Vec2 = [-l.d[1], l.d[0]];
  const foot: Vec2 = [seed[0] - n[0] * ds, seed[1] - n[1] * ds];
  const view = flatView(state);
  if (!view) return null;
  const adj = adjacency(state.cp);
  let best: PlaneLine | null = null;
  let bestAt = Infinity;
  for (const c of state.cp.creases.values()) {
    if (c.angleDeg !== 0) continue;
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    const a = view.vertexWorld.get(c.v[0])!;
    const b = view.vertexWorld.get(c.v[1])!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 5) continue;
    const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (Math.abs(d[0] * l.d[1] - d[1] * l.d[0]) > Math.sin((20 * Math.PI) / 180)) continue;
    const da = signedDistance(l, a);
    const db = signedDistance(l, b);
    if (Math.min(da, db) < 2) continue;
    const pl = lineThrough(a, b);
    const s1 = signedDistance(pl, seed);
    const s0 = signedDistance(pl, foot);
    if (Math.abs(s1) < 2 || Math.sign(s1) === Math.sign(s0)) continue;
    const at = (da + db) / 2;
    if (at < bestAt) {
      bestAt = at;
      best = { p: a, d };
    }
  }
  return best ?? { p: [l.p[0] + (n[0] * ds) / 2, l.p[1] + (n[1] * ds) / 2], d: l.d };
}

/**
 * Where the top layer under p would lift as a petal (its hinge), worked out from the paper:
 * the layer's flat region must be held by two folded edges; the tip is its corner nearest p;
 * each kite line runs from the tip along a precrease if there is one, else halfway between the
 * raw edge and the middle line; the hinge joins where the kite lines meet the folded edges.
 */
function petalHinge(state: KernelState, p: Vec2): PlaneLine | null {
  const view = flatView(state);
  const st = stackAt(state, p);
  if (!view || !st.ok || st.faces.length < 2) return null;
  const adj = adjacency(state.cp);
  const top = st.faces[0]!;
  const region = new Set([top]);
  const q = [top];
  for (let i = 0; i < q.length; i++) {
    for (const e of faceEdges(state.cp, q[i]!)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === q[i] ? ef.right : ef.left;
      if (g === null || region.has(g) || c.angleDeg !== 0) continue;
      region.add(g);
      q.push(g);
    }
  }
  type Seg = readonly [Vec2, Vec2];
  const folded: Seg[] = [];
  const raw: Seg[] = [];
  const flat: Seg[] = [];
  for (const f of region) {
    for (const e of faceEdges(state.cp, f)) {
      const c = state.cp.creases.get(e)!;
      const ef = adj.edgeFaces.get(e)!;
      const g = ef.left === f ? ef.right : ef.left;
      const seg: Seg = [view.vertexWorld.get(c.v[0])!, view.vertexWorld.get(c.v[1])!];
      if (g === null) raw.push(seg);
      else if (!region.has(g) && Math.abs(c.angleDeg) === 180) folded.push(seg);
      else if (region.has(g) && c.angleDeg === 0) flat.push(seg);
    }
  }
  const tol = state.tol.len * 100;
  const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
  const unit = (v: Vec2): Vec2 => {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  };
  const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
  const onLine = (s: Seg, x: Vec2) => Math.abs(cross(unit(sub(s[1], s[0])), sub(x, s[0]))) < tol;
  // The two folded edge lines.
  const sides: Seg[] = [];
  for (const s of folded) if (!sides.some((t) => onLine(t, s[0]) && onLine(t, s[1]))) sides.push(s);
  if (sides.length !== 2) return null;
  const meet = (o: Vec2, d: Vec2, s: Seg): Vec2 | null => {
    const e = sub(s[1], s[0]);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) return null;
    const t = cross(sub(s[0], o), e) / den;
    return t > tol ? [o[0] + d[0] * t, o[1] + d[1] * t] : null;
  };
  // The tip: the region's corner nearest the press, not on a folded edge.
  const corners = raw.flatMap((s) => [s[0], s[1]]).filter((x) => !sides.some((s) => onLine(s, x)));
  if (corners.length === 0) return null;
  const A = corners.reduce((b, x) => (Math.hypot(x[0] - p[0], x[1] - p[1]) < Math.hypot(b[0] - p[0], b[1] - p[1]) ? x : b));
  // The middle line: from the tip toward where the folded edges meet.
  const e0 = unit(sub(sides[0]![1], sides[0]![0]));
  const O = meet(sides[0]![0], e0, sides[1]!) ?? meet(sides[0]![1], [-e0[0], -e0[1]], sides[1]!);
  if (!O) return null;
  const mid = unit(sub(O, A));
  const at = (A0: Vec2) => (x: Vec2) => Math.hypot(x[0] - A0[0], x[1] - A0[1]) < tol;
  const fromA = at(A);
  const X: Vec2[] = [];
  for (const side of sides) {
    // The raw edge from the tip to this side.
    const edge = raw.find((s) => (fromA(s[0]) && onLine(side, s[1])) || (fromA(s[1]) && onLine(side, s[0])));
    if (!edge) return null;
    const far = fromA(edge[0]) ? edge[1] : edge[0];
    const half = unit([unit(sub(far, A))[0] + mid[0], unit(sub(far, A))[1] + mid[1]]);
    // A precrease from the tip close to the halfway line wins.
    let kite = half;
    for (const s of flat) {
      const other = fromA(s[0]) ? s[1] : fromA(s[1]) ? s[0] : null;
      if (!other) continue;
      const d = unit(sub(other, A));
      if (d[0] * half[0] + d[1] * half[1] > Math.cos((12 * Math.PI) / 180)) kite = d;
    }
    const x = meet(A, kite, side);
    if (!x) return null;
    X.push(x);
  }
  const d = unit(sub(X[1]!, X[0]!));
  return { p: X[0]!, d };
}

/** Where a point of the top face under p goes in `after` (table plane). */
function landingOf(before: KernelState, after: KernelState, p: Vec2): Vec2 | null {
  const st = stackAt(before, p);
  if (!st.ok || st.faces.length === 0) return null;
  const m = applyPlaneIso(invertPlaneIso(planeIsoOf(before.folded.placements.get(st.faces[0]!)!)), p);
  for (const f of after.cp.faces.keys()) {
    if (!containsStrictly(materialPolygon(after.cp, f), m, after.tol)) continue;
    return applyPlaneIso(planeIsoOf(after.folded.placements.get(f)!), m);
  }
  return null;
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
  /** Squash candidates don't depend on the drag's line: once per press. */
  private squashCache: { key: string; results: Array<{ candidate: Candidate; ok: boolean; result: ReturnType<typeof applyMove> }> } | null = null;
  private peekCache: { key: string; result: PeekResult } | null = null;

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
    const key = JSON.stringify([q.line, q.seed, q.holds, q.layers ?? 1, this.history.current]);
    if (!this.exploreCache || this.exploreCache.key !== key) {
      const st = stackAt(state, q.seed);
      const layers = st.ok ? st.faces.length : 1;
      let cands = candidateMoves({ line: { p: q.line.p, d: q.line.d }, seed: q.seed, layersAtSeed: layers, holds: q.holds });
      const squashKey = JSON.stringify([q.seed, q.holds, this.history.current]);
      if (!this.squashCache || this.squashCache.key !== squashKey) {
        const hinges = q.lead ? [] : squashHinges(state, q.seed, Math.min(layers, 4));
        const squashes = candidateMoves({ line: { p: q.line.p, d: q.line.d }, seed: q.seed, layersAtSeed: Math.min(layers, 4), holds: q.holds, squashHinges: hinges })
          .filter((c) => c.kind === 'squash');
        // The petal's own hinge, from the paper (a drag rarely lands exactly on it).
        const ph = q.lead ? null : petalHinge(state, q.seed);
        if (ph) squashes.unshift({ kind: 'petal', layers: 1, move: { type: 'petal', params: { hinge: ph, seed: q.seed, layers: 1, holds: [...q.holds] } } });
        const results = squashes.map((candidate) => {
          const result = applyMove(state, candidate.move);
          return { candidate, ok: result.ok, result };
        });
        this.squashCache = { key: squashKey, results };
      }
      cands = cands.filter((c) => c.kind !== 'squash');
      // Keep the list short on deep stacks: top, all, a few k near the picked count, and the
      // reverse folds.
      const k = q.layers ?? 1;
      cands = cands.filter((c) => c.kind !== 'fold-layers' || c.layers <= 3 || Math.abs(c.layers - k) <= 1);
      const results = cands.map((candidate) => {
        const result = applyMove(state, candidate.move);
        return { candidate, ok: result.ok, result };
      });
      // A pleat along the drag (the second line from the paper's precreases), and a crimp
      // where the flap could be reverse folded on this line.
      const second = pleatLine(state, q.line, q.seed);
      if (second) {
        const reversible = results.some((r) => r.ok && (r.candidate.kind === 'inside-reverse' || r.candidate.kind === 'outside-reverse'));
        const extra = candidateMoves({ line: { p: q.line.p, d: q.line.d }, seed: q.seed, layersAtSeed: layers, holds: q.holds, secondLine: second }).filter(
          (c) => c.kind === 'pleat' || (reversible && (c.kind === 'inside-crimp' || c.kind === 'outside-crimp')),
        );
        for (const candidate of extra) {
          const result = applyMove(state, candidate.move);
          results.push({ candidate, ok: result.ok, result });
        }
      }
      // A flap squashes on one hinge only once, whatever the layer count that reached it; the
      // paper's own petal replaces one along the drag's line.
      const seen = new Set<string>();
      for (const r of this.squashCache.results) {
        if (!r.ok || !r.result.ok) continue;
        const h = r.candidate.kind + ':' + r.result.state.cp.faces.size + ':' + JSON.stringify((r.candidate.move as { params: { hinge: PlaneLine } }).params.hinge);
        if (seen.has(h)) continue;
        seen.add(h);
        if (r.candidate.kind === 'petal') {
          const i = results.findIndex((x) => x.candidate.kind === 'petal');
          if (i >= 0) results.splice(i, 1);
        }
        results.push(r);
      }
      this.exploreCache = { key, results };
    }
    const ordered = orderCandidates(this.exploreCache.results, {
      allLayers: q.allLayers,
      ...(q.layers !== undefined ? { layers: q.layers } : {}),
      ...(q.lead ? { lead: q.lead } : {}),
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
    if (tr.kind !== 'fold' && tr.kind !== 'reverse' && tr.kind !== 'squash' && tr.kind !== 'petal' && tr.kind !== 'pleat' && tr.kind !== 'crimp') {
      return { candidates, selected, preview: null, refusal: null };
    }
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
        landing: tr.kind === 'fold' || tr.kind === 'reverse' ? null : landingOf(state, pick.result.state, q.seed),
      },
      refusal: null,
    };
  }

  /**
   * Hovering a corner (Phase 1 polish, plan 1): a small fold of the corner by the layers you'd
   * pick up, validated like any move, for the skin to show a few degrees open. If that many
   * layers can't move on their own (they're joined), it takes as many as it must.
   */
  peek(q: PeekQuery): PeekResult {
    const state = currentState(this.history);
    const key = JSON.stringify([q.corner, q.layers, this.history.current]);
    if (this.peekCache?.key === key) return this.peekCache.result;
    const size = state.paper.outline.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1])), 0) * 2;
    // Into the paper from the corner: the mean direction of nearby points that are on it.
    let ux = 0;
    let uy = 0;
    const r = Math.max(0.5, size * 0.01);
    for (let i = 0; i < 24; i++) {
      const a = ((i + 0.5) / 24) * Math.PI * 2;
      const st = stackAt(state, [q.corner[0] + Math.cos(a) * r, q.corner[1] + Math.sin(a) * r]);
      if (st.ok && st.faces.length > 0) {
        ux += Math.cos(a);
        uy += Math.sin(a);
      }
    }
    const ul = Math.hypot(ux, uy);
    const none: PeekResult = { layers: q.layers, min: 1, total: 0, preview: null };
    if (ul < 1e-9) return none;
    const u: Vec2 = [ux / ul, uy / ul];
    const seed: Vec2 = [q.corner[0] + u[0] * r, q.corner[1] + u[1] * r];
    const st = stackAt(state, seed);
    const total = st.ok ? st.faces.length : 0;
    if (total === 0) return none;
    const dist = Math.min(16, size * 0.11);
    const line = { p: [q.corner[0] + u[0] * dist, q.corner[1] + u[1] * dist] as Vec2, d: [-u[1], u[0]] as Vec2 };
    // From k layers up: the first count that can move on its own (joined layers go together).
    const tryFrom = (from: number): { k: number; r: ReturnType<typeof applyMove> | null } => {
      let k = Math.max(1, Math.min(total, from));
      while (k <= total) {
        const r2 = applyMove(state, { type: 'fold', params: { line, seed, layers: k >= total ? 'all' : k, direction: 'valley' } });
        if (r2.ok) return { k, r: r2 };
        if (r2.reason !== 'joined') return { k, r: null };
        k = Math.max(k + 1, r2.suggestLayers ?? 0);
      }
      return { k: total, r: null };
    };
    const least = tryFrom(1);
    const pick = q.layers <= least.k ? least : tryFrom(q.layers);
    const tr = pick.r && pick.r.ok && pick.r.transition.kind === 'fold' ? pick.r : null;
    const result: PeekResult = {
      layers: Math.min(pick.k, total),
      min: Math.min(least.k, total),
      total,
      preview: tr && tr.ok && tr.transition.kind === 'fold' ? { after: snapshot(tr.state), transition: tr.transition } : null,
    };
    this.peekCache = { key, result };
    return result;
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
        base: s.base ?? null,
        repeat: s.repeat ?? null,
      })),
      verified: result.verified,
      difficulty: result.difficulty,
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
    };
  }

  exportFold(title: string): string {
    return JSON.stringify(toFold(currentState(this.history), title), null, 1);
  }

  private follow: { readonly targets: readonly KernelState[]; readonly initial: KernelState } | null = null;

  /**
   * Follow-along (Phase 2): the current design's steps become targets, and folding starts
   * again from its flat sheet. Each step comes with its sentence and its diagram.
   */
  followStart(handedness: HandSide): { readonly view: View; readonly steps: readonly FollowStep[] } {
    const log = designLog(this.history);
    const result = buildSteps(log, { handedness });
    const text = (s: Step) => stepText({ caption: s.caption, base: s.base ?? null, repeat: s.repeat ?? null });
    this.follow = { targets: result.steps.map((s) => s.after), initial: log.initial };
    this.history = createHistory(log.initial);
    this.exploreCache = null;
    return {
      view: this.view(),
      steps: result.steps.map((s, i) => ({ text: text(s), svg: stepsSvg([s], { title: '', text: () => '', firstNumber: i + 1 }) })),
    };
  }

  /** Which step the paper is at now: the furthest step it matches, if any. */
  followCheck(index: number): { readonly index: number; readonly matched: boolean } {
    if (!this.follow) return { index, matched: false };
    const s = currentState(this.history);
    const { targets, initial } = this.follow;
    // The step asked for first, then any other (folding ahead, or undoing back).
    if (targets[index] && matchesState(s, targets[index])) return { index: index + 1, matched: true };
    for (let j = targets.length - 1; j >= 0; j--) if (j !== index && matchesState(s, targets[j]!)) return { index: j + 1, matched: true };
    if (matchesState(s, initial)) return { index: 0, matched: true };
    return { index, matched: false };
  }

  followStop(): void {
    this.follow = null;
  }

  /** The build steps as files: a FOLD with a frame per step, and a diagram sheet (SVG). */
  exportSteps(title: string, handedness: HandSide): { readonly fold: string; readonly svg: string; readonly count: number } {
    const result = buildSteps(designLog(this.history), { handedness });
    const text = (s: Step) => stepText({ caption: s.caption, base: s.base ?? null, repeat: s.repeat ?? null });
    const fold = toFoldSteps(
      currentState(this.history),
      result.steps.map((s, i) => ({ state: s.after, title: `${i + 1}. ${text(s)}` })),
      title,
    );
    const svg = stepsSvg(result.steps, {
      title,
      text,
      subtitle: `${strings.stepsSummary(result.steps.length)} ${strings.difficulty(result.difficulty.level)}`,
    });
    return { fold: JSON.stringify(fold, null, 1), svg, count: result.steps.length };
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
      const siblings = parent ? parent.children : [];
      const i = siblings.indexOf(id);
      return {
        id,
        label: parent ? this.nameOf(parent.state, node.state) : ('start' as const),
        current: id === h.current,
        thumb: this.thumbOf(node.state),
        base: this.baseOf(node.state),
        branch: siblings.length > 1 ? { index: i, count: siblings.length, next: siblings[(i + 1) % siblings.length]! } : null,
      };
    });
    return { snapshot: snapshot(currentState(h)), base: this.baseOf(currentState(h)), timeline, canUndo: canUndo(h), canRedo: canRedo(h) };
  }

  private bases = new WeakMap<KernelState, BaseName | null>();
  private baseOf(s: KernelState): BaseName | null {
    if (!this.bases.has(s)) this.bases.set(s, recognizeBase(s));
    return this.bases.get(s)!;
  }
}
