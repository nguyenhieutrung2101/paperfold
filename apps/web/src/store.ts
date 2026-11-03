import type { Line2, Snapshot, Transition, Vec2 } from '@paperfold/kernel';
import type { PaperMode } from '@paperfold/skin';
import { create } from 'zustand';
import type { View } from './kernel/api.ts';
import { PRESETS, type PresetId } from './presets.ts';

export type Theme = 'light' | 'dark';

/** The most recent fold, still animating or resting soft until it's creased. */
export interface ActiveFold {
  readonly key: number;
  readonly before: Snapshot;
  readonly transition: Extract<Transition, { kind: 'fold' }>;
  /** performance.now() when the fold landed (animation start). */
  readonly startedAt: number;
  /** performance.now() when creasing started, if it has. */
  readonly creasedAt: number | null;
}

/** A whole-model move animating in (turn over, rotate). */
export interface ModelMotion {
  readonly key: number;
  readonly transition: Extract<Transition, { kind: 'turnOver' | 'rotate' }>;
  readonly startedAt: number;
}

export interface Ghost {
  readonly line: Line2;
  readonly landing: ReadonlyArray<readonly Vec2[]>;
  readonly ok: boolean;
  readonly snaps: readonly Vec2[];
  readonly allLayers: boolean;
}

export interface PointerHint {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface Paperstate {
  readonly mode: 'fold' | 'lab';
  readonly theme: Theme;
  readonly paperMode: PaperMode;
  readonly autoCrease: boolean;
  readonly preset: PresetId;
  readonly sizeMm: number;
  readonly frontColor: string;
  readonly backColor: string;
  readonly title: string;
  readonly panelOpen: boolean;
  readonly view: View | null;
  readonly active: ActiveFold | null;
  readonly modelMotion: ModelMotion | null;
  readonly ghost: Ghost | null;
  readonly glow: ReadonlySet<number>;
  readonly hint: PointerHint | null;
  readonly firstRun: number;
  readonly busy: boolean;
}

export interface PaperActions {
  set(partial: Partial<Paperstate>): void;
  showHint(text: string, x: number, y: number): void;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('paperfold.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be unavailable (private mode, previews). Fall through.
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function firstRunIndex(): number {
  try {
    return Number(localStorage.getItem('paperfold.firstRun') ?? 0) || 0;
  } catch {
    return 0;
  }
}

export const useStore = create<Paperstate & PaperActions>((set) => ({
  mode: 'fold',
  theme: initialTheme(),
  paperMode: 'real',
  autoCrease: false,
  preset: 'kami',
  sizeMm: 150,
  frontColor: PRESETS.kami.sheet.frontColor,
  backColor: PRESETS.kami.sheet.backColor,
  title: '',
  panelOpen: true,
  view: null,
  active: null,
  modelMotion: null,
  ghost: null,
  glow: new Set(),
  hint: null,
  firstRun: firstRunIndex(),
  busy: false,
  set: (partial) => set(partial),
  showHint: (text, x, y) => set({ hint: { text, x, y, at: performance.now() } }),
}));

export function advanceFirstRun(to: number): void {
  const cur = useStore.getState().firstRun;
  if (to <= cur) return;
  useStore.getState().set({ firstRun: to });
  try {
    localStorage.setItem('paperfold.firstRun', String(to));
  } catch {
    // Not persisted; the hint may show again next time.
  }
}

export function saveTheme(theme: Theme): void {
  useStore.getState().set({ theme });
  try {
    localStorage.setItem('paperfold.theme', theme);
  } catch {
    // Per-viewer convenience only.
  }
}
