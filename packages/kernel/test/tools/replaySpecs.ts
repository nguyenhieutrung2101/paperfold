// Debug helper: replay a property-test counterexample and report each step.
// Usage: node --experimental-strip-types test/tools/replaySpecs.ts '<json specs>'
import { applyMove, checkInvariants, createSheet, type KernelState } from '../../src/index.ts';
import { type MoveSpec, toMove } from '../specs.ts';

const specs = JSON.parse(process.argv[2] ?? '[]') as MoveSpec[];
let s: KernelState = createSheet({ sizeMm: 100 });
specs.forEach((spec, i) => {
  const m = toMove(s, spec);
  if (!m) return;
  const r = applyMove(s, m);
  if (!r.ok) {
    console.log(i, m.type, 'REFUSED', r.reason, r.detail ?? '');
    return;
  }
  s = r.state;
  const v = checkInvariants(s);
  console.log(i, m.type, JSON.stringify(m.params), 'faces', s.cp.faces.size, v.length ? 'INVALID' : 'ok');
});
