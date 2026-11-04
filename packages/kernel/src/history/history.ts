import { applyMove } from '../moves/apply.ts';
import type { Move, Op, Rejection, StateHash, Transition } from '../moves/types.ts';
import type { Grip, KernelState } from '../state/types.ts';
import { stateHash } from './hash.ts';

export type NodeId = number;

export interface HistoryNode {
  readonly id: NodeId;
  readonly parent: NodeId | null;
  /** The op that led here from the parent (null at the root). */
  readonly op: Op | null;
  readonly state: KernelState;
  readonly hash: StateHash;
  readonly children: readonly NodeId[];
}

/**
 * The op log as a tree (a DAG with one root). Undo walks to the parent, redo to the
 * child you came from, and folding something new after an undo starts a branch while
 * the old one stays reachable. States are immutable and share structure, so keeping
 * every node is cheap.
 */
export interface History {
  readonly nodes: ReadonlyMap<NodeId, HistoryNode>;
  readonly root: NodeId;
  readonly current: NodeId;
  /** For each node, the child redo returns to (the most recently visited one). */
  readonly redoTo: ReadonlyMap<NodeId, NodeId>;
  readonly nextNode: NodeId;
}

export function createHistory(initial: KernelState): History {
  const root: HistoryNode = { id: 0, parent: null, op: null, state: initial, hash: stateHash(initial), children: [] };
  return { nodes: new Map([[0, root]]), root: 0, current: 0, redoTo: new Map(), nextNode: 1 };
}

export function currentNode(h: History): HistoryNode {
  return h.nodes.get(h.current)!;
}

export function currentState(h: History): KernelState {
  return currentNode(h).state;
}

export interface PerformOk {
  readonly ok: true;
  readonly history: History;
  readonly op: Op;
  readonly transition: Transition;
}

export interface OpExtras {
  readonly grab?: Grip;
  readonly holds?: readonly Grip[];
}

/** Apply a move at the current node and record it. Rejections leave history untouched. */
export function perform(h: History, move: Move, extras: OpExtras = {}): PerformOk | Rejection {
  const node = currentNode(h);
  const result = applyMove(node.state, move);
  if (!result.ok) return result;
  const after = stateHash(result.state);
  const op: Op = {
    id: node.state.next.op,
    move,
    ...(extras.grab ? { grab: extras.grab } : {}),
    holds: extras.holds ?? [],
    before: node.hash,
    after,
  };
  const id = h.nextNode;
  const child: HistoryNode = { id, parent: node.id, op, state: result.state, hash: after, children: [] };
  const nodes = new Map(h.nodes);
  nodes.set(node.id, { ...node, children: [...node.children, id] });
  nodes.set(id, child);
  const redoTo = new Map(h.redoTo);
  redoTo.set(node.id, id);
  return {
    ok: true,
    history: { ...h, nodes, current: id, redoTo, nextNode: id + 1 },
    op,
    transition: result.transition,
  };
}

/**
 * Redo the current node's move differently, in place (the last fold opened or closed a little):
 * the same node, a new move from its parent. Only at a node nothing has followed yet.
 */
export function amend(h: History, move: Move): PerformOk | Rejection {
  const node = currentNode(h);
  if (node.parent === null || node.children.length > 0 || !node.op) return { ok: false, reason: 'unsupported', blockers: [], detail: 'Only the last move can change' };
  const parent = h.nodes.get(node.parent)!;
  const result = applyMove(parent.state, move);
  if (!result.ok) return result;
  const after = stateHash(result.state);
  const op: Op = { ...node.op, move, after };
  const nodes = new Map(h.nodes);
  nodes.set(node.id, { ...node, op, state: result.state, hash: after });
  return { ok: true, history: { ...h, nodes }, op, transition: result.transition };
}

export function canUndo(h: History): boolean {
  return currentNode(h).parent !== null;
}

export function canRedo(h: History): boolean {
  return h.redoTo.has(h.current);
}

export function undo(h: History): History {
  const parent = currentNode(h).parent;
  if (parent === null) return h;
  const redoTo = new Map(h.redoTo);
  redoTo.set(parent, h.current);
  return { ...h, current: parent, redoTo };
}

export function redo(h: History): History {
  const child = h.redoTo.get(h.current);
  return child === undefined ? h : { ...h, current: child };
}

/** Jump to any node (timeline click). */
export function goTo(h: History, id: NodeId): History {
  if (!h.nodes.has(id)) return h;
  // Remember the path so redo from any ancestor comes back down this branch.
  const redoTo = new Map(h.redoTo);
  let n = h.nodes.get(id)!;
  while (n.parent !== null) {
    redoTo.set(n.parent, n.id);
    n = h.nodes.get(n.parent)!;
  }
  return { ...h, current: id, redoTo };
}

/** Ops from the root to `id` (default: the current node): the linear op log of that branch. */
export function opLog(h: History, id: NodeId = h.current): Op[] {
  const ops: Op[] = [];
  let n = h.nodes.get(id);
  while (n && n.op) {
    ops.push(n.op);
    n = n.parent === null ? undefined : h.nodes.get(n.parent);
  }
  return ops.reverse();
}

/** The node path from the root to `id` (default: the current node). */
export function pathTo(h: History, id: NodeId = h.current): HistoryNode[] {
  const out: HistoryNode[] = [];
  let n = h.nodes.get(id);
  while (n) {
    out.push(n);
    n = n.parent === null ? undefined : h.nodes.get(n.parent);
  }
  return out.reverse();
}

export class ReplayError extends Error {
  readonly index: number;
  readonly rejection: Rejection;
  constructor(index: number, rejection: Rejection) {
    super(`Move ${index} was refused on replay: ${rejection.reason}${rejection.detail ? ` (${rejection.detail})` : ''}`);
    this.index = index;
    this.rejection = rejection;
  }
}

/** Rebuild a state from a flat sheet and a list of moves. Deterministic bit for bit. */
export function replay(initial: KernelState, moves: readonly Move[]): KernelState {
  let s = initial;
  moves.forEach((m, i) => {
    const r = applyMove(s, m);
    if (!r.ok) throw new ReplayError(i, r);
    s = r.state;
  });
  return s;
}
