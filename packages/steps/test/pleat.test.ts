/** Pleats, crimps and rabbit ears as build steps: their own captions and diagram lines. */
import { createHistory, createSheet, currentState, type History, type Move, perform } from '@paperfold/kernel';
import { describe, expect, it } from 'vitest';
import { buildSteps, designLog, stepsSvg } from '../src/index.ts';

function fold(moves: readonly Move[]): History {
  let h = createHistory(createSheet({ sizeMm: 100 }));
  for (const m of moves) {
    const r = perform(h, m);
    if (!r.ok) throw new Error(`${m.type}: ${r.reason}`);
    h = r.history;
  }
  return h;
}

const diagonal: Move = { type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [25, -25], layers: 'all', direction: 'valley' } };

describe('pleat, crimp and rabbit ear steps', () => {
  it('a pleat: named, captioned, a valley and a mountain line, and it replays', () => {
    const { steps, verified } = buildSteps(designLog(fold([{ type: 'pleat', params: { first: { p: [10, 0], d: [0, 1] }, second: { p: [25, 0], d: [0, 1] }, seed: [40, 0] } }])));
    expect(verified).toBe(true);
    const s = steps[0]!;
    expect(s.kind).toBe('pleat');
    expect(s.name).toBe('pleat');
    expect(s.caption.kind).toBe('pleat');
    expect(s.symbols.map((x) => x.kind).sort()).toEqual(['mountain-line', 'valley-arrow', 'valley-line']);
  });

  it('a crimp: named inside, captioned, drawn on the flap, and it replays', () => {
    const crimp: Move = { type: 'crimp', params: { first: { p: [10, 10], d: [1, 3] }, second: { p: [20, 20], d: [1, 1.5] }, seed: [40, 44], kind: 'inside' } };
    const { steps, verified } = buildSteps(designLog(fold([diagonal, crimp])));
    expect(verified).toBe(true);
    const s = steps[1]!;
    expect(s.kind).toBe('crimp');
    expect(s.name).toBe('inside-crimp');
    expect(s.caption).toEqual({ kind: 'crimp', reverse: 'inside' });
    expect(s.symbols.filter((x) => x.kind === 'valley-line' || x.kind === 'mountain-line')).toHaveLength(2);
    const svg = stepsSvg(steps, { title: 'Crimp', text: () => 'step' });
    expect(svg).toContain('stroke-dasharray="7 3 1.5 3"');
  });

  it('a rabbit ear: named, captioned with its corner, three valleys and a mountain, and it replays', () => {
    const ear: Move = { type: 'rabbitEar', params: { tip: [-50, 50], base: [[-50, -50], [50, 50]], seed: [-45, 44], layers: 'all' } };
    const { steps, verified } = buildSteps(designLog(fold([{ type: 'fold', params: { line: { p: [0, 0], d: [1, 1] }, seed: [25, -25], layers: 'all', direction: 'valley' } }, ear])));
    expect(verified).toBe(true);
    const s = steps[1]!;
    expect(s.kind).toBe('rabbit-ear');
    expect(s.name).toBe('rabbit-ear');
    expect(s.caption.kind).toBe('rabbit-ear');
    expect(s.symbols.filter((x) => x.kind === 'valley-line')).toHaveLength(3);
    expect(s.symbols.filter((x) => x.kind === 'mountain-line')).toHaveLength(1);
  });
});
