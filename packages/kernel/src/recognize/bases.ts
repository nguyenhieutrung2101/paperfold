import { containsStrictly } from '../geometry/polygon.ts';
import { applyPlaneIso } from '../geometry/rigid.ts';
import type { Vec2 } from '../geometry/vec.ts';
import { materialPolygon } from '../paper/creasePattern.ts';
import { applyMove } from '../moves/apply.ts';
import type { Move } from '../moves/types.ts';
import { createSheet } from '../state/create.ts';
import { flatView } from '../state/flat.ts';
import type { KernelState } from '../state/types.ts';

/** The traditional bases the app names (brief, section 7). */
export type BaseName = 'kite' | 'blintz' | 'preliminary' | 'waterbomb' | 'bird';

/**
 * Is this state one of the traditional bases? Bases are recognized by shape, not by how they
 * were folded: where every point of the sheet ends up, compared with the same base folded here
 * in the kernel, up to moving, rotating or turning the model over, and up to the square's own
 * symmetries (a base folded from another corner is the same base). Layer order and crease
 * memory don't count, so a base folded with extra precreases, or by another route, still is one.
 *
 * Only for square sheets. Returns null when nothing matches within 1% of the sheet size.
 */
export function recognizeBase(state: KernelState): BaseName | null {
  const sheet = squareSize(state);
  if (sheet === null) return null;
  const here = sample(state, sheet.size, sheet.origin);
  if (!here) return null;
  for (const [name, canon] of canonicalBases(sheet.size)) {
    if (canon.faces !== undefined && canon.faces > state.cp.faces.size) continue;
    if (sameShape(here, canon.samples, sheet.size)) return name;
  }
  return null;
}

interface Sheet {
  readonly size: number;
  readonly origin: Vec2;
}

function squareSize(state: KernelState): Sheet | null {
  const o = state.paper.outline;
  if (o.length !== 4) return null;
  const xs = o.map((p) => p[0]);
  const ys = o.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (Math.abs(w - h) > 1e-6 * Math.max(w, h)) return null;
  return { size: w, origin: [Math.min(...xs), Math.min(...ys)] };
}

const N = 9;
/** Sample points of the sheet (0..1 coordinates), off every simple crease line. */
const UNIT: Vec2[] = (() => {
  const out: Vec2[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) out.push([(i + 0.5 + 0.0731) / N, (j + 0.5 + 0.1173) / N]);
  return out;
})();

/** World (table-plane) position of each sample point, or null if one can't be placed. */
function sample(state: KernelState, size: number, origin: Vec2, sym: (p: Vec2) => Vec2 = (p) => p): Vec2[] | null {
  const view = flatView(state);
  if (!view) return null;
  const faces = [...state.cp.faces.keys()].map((f) => ({ f, poly: materialPolygon(state.cp, f) }));
  const out: Vec2[] = [];
  for (const u of UNIT) {
    const s = sym(u);
    const m: Vec2 = [origin[0] + s[0] * size, origin[1] + s[1] * size];
    const hit = faces.find((x) => containsStrictly(x.poly, m, state.tol));
    if (!hit) return null;
    out.push(applyPlaneIso(view.iso.get(hit.f)!, m));
  }
  return out;
}

/** The eight symmetries of the unit square. */
const SYMS: ReadonlyArray<(p: Vec2) => Vec2> = [
  (p) => p,
  (p) => [1 - p[1], p[0]],
  (p) => [1 - p[0], 1 - p[1]],
  (p) => [p[1], 1 - p[0]],
  (p) => [1 - p[0], p[1]],
  (p) => [p[0], 1 - p[1]],
  (p) => [p[1], p[0]],
  (p) => [1 - p[1], 1 - p[0]],
];

/** Can `b` be moved onto `a` (rotation, translation, maybe a mirror) within tolerance? */
function sameShape(a: readonly Vec2[], bs: readonly (readonly Vec2[])[], size: number): boolean {
  const tol = 0.01 * size;
  const ca = mean(a);
  for (const b of bs) {
    const cb = mean(b);
    for (const mirror of [false, true]) {
      // 2D Procrustes: the best rotation of b (mirrored or not) onto a about their centroids.
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < a.length; i++) {
        const ax = a[i]![0] - ca[0];
        const ay = a[i]![1] - ca[1];
        const bx = b[i]![0] - cb[0];
        const by = (mirror ? -1 : 1) * (b[i]![1] - cb[1]);
        sxx += ax * bx + ay * by;
        sxy += ay * bx - ax * by;
      }
      const t = Math.atan2(sxy, sxx);
      const c = Math.cos(t);
      const s = Math.sin(t);
      let worst = 0;
      for (let i = 0; i < a.length && worst <= tol; i++) {
        const bx = b[i]![0] - cb[0];
        const by = (mirror ? -1 : 1) * (b[i]![1] - cb[1]);
        const x = c * bx - s * by + ca[0];
        const y = s * bx + c * by + ca[1];
        worst = Math.max(worst, Math.hypot(x - a[i]![0], y - a[i]![1]));
      }
      if (worst <= tol) return true;
    }
  }
  return false;
}

