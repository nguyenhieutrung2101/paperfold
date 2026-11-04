import type { Line2, Move, Transition, Vec2 } from '@paperfold/kernel';
import { motionLine } from '@paperfold/skin';
import { kernel } from './kernel/client.ts';
import type { PerformResult, Refusal } from './kernel/api.ts';
import { PRESETS } from './presets.ts';
import { reasonHints, strings } from './strings.en.ts';
import { advanceFirstRun, useStore } from './store.ts';

let motionKey = 1;

/** Start over with a fresh sheet using the current paper settings. */
export async function newSheet(): Promise<void> {
  const s = useStore.getState();
  const preset = PRESETS[s.preset];
  const view = await kernel().reset({
    sizeMm: s.sizeMm,
    thicknessMm: preset.sheet.thicknessMm,
    stiffness: preset.sheet.stiffness,
    frontColor: s.frontColor,
    backColor: s.backColor,
  });
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, glow: new Set(), stepsView: null });
}

/**
 * The paper said no. The blocking layer glows warm for a moment; the first time there's
 * no text, on a second try one short hint appears by the pointer (brief, section 5).
 */
export function refused(r: Pick<Refusal, 'reason' | 'blockers'>, at?: { x: number; y: number }): void {
  const st = useStore.getState();
  const now = performance.now();
  const again = st.lastRefusal !== null && st.lastRefusal.reason === r.reason && now - st.lastRefusal.at < 30_000;
  st.set({ glow: new Set(r.blockers), lastRefusal: { reason: r.reason, at: now } });
  if (at && again) st.showHint(reasonHints[r.reason], at.x, at.y);
  window.setTimeout(() => {
    if (useStore.getState().glow.size > 0) useStore.getState().set({ glow: new Set() });
  }, 900);
}

function landed(r: Extract<PerformResult, { ok: true }>, fromTheta = 0): void {
  const tr: Transition = r.transition;
  const st = useStore.getState();
  const base = { view: r.view, stepsView: null, lastRefusal: null };
  if (tr.kind === 'fold' || tr.kind === 'reverse' || tr.kind === 'squash' || tr.kind === 'petal') {
    st.set({
      ...base,
      active: { key: motionKey++, before: r.before, transition: tr, startedAt: performance.now(), creasedAt: null, fromTheta },
      modelMotion: null,
      glow: new Set(),
    });
  } else if (tr.kind === 'turnOver' || tr.kind === 'rotate') {
    st.set({ ...base, modelMotion: { key: motionKey++, transition: tr, startedAt: performance.now() }, active: null });
  } else {
    st.set(base);
  }
}

/** Commit a move (with where the hands were). Returns true when the paper moved. */
export async function commitMove(
  move: Move,
  at: { x: number; y: number },
  extras: { grab?: Vec2; holds?: readonly Vec2[] } = {},
  fromTheta = 0,
): Promise<boolean> {
  const r = await kernel().perform(move, extras);
  if (!r.ok) {
    refused(r, at);
    return false;
  }
  landed(r, fromTheta);
  advanceFirstRun(1);
  if (useStore.getState().autoCrease && (move.type === 'fold' || move.type === 'reverseFold' || move.type === 'squash' || move.type === 'petal')) await creaseActive();
  return true;
}

/** Crease the most recent fold along its whole length (double-click, C, auto-crease). */
export async function creaseActive(at?: { x: number; y: number }): Promise<void> {
  const st = useStore.getState();
  const active = st.active;
  if (!active) return;
  const r = await kernel().perform({ type: 'burnish', params: { line: motionLine(active.transition), amount: 1 } });
  if (!r.ok) {
    refused(r, at);
    return;
  }
  const current = useStore.getState().active;
  useStore.getState().set({
    view: r.view,
    stepsView: null,
    active: current && current.key === active.key ? { ...current, creasedAt: performance.now() } : current,
  });
  advanceFirstRun(2);
}

/** A finger ran along a fold from `from` to `to` (mm along the line): crease just that part. */
export async function creaseStroke(line: Line2, from: number, to: number, amount: number, at: { x: number; y: number }): Promise<void> {
  const r = await kernel().perform({ type: 'burnish', params: { line: { p: line.p, d: line.d }, from, to, amount } });
  useStore.getState().set({ creaseOverlay: null });
  if (!r.ok) {
    refused(r, at);
    return;
  }
  useStore.getState().set({ view: r.view, stepsView: null });
  advanceFirstRun(2);
}

export async function performMove(move: Move): Promise<void> {
  const r = await kernel().perform(move);
  if (!r.ok) {
    refused(r);
    return;
  }
  landed(r);
}

export async function undo(): Promise<void> {
  const view = await kernel().undo();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
}

export async function redo(): Promise<void> {
  const view = await kernel().redo();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
}

export async function goTo(id: number): Promise<void> {
  const view = await kernel().goTo(id);
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
}

/** Open the build steps for the current design. */
export async function openSteps(): Promise<void> {
  const steps = await kernel().steps(useStore.getState().handedness);
  useStore.getState().set({ stepsView: steps, mode: 'steps', drag: null });
}

export async function exportFold(): Promise<void> {
  const title = useStore.getState().title || strings.untitled;
  const text = await kernel().exportFold(title);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, '').trim() || 'paperfold'}.fold`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openFold(file: File): Promise<void> {
  const text = await file.text();
  const r = await kernel().importFold(text);
  if ('error' in r) {
    useStore.getState().showHint(strings.badFile, window.innerWidth / 2, 96);
    return;
  }
  useStore.getState().set({ view: r, active: null, modelMotion: null, ghost: null, title: file.name.replace(/\.fold$/i, ''), stepsView: null });
}
