import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  compose,
  halfTurnAboutPlaneLine,
  lineThrough,
  pairKey,
  setOrder,
  stackAt,
  type KernelState,
} from '../src/index.ts';
import { bookFold, foldMove, mustApply } from './helpers.ts';

const codes = (s: KernelState) => new Set(checkInvariants(s).map((v) => v.code));

function withOrder(s: KernelState, edit: (m: Map<number, 1 | -1>) => void): KernelState {
  const m = new Map(s.folded.layerOrder);
  edit(m);
  return { ...s, folded: { ...s.folded, layerOrder: m } };
}

describe('the validator catches broken states', () => {
  it('a reversed layer order no longer matches the fold angle', () => {
    const s = bookFold();
    const broken = withOrder(s, (m) => {
      for (const [k, v] of m) m.set(k, v === 1 ? -1 : 1);
    });
    expect(codes(broken).has('consistency')).toBe(true);
  });

  it('a missing or stale layer order', () => {
    const s = bookFold();
    expect(codes(withOrder(s, (m) => m.clear())).has('order-missing')).toBe(true);
    const faces = [...s.cp.faces.keys()];
    const stale = withOrder(s, (m) => m.set(pairKey(faces[0]!, 999), 1));
    expect(codes(stale).has('order-stale')).toBe(true);
  });

  it('a face moved off its crease', () => {
    const s = bookFold();
    const f = [...s.cp.faces.keys()][0]!;
    const placements = new Map(s.folded.placements);
    placements.set(f, compose(halfTurnAboutPlaneLine(lineThrough([-20, -60], [-20, 60])), placements.get(f)!));
    const broken: KernelState = { ...s, folded: { ...s.folded, placements } };
    const c = codes(broken);
    expect(c.has('connectivity') || c.has('consistency')).toBe(true);
  });

  it('a sheet slipped inside a fold (taco–tortilla)', () => {
    // Book fold, then fold the top layer's left strip back over itself: a fold at x = -30
    // whose two layers lie over the bottom sheet, which crosses that fold line.
    const s = mustApply(bookFold(), foldMove([-30, 0], [0, 1], [-45, 0], 1));
    expect(checkInvariants(s)).toEqual([]);
    const st = stackAt(s, [-20, 0]);
    if (!st.ok) throw new Error('no stack');
    const [top, middle, bottom] = st.faces as [number, number, number];
    // Slide the bottom sheet between the two layers of the new fold.
    const broken = withOrder(s, (m) => {
      setOrder(m, bottom, top, -1);
      setOrder(m, bottom, middle, 1);
    });
    const c = codes(broken);
    expect(c.has('taco-tortilla') || c.has('order-cycle')).toBe(true);
  });
});

describe('scoped checks (what a move runs) agree with the full check', () => {
  // The scoped check is sound only for corruptions that touch a changed face: that's the
  // contract a move relies on (everything else was valid before it).
  const scopedCodes = (s: KernelState, changed: number[]) => new Set(checkInvariants(s, { changed: new Set(changed) }).map((v) => v.code));

  it('a sheet slipped inside a fold is caught when any of its faces changed', () => {
    const s = mustApply(bookFold(), foldMove([-30, 0], [0, 1], [-45, 0], 1));
    const st = stackAt(s, [-20, 0]);
    if (!st.ok) throw new Error('no stack');
    const [top, middle, bottom] = st.faces as [number, number, number];
    const broken = withOrder(s, (m) => {
      setOrder(m, bottom, top, -1);
      setOrder(m, bottom, middle, 1);
    });
    for (const f of [top, middle, bottom]) {
      const c = scopedCodes(broken, [f]);
      expect(c.has('taco-tortilla') || c.has('order-cycle'), `changed face ${f}`).toBe(true);
    }
    // Valid states pass the scoped check whatever the scope.
    expect(checkInvariants(s, { changed: new Set(s.cp.faces.keys()) })).toEqual([]);
    expect(checkInvariants(s, { changed: new Set([top]) })).toEqual([]);
  });

  it('a missing order is caught from either face', () => {
    const s = bookFold();
    const [f, g] = [...s.cp.faces.keys()] as [number, number];
    const broken = withOrder(s, (m) => m.delete(pairKey(f, g)));
    expect(scopedCodes(broken, [f]).has('order-missing')).toBe(true);
    expect(scopedCodes(broken, [g]).has('order-missing')).toBe(true);
  });
});
