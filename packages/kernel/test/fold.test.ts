import { describe, expect, it } from 'vitest';
import {
  adjacency,
  checkInvariants,
  flatView,
  fold,
  frontUp,
  fromFold,
  toFold,
  orderOf,
  recognize,
  stackAt,
  type KernelState,
  type Move,
} from '../src/index.ts';
import { apply, bookFold, faceCount, foldMove, footprint, mustApply, sheet } from './helpers.ts';

const interiorCreases = (s: KernelState) => {
  const adj = adjacency(s.cp);
  return [...s.cp.creases.values()].filter((c) => {
    const ef = adj.edgeFaces.get(c.id)!;
    return ef.left !== null && ef.right !== null;
  });
};

describe('a fresh sheet', () => {
  it('is valid', () => {
    expect(checkInvariants(sheet())).toEqual([]);
  });
});

describe('fold: book fold', () => {
  const s = bookFold();

  it('splits the sheet into two faces joined by one valley crease', () => {
    expect(faceCount(s)).toBe(2);
    const creases = interiorCreases(s);
    expect(creases).toHaveLength(1);
    expect(creases[0]!.angleDeg).toBe(180);
    expect(creases[0]!.assignment).toBe('V');
    expect(creases[0]!.sharpness).toEqual([]); // soft until creased
  });

  it('lays the moving half on top, face down, over the left half', () => {
    const fp = footprint(s);
    expect(fp.minX).toBeCloseTo(-50, 9);
    expect(fp.maxX).toBeCloseTo(0, 9);
    const stack = stackAt(s, [-25, 0]);
    expect(stack.ok).toBe(true);
    if (!stack.ok) return;
    expect(stack.faces).toHaveLength(2);
    const [top, bottom] = stack.faces as [number, number];
    expect(frontUp(s.folded.placements.get(top)!)).toBe(false);
    expect(frontUp(s.folded.placements.get(bottom)!)).toBe(true);
    expect(orderOf(s.folded.layerOrder, top, bottom)).toBe(1);
  });

  it('records the exact transition', () => {
    const r = fold(sheet(), { line: { p: [0, 0], d: [0, 1] }, seed: [25, 0], layers: 'all', direction: 'valley' });
    expect(r.ok).toBe(true);
    if (!r.ok || r.transition.kind !== 'fold') return;
    expect(r.transition.moving).toHaveLength(1);
    expect(r.transition.newCreases).toHaveLength(1);
    expect(r.transition.direction).toBe(1);
    // The moving side is the left of the transition line.
    const m = r.transition.moving[0]!;
    const start = r.transition.startPlacements.get(m)!;
    expect(frontUp(start)).toBe(true);
  });

  it('leaves the input state untouched', () => {
    const before = sheet();
    fold(before, { line: { p: [0, 0], d: [0, 1] }, seed: [25, 0], layers: 'all', direction: 'valley' });
    expect(before.cp.faces.size).toBe(1);
  });
});

describe('fold: two folds', () => {
  it('folding a book-folded sheet in half again gives a legal flat vertex (Maekawa, Kawasaki)', () => {
    const s = mustApply(bookFold(), foldMove([0, 0], [1, 0], [-25, 25]));
    expect(faceCount(s)).toBe(4);
    const creases = interiorCreases(s);
    const folded = creases.filter((c) => c.angleDeg !== 0);
    const m = folded.filter((c) => c.angleDeg < 0).length;
    const v = folded.length - m;
    expect(Math.abs(m - v)).toBe(2);
    const stack = stackAt(s, [-25, -25]);
    expect(stack.ok && stack.faces.length).toBe(4);
  });

  it('a diagonal fold then a fold of the triangle in half (the reverse-fold fixture base)', () => {
    const tri = mustApply(sheet(), foldMove([0, 0], [1, 1], [25, -25]));
    expect(faceCount(tri)).toBe(2);
    const half = mustApply(tri, foldMove([0, 0], [1, -1], [-25, 0]));
    expect(faceCount(half)).toBe(4);
    expect(checkInvariants(half)).toEqual([]);
  });

  it('folds only the top layer when asked', () => {
    // Fold the top layer's left strip back to the right: only one face splits.
    const s = mustApply(bookFold(), foldMove([-30, 0], [0, 1], [-45, 0], 1));
    expect(faceCount(s)).toBe(3);
    const stack = stackAt(s, [-20, 0]);
    expect(stack.ok && stack.faces.length).toBe(3);
    const under = stackAt(s, [-45, 0]);
    expect(under.ok && under.faces.length).toBe(1);
  });
});

