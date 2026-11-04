import type { CandidateKind, TargetKind } from '@paperfold/intent';
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
  /** Screen direction away from the model: the strip goes that side, off the paper. */
  readonly away: { readonly x: number; readonly y: number };
  /** Where the common folds would land (faint dots), the line an edge would land on, and the
   * kind of common fold the drag has snapped to. */
  readonly targets: readonly Vec2[];
  readonly guide: readonly [Vec2, Vec2] | null;
  readonly snapKind: TargetKind | null;
}

/** A crease stroke in progress: sharpness along a fold line. */
export interface CreaseOverlay {
  readonly line: Line2;
  readonly lo: number;
  readonly hi: number;
  readonly value: number;
}

export type ZoneKind = 'corner' | 'folded-edge' | 'paper';

/** What the pointer is over before you press (Phase 1 polish, plan 1). */
export interface HoverView {
  readonly zone: ZoneKind;
  readonly screen: { readonly x: number; readonly y: number };
  /** Screen direction away from the model: badges go that side, off the paper. */
  readonly away: { readonly x: number; readonly y: number };
  /** Layers you'd pick up here, the fewest that can move on their own, and how many there are. */
  readonly layers: number;
  readonly min: number;
  readonly total: number;
  /** The corner's ring, or the folded edge's glow (table plane). */
  readonly corner?: Vec2;
  readonly edge?: { readonly a: Vec2; readonly b: Vec2 };
  /** True while the button is down and nothing has moved yet (scroll picks layers). */
  readonly pressed: boolean;
}

/** The corner curl while hovering: a small validated fold the skin shows a little open. */
export interface PeekView {
  readonly key: string;
  readonly after: Snapshot;
  readonly transition: MotionTransition;
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
  /** What the user picked last time for each kind of press (it leads when valid). */
  readonly preferredByZone: Partial<Record<ZoneKind, CandidateKind>>;
  readonly hover: HoverView | null;
  /** Relaxed folds: free flaps spring a little open so the layers show (R). */
  readonly relaxed: boolean;
  /** On the lightbox: light from below shows the layers (the button toggles it, L holds it). */
  readonly lightbox: boolean;
  readonly lightboxHeld: boolean;
  readonly peek: PeekView | null;
  /** Set while a drag is live: pick alternative i (the strip, for touch). */
  readonly choose: ((i: number) => void) | null;
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
  preferredByZone: {},
  hover: null,
  relaxed: false,
  lightbox: false,
  lightboxHeld: false,
  peek: null,
  choose: null,
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
