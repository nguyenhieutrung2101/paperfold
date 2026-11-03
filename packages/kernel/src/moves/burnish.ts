import { along, leftNormal, line as makeLine, signedDistance } from '../geometry/line.ts';
import { add2, scale2 } from '../geometry/vec.ts';
import { adjacency } from '../paper/creasePattern.ts';
import { foldedRestDeg, maxSharpness } from '../paper/physics.ts';
import { maxSpan, raiseSpans } from '../paper/spans.ts';
import type { Crease, EdgeId } from '../paper/types.ts';
import { faceSideOfLine } from '../state/derive.ts';
import { flatView, stackAt } from '../state/flat.ts';
import type { KernelState } from '../state/types.ts';
import { type BurnishParams, type MoveResult, reject } from './types.ts';

/**
 * Crease a folded edge: raise its sharpness where the finger passed, and move its rest
 * angle toward its current angle (crease memory). Stacks too thick for the paper can't
 * go fully sharp (paper/physics.ts).
 */
export function burnish(state: KernelState, params: BurnishParams): MoveResult {
  const view = flatView(state);
  if (!view) return reject('unsupported');
  const tol = state.tol;
  let l;
  try {
    l = makeLine(params.line.p, params.line.d);
  } catch {
    return reject('degenerate');
  }
  const amount = Math.max(0, Math.min(1, params.amount));
  const from = params.from ?? -Infinity;
  const to = params.to ?? Infinity;
  const adj = adjacency(state.cp);
  const creases = new Map(state.cp.creases);
  const touched: EdgeId[] = [];
  let capped = false;

  for (const c of state.cp.creases.values()) {
    if (Math.abs(c.angleDeg) !== 180) continue;
    const a = view.vertexWorld.get(c.v[0])!;
    const b = view.vertexWorld.get(c.v[1])!;
    if (Math.abs(signedDistance(l, a)) > tol.len || Math.abs(signedDistance(l, b)) > tol.len) continue;
    const ta = along(l, a);
    const tb = along(l, b);
    const lo = Math.max(Math.min(ta, tb), from);
    const hi = Math.min(Math.max(ta, tb), to);
    if (hi - lo <= tol.len) continue;
    const p0 = (lo - ta) / (tb - ta);
    const p1 = (hi - ta) / (tb - ta);

    // Layers stacked at the fold: probe just inside the folded faces at the middle of the range.
    const ef = adj.edgeFaces.get(c.id)!;
    const inward = faceSideOfLine(view.poly.get(ef.left!)!, l);
    const probe = add2(
      add2(l.p, scale2(l.d, (lo + hi) / 2)),
      scale2(leftNormal(l), inward * Math.max(50 * tol.len, 1e-3)),
    );
    const stack = stackAt(state, probe);
    const layers = stack.faces.length;
    const cap = maxSharpness(layers);

    const sharpness = raiseSpans(c.sharpness, Math.min(p0, p1), Math.max(p0, p1), amount, cap);
    const before = maxSpan(c.sharpness);
    const after = maxSpan(sharpness);
    touched.push(c.id);
    if (sameSpans(sharpness, c.sharpness)) {
      if (before >= cap && cap < 1) capped = true;
      continue;
    }
    const sign = c.angleDeg > 0 ? 1 : -1;
    const updated: Crease = { ...c, sharpness, restAngleDeg: sign * foldedRestDeg(state.paper.stiffness, after) };
    creases.set(c.id, updated);
  }

  if (touched.length === 0) return reject('missed', [], { detail: 'No folded edge along that line' });
  if (capped && touched.every((e) => creases.get(e) === state.cp.creases.get(e))) return reject('too-thick');

  return {
    ok: true,
    state: { ...state, cp: { ...state.cp, creases }, next: { ...state.next, op: state.next.op + 1 } },
    transition: { kind: 'burnish', edges: touched },
  };
}

function sameSpans(a: Crease['sharpness'], b: Crease['sharpness']): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.from === b[i]!.from && s.to === b[i]!.to && s.value === b[i]!.value);
}
