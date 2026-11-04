/**
 * Every UI string lives here so the voice can be tuned in one place (brief, section 8).
 * Short, plain, warm, a little dry. Sentence case, contractions, second person, no
 * exclamation marks, no emoji.
 */
import type { BaseName, MoveName, ReasonCode } from '@paperfold/kernel';
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
  exportModel: 'Model (.fold)',
  exportStepsFold: 'Steps (.fold, a frame per step)',
  exportDiagrams: 'Diagrams (SVG)',
  printDiagrams: 'Print diagrams or save as PDF',
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
  relaxed: 'Relaxed folds',
  relaxedHelp: 'Let the folds open a little so the layers show. R toggles.',
  sound: 'Sound',
  soundHelp: 'Paper sounds; a light buzz on touch screens.',
  mirror: 'Mirror folds',
  mirrorHelp: 'Each fold is repeated on the other side of the middle. M toggles.',
  mirrorRefused: "The mirrored fold doesn't fit here.",
  foldAlong: 'Fold along',
  followStep: (k: number, n: number) => `Step ${k} of ${n}`,
  followOff: "That isn't this step yet. Undo and try again, or keep going.",
  followDone: "That's the model. Every step done.",
  stopFollowing: 'Stop',
  followLabel: 'Follow along',
  lightbox: 'Lightbox',
  lightboxHelp: 'Light from below shows every layer. Hold L to look.',
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
    'Push a folded edge to tuck the tip in.',
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

  // Hover and the choice strip (what a press will pick up, what else a drag could do)
  layersName: (k: number, total: number) =>
    k >= total ? (total <= 1 ? 'The sheet' : total === 2 ? 'Both layers' : 'All layers') : k === 1 ? 'Top layer' : `${k} layers`,
  scrollLayers: (which: 'more' | 'fewer', pressed: boolean) => `${pressed ? 'Scroll' : 'Hold and scroll'} for ${which} layers`,
  pushIn: 'Push in: tuck the tip inside',
  pushSub: 'Pull out to wrap it, or run along to crease',
  stripHint: (n: number) => `Scroll or 1–${Math.min(9, n)}`,
  branchHelp: (i: number, n: number) => `Folded another way here: ${i} of ${n}. Show the next.`,
  difficulty: (level: number) => `Difficulty: ${['very easy', 'easy', 'intermediate', 'tricky', 'complex'][level - 1]} (${level} of 5).`,
  // What a snapped drag lines up with.
  targetNames: {
    half: 'In half',
    center: 'To the center',
    corner: 'To the corner',
    midpoint: 'To the middle',
    'crease-point': 'To the crease',
    'edge-to-edge': 'Edge to edge',
    'edge-to-crease': 'Edge to the crease',
  } as Record<string, string>,
  choicesLabel: 'Ways to make this fold',
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
  keys: 'Drag a corner to fold. Push a folded edge to tuck the tip in. Hold the button and scroll for other ways. Run along a fold to crease it. Space holds. R relaxes the folds, L holds them up to the light, M mirrors your folds. F turns over, Q and E rotate. K folds with the keyboard.',
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
  unchanged: 'Already creased there.',
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
    case 'squash':
      return 'Squash fold';
    case 'petal':
      return 'Petal fold';
    case 'pleat':
      return 'Pleat';
    case 'inside-crimp':
      return 'Inside crimp';
    case 'outside-crimp':
      return 'Outside crimp';
  }
}

/** The traditional bases, when the model is one. */
export const baseNames: Record<BaseName, string> = {
  kite: 'Kite base',
  blintz: 'Blintz base',
  preliminary: 'Preliminary base',
  waterbomb: 'Waterbomb base',
  bird: 'Bird base',
};

/** Named moves, as chips. */
export const moveNames: Record<MoveName, string> = {
  'valley-fold': 'Valley fold',
  'mountain-fold': 'Mountain fold',
  unfold: 'Unfold',
  'inside-reverse-fold': 'Inside reverse fold',
  'outside-reverse-fold': 'Outside reverse fold',
  'squash-fold': 'Squash fold',
  'petal-fold': 'Petal fold',
  pleat: 'Pleat',
  'inside-crimp': 'Inside crimp',
  'outside-crimp': 'Outside crimp',
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

/** A step's sentence: its caption, or "repeat" for a step that does an earlier one again, and a note when it makes a base. */
export function stepText(s: { readonly caption: Caption; readonly base: BaseName | null; readonly repeat: { readonly of: number; readonly behind: boolean } | null }): string {
  const main = s.repeat ? `Repeat step ${s.repeat.of + 1} ${s.repeat.behind ? 'on the back' : 'on the other side'}.` : captionText(s.caption);
  return s.base ? `${main} That's a ${baseNames[s.base].toLowerCase()}.` : main;
}

/** One short sentence per step (brief, section 7, "Caption"). */
export function captionText(c: Caption): string {
  switch (c.kind) {
    case 'fold': {
      // A landmark says where it goes; a direction is only needed without one.
      const where = c.to ? `to ${targetText(c.to)}` : dirWords[c.dir];
      const behind = c.mountain ? ' behind' : '';
      return `Fold ${placeText(c.from)}${behind} ${where}.`;
    }
    case 'precrease': {
      const where = c.to ? `to ${targetText(c.to)}` : dirWords[c.dir];
      return `Fold ${placeText(c.from)} ${where}, crease, then unfold.`;
    }
    case 'unfold':
      return `Unfold ${placeText(c.from)}.`;
    case 'reverse':
      return c.reverse === 'inside' ? 'Push the tip inside.' : 'Wrap the tip around the outside.';
    case 'squash':
      return 'Lift the flap, open it, and squash it flat.';
    case 'pleat':
      return 'Pleat: valley fold on the first line, mountain fold on the second.';
    case 'crimp':
      return c.reverse === 'inside' ? 'Crimp the point inside: two reverse folds.' : 'Crimp the point outside: two reverse folds.';
    case 'petal':
      return `Lift ${placeText(c.tip)} up; the sides fold in.`;
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
