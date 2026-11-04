/** The Phase 2 gate: the traditional crane's op log turns into verified build steps. */
import { createHistory, createSheet, currentState, type History, perform } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { CRANE } from '../../kernel/test/crane.ts';
import { buildSteps, designLog } from '../src/index.ts';

function foldCrane(): History {
  let h = createHistory(createSheet({ sizeMm: 150 }));
  for (const step of CRANE) {
    const r = perform(h, step.move(currentState(h)));
    if (!r.ok) throw new Error(`${step.label}: ${r.reason}`);
    h = r.history;
  }
  return h;
}

describe('the crane, as build steps', () => {
  const { steps, verified } = buildSteps(designLog(foldCrane()));

  it('replays from a flat sheet to the same crane', () => {
    expect(verified).toBe(true);
  });

  it('names the moves a folder would', () => {
    const names = steps.map((s) => (s.named ? s.name : s.kind));
    expect(names.filter((n) => n === 'squash-fold')).toHaveLength(2);
    expect(names.filter((n) => n === 'petal-fold')).toHaveLength(2);
    expect(names.filter((n) => n === 'inside-reverse-fold')).toHaveLength(3);
    // The kite folds are precreases: fold, crease, unfold in one step each.
    expect(steps.filter((s) => s.kind === 'precrease')).toHaveLength(2);
  });

  it('says where the bases are, compresses repeats, and rates it', () => {
    const { difficulty } = buildSteps(designLog(foldCrane()));
    const bases = steps.filter((s) => s.base).map((s) => `${s.index}:${s.base}`);
    const repeats = steps.filter((s) => s.repeat).map((s) => `${s.index}<-${s.repeat!.of}${s.repeat!.behind ? ' behind' : ''}`);
    expect(bases).toEqual(['4:preliminary', '9:bird']);
    // The second squash, kite fold and petal; the narrowing, front and back; the tail.
    expect(repeats).toEqual(['4<-2 behind', '6<-5', '9<-7 behind', '11<-10', '13<-10 behind', '14<-13', '16<-15']);
    expect(difficulty.level).toBe(3);
  });

  it('every step has a caption and something to draw', () => {
    for (const s of steps) {
      expect(s.caption).toBeTruthy();
      if (s.kind !== 'turn-over' && s.kind !== 'rotate') expect(s.symbols.length).toBeGreaterThan(0);
    }
  });
});

describe('the crane, exported', () => {
  it('draws a diagram sheet with every step and its sentence', async () => {
    const { stepsSvg } = await import('../src/index.ts');
    const { steps } = buildSteps(designLog(foldCrane()));
    const svg = stepsSvg(steps, { title: 'Crane', text: (s) => `Step text ${s.index}` });
    expect(svg.startsWith('<svg')).toBe(true);
    for (const s of steps) expect(svg).toContain(`Step text ${s.index}`);
    // Valley lines, fold arrows and push arrows all appear.
    expect(svg).toContain('stroke-dasharray="7 4"');
    expect(svg).toContain('marker-end="url(#head)"');
    expect(svg).toContain('marker-end="url(#hollow)"');
  });

  it('writes a FOLD file with a frame per step', async () => {
    const { toFoldSteps } = await import('@paperfold/kernel');
    const { steps } = buildSteps(designLog(foldCrane()));
    const fold = toFoldSteps(steps[steps.length - 1]!.after, steps.map((s) => ({ state: s.after, title: `${s.index + 1}` })), 'Crane');
    expect(fold.file_frames).toHaveLength(1 + steps.length);
    expect(fold.file_frames![steps.length]!['frame_title']).toBe(String(steps.length));
    expect(JSON.parse(JSON.stringify(fold)).file_classes).toContain('diagrams');
  });
});
