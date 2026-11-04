import { lineThrough, signedDistance, type Line2 } from '../geometry/line.ts';
import { type Box, boxesOverlap, collinearOverlap, intersectConvex, isFat, segmentLengthInside } from '../geometry/polygon.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { adjacency } from '../paper/creasePattern.ts';
import type { FaceId } from '../paper/types.ts';
import { faceSideOfLine } from './derive.ts';
import { flatView, overlapPairsTouching } from './flat.ts';
import { type PairKey, pairKey, parsePairKey } from './order.ts';
import type { KernelState } from './types.ts';

/**
 * Layer order for a flat state whose geometry is known but where some pairs of overlapping
 * faces have no order yet (moves that turn several parts of the paper at once: squash,
 * petal). It finds an order that satisfies every flat-folding constraint the validator checks
 * (Akitaya, Demaine & Ku, "Computing Flat-Folded States"):
 *
 * - no three faces stacked in a loop where all three overlap;
 * - no face between the two faces of a folded crease it covers (taco–tortilla), and no face
 *   cutting through a flat crease (tortilla–tortilla);
 * - two folds on the same line either nest or stay apart (taco–taco), and so on for the
 *   other edge pairs.
 *
 * Every constraint is an equality, a "not all equal" over a loop of three, or an equality
 * of two products, over ±1 variables, so unit propagation does almost all the work. When
 * it stalls, it tries the move's preferred order for one pair (`hint`), then the other, and
 * backs up on a contradiction (depth-first, so the result is deterministic).
 *
 * Only pairs touching `changed` can be unknown; `known` holds every pair whose order carries
 * over from before the move.
 */
export interface SolveInput {
  /** The new geometry: faces and placements (its layer order is ignored). */
  readonly state: KernelState;
  /** Faces that are new or moved differently from something they overlap. */
  readonly changed: ReadonlySet<FaceId>;
  /** Orders that carry over (pair key -> +1 if the smaller id is above). */
  readonly known: ReadonlyMap<PairKey, 1 | -1>;
  /** Preferred order for a free pair: +1 if x should end above y. */
  readonly hint?: (x: FaceId, y: FaceId) => 1 | -1 | undefined;
  /** Give up after this many guesses (each followed by propagation). */
  readonly maxGuesses?: number;
}

export type SolveResult =
  | { readonly ok: true; readonly order: Map<PairKey, 1 | -1> }
  | { readonly ok: false; readonly faces: readonly FaceId[]; readonly detail: string };

/** A literal: variable index and the sign that turns it into "first face above second". */
interface Lit {
  readonly v: number;
  readonly s: 1 | -1;
}

type Constraint =
  /** a == b */
  | { readonly k: 'eq'; readonly a: Lit; readonly b: Lit; readonly faces: readonly FaceId[] }
  /** not (a == b == c) */
  | { readonly k: 'nae'; readonly a: Lit; readonly b: Lit; readonly c: Lit; readonly faces: readonly FaceId[] }
  /** a·b == c·d */
  | { readonly k: 'xeq'; readonly a: Lit; readonly b: Lit; readonly c: Lit; readonly d: Lit; readonly faces: readonly FaceId[] };