function mean(ps: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p[0] / ps.length;
    y += p[1] / ps.length;
  }
  return [x, y];
}

interface Canon {
  /** Sample positions under each of the square's symmetries. */
  readonly samples: ReadonlyArray<readonly Vec2[]>;
  /** At least this many faces (cheap early out). */
  readonly faces?: number;
}

const canonCache = new Map<number, ReadonlyArray<[BaseName, Canon]>>();

/** The bases, folded in the kernel on a sheet of this size (once per size). */
export function canonicalBases(size: number): ReadonlyArray<[BaseName, Canon]> {
  const hit = canonCache.get(size);
  if (hit) return hit;
  const out: Array<[BaseName, Canon]> = [];
  for (const [name, moves] of baseSequences(size)) {
    let s = createSheet({ sizeMm: size });
    let ok = true;
    for (const m of moves(s)) {
      const r = applyMove(s, m);
      if (!r.ok) {
        ok = false;
        break;
      }
      s = r.state;
    }
    if (!ok) continue;
    const sheet = squareSize(s)!;
    const samples = SYMS.map((sym) => sample(s, sheet.size, sheet.origin, sym)).filter((x): x is Vec2[] => x !== null);
    if (samples.length === SYMS.length) out.push([name, { samples, faces: Math.max(1, Math.floor(s.cp.faces.size / 3)) }]);
  }
  canonCache.set(size, out);
  return out;
}

/** How each base is folded (table coordinates of a sheet centered on the origin). */
function baseSequences(size: number): Array<[BaseName, (s: KernelState) => Move[]]> {
  const h = size / 2;
  const t8 = Math.tan(Math.PI / 8);
  const k = h - h * t8; // where the petal hinge meets a preliminary base's edge
  const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
    type: 'fold',
    params: { line: { p, d }, seed, layers, direction: 'valley' },
  });
  const turn: Move = { type: 'turnOver', params: { axis: 'side' } };
  const sc = (x: number) => (x * size) / 150;
  const P = (x: number, y: number): Vec2 => [sc(x), sc(y)];
  // Kite: two edges at one corner folded to the diagonal through it.
  const kiteFolds = (): Move[] => [
    fold(P(75, 75), [-Math.cos(Math.PI / 8), -Math.sin(Math.PI / 8)], P(-60, 70)),
    fold(P(75, 75), [-Math.sin(Math.PI / 8), -Math.cos(Math.PI / 8)], P(70, -60)),
  ];
  const blintz = (): Move[] => [
    fold(P(37.5, -37.5), [1, 1], P(70, -70), 1),
    fold(P(37.5, 37.5), [1, -1], P(70, 70), 1),
    fold(P(-37.5, 37.5), [1, 1], P(-70, 70), 1),
    fold(P(-37.5, -37.5), [1, -1], P(-70, -70), 1),
  ];
  const preliminary = (): Move[] => [
    fold([0, 0], [1, 1], P(40, -40)),
    fold([0, 0], [1, -1], P(-50, -30)),
    { type: 'squash', params: { hinge: { p: [0, 0], d: [-1, 1] }, seed: P(10, 50), layers: 2 } },
    turn,
    { type: 'squash', params: { hinge: { p: [0, 0], d: [1, 1] }, seed: P(-10, 50), layers: 2 } },
  ];
  const bird = (): Move[] => [
    ...preliminary(),
    { type: 'petal', params: { hinge: { p: [0, k], d: [k, -k] }, seed: P(70, 66) } },
    turn,
    { type: 'petal', params: { hinge: { p: [0, 0], d: [1, 1] }, seed: P(-22, 69) } },
  ];
  // Waterbomb: book fold, fold in half again, squash the top flap into a triangle, turn, squash.
  const waterbomb = (): Move[] => [
    fold([0, 0], [1, 0], P(0, 40)),
    fold([0, 0], [0, 1], P(40, -40)),
    { type: 'squash', params: { hinge: { p: [0, 0], d: [0, -1] }, seed: P(-20, -40), layers: 2 } },
    turn,
    { type: 'squash', params: { hinge: { p: [0, 0], d: [0, -1] }, seed: P(20, -40), layers: 2 } },
  ];
  return [
    ['blintz', blintz],
    ['kite', kiteFolds],
    ['preliminary', preliminary],
    ['waterbomb', waterbomb],
    ['bird', bird],
  ];
}
