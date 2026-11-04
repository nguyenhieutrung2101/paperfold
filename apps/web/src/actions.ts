import type { Line2, Move, Transition, Vec2 } from '@paperfold/kernel';
import { motionLine } from '@paperfold/skin';
import { mirrorAxis, mirrorMove } from './mirror.ts';
import { cue } from './sound.ts';
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
  if (s.follow) await kernel().followStop();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, glow: new Set(), stepsView: null, follow: null });
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
  cue('refuse', lastTouch());
  if (at && again) st.showHint(reasonHints[r.reason], at.x, at.y);
  window.setTimeout(() => {
    if (useStore.getState().glow.size > 0) useStore.getState().set({ glow: new Set() });
  }, 900);
}

function landed(r: Extract<PerformResult, { ok: true }>, fromTheta = 0): void {
  const tr: Transition = r.transition;
  const st = useStore.getState();
  const base = { view: r.view, stepsView: null, lastRefusal: null };
  if (tr.kind === 'turnOver') cue('turn', lastTouch());
  else if (tr.kind !== 'burnish' && tr.kind !== 'rotate') cue('fold', lastTouch());
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
  const before = useStore.getState().view?.snapshot ?? null;
  const r = await kernel().perform(move, extras);
  if (!r.ok) {
    refused(r, at);
    return false;
  }
  landed(r, fromTheta);
  advanceFirstRun(1);
  const foldLike = move.type === 'fold' || move.type === 'reverseFold' || move.type === 'squash' || move.type === 'petal';
  if (useStore.getState().autoCrease && foldLike) await creaseActive();
  void checkFollow();
  // The mirror tool: the same fold on the other side of the model's middle line.
  if (useStore.getState().mirror && foldLike && before) {
    const m = mirrorMove(move, mirrorAxis(before));
    if (m) {
      await new Promise((res) => window.setTimeout(res, 520));
      const r2 = await kernel().perform(m);
      if (r2.ok) {
        landed(r2);
        if (useStore.getState().autoCrease) await creaseActive();
      } else {
        useStore.getState().showHint(strings.mirrorRefused, at.x, at.y);
      }
    }
  }
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
  cue('crease', lastTouch());
  advanceFirstRun(2);
  void checkFollow();
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
  cue('crease', lastTouch());
  advanceFirstRun(2);
  void checkFollow();
}

let touchInput = false;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => (touchInput = e.pointerType === 'touch'), true);
const lastTouch = () => touchInput;

export async function performMove(move: Move): Promise<void> {
  const r = await kernel().perform(move);
  if (!r.ok) {
    refused(r);
    return;
  }
  landed(r);
  void checkFollow();
}

/** Follow-along: fold the current design's steps yourself, from its flat sheet. */
export async function foldAlong(): Promise<void> {
  const r = await kernel().followStart(useStore.getState().handedness);
  useStore.getState().set({
    view: r.view,
    follow: { steps: r.steps, index: 0, off: false },
    mode: 'fold',
    stepsView: null,
    active: null,
    modelMotion: null,
    drag: null,
  });
}

export async function stopFollowing(): Promise<void> {
  await kernel().followStop();
  useStore.getState().set({ follow: null });
}

/** After every change: is the paper at the next step (or another one)? */
async function checkFollow(): Promise<void> {
  const f = useStore.getState().follow;
  if (!f) return;
  const r = await kernel().followCheck(f.index);
  const now = useStore.getState().follow;
  if (!now) return;
  useStore.getState().set({ follow: { ...now, index: r.index, off: !r.matched } });
}

export async function undo(): Promise<void> {
  const view = await kernel().undo();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
  void checkFollow();
}

export async function redo(): Promise<void> {
  const view = await kernel().redo();
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
  void checkFollow();
}

export async function goTo(id: number): Promise<void> {
  const view = await kernel().goTo(id);
  useStore.getState().set({ view, active: null, modelMotion: null, ghost: null, drag: null, stepsView: null });
  void checkFollow();
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

function download(text: string, name: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileBase = () => (useStore.getState().title || strings.untitled).replace(/[^\w\- ]+/g, '').trim() || 'paperfold';

/** The build steps as a FOLD file, one frame per step. */
export async function exportStepsFold(): Promise<void> {
  const r = await kernel().exportSteps(useStore.getState().title || strings.untitled, useStore.getState().handedness);
  download(r.fold, `${fileBase()} steps.fold`, 'application/json');
}

/** The diagram sheet as an SVG file. */
export async function exportDiagrams(): Promise<void> {
  const r = await kernel().exportSteps(useStore.getState().title || strings.untitled, useStore.getState().handedness);
  download(r.svg, `${fileBase()} diagrams.svg`, 'image/svg+xml');
}

/** The diagram sheet in a print window: print it, or save it as a PDF from the print dialog. */
export async function printDiagrams(): Promise<void> {
  const r = await kernel().exportSteps(useStore.getState().title || strings.untitled, useStore.getState().handedness);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.title = useStore.getState().title || strings.untitled;
  w.document.body.style.margin = '0';
  w.document.body.innerHTML = `<style>@page { margin: 12mm } svg { width: 100%; height: auto }</style>${r.svg}`;
  w.setTimeout(() => w.print(), 300);
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