export function solveLayerOrder(input: SolveInput): SolveResult {
  const { state, changed, known } = input;
  const view = flatView(state);
  if (!view) return { ok: false, faces: [], detail: 'The new state is not flat' };
  const tol = state.tol;

  // Variables: every overlapping pair touching a changed face, plus the known pairs they
  // meet in constraints (added on demand).
  const index = new Map<PairKey, number>();
  const keys: PairKey[] = [];
  const value: Array<0 | 1 | -1> = [];
  const neighbors = new Map<FaceId, Set<FaceId>>();
  const link = (f: FaceId, g: FaceId) => {
    let s = neighbors.get(f);
    if (!s) neighbors.set(f, (s = new Set()));
    s.add(g);
  };
  const varOf = (k: PairKey): number => {
    let i = index.get(k);
    if (i === undefined) {
      i = keys.length;
      index.set(k, i);
      keys.push(k);
      value.push(known.get(k) ?? 0);
    }
    return i;
  };
  for (const [f, g] of overlapPairsTouching(state, changed)) {
    varOf(pairKey(f, g));
    link(f, g);
    link(g, f);
  }
  // Pairs among unchanged faces overlap iff they had an order.
  for (const k of known.keys()) {
    const [f, g] = parsePairKey(k);
    if (changed.has(f) || changed.has(g)) continue;
    if (!view.poly.has(f) || !view.poly.has(g)) continue;
    link(f, g);
    link(g, f);
  }
  const overlaps = (f: FaceId, g: FaceId) => neighbors.get(f)?.has(g) === true;
  /** "f above g" as a literal; undefined if they don't overlap. */
  const lit = (f: FaceId, g: FaceId): Lit | undefined => {
    if (f === g || !overlaps(f, g)) return undefined;
    return { v: varOf(pairKey(f, g)), s: f < g ? 1 : -1 };
  };
  const isFree = (l: Lit) => value[l.v] === 0;

  const constraints: Constraint[] = [];
  /** A constraint among orders that are all given, and broken: the move contradicts itself. */
  let broken: Constraint | null = null;
  const add = (c: Constraint) => {
    const lits = c.k === 'eq' ? [c.a, c.b] : c.k === 'nae' ? [c.a, c.b, c.c] : [c.a, c.b, c.c, c.d];
    if (lits.some(isFree)) {
      constraints.push(c);
      return;
    }
    const x = lits.map((l) => value[l.v]! * l.s);
    const ok = c.k === 'eq' ? x[0] === x[1] : c.k === 'nae' ? !(x[0] === x[1] && x[1] === x[2]) : x[0]! * x[1]! === x[2]! * x[3]!;
    if (!ok && !broken) broken = c;
  };

  // 1. Loops of three, among faces with a common region.
  const seenTriple = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    const [f, g] = parsePairKey(keys[i]!);
    if (!changed.has(f) && !changed.has(g)) continue;
    for (const h of neighbors.get(f) ?? []) {
      if (h === g || !overlaps(g, h)) continue;
      const t = [f, g, h].sort((a, b) => a - b);
      const tk = t.join(',');
      if (seenTriple.has(tk)) continue;
      seenTriple.add(tk);
      const common = intersectConvex(intersectConvex(view.poly.get(t[0]!)!, view.poly.get(t[1]!)!), view.poly.get(t[2]!)!);
      if (!isFat(common, tol)) continue;
      add({ k: 'nae', a: lit(t[0]!, t[1]!)!, b: lit(t[1]!, t[2]!)!, c: lit(t[2]!, t[0]!)!, faces: t });
    }
  }

  // 2. Creases against faces and against each other.
  interface Edge {
    readonly a: Vec2;
    readonly b: Vec2;
    readonly line: Line2;
    readonly left: FaceId;
    readonly right: FaceId;
    readonly taco: boolean;
    readonly box: Box;
  }
  const adj = adjacency(state.cp);
  const edges: Edge[] = [];
  for (const c of state.cp.creases.values()) {
    const ef = adj.edgeFaces.get(c.id)!;
    if (ef.left === null || ef.right === null) continue;
    const a = view.vertexWorld.get(c.v[0])!;
    const b = view.vertexWorld.get(c.v[1])!;
    const l = lineThrough(a, b);
    const taco = faceSideOfLine(view.poly.get(ef.left)!, l) === faceSideOfLine(view.poly.get(ef.right)!, l);
    const box = { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) };
    edges.push({ a, b, line: l, left: ef.left, right: ef.right, taco, box });
  }
  const hot = (...fs: FaceId[]) => fs.some((f) => changed.has(f));
  const sameSideEq = (x: FaceId, p: FaceId, q: FaceId, faces: readonly FaceId[]) => {
    // x is on the same side (above or below) of both p and q.
    const a = lit(x, p);
    const b = lit(x, q);
    if (a && b) add({ k: 'eq', a, b, faces });
  };
  for (const e of edges) {
    for (const f of view.faceIds) {
      if (f === e.left || f === e.right) continue;
      if (!hot(f, e.left, e.right)) continue;
      if (!boxesOverlap(e.box, view.box.get(f)!)) continue;
      if (segmentLengthInside(e.a, e.b, view.poly.get(f)!, tol) <= tol.len) continue;
      // Folded: f can't lie between the two faces. Flat: f can't cut through the sheet.
      sameSideEq(f, e.left, e.right, [f, e.left, e.right]);
    }
  }
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    for (let j = i + 1; j < edges.length; j++) {
      const k = edges[j]!;
      if (!hot(e.left, e.right, k.left, k.right)) continue;
      if (e.left === k.left || e.left === k.right || e.right === k.left || e.right === k.right) continue;
      if (Math.abs(signedDistance(e.line, k.a)) > tol.len || Math.abs(signedDistance(e.line, k.b)) > tol.len) continue;
      if (collinearOverlap(e.a, e.b, k.a, k.b, e.line.d) <= tol.len) continue;
      const sideOf = (f: FaceId) => faceSideOfLine(view.poly.get(f)!, e.line);
      const faces = [e.left, e.right, k.left, k.right];
      if (e.taco && k.taco) {
        if (sideOf(e.left) !== sideOf(k.left)) continue;
        // between(k.left) == between(k.right), with between(x) = s(x,e.l) != s(x,e.r):
        // s(kl,el)·s(kl,er) == s(kr,el)·s(kr,er).
        const a = lit(k.left, e.left);
        const b = lit(k.left, e.right);
        const c = lit(k.right, e.left);
        const d = lit(k.right, e.right);
        if (a && b && c && d) add({ k: 'xeq', a, b, c, d, faces });
      } else if (e.taco !== k.taco) {
        const taco = e.taco ? e : k;
        const tortilla = e.taco ? k : e;
        const s = sideOf(taco.left);
        const near = sideOf(tortilla.left) === s ? tortilla.left : tortilla.right;
        sameSideEq(near, taco.left, taco.right, faces);
      } else {
        const eL = sideOf(e.left);
        const kSame = sideOf(k.left) === eL ? k.left : k.right;
        const kOther = kSame === k.left ? k.right : k.left;
        const a = lit(e.left, kSame);
        const b = lit(e.right, kOther);
        if (a && b) add({ k: 'eq', a, b, faces });
      }
    }
  }

  if (broken) return { ok: false, faces: (broken as Constraint).faces, detail: 'The layers can’t be stacked that way' };

  // 3. Propagate, guess, back up.
  const watch: number[][] = keys.map(() => []);
  constraints.forEach((c, ci) => {
    const lits = c.k === 'eq' ? [c.a, c.b] : c.k === 'nae' ? [c.a, c.b, c.c] : [c.a, c.b, c.c, c.d];
    for (const l of lits) watch[l.v]!.push(ci);
  });
  const trail: number[] = [];
  const val = (l: Lit): 0 | 1 | -1 => {
    const x = value[l.v]!;
    return x === 0 ? 0 : ((x * l.s) as 1 | -1);
  };
  const set = (l: Lit, s: 1 | -1, queue: number[]): boolean => {
    const want = (s * l.s) as 1 | -1;
    const cur = value[l.v]!;
    if (cur !== 0) return cur === want;
    value[l.v] = want;
    trail.push(l.v);
    queue.push(l.v);
    return true;
  };
  let conflict: Constraint | null = null;
  const propagate = (queue: number[]): boolean => {
    while (queue.length > 0) {
      const v = queue.pop()!;
      for (const ci of watch[v]!) {
        const c = constraints[ci]!;
        let ok = true;
        if (c.k === 'eq') {
          const a = val(c.a);
          const b = val(c.b);
          if (a !== 0 && b !== 0) ok = a === b;
          else if (a !== 0) ok = set(c.b, a, queue);
          else if (b !== 0) ok = set(c.a, b, queue);
        } else if (c.k === 'nae') {
          const xs = [val(c.a), val(c.b), val(c.c)];
          const ls = [c.a, c.b, c.c];
          const unknown = xs.filter((x) => x === 0).length;
          if (unknown === 0) ok = !(xs[0] === xs[1] && xs[1] === xs[2]);
          else if (unknown === 1) {
            const i = xs.indexOf(0);
            const others = xs.filter((_, j) => j !== i);
            if (others[0] === others[1]) ok = set(ls[i]!, (-others[0]!) as 1 | -1, queue);
          }
        } else {
          const xs = [val(c.a), val(c.b), val(c.c), val(c.d)];
          const ls = [c.a, c.b, c.c, c.d];
          const unknown = xs.filter((x) => x === 0).length;
          if (unknown === 0) ok = xs[0]! * xs[1]! === xs[2]! * xs[3]!;
          else if (unknown === 1) {
            const i = xs.indexOf(0);
            // The product of all four is +1.
            const prod = xs.reduce<number>((p, x, j) => (j === i ? p : p * x), 1);
            ok = set(ls[i]!, (prod > 0 ? 1 : -1) as 1 | -1, queue);
          }
        }
        if (!ok) {
          conflict = c;
          return false;
        }
      }
    }
    return true;
  };
  const undoTo = (mark: number) => {
    while (trail.length > mark) value[trail.pop()!] = 0;
  };

  // Everything known first: a contradiction here means the move itself is impossible.
  const initial: number[] = [];
  for (let v = 0; v < keys.length; v++) if (value[v] !== 0) initial.push(v);
  if (!propagate(initial)) {
    const c = conflict as Constraint | null;
    return { ok: false, faces: c?.faces ?? [], detail: 'The layers can’t be stacked that way' };
  }

  const hint = input.hint;
  const prefer = (v: number): 1 | -1 => {
    const [f, g] = parsePairKey(keys[v]!);
    const h = hint?.(f, g);
    return h ?? 1;
  };
  const maxGuesses = input.maxGuesses ?? 20000;
  let guesses = 0;
  // Depth-first search; frames remember the trail mark and whether the second value was tried.
  const frames: Array<{ v: number; mark: number; second: boolean }> = [];
  let next = 0;
  for (;;) {
    while (next < keys.length && value[next] !== 0) next++;
    if (next >= keys.length) break;
    if (++guesses > maxGuesses) return { ok: false, faces: [], detail: 'Too many ways to stack the layers to decide' };
    const v = next;
    const mark = trail.length;
    frames.push({ v, mark, second: false });
    let ok = set({ v, s: 1 }, prefer(v), []) && propagate([v]);
    while (!ok) {
      // Back up to the last guess that still has its other value to try.
      let frame = frames.pop();
      while (frame && frame.second) frame = frames.pop();
      if (!frame) {
        const c = conflict as Constraint | null;
        return { ok: false, faces: c?.faces ?? [], detail: 'The layers can’t be stacked that way' };
      }
      undoTo(frame.mark);
      frames.push({ ...frame, second: true });
      ok = set({ v: frame.v, s: 1 }, (-prefer(frame.v)) as 1 | -1, []) && propagate([frame.v]);
      next = 0;
    }
  }

  const order = new Map<PairKey, 1 | -1>(known);
  for (let v = 0; v < keys.length; v++) {
    const [f, g] = parsePairKey(keys[v]!);
    if (!overlaps(f, g)) continue;
    order.set(keys[v]!, value[v] as 1 | -1);
  }
  // Known pairs that no longer overlap are dropped.
  for (const k of [...order.keys()]) {
    const [f, g] = parsePairKey(k);
    if (!overlaps(f, g)) order.delete(k);
  }
  return { ok: true, order };
}
