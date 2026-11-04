import {
  applyMove,
  applyPlaneIso,
  containsStrictly,
  cross2,
  flatView,
  type FaceId,
  type History,
  invertPlaneIso,
  type KernelState,
  type Line2,
  line as makeLine,
  materialPolygon,
  type Move,
  NAME_CONFIDENCE,
  type Op,
  pathTo,
  planeIsoOf,
  recognize,
  recognizeBase,
  intersectConvex,
  signedArea,
  lineThrough,
  reflectPoint,
  sameFoldedState,
  signedDistance,
  type Transition,
  type Vec2,
} from '@paperfold/kernel';
import { directionOf, footprintHull, footprintHullOf, placeOf } from './describe.ts';
import type { Caption, DiagramSymbol, Difficulty, HandPlan, HandSide, Step, StepKind, StepsResult } from './types.ts';

/** The designer's current branch: ops in order and the state after each. */
export interface DesignLog {
  readonly initial: KernelState;
  readonly ops: readonly Op[];
  /** states[0] is the flat sheet; states[i + 1] follows ops[i]. */
  readonly states: readonly KernelState[];
}

export function designLog(h: History): DesignLog {
  const path = pathTo(h);
  return {
    initial: path[0]!.state,
    ops: path.slice(1).map((n) => n.op!),
    states: path.map((n) => n.state),
  };
}

export interface StepOptions {
  /** The folding hand; the other one holds. */
  readonly handedness?: HandSide;
  /** Merge and drop ops (default). False gives one step per op. */
  readonly cleanup?: boolean;
}

interface Group {
  kind: StepKind;
  ops: number[];
  creased: boolean;
}

const NO_HANDS: HandPlan = { folding: null, holding: null, crease: null, liftModel: false };

function lineOf(move: Move): Line2 | null {
  if (move.type === 'fold' || move.type === 'reverseFold' || move.type === 'burnish') {
    try {
      return makeLine(move.params.line.p, move.params.line.d);
    } catch {
      return null;
    }
  }
  return null;
}

function sameLine(a: Line2 | null, b: Line2 | null): boolean {
  if (!a || !b) return false;
  return Math.abs(cross2(a.d, b.d)) < 1e-6 && Math.abs(signedDistance(a, b.p)) < 1e-3;
}

/**
 * Clean up the op log into steps (brief, section 7, "Pipeline", steps 1–2): merge creasing
 * into the fold it creases, a fold followed by its unfold into one "precrease" step, and
 * drop back-to-back turn-overs that cancel. Everything keeps the designer's order.
 */
function group(log: DesignLog, cleanup: boolean): Group[] {
  const out: Group[] = [];
  const { ops, states } = log;
  for (let i = 0; i < ops.length; ) {
    const op = ops[i]!;
    const move = op.move;
    if (!cleanup) {
      out.push({ kind: kindOf(log, i), ops: [i], creased: move.type === 'burnish' });
      i++;
      continue;
    }
    if (move.type === 'turnOver') {
      const next = ops[i + 1]?.move;
      if (next && next.type === 'turnOver' && next.params.axis === move.params.axis) {
        i += 2;
        continue;
      }
      out.push({ kind: 'turn-over', ops: [i], creased: false });
      i++;
      continue;
    }
    if (move.type === 'rotate') {
      out.push({ kind: 'rotate', ops: [i], creased: false });
      i++;
      continue;
    }
    if (move.type === 'burnish') {
      const prev = out[out.length - 1];
      const prevLine = prev ? lineOf(ops[prev.ops[0]!]!.move) : null;
      if (prev && prev.ops[prev.ops.length - 1] === i - 1 && sameLine(prevLine, lineOf(move))) {
        prev.ops.push(i);
        prev.creased = true;
      } else {
        out.push({ kind: 'crease', ops: [i], creased: true });
      }
      i++;
      continue;
    }
    // fold or reverse fold, plus any creasing right after it
    const g: Group = { kind: kindOf(log, i), ops: [i], creased: false };
    const line = lineOf(move);
    let j = i + 1;
    while (j < ops.length && ops[j]!.move.type === 'burnish' && sameLine(line, lineOf(ops[j]!.move))) {
      g.ops.push(j);
      g.creased = true;
      j++;
    }
    // Fold, then unfold along the same line: a precrease.
    const next = ops[j];
    if (g.kind === 'fold' && next && next.move.type === 'fold' && sameLine(line, lineOf(next.move))) {
      if (recognize(states[j]!, states[j + 1]!).name === 'unfold') {
        g.kind = 'precrease';
        g.ops.push(j);
        j++;
      }
    }
    out.push(g);
    i = j;
  }
  return out;
}