describe('fold: refusals', () => {
  it('refuses to fold one layer that is joined to the one under it', () => {
    // Spine of the book fold is at x = 0. A fold at x = -25 grabbed near the spine
    // would need both layers.
    const r = apply(bookFold(), foldMove([-25, 0], [0, 1], [-10, 0], 1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('joined');
    expect(r.suggestLayers).toBe(2);
    expect(apply(bookFold(), foldMove([-25, 0], [0, 1], [-10, 0], 2)).ok).toBe(true);
  });

  it('refuses to fold a top layer down through the layer under it', () => {
    const r = apply(bookFold(), foldMove([-25, 0], [0, 1], [-40, 0], 1, 'mountain'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('tucked');
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it('refuses a grab off the paper and a zero-length fold', () => {
    const off = apply(sheet(), foldMove([0, 0], [0, 1], [80, 0]));
    expect(!off.ok && off.reason).toBe('missed');
    const onLine = apply(sheet(), foldMove([0, 0], [0, 1], [0, 10]));
    expect(!onLine.ok && onLine.reason).toBe('degenerate');
  });

  it('refuses to move a held face', () => {
    const base = sheet();
    const held: KernelState = { ...base, folded: { ...base.folded, holds: [{ face: 0, material: [90, 50] }] } };
    const r = apply(held, foldMove([0, 0], [0, 1], [25, 0]));
    expect(!r.ok && r.reason).toBe('held');
    // Holding the half that stays put is fine.
    const ok: KernelState = { ...base, folded: { ...base.folded, holds: [{ face: 0, material: [10, 50] }] } };
    expect(apply(ok, foldMove([0, 0], [0, 1], [25, 0])).ok).toBe(true);
  });
});

describe('fold: unfold and refold', () => {
  it('folding a flap back along its crease unfolds it and keeps the crease memory', () => {
    const folded = bookFold();
    const open = mustApply(folded, foldMove([0, 0], [0, 1], [-25, 0], 1));
    const fp = footprint(open);
    expect(fp.minX).toBeCloseTo(-50, 9);
    expect(fp.maxX).toBeCloseTo(50, 9);
    const creases = interiorCreases(open);
    expect(creases).toHaveLength(1);
    expect(creases[0]!.angleDeg).toBe(0);
    expect(creases[0]!.assignment).toBe('V'); // memory
    expect(creases[0]!.restAngleDeg).toBeGreaterThan(0);
    expect(open.folded.layerOrder.size).toBe(0);
    for (const tr of open.folded.placements.values()) expect(frontUp(tr)).toBe(true);
    // Refold along the same crease the other way: it becomes a mountain.
    const back = mustApply(open, foldMove([0, 0], [0, 1], [25, 0], 'all', 'mountain'));
    const c = interiorCreases(back)[0]!;
    expect(c.angleDeg).toBe(-180);
    expect(c.assignment).toBe('M');
  });
});

describe('turn over and rotate', () => {
  it('turning over flips every layer order and every face', () => {
    const s = bookFold();
    const t = mustApply(s, { type: 'turnOver', params: { axis: 'side' } });
    for (const [k, v] of s.folded.layerOrder) expect(t.folded.layerOrder.get(k)).toBe(v === 1 ? -1 : 1);
    for (const [f, tr] of s.folded.placements) expect(frontUp(t.folded.placements.get(f)!)).toBe(!frontUp(tr));
    // Fold angles are material-relative and don't change.
    for (const c of s.cp.creases.values()) expect(t.cp.creases.get(c.id)!.angleDeg).toBe(c.angleDeg);
  });

  it('rotating keeps the model valid and on the table', () => {
    const t = mustApply(bookFold(), { type: 'rotate', params: { degrees: 45 } });
    expect(flatView(t)).not.toBeNull();
  });
});

describe('burnish', () => {
  const line = { p: [0, 0] as const, d: [0, 1] as const };

  it('creases only where the finger passed, and sets the rest angle when fully sharp', () => {
    const s = bookFold();
    const half = mustApply(s, { type: 'burnish', params: { line, from: 0, to: 50, amount: 1 } });
    const c = interiorCreases(half)[0]!;
    expect(c.sharpness).toHaveLength(1);
    expect(c.sharpness[0]!.to - c.sharpness[0]!.from).toBeCloseTo(0.5, 9);
    expect(c.restAngleDeg).toBe(180);
  });

  it('refuses when there is no fold on that line', () => {
    const r = apply(sheet(), { type: 'burnish', params: { line, amount: 1 } } as Move);
    expect(!r.ok && r.reason).toBe('missed');
  });

  it('refuses a crease that changes nothing, so it adds no step', () => {
    const sharp = mustApply(bookFold(), { type: 'burnish', params: { line, amount: 1 } });
    const r = apply(sharp, { type: 'burnish', params: { line, amount: 1 } } as Move);
    expect(!r.ok && r.reason).toBe('unchanged');
    const again = apply(sharp, { type: 'burnish', params: { line, from: -20, to: 20, amount: 0.5 } } as Move);
    expect(!again.ok && again.reason).toBe('unchanged');
  });

  it('a second stroke on another part of a creased fold is still named a crease', () => {
    const half = mustApply(bookFold(), { type: 'burnish', params: { line, from: 0, to: 50, amount: 1 } });
    const both = mustApply(half, { type: 'burnish', params: { line, from: -50, to: 0, amount: 1 } });
    const r = recognize(half, both);
    expect(r.name).toBe('crease');
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

describe('FOLD import fails closed', () => {
  const folded = () => mustApply(mustApply(sheet(), foldMove([0, 0], [1, 1], [25, -25])), foldMove([0, 0], [1, -1], [-40, -30]));

  it('opens its own export', () => {
    const r = fromFold(JSON.parse(JSON.stringify(toFold(folded(), 'x'))));
    expect(r.ok).toBe(true);
  });

  it('refuses a file whose layer order was tampered with', () => {
    const file = JSON.parse(JSON.stringify(toFold(folded(), 'x')));
    const rows = file['paperfold:state'].layerOrder as Array<[number, number, number]>;
    rows[0]![2] = -rows[0]![2]!;
    expect(fromFold(file)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a file with missing parts instead of throwing', () => {
    const file = JSON.parse(JSON.stringify(toFold(folded(), 'x')));
    delete file['paperfold:state'].faces;
    expect(fromFold(file)).toEqual({ ok: false, reason: 'invalid' });
  });
});
