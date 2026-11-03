import type { KernelState } from '../state/types.ts';
import type { StateHash } from '../moves/types.ts';

/**
 * A fast 64-bit (two 32-bit lanes) hash over the exact bits of a state.
 * Numbers are hashed by their IEEE-754 bytes, so "same hash" means "same bits"
 * (brief, invariant 6: determinism). Not cryptographic.
 */
class Hasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x9747b28c;
  private readonly f64 = new Float64Array(1);
  private readonly u8 = new Uint8Array(this.f64.buffer);

  byte(b: number): void {
    this.h1 = Math.imul(this.h1 ^ b, 16777619);
    this.h2 = Math.imul(this.h2 ^ b, 0x5bd1e995);
    this.h2 ^= this.h2 >>> 13;
  }

  num(x: number): void {
    // Signed zeros are canonicalized: JSON (FOLD files, share links) can't carry -0.
    this.f64[0] = x === 0 ? 0 : x;
    for (let i = 0; i < 8; i++) this.byte(this.u8[i]!);
  }

  str(s: string): void {
    this.num(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
  }

  digest(): string {
    return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0');
  }
}

const sortedKeys = <K extends number | string>(m: ReadonlyMap<K, unknown>): K[] =>
  [...m.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function stateHash(state: KernelState): StateHash {
  const h = new Hasher();
  const { paper, cp, folded, next } = state;
  h.str('paper');
  for (const p of paper.outline) {
    h.num(p[0]);
    h.num(p[1]);
  }
  h.num(paper.thicknessMm);
  h.num(paper.stiffness);
  h.str(paper.front.color);
  h.str(paper.back.color);
  h.str('v');
  for (const id of sortedKeys(cp.vertices)) {
    const p = cp.vertices.get(id)!;
    h.num(id);
    h.num(p[0]);
    h.num(p[1]);
  }
  h.str('e');
  for (const id of sortedKeys(cp.creases)) {
    const c = cp.creases.get(id)!;
    h.num(id);
    h.num(c.v[0]);
    h.num(c.v[1]);
    h.str(c.assignment);
    h.num(c.angleDeg);
    h.num(c.restAngleDeg);
    h.num(c.createdBy ?? -1);
    h.num(c.sharpness.length);
    for (const s of c.sharpness) {
      h.num(s.from);
      h.num(s.to);
      h.num(s.value);
    }
  }
  h.str('f');
  for (const id of sortedKeys(cp.faces)) {
    const f = cp.faces.get(id)!;
    h.num(id);
    h.num(f.verts.length);
    for (const v of f.verts) h.num(v);
  }
  h.str('p');
  for (const id of sortedKeys(folded.placements)) {
    const tr = folded.placements.get(id)!;
    h.num(id);
    for (const x of tr.r) h.num(x);
    for (const x of tr.t) h.num(x);
  }
  h.str('o');
  for (const k of sortedKeys(folded.layerOrder)) {
    h.num(k);
    h.num(folded.layerOrder.get(k)!);
  }
  h.str('h');
  for (const hold of folded.holds) {
    h.num(hold.face);
    h.num(hold.material[0]);
    h.num(hold.material[1]);
  }
  h.str('n');
  h.num(next.vertex);
  h.num(next.edge);
  h.num(next.face);
  h.num(next.op);
  return h.digest();
}