function kindOf(log: DesignLog, i: number): StepKind {
  const move = log.ops[i]!.move;
  switch (move.type) {
    case 'reverseFold':
      return 'reverse';
    case 'squash':
      return 'squash';
    case 'petal':
      return 'petal';
    case 'pleat':
      return 'pleat';
    case 'crimp':
      return 'crimp';
    case 'rabbitEar':
      return 'rabbit-ear';
    case 'burnish':
      return 'crease';
    case 'turnOver':
      return 'turn-over';
    case 'rotate':
      return 'rotate';
    case 'fold':
      return recognize(log.states[i]!, log.states[i + 1]!).name === 'unfold' ? 'unfold' : 'fold';
  }
}

/** Outlines (table plane, before the move) of the faces a fold or reverse fold moves. */
function movingOutlines(after: KernelState, tr: Transition): Array<{ face: FaceId; poly: Vec2[] }> {
  if (tr.kind !== 'fold' && tr.kind !== 'reverse' && tr.kind !== 'squash' && tr.kind !== 'petal' && tr.kind !== 'crimp' && tr.kind !== 'pleat' && tr.kind !== 'rabbitEar') return [];
  return tr.moving.map((f) => {
    const iso = planeIsoOf(tr.startPlacements.get(f)!);
    return { face: f, poly: materialPolygon(after.cp, f).map((p) => applyPlaneIso(iso, p)) };
  });
}

/** Where a line runs through a set of polygons: the extent of the union, as a segment. */
function extentAlong(l: Line2, polys: readonly Vec2[][]): [Vec2, Vec2] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const da = signedDistance(l, a);
      const db = signedDistance(l, b);
      const hit = (p: Vec2) => {
        const t = (p[0] - l.p[0]) * l.d[0] + (p[1] - l.p[1]) * l.d[1];
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      };
      if (Math.abs(da) < 1e-6) hit(a);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
        const t = da / (da - db);
        hit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  if (!(hi > lo)) return null;
  return [
    [l.p[0] + l.d[0] * lo, l.p[1] + l.d[1] * lo],
    [l.p[0] + l.d[0] * hi, l.p[1] + l.d[1] * hi],
  ];
}

/** On the paper, on the side of the line that stays put (moving pieces are all on its left). */
function onStationaryPaper(before: KernelState, p: Vec2, l: Line2): boolean {
  const view = flatView(before);
  if (!view || signedDistance(l, p) >= -0.5) return false;
  return view.faceIds.some((f) => containsStrictly(view.poly.get(f)!, p, before.tol));
}

/**
 * Turn the designer's op log into build steps: clean up, name, caption, symbols and hand
 * choreography, then replay the steps from a flat sheet and check they reproduce the design.
 * If the cleaned-up sequence doesn't, fall back to one step per op and flag where it broke
 * (brief, section 7, "Verify before showing").
 */
export function buildSteps(log: DesignLog, options: StepOptions = {}): StepsResult {
  const cleanup = options.cleanup ?? true;
  const made = group(log, cleanup).map((g, index) => makeStep(log, g, index, options.handedness ?? 'right'));
  const steps = markRepeats(markBases(made));
  const difficulty = difficultyOf(steps);
  const design = log.states[log.states.length - 1]!;
  const check = verifySteps(log.initial, steps, design);
  if (check.ok) return { steps, verified: true, difficulty };
  if (!cleanup) return { steps, verified: false, brokenAt: check.brokenAt, difficulty };
  const raw = buildSteps(log, { ...options, cleanup: false });
  return { steps: raw.steps, verified: raw.verified, brokenAt: check.brokenAt, difficulty: raw.difficulty };
}

/** The step where the model becomes a traditional base says so. */
function markBases(steps: readonly Step[]): Step[] {
  return steps.map((s) => {
    const base = recognizeBase(s.after);
    return base && base !== recognizeBase(s.before) ? { ...s, base } : s;
  });
}

const sameLine2 = (a: Line2, b: Line2, tol = 1e-3) =>
  Math.abs(a.d[0] * b.d[1] - a.d[1] * b.d[0]) < tol && Math.abs((b.p[0] - a.p[0]) * a.d[1] - (b.p[1] - a.p[1]) * a.d[0]) < tol * 100;
