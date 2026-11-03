import {
  createHistory,
  createSheet,
  currentState,
  type History,
  lineThrough,
  type Move,
  perform,
  reflectPoint,
  type Vec2,
} from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { buildSteps, designLog } from '../src/index.ts';

function play(moves: Move[]): History {
  let h = createHistory(createSheet({ sizeMm: 100 }));
  for (const m of moves) {
    const r = perform(h, m);
    if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail ?? ''}`);
    h = r.history;
  }
  return h;
}

const fold = (p: Vec2, d: Vec2, seed: Vec2, layers: number | 'all' = 'all'): Move => ({
  type: 'fold',
  params: { line: { p, d }, seed, layers, direction: 'valley' },
});
const crease = (p: Vec2, d: Vec2): Move => ({ type: 'burnish', params: { line: { p, d }, amount: 1 } });
const c3 = (a: Vec2, b: Vec2, c: Vec2): Vec2 => [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];

// The diagonal fold, then an inside reverse fold of corner B(50,50).
const DIAG = fold([0, 0], [1, 1], [25, -25]);
const P: Vec2 = [20, 20];
const Q: Vec2 = [35, 50];
const D: Vec2 = [15, 30];
const TIP = c3(P, Q, [50, 50]);
const INSIDE: Move = { type: 'reverseFold', params: { line: { p: P, d: D }, seed: TIP, kind: 'inside' } };

describe('build steps', () => {
  it('a fold plus its crease is one step, and the steps replay to the design', () => {
    const h = play([DIAG, crease([0, 0], [1, 1]), INSIDE]);
    const { steps, verified } = buildSteps(designLog(h));
    expect(verified).toBe(true);
    expect(steps.map((s) => s.kind)).toEqual(['fold', 'reverse']);
    expect(steps[0]!.creased).toBe(true);
    expect(steps[0]!.name).toBe('valley-fold');
    expect(steps[1]!.name).toBe('inside-reverse-fold');
    expect(steps[1]!.named).toBe(true);
  });

  it('fold then unfold becomes a precrease step, and the push names itself', () => {
    const back = reflectPoint(lineThrough(P, Q), TIP);
    const h = play([DIAG, fold(P, D, TIP, 'all'), fold(P, D, back, 2), INSIDE]);
    const { steps, verified } = buildSteps(designLog(h));
    expect(verified).toBe(true);
    expect(steps.map((s) => s.kind)).toEqual(['fold', 'precrease', 'reverse']);
    expect(steps[1]!.caption.kind).toBe('precrease');
    expect(steps[1]!.symbols.map((s) => s.kind)).toContain('fold-unfold-arrow');
    expect(steps[2]!.symbols.map((s) => s.kind)).toEqual(['mountain-line', 'push-arrow']);
    expect(steps[2]!.hands.folding?.pose).toBe('push');
  });

  it('turn-overs that cancel out are dropped', () => {
    const h = play([DIAG, { type: 'turnOver', params: { axis: 'side' } }, { type: 'turnOver', params: { axis: 'side' } }]);
    const { steps, verified } = buildSteps(designLog(h));
    expect(verified).toBe(true);
    expect(steps.map((s) => s.kind)).toEqual(['fold']);
  });

  it('captions name landmarks relative to the view', () => {
    // Bottom-right corner up to the top-left corner.
    const h = play([fold([0, 0], [1, 1], [45, -45])]);
    const [step] = buildSteps(designLog(h)).steps;
    expect(step!.caption).toMatchObject({
      kind: 'fold',
      from: { v: 'bottom', h: 'right', what: 'corner' },
      dir: 'up-left',
      to: { v: 'top', h: 'left', what: 'corner' },
    });
  });

  it('hands pinch on the moving flap and hold outside its path', () => {
    const h = play([fold([0, 0], [0, 1], [40, 10])]);
    const [step] = buildSteps(designLog(h)).steps;
    const pinch = step!.hands.folding!;
    expect(pinch.pose).toBe('pinch');
    expect(pinch.at[0]).toBeGreaterThan(0); // on the right half, which moves
    const hold = step!.hands.holding!;
    expect(hold.at[0]).toBeLessThan(0); // on the left half, which stays
    expect(step!.hands.folding!.hand).toBe('right');
    expect(step!.hands.holding!.hand).toBe('left');
  });

  it('a left-handed setting swaps the hands', () => {
    const h = play([fold([0, 0], [0, 1], [40, 10])]);
    const [step] = buildSteps(designLog(h), { handedness: 'left' }).steps;
    expect(step!.hands.folding!.hand).toBe('left');
  });

  it('places the tip right when two layers\' corners coincide up to rounding', () => {
    // A 150 mm diagonal fold leaves two copies of one corner that differ by ~1e-14 mm; the
    // outline hull used to lose the opposite corner and call the top-right tip "bottom right".
    let h = createHistory(createSheet({ sizeMm: 150 }));
    const s = Math.SQRT1_2;
    const moves: Move[] = [
      { type: 'fold', params: { line: { p: [0, 0], d: [-s, -s] }, seed: [73.3, -73.3], layers: 1, direction: 'valley' } },
      { type: 'burnish', params: { line: { p: [0, 0], d: [-s, -s] }, amount: 1 } },
      { type: 'reverseFold', params: { line: { p: [53, 70.5], d: [0.18884726955203154, -0.9820064708456571] }, seed: [66, 73], kind: 'inside' } },
    ];
    for (const m of moves) {
      const r = perform(h, m);
      if (!r.ok) throw new Error(r.reason);
      h = r.history;
    }
    const { steps } = buildSteps(designLog(h));
    expect(steps[1]!.caption).toEqual({ kind: 'reverse', reverse: 'inside', tip: { v: 'top', h: 'right', what: 'tip' } });
  });

  it('the nested reverse-fold fixture builds verified steps', () => {
    const P2: Vec2 = [-20, 20];
    const Q2: Vec2 = [-35, 50];
    const h = play([
      DIAG,
      fold([0, 0], [1, -1], [-40, -30]),
      { type: 'reverseFold', params: { line: { p: P2, d: [Q2[0] - P2[0], Q2[1] - P2[1]] }, seed: c3(P2, Q2, [-50, 50]), kind: 'inside' } },
    ]);
    const { steps, verified } = buildSteps(designLog(h));
    expect(verified).toBe(true);
    expect(steps.at(-1)!.name).toBe('inside-reverse-fold');
    expect(currentState(h).cp.faces.size).toBe(8);
  });
});
