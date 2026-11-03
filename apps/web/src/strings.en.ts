/**
 * Every UI string lives here so the voice can be tuned in one place (brief, section 8).
 * Short, plain, warm, a little dry. Sentence case, contractions, second person, no
 * exclamation marks, no emoji.
 */
import type { MoveName, ReasonCode } from '@paperfold/kernel';
import type { CandidateKind } from '@paperfold/intent';
import type { Caption, Direction, Place } from '@paperfold/steps';

export const strings = {
  appName: 'Paperfold',
  untitled: 'Untitled',
  designNameLabel: 'Design name',

  // Top bar
  fold: 'Fold',
  lab: 'Bend lab',
  share: 'Share',
  export: 'Export',
  open: 'Open',
  newSheet: 'New sheet',
  settings: 'Settings',

  // Timeline
  undo: 'Undo',
  redo: 'Redo',
  steps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  start: 'Flat sheet',

  // Side panel
  paper: 'Paper',
  size: 'Size',
  frontColor: 'Front',
  backColor: 'Back',
  view: 'View',
  realPaper: 'Real paper',
  realPaperHelp: 'Thickness, soft bends and springback.',
  idealPaper: 'Ideal paper',
  autoCrease: 'Auto-crease',
  autoCreaseHelp: 'Crease every fold as it lands.',
  theme: 'Theme',
  light: 'Light',
  dark: 'Dark',
  collapse: 'Hide panel',
  expand: 'Show panel',

  presets: {
    kami: 'Kami',
    washi: 'Washi',
    printer: 'Printer',
    foil: 'Foil',
    duo: 'Duo',
  } as Record<string, string>,

  // First run, one at a time, each shown once.
  firstRun: [
    'A fresh square. Grab a corner.',
    'Run your finger along the fold to crease it.',
    'Hold Space to keep the paper still.',
  ],
  firstRunTouchHold: 'Rest a finger to hold the paper.',

  // Steps
  stepsButton: 'Steps',
  stepsTitle: 'Steps',
  stepsSummary: (n: number) => `${n === 1 ? '1 step' : `${n} steps`}. About ${Math.max(1, Math.round(n * 0.6))} ${Math.round(n * 0.6) <= 1 ? 'minute' : 'minutes'}.`,
  stepsEmpty: 'Fold something first.',
  stepsUnverified: "These steps don't quite rebuild your design. Showing every move instead.",
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous',
  next: 'Next',
  loopStep: 'Loop step',
  speed: 'Speed',
  stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
  backToFolding: 'Back to folding',
  stepsList: 'All steps as text',
  handedness: 'Folding hand',
  rightHand: 'Right',
  leftHand: 'Left',

  // Keyboard folding (accessibility)
  keyboardStart: 'K: fold with the keyboard',
  keyboardFrom: (i: number, n: number, what: string) => `Pick what to move: ${what} ${i} of ${n}. Arrows to change, Enter to pick.`,
  keyboardTo: (i: number, n: number, what: string) => `Pick where it goes: ${what} ${i} of ${n}. Enter folds, Shift+Enter folds every layer.`,
  landmarkKinds: { corner: 'corner', midpoint: 'midpoint' } as Record<string, string>,

  // Pointer chips
  layersBadge: (n: number) => (n === 1 ? '1 layer' : `${n} layers`),
  allLayers: 'All layers',
  topLayer: 'Top layer',
  tabForMore: 'Tab',
  held: 'Held.',
  creased: 'Creased.',

  // Files
  saved: 'Saved.',
  badFile: "Can't open that file. Try a .fold file.",
  noWebGL: "Your browser can't show 3D here. Try Chrome or Safari.",

  // Lab
  labTitle: 'Bend lab',
  labIntro: 'Bend it, then run your pointer along the fold to crease it.',
  labLayers: 'Layers',
  labAngle: 'Fold',
  labThickness: 'Thickness',
  labSoften: 'Smooth out',
  labLetGo: 'Let go',
  labHold: 'Hold',
  labDirection: 'Direction',

  // Keyboard help
  keys: 'Drag a corner to fold. Shift takes every layer, Tab tries another way. Run along a fold to crease it. Space holds. F turns over, Q and E rotate. K folds with the keyboard.',
} as const;