const mirrorLine = (l: Line2, axis: Line2): Line2 => {
  const p = reflectPoint(axis, l.p);
  const q = reflectPoint(axis, [l.p[0] + l.d[0], l.p[1] + l.d[1]]);
  return { p, d: [q[0] - p[0], q[1] - p[1]] };
};

/**
 * Repeats (brief, section 7, "Repeat compression"): a step that does what an earlier one did,
 * on the back (the same fold after a turn-over) or on the other side (mirrored across the
 * model's middle), is marked as a repeat of it, so the diagrams say "Repeat on the back".
 */
function markRepeats(steps: readonly Step[]): Step[] {
  const out = [...steps];
  const comparable = (s: Step) => s.kind !== 'turn-over' && s.kind !== 'rotate' && s.line !== null;
  for (let j = 1; j < out.length; j++) {
    const b = out[j]!;
    if (!comparable(b)) continue;
    // The model's mirror lines through its middle, before the first of the two folds.
    const axesOf = (st: Step): Line2[] => {
      const hull = footprintHull(st.before);
      const c = hull.reduce((m, p) => [m[0] + p[0] / hull.length, m[1] + p[1] / hull.length] as Vec2, [0, 0] as Vec2);
      const size = Math.max(...hull.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), 1);
      const symmetric = (ax: Line2) =>
        hull.every((p) => {
          const q = reflectPoint(ax, p);
          return hull.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-3 * size);
        });
      return ([[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]] as Vec2[])
        .map((d): Line2 => ({ p: c, d }))
        .filter(symmetric);
    };
    // Nearest earlier step first, back to the last turn-over but one.
    let turns = 0;
    for (let i = j - 1; i >= 0 && turns <= 1; i--) {
      const a = out[i]!;
      if (a.kind === 'turn-over') {
        turns++;
        continue;
      }
      if (a.kind === 'rotate') break;
      if (!comparable(a) || a.kind !== b.kind || a.name !== b.name) continue;
      if (turns === 1) {
        // On the back: the same fold, seen through the turn-over.
        const turn = out.slice(i + 1, j).find((x) => x.kind === 'turn-over')!.transition;
        if (turn && turn.kind === 'turnOver' && sameLine2(mirrorLine(a.line!, turn.axis), b.line!)) {
          out[j] = { ...b, repeat: { of: i, behind: true } };
          break;
        }
      } else if (axesOf(a).some((ax) => sameLine2(mirrorLine(a.line!, ax), b.line!) && sameRegion(movedPoints(a).map((p) => reflectPoint(ax, p)), movedPoints(b)))) {
        // On the other side: the model is symmetric across a middle line, and so are the folds.
        out[j] = { ...b, repeat: { of: i, behind: false } };
        break;
      }
    }
  }
  return out;
}

/** Corners of the paper a step moves (table plane, before it moves). */
function movedPoints(s: Step): Vec2[] {
  const tr = s.transition;
  if (!tr || !('moving' in tr) || !('startPlacements' in tr)) return [];
  return tr.moving.flatMap((f) => {
    const start = tr.startPlacements.get(f);
    if (!start || !s.after.cp.faces.has(f)) return [];
    const iso = planeIsoOf(start);
    return materialPolygon(s.after.cp, f).map((p) => applyPlaneIso(iso, p));
  });
}

/** About the same region: their outlines overlap by at least 80% of the larger one. */
function sameRegion(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ha = footprintHullOf(a);
  const hb = footprintHullOf(b);
  const area = (poly: readonly Vec2[]) => Math.abs(signedArea(poly));
  const common = area(intersectConvex(ha, hb));
  return common >= 0.8 * Math.max(area(ha), area(hb));
}

const WEIGHT: Record<StepKind, number> = {
  fold: 1,
  precrease: 1.5,
  unfold: 0.5,
  crease: 0.3,
  'turn-over': 0.2,
  rotate: 0.2,
  reverse: 3,
  squash: 3,
  petal: 4,
  pleat: 2,
  crimp: 4,
  'rabbit-ear': 3,
};

/** Weighted moves, plus deep stacks (hard to fold neatly): 1 very easy … 5 complex. */
function difficultyOf(steps: readonly Step[]): Difficulty {
  let score = steps.reduce((sum, s) => sum + (s.repeat ? 0.6 : 1) * WEIGHT[s.kind], 0);
  const last = steps[steps.length - 1]?.after;
  if (last) {
    let deepest = 0;
    for (const f of last.cp.faces.keys()) {
      let above = 0;
      for (const [k] of last.folded.layerOrder) {
        const lo = k % 2097152;
        const hi = (k - lo) / 2097152;
        if (lo === f || hi === f) above++;
      }
      deepest = Math.max(deepest, above);
    }
    if (deepest > 16) score += 6;
    else if (deepest > 8) score += 3;
  }
  const level = score < 10 ? 1 : score < 25 ? 2 : score < 40 ? 3 : score < 70 ? 4 : 5;
  return { level, score: Math.round(score * 10) / 10 };
}

