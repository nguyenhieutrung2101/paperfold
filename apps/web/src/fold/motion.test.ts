import { applyMove, createSheet, snapshot, type KernelState } from '@paperfold/kernel';
import type { FoldTransition } from '@paperfold/skin';
import { describe, expect, it } from 'vitest';
import type { ActiveFold } from '../store.ts';
import { creaseProfile, foldPose, TIMING } from './motion.ts';

function bookFold(): { before: KernelState; after: KernelState; transition: FoldTransition } {
  const before = createSheet({ sizeMm: 150 });
  const r = applyMove(before, {
    type: 'fold',
    params: { line: { p: [0, 0], d: [0, 1] }, seed: [40, 0], layers: 'all', direction: 'valley' },
  });
  if (!r.ok || r.transition.kind !== 'fold') throw new Error('fold refused');
  return { before, after: r.state, transition: r.transition };
}

describe('fold animation', () => {
  const { before, after, transition } = bookFold();
  const snap = snapshot(after);
  const active: ActiveFold = { key: 1, before: snapshot(before), transition, startedAt: 0, creasedAt: null };

  it('reads sharpness and rest angle from the kernel', () => {
    const p = creaseProfile(snap, transition);
    expect(p.restDeg).toBeLessThan(180);
    expect(p.at(0)).toBe(0);
    expect(p.uMax - p.uMin).toBeCloseTo(150, 6);
    expect(p.fullySharp).toBe(false);
  });

  it('swings over, then springs back to the kernel rest angle and stays there', () => {
    expect(foldPose(active, snap, 0, 'real').motion?.theta).toBe(0);
    const mid = foldPose(active, snap, TIMING.fold / 2, 'real');
    expect(mid.motion!.theta).toBeGreaterThan(0);
    expect(mid.motion!.theta).toBeLessThan(Math.PI);
    const rest = foldPose(active, snap, TIMING.fold + TIMING.settle + 50, 'real');
    expect(rest.animating).toBe(false);
    expect(rest.motion!.theta).toBeCloseTo((creaseProfile(snap, transition).restDeg * Math.PI) / 180, 9);
  });

  it('ideal paper lands flat with no motion left', () => {
    const done = foldPose(active, snap, TIMING.fold + TIMING.settle + 50, 'ideal');
    expect(done.motion).toBeNull();
  });

  it('once creased in the kernel, the fold sharpens and then hands over to the static frame', () => {
    const line = transition.line;
    const r = applyMove(after, { type: 'burnish', params: { line: { p: line.p, d: line.d }, amount: 1 } });
    if (!r.ok) throw new Error('burnish refused');
    const creased = snapshot(r.state);
    expect(creaseProfile(creased, transition).fullySharp).toBe(true);
    const c: ActiveFold = { ...active, creasedAt: 2000 };
    const during = foldPose(c, creased, 2000 + TIMING.crease / 3, 'real');
    expect(during.animating).toBe(true);
    const after2 = foldPose(c, creased, 2000 + TIMING.crease + 10, 'real');
    expect(after2.motion).toBeNull();
  });
});
