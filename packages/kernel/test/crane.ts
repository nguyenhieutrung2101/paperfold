import { applyMove, flatView, type KernelState, type Move, reflectPoint, lineThrough, type Vec2 } from '../src/index.ts';

/**
 * The traditional crane, folded from a 150 mm square (the Phase 2 gate). Each step is a
 * function of the state it starts from, so steps that depend on where earlier folds put the
 * paper (the neck's tip) can find it. Coordinates are exact: tan(π/8) everywhere a kite or
 * petal line needs it.
 */
export interface CraneStep {
  readonly label: string;
  readonly move: (s: KernelState) => Move;
}

const T8 = Math.tan(Math.PI / 8);
/** Distance from the closed corner to the petal hinge along each edge of the preliminary base. */
const K = 75 - 75 * T8;

const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers, direction: 'valley' },
});
const unit = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const bisect = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(a[0] + b[0], a[1] + b[1]);
  return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
};
const rot = (d: Vec2, a: number): Vec2 => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
const along = (p: Vec2, d: Vec2, t: number): Vec2 => [p[0] + d[0] * t, p[1] + d[1] * t];
const turn: Move = { type: 'turnOver', params: { axis: 'side' } };

/** A fold and the fold that undoes it (the same line, the moved layers turned back). */
function precrease(label: string, p: Vec2, q: Vec2, seed: Vec2, layers: number): CraneStep[] {
  const d = unit(p, q);
  const back = reflectPoint(lineThrough(p, q), seed);
  return [
    { label, move: () => fold(p, d, seed, layers) },
    { label: `${label}, unfold`, move: () => fold(p, d, back, layers) },
  ];
}

/** The farthest point of the model in a direction (to find tips). */
export function extreme(s: KernelState, d: Vec2): Vec2 {
  const v = flatView(s)!;
  let best: Vec2 = [0, 0];
  let bv = -Infinity;
  for (const f of v.faceIds) {
    for (const p of v.poly.get(f)!) {
      const x = p[0] * d[0] + p[1] * d[1];
      if (x > bv) {
        bv = x;
        best = p;
      }
    }
  }
  return best;
}

// The bird base, after two turns: legs at B2, petal tips at W, middle M.
const B: Vec2 = [-75 * T8, 75];
const S1: Vec2 = [0, 0];
const S2: Vec2 = [K, K];
const M: Vec2 = [K / 2, K / 2];
const mirror = (p: Vec2): Vec2 => [K - p[0], p[1]];

function narrow(label: string, b: Vec2, side: Vec2, layers: number): CraneStep {
  const center = unit(b, M);
  const edge = unit(b, side);
  const d = bisect(edge, center);
  const seed = along(b, bisect(edge, d), 40);
  return { label, move: () => fold(b, d, seed, layers) };
}

const B2 = mirror(B);
const down = unit(M, B2);
/** Where the neck and tail turn up: on the center line, 12 mm below the middle. */
const P = along(M, down, 12);

function leg(label: string, a: 1 | -1): CraneStep {
  const l = rot(down, (a * 75 * Math.PI) / 180);
  const off = rot(down, (a * Math.PI) / 2);
  const seed: Vec2 = [B2[0] - 25 * down[0] + 2 * off[0], B2[1] - 25 * down[1] + 2 * off[1]];
  return { label, move: () => ({ type: 'reverseFold', params: { line: { p: P, d: l }, seed, kind: 'inside' } }) };
}

/** The head: an inside reverse fold 18 mm from the tip of the neck (the up-left point). */
const head: CraneStep = {
  label: 'Reverse fold the head',
  move: (s) => {
    const tip = extreme(s, rot(down, (150 * Math.PI) / 180));
    const nd = unit(P, tip);
    const n: Vec2 = [-nd[1], nd[0]];
    const v = flatView(s)!;
    // The neck lies on one side of its folded edge: pick the side with paper.
    let seed: Vec2 = tip;
    for (const sg of [1, -1]) {
      const q: Vec2 = [tip[0] - 8 * nd[0] + sg * 1.2 * n[0], tip[1] - 8 * nd[1] + sg * 1.2 * n[1]];
      const inside = v.faceIds.some((f) => {
        const poly = v.poly.get(f)!;
        return poly.every((a, i) => {
          const b = poly[(i + 1) % poly.length]!;
          return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) > 0;
        });
      });
      if (inside) {
        seed = q;
        break;
      }
    }
    const Q = along(tip, nd, -18);
    return { type: 'reverseFold', params: { line: { p: Q, d: rot(nd, (-70 * Math.PI) / 180) }, seed, kind: 'inside' } };
  },
};

export const CRANE: readonly CraneStep[] = [
  { label: 'Fold in half diagonally', move: () => fold([0, 0], [1, 1], [40, -40]) },
  { label: 'Fold in half again', move: () => fold([0, 0], [1, -1], [-50, -30]) },
  { label: 'Squash the flap', move: () => ({ type: 'squash', params: { hinge: { p: [0, 0], d: [-1, 1] }, seed: [10, 50], layers: 2 } }) },
  { label: 'Turn over', move: () => turn },
  { label: 'Squash the other flap', move: () => ({ type: 'squash', params: { hinge: { p: [0, 0], d: [1, 1] }, seed: [-10, 50], layers: 2 } }) },
  // Preliminary base: closed corner (0,0), open corner (75,75).
  ...precrease('Kite fold the left edge', [75, 75], [0, K], [25, 75 - (75 - K) / 3], 2),
  ...precrease('Kite fold the right edge', [75, 75], [K, 0], [75 - (75 - K) / 3, 25], 2),
  { label: 'Petal fold', move: () => ({ type: 'petal', params: { hinge: { p: [0, K], d: [K, -K] }, seed: [70, 66] } }) },
  { label: 'Turn over', move: () => turn },
  { label: 'Petal fold the other side', move: () => ({ type: 'petal', params: { hinge: { p: [0, 0], d: [1, 1] }, seed: [-22, 69] } }) },
  // Bird base.
  narrow('Narrow the left leg', B, S1, 2),
  narrow('Narrow the right leg', B, S2, 2),
  { label: 'Turn over', move: () => turn },
  narrow('Narrow the left leg', B2, mirror(S1), 2),
  narrow('Narrow the right leg', B2, mirror(S2), 2),
  leg('Reverse fold the neck', 1),
  leg('Reverse fold the tail', -1),
  head,
];

/** Fold the whole crane; throws on the first refusal. */
export function foldCrane(start: KernelState, upTo = CRANE.length): KernelState[] {
  const states = [start];
  let s = start;
  for (const step of CRANE.slice(0, upTo)) {
    const r = applyMove(s, step.move(s));
    if (!r.ok) throw new Error(`${step.label}: ${r.reason} ${r.detail ?? ''}`);
    s = r.state;
    states.push(s);
  }
  return states;
}
