import type { CandidateKind } from '@paperfold/intent';
import type { Line2, ReasonCode, Snapshot, Transition, Vec2 } from '@paperfold/kernel';
import type { MotionTransition, PaperMode } from '@paperfold/skin';
import type { HandSide } from '@paperfold/steps';
import { create } from 'zustand';
import type { CandidateStatus, DragPreview, StepsView, View } from './kernel/api.ts';
import { PRESETS, type PresetId } from './presets.ts';

export type Theme = 'light' | 'dark';

/** The most recent fold, still animating or resting soft until it's creased. */
export interface ActiveFold {
  readonly key: number;
  readonly before: Snapshot;
  readonly transition: MotionTransition;
  /** performance.now() when the fold landed (animation start). */
  readonly startedAt: number;
  /** performance.now() when creasing started, if it has. */
  readonly creasedAt: number | null;
  /** The angle it was already at when committed from a live drag (radians). */
  readonly fromTheta?: number;
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

/** The live drag: what the paper is doing under the pointer right now. */
export interface DragView {
  /** The candidate being shown (the last valid one while resisting). */
  readonly preview: DragPreview['preview'];
  /** Where the fold should be (radians); the paper eases toward it. */
  readonly theta: number;
  /** The selected candidate was refused: the paper resists and trembles. */
  readonly resisting: boolean;
  readonly candidates: readonly CandidateStatus[];
  readonly selected: number;
  readonly line: Line2 | null;
  readonly marks: readonly Vec2[];
  readonly pointer: { readonly x: number; readonly y: number };
}

/** A crease stroke in progress: sharpness along a fold line. */
export interface CreaseOverlay {
  readonly line: Line2;
  readonly lo: number;
  readonly hi: number;
  readonly value: number;
}

export interface KeyboardFold {
  readonly stage: 'from' | 'to';
  readonly from: Vec2 | null;
  readonly current: Vec2;
  readonly text: string;
}

export interface PointerHint {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface Paperstate {
  readonly mode: 'fold' | 'lab' | 'steps';
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
  readonly drag: DragView | null;
  readonly holds: readonly Vec2[];
  readonly creaseOverlay: CreaseOverlay | null;
  readonly keyboard: KeyboardFold | null;
  readonly lastRefusal: { readonly reason: ReasonCode; readonly at: number } | null;
  /** The alternative the user picked last time (it leads when valid). */
  readonly preferred: CandidateKind | null;
  readonly handedness: HandSide;
  readonly stepsView: StepsView | null;
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
  drag: null,
  holds: [],
  creaseOverlay: null,
  keyboard: null,
  lastRefusal: null,
  preferred: null,
  handedness: 'right',
  stepsView: null,
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
