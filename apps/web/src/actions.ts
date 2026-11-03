import type { FoldParams, Move, Transition } from '@paperfold/kernel';
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
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, glow: new Set() });
}

function refused(r: Refusal, at?: { x: number; y: number }): void {
  const st = useStore.getState();
  st.set({ glow: new Set(r.blockers) });
  if (at) st.showHint(reasonHints[r.reason], at.x, at.y);
  window.setTimeout(() => {
    if (useStore.getState().glow.size > 0) useStore.getState().set({ glow: new Set() });
  }, 900);
}

function landed(r: Extract<PerformResult, { ok: true }>): void {
  const tr: Transition = r.transition;
  const st = useStore.getState();
  if (tr.kind === 'fold') {
    st.set({
      view: r.view,
      active: { key: motionKey++, before: r.before, transition: tr, startedAt: performance.now(), creasedAt: null },
      modelMotion: null,
      glow: new Set(),
    });
  } else if (tr.kind === 'turnOver' || tr.kind === 'rotate') {
    st.set({ view: r.view, modelMotion: { key: motionKey++, transition: tr, startedAt: performance.now() }, active: null });
  } else {
    st.set({ view: r.view });
  }
}

/** Commit a fold. Returns true when the paper folded. */
export async function commitFold(params: FoldParams, at: { x: number; y: number }): Promise<boolean> {
  const r = await kernel().perform({ type: 'fold', params });
  if (!r.ok) {
    refused(r, at);
    return false;
  }
  landed(r);
  advanceFirstRun(1);
  if (useStore.getState().autoCrease) await creaseActive();
  return true;
}

/** Crease the most recent fold along its whole length (double-click, C, auto-crease). */
export async function creaseActive(at?: { x: number; y: number }): Promise<void> {
  const st = useStore.getState();
  const active = st.active;
  if (!active) return;
  const r = await kernel().perform({ type: 'burnish', params: { line: active.transition.line, amount: 1 } });
  if (!r.ok) {
    refused(r, at);
    return;
  }
  const current = useStore.getState().active;
  useStore.getState().set({
    view: r.view,
    active: current && current.key === active.key ? { ...current, creasedAt: performance.now() } : current,
  });
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
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null });
}

export async function redo(): Promise<void> {
  const view = await kernel().redo();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null });
}

export async function goTo(id: number): Promise<void> {
  const view = await kernel().goTo(id);
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null });
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
  useStore.getState().set({ view: r, active: null, modelMotion: null, ghost: null, title: file.name.replace(/\.fold$/i, '') });
}