/** One short line per kernel reason code: what happened, then what to try. */
export const reasonHints: Record<ReasonCode, string> = {
  missed: 'Grab the paper, not the table.',
  degenerate: 'Too close to a corner. Try a little further.',
  joined: 'Those layers are joined. Grab them all.',
  tucked: "That layer's tucked under a fold.",
  blocked: "Something's in the way.",
  held: 'That would tear the paper.',
  'too-thick': 'Too thick to crease here.',
  tear: 'That would tear the paper.',
  unsupported: "That fold isn't possible here yet.",
  internal: "Something's in the way.",
};

/** The chip near the pointer while dragging: what this drag will do. */
export function candidateName(kind: CandidateKind, layers: number): string {
  switch (kind) {
    case 'inside-reverse':
      return 'Inside reverse fold';
    case 'outside-reverse':
      return 'Outside reverse fold';
    case 'fold-all':
      return layers === 2 ? 'Fold both layers' : 'Fold all layers';
    case 'fold-layers':
      return `Fold ${layers} layers`;
    case 'fold-top':
      return 'Fold top layer';
  }
}

/** Named moves, as chips. */
export const moveNames: Record<MoveName, string> = {
  'valley-fold': 'Valley fold',
  'mountain-fold': 'Mountain fold',
  unfold: 'Unfold',
  'inside-reverse-fold': 'Inside reverse fold',
  'outside-reverse-fold': 'Outside reverse fold',
  crease: 'Crease',
  'turn-over': 'Turn over',
  rotate: 'Rotate',
  fold: 'Fold',
};

function placeText(p: Place): string {
  const where = p.v === 'middle' && p.h === 'center' ? 'middle' : p.v === 'middle' ? p.h : p.h === 'center' ? p.v : `${p.v} ${p.h}`;
  if (p.what === 'point') return `the ${where}`;
  return `the ${where} ${p.what}`;
}

function targetText(p: Place): string {
  return p.v === 'middle' && p.h === 'center' ? 'the middle' : placeText({ ...p, what: p.what === 'point' ? 'point' : p.what });
}

const dirWords: Record<Direction, string> = {
  up: 'up',
  down: 'down',
  left: 'to the left',
  right: 'to the right',
  'up-left': 'up and to the left',
  'up-right': 'up and to the right',
  'down-left': 'down and to the left',
  'down-right': 'down and to the right',
};

/** One short sentence per step (brief, section 7, "Caption"). */
export function captionText(c: Caption): string {
  switch (c.kind) {
    case 'fold': {
      const to = c.to ? ` to ${targetText(c.to)}` : '';
      const behind = c.mountain ? ' behind' : '';
      return `Fold ${placeText(c.from)}${behind} ${dirWords[c.dir]}${to}.`;
    }
    case 'precrease': {
      const to = c.to ? ` to ${targetText(c.to)}` : '';
      return `Fold ${placeText(c.from)} ${dirWords[c.dir]}${to}, crease, then unfold.`;
    }
    case 'unfold':
      return `Unfold ${placeText(c.from)}.`;
    case 'reverse':
      return c.reverse === 'inside' ? 'Push the tip inside.' : 'Wrap the tip around the outside.';
    case 'turn-over':
      return c.axis === 'side' ? 'Turn it over.' : 'Turn it over, top to bottom.';
    case 'rotate': {
      const turns = Math.abs(c.degrees) % 360;
      const size = turns === 90 ? 'a quarter turn' : turns === 180 ? 'a half turn' : turns === 45 ? 'an eighth of a turn' : `${turns}°`;
      return `Rotate it ${size} to the ${c.degrees > 0 ? 'left' : 'right'}.`;
    }
    case 'crease':
      return 'Crease the fold firmly.';
  }
}
