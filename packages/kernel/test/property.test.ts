import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  checkInvariants,
  createHistory,
  currentNode,
  currentState,
  fromFold,
  opLog,
  perform,
  redo,
  replay,
  stateHash,
  toFold,
  undo,
  type History,
  type KernelState,
} from '../src/index.ts';

const diagonalTriangle = () => mustApply(sheet(), foldMove([0, 0], [1, 1], [25, -25]));
const nestedTriangle = () => mustApply(diagonalTriangle(), foldMove([0, 0], [1, -1], [-40, -30]));
import { foldMove, mustApply, sheet } from './helpers.ts';
import { type MoveSpec, specArb, toMove } from './specs.ts';

const MAX_FACES = 160;
const stats = { attempted: 0, accepted: 0, reverseAttempted: 0, reverseAccepted: 0, maxFaces: 0, rejected: new Map<string, number>() };

function runSequence(specs: readonly MoveSpec[], start: KernelState = sheet()): History {
  let h = createHistory(start);
  for (const spec of specs) {
    const state = currentState(h);
    if (state.cp.faces.size > MAX_FACES) break;
    const move = toMove(state, spec);
    if (!move) continue;
    if (move.type === 'fold') stats.attempted++;
    if (move.type === 'reverseFold') stats.reverseAttempted++;
    const r = perform(h, move);
    if (!r.ok) {
      stats.rejected.set(r.reason + (r.detail ? ': ' + r.detail : ''), (stats.rejected.get(r.reason + (r.detail ? ': ' + r.detail : '')) ?? 0) + 1);
      // Fail closed means the kernel may refuse, but it must never refuse because
      // it produced something invalid from valid input.
      if (r.reason === 'internal') throw new Error(`Kernel produced an invalid state: ${r.detail}`);
      continue;
    }
    if (move.type === 'fold') stats.accepted++;
    if (move.type === 'reverseFold') stats.reverseAccepted++;
    stats.maxFaces = Math.max(stats.maxFaces, r.history.nodes.get(r.history.current)!.state.cp.faces.size);
    const violations = checkInvariants(r.history.nodes.get(r.history.current)!.state);
    if (violations.length) throw new Error(violations.map((v) => v.message).join('; '));
    h = r.history;
  }
  return h;
}

const numRuns = Number(process.env.PROPERTY_RUNS ?? 120);

describe('kernel properties', () => {
  it('random move sequences keep every invariant', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 14 }), (specs) => {
        runSequence(specs);
      }),
      { numRuns },
    );
    // The property must not hold vacuously.
    if (process.env.PROPERTY_STATS) console.log(stats);
    expect(stats.accepted).toBeGreaterThan(stats.attempted * 0.4);
  });

  it('deep sequences keep every invariant', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 15, maxLength: 30 }), (specs) => {
        runSequence(specs);
      }),
      { numRuns: Math.max(40, Math.ceil(numRuns / 4)) },
    );
    if (process.env.PROPERTY_STATS) console.log(stats);
    // Deep runs must reach genuinely multi-layer states.
    expect(stats.maxFaces).toBeGreaterThan(12);
  });

  it('reverse folds on closed flaps keep every invariant', () => {
    const starts = [diagonalTriangle(), nestedTriangle()];
    fc.assert(
      fc.property(fc.nat(1), fc.array(specArb, { minLength: 1, maxLength: 10 }), (which, specs) => {
        runSequence(specs, starts[which]!);
      }),
      { numRuns },
    );
    if (process.env.PROPERTY_STATS) console.log(stats);
    expect(stats.reverseAccepted).toBeGreaterThan(0);
  });

  it('replaying the op log rebuilds the same state bit for bit', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 8 }), (specs) => {
        const h = runSequence(specs);
        const rebuilt = replay(sheet(), opLog(h).map((op) => op.move));
        expect(stateHash(rebuilt)).toBe(currentNode(h).hash);
      }),
      { numRuns: Math.ceil(numRuns / 2) },
    );
  });

  it('undo then redo returns the identical state', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 8 }), fc.nat(), (specs, k) => {
        const h = runSequence(specs);
        const n = opLog(h).length;
        const steps = n === 0 ? 0 : (k % n) + 1;
        let u = h;
        const hashes: string[] = [];
        for (let i = 0; i < steps; i++) {
          hashes.push(currentNode(u).hash);
          u = undo(u);
        }
        for (let i = steps - 1; i >= 0; i--) {
          u = redo(u);
          expect(currentNode(u).hash).toBe(hashes[i]);
        }
        expect(stateHash(currentState(u))).toBe(currentNode(h).hash);
      }),
      { numRuns: Math.ceil(numRuns / 2) },
    );
  });

  it('FOLD export then import round-trips exactly', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 8 }), fc.array(specArb, { maxLength: 2 }), (specs, more) => {
        const state = currentState(runSequence(specs));
        const json = JSON.stringify(toFold(state));
        const back = fromFold(JSON.parse(json));
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(stateHash(back.state)).toBe(stateHash(state));
        expect(JSON.stringify(toFold(back.state))).toBe(json);
        // And the imported state behaves identically.
        for (const spec of more) {
          const m = toMove(state, spec);
          if (!m) continue;
          const r1 = applyMove(state, m);
          const r2 = applyMove(back.state, m);
          expect(r2.ok).toBe(r1.ok);
          if (r1.ok && r2.ok) expect(stateHash(r2.state)).toBe(stateHash(r1.state));
        }
      }),
      { numRuns: Math.ceil(numRuns / 2) },
    );
  });
});