export function verifySteps(
  initial: KernelState,
  steps: readonly Step[],
  design: KernelState,
): { ok: true } | { ok: false; brokenAt: number; why: string } {
  let s = initial;
  for (const step of steps) {
    for (const m of step.moves) {
      const r = applyMove(s, m);
      if (!r.ok) return { ok: false, brokenAt: step.index, why: r.reason };
      s = r.state;
    }
  }
  const same = sameFoldedState(s, design, { upToRigidMotion: true });
  return same.same ? { ok: true } : { ok: false, brokenAt: Math.max(0, steps.length - 1), why: same.why };
}

function makeStep(log: DesignLog, g: Group, index: number, handedness: HandSide): Step {
  const first = g.ops[0]!;
  const last = g.ops[g.ops.length - 1]!;
  const before = log.states[first]!;
  const after = log.states[last + 1]!;
  const op = log.ops[first]!;
  const move = op.move;
  const applied = applyMove(before, move);
  const transition = applied.ok ? applied.transition : null;
  const recognized = recognize(before, log.states[first + 1]!);
  const otherHand: HandSide = handedness === 'right' ? 'left' : 'right';
  const base = {
    index,
    kind: g.kind,
    name: recognized.name,
    named: recognized.confidence >= NAME_CONFIDENCE,
    moves: g.ops.map((i) => log.ops[i]!.move),
    opIds: g.ops.map((i) => log.ops[i]!.id),
    before,
    after,
    transition,
    creased: g.creased,
  };

  if (move.type === 'turnOver') {
    return { ...base, line: null, caption: { kind: 'turn-over', axis: move.params.axis }, symbols: [{ kind: 'turn-over', axis: move.params.axis }], hands: NO_HANDS };
  }
  if (move.type === 'rotate') {
    return { ...base, line: null, caption: { kind: 'rotate', degrees: move.params.degrees }, symbols: [{ kind: 'rotate', degrees: move.params.degrees }], hands: NO_HANDS };
  }
  const hull = footprintHull(before);
  const line = lineOf(move);
  if (transition && (transition.kind === 'squash' || transition.kind === 'petal')) {
    const outlines = movingOutlines(log.states[first + 1]!, transition);
    const polys = outlines.map((o) => o.poly);
    const hinge = transition.hinge;
    const hingeSeg = extentAlong(hinge, [hull]);
    const symbols: DiagramSymbol[] = [];
    if (hingeSeg) symbols.push({ kind: 'valley-line', a: hingeSeg[0], b: hingeSeg[1] });
    if (transition.kind === 'squash') {
      // Open the flap and press its folded edge down onto the hinge.
      const bis = extentAlong(transition.bisector, polys);
      if (bis) symbols.push({ kind: 'valley-line', a: bis[0], b: bis[1] });
      const spine = extentAlong(transition.spine, polys);
      const tip = spine ? (Math.hypot(spine[0][0] - transition.spine.p[0], spine[0][1] - transition.spine.p[1]) > Math.hypot(spine[1][0] - transition.spine.p[0], spine[1][1] - transition.spine.p[1]) ? spine[0] : spine[1]) : transition.spine.p;
      const dir: Vec2 = [transition.hinge.d[0] - transition.spine.d[0], transition.hinge.d[1] - transition.spine.d[1]];
      const dl = Math.hypot(dir[0], dir[1]) || 1;
      symbols.push({ kind: 'push-arrow', at: tip, dir: [dir[0] / dl, dir[1] / dl] });
      return { ...base, line: hinge, caption: { kind: 'squash' }, symbols, hands: NO_HANDS };
    }
    // Lift the tip on the hinge; the sides fold in along the kite lines.
    const kites = [transition.x, transition.y].map((p) => extentAlong(lineThrough(transition.apex, p), polys)).filter((x): x is [Vec2, Vec2] => x !== null);
    for (const k of kites) symbols.push({ kind: 'valley-line', a: k[0], b: k[1] });
    symbols.push({ kind: 'valley-arrow', from: transition.apex, to: reflectPoint(transition.hinge, transition.apex) });
    return { ...base, line: hinge, caption: { kind: 'petal', tip: { ...placeOf(before, transition.apex, hull), what: 'tip' } }, symbols, hands: NO_HANDS };
  }
  if (transition && transition.kind === 'rabbitEar') {
    // Valley lines on the two base bisectors and the ear's foot, a mountain on the tip's
    // bisector; an arrow takes the tip over to where the ear lies.
    const { tip, sideA, sideB, center, foot } = transition;
    const symbols: DiagramSymbol[] = [
      { kind: 'valley-line', a: sideA, b: center },
      { kind: 'valley-line', a: sideB, b: center },
      { kind: 'valley-line', a: center, b: foot },
      { kind: 'mountain-line', a: tip, b: center },
      { kind: 'valley-arrow', from: tip, to: reflectPoint(lineThrough(sideA, center), tip) },
    ];
    return { ...base, line: lineThrough(sideA, center), caption: { kind: 'rabbit-ear', tip: { ...placeOf(before, tip, hull), what: 'corner' } }, symbols, hands: NO_HANDS };
  }
  if (transition && (transition.kind === 'pleat' || transition.kind === 'crimp')) {
    // Valley on the first line, mountain on the second, and an arrow taking the far part over.
    const firstLine = transition.first;
    const secondLine = transition.second;
    const symbols: DiagramSymbol[] = [];
    const where = transition.kind === 'crimp' ? movingOutlines(log.states[first + 1]!, transition).map((o) => o.poly) : [hull];
    const a = firstLine ? extentAlong(firstLine, where) : null;
    const b = secondLine ? extentAlong(secondLine, where) : null;
    if (a) symbols.push({ kind: 'valley-line', a: a[0], b: a[1] });
    if (b) symbols.push({ kind: 'mountain-line', a: b[0], b: b[1] });
    if (b) {
      const mid: Vec2 = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
      const seed = 'seed' in move.params ? (move.params.seed as Vec2) : mid;
      const from: Vec2 = [mid[0] + (seed[0] - mid[0]) * 0.5, mid[1] + (seed[1] - mid[1]) * 0.5];
      symbols.push({ kind: 'valley-arrow', from, to: reflectPoint(firstLine, from) });
    }
    const caption: Caption =
      transition.kind === 'pleat' ? (recognized.name === 'swivel' ? { kind: 'pleat', swivel: true } : { kind: 'pleat' }) : { kind: 'crimp', reverse: transition.reverse ?? 'inside' };
    return { ...base, line: firstLine, caption, symbols, hands: NO_HANDS };
  }
  if (move.type === 'burnish' || !transition || (transition.kind !== 'fold' && transition.kind !== 'reverse') || !line) {
    // A standalone crease: run a fingernail along the fold where it lies on the model.
    const seg = line ? extentAlong(line, [hull]) : null;
    return {
      ...base,
      line,
      caption: { kind: 'crease' },
      symbols: seg ? [{ kind: 'valley-line', a: seg[0], b: seg[1] }] : [],
      hands: { ...NO_HANDS, crease: seg ? { a: seg[0], b: seg[1] } : null },
    };
  }

  const tl = transition.line;
  const outlines = movingOutlines(log.states[first + 1]!, transition);
  const seg = extentAlong(tl, outlines.map((o) => o.poly)) ?? [tl.p, tl.p];
  const crease = g.creased || g.kind === 'precrease' ? { a: seg[0], b: seg[1] } : null;

  // Where the folding hand takes the paper: the recorded grab, snapped to a corner of the
  // moving flap when one is close.
  const seed: Vec2 = op.grab ? [op.grab.world[0], -op.grab.world[2]] : 'seed' in move.params ? move.params.seed : seg[0];
  let grab = seed;
  let best = 15;
  for (const o of outlines) {
    for (const q of o.poly) {
      const d = Math.hypot(q[0] - seed[0], q[1] - seed[1]);
      if (d < best) {
        best = d;
        grab = q;
      }
    }
  }
  const grabFace = outlines.find((o) => containsStrictly(o.poly, grab, before.tol))?.face ??
    outlines.reduce((acc, o) => (o.poly.some((q) => q[0] === grab[0] && q[1] === grab[1]) ? o.face : acc), outlines[0]?.face ?? -1);
  const grabIso = planeIsoOf(transition.startPlacements.get(grabFace) ?? before.folded.placements.values().next().value!);
  const grabMaterial = applyPlaneIso(invertPlaneIso(grabIso), grab);
  const landing = reflectPoint(tl, grab);

  // The holding hand: on the part that stays, near the fold, out of the flap's path.
  const landed = outlines.map((o) => o.poly.map((q) => reflectPoint(tl, q)));
  const inward: Vec2 = [tl.d[1], -tl.d[0]]; // away from the moving (left) side
  let hold: Vec2 | null = op.holds[0] ? [op.holds[0].world[0], -op.holds[0].world[2]] : null;
  if (!hold) {
    search: for (const frac of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const m: Vec2 = [seg[0][0] + (seg[1][0] - seg[0][0]) * frac, seg[0][1] + (seg[1][1] - seg[0][1]) * frac];
      for (const dist of [18, 28, 10, 40]) {
        const p: Vec2 = [m[0] + inward[0] * dist, m[1] + inward[1] * dist];
        if (!onStationaryPaper(before, p, tl)) continue;
        if (landed.some((poly) => containsStrictly(poly, p, before.tol))) continue;
        hold = p;
        break search;
      }
    }
  }

  if (transition.kind === 'reverse') {
    const P = transition.spine.p;
    const body = transition.spine.d;
    // Push on the tip's spine, a little past P, toward the inside of the flap.
    const k = Math.min(12, Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) / 2 + 4);
    const pushAt: Vec2 = [P[0] - body[0] * k, P[1] - body[1] * k];
    let n: Vec2 = [-body[1], body[0]];
    const probe: Vec2 = [P[0] + body[0] * 4 + n[0] * 3, P[1] + body[1] * 4 + n[1] * 3];
    if (!onStationaryPaper(before, probe, tl)) n = [-n[0], -n[1]];
    const tip = outlines.length > 0 ? centroidOf(outlines.flatMap((o) => o.poly)) : pushAt;
    const caption: Caption = { kind: 'reverse', reverse: transition.reverse, tip: { ...placeOf(before, tip, hull), what: 'tip' } };
    const symbols: DiagramSymbol[] =
      transition.reverse === 'inside'
        ? [
            { kind: 'mountain-line', a: seg[0], b: seg[1] },
            { kind: 'push-arrow', at: [pushAt[0] - n[0] * 10, pushAt[1] - n[1] * 10], dir: n },
          ]
        : [
            { kind: 'valley-line', a: seg[0], b: seg[1] },
            { kind: 'valley-arrow', from: tip, to: reflectPoint(tl, tip) },
          ];
    const holdAt: Vec2 = [P[0] + body[0] * 22 + n[0] * 4, P[1] + body[1] * 22 + n[1] * 4];
    return {
      ...base,
      line: tl,
      caption,
      symbols,
      hands: {
        folding: { hand: handedness, pose: 'push', at: pushAt, face: grabFace, material: grabMaterial },
        holding: onStationaryPaper(before, holdAt, tl) ? { hand: otherHand, pose: 'hold', at: holdAt } : hold ? { hand: otherHand, pose: 'hold', at: hold } : null,
        crease,
        liftModel: false,
      },
    };
  }

  const mountain = transition.direction === -1;
  const from = placeOf(before, grab, hull);
  const view = flatView(before);
  const nearLandmark = view && [...view.vertexWorld.values()].some((q) => Math.hypot(q[0] - landing[0], q[1] - landing[1]) <= 1.5);
  const to = nearLandmark ? placeOf(before, landing, hull) : null;
  const dir = directionOf(grab, landing);
  let caption: Caption;
  if (g.kind === 'precrease') caption = { kind: 'precrease', from, dir, to };
  else if (g.kind === 'unfold') caption = { kind: 'unfold', from };
  else {
    const stop = move.type === 'fold' && move.params.angleDeg !== undefined && move.params.angleDeg < 180 ? move.params.angleDeg : undefined;
    caption = { kind: 'fold', from, dir, to, mountain, ...(stop !== undefined ? { stopDeg: stop } : {}) };
  }
  const symbols: DiagramSymbol[] = [
    { kind: mountain ? 'mountain-line' : 'valley-line', a: seg[0], b: seg[1] },
    { kind: g.kind === 'precrease' ? 'fold-unfold-arrow' : mountain ? 'mountain-arrow' : 'valley-arrow', from: grab, to: landing },
  ];
  return {
    ...base,
    line: tl,
    caption,
    symbols,
    hands: {
      folding: { hand: handedness, pose: 'pinch', at: grab, face: grabFace, material: grabMaterial },
      holding: hold ? { hand: otherHand, pose: 'hold', at: hold } : null,
      crease,
      liftModel: mountain,
    },
  };
}

function centroidOf(pts: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}
