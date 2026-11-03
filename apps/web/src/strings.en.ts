/**
 * Every UI string lives here so the voice can be tuned in one place (brief, section 8).
 * Short, plain, warm, a little dry. Sentence case, contractions, second person, no
 * exclamation marks, no emoji.
 */
import type { ReasonCode } from '@paperfold/kernel';

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
  moveLabel: {
    fold: 'Fold',
    burnish: 'Crease',
    turnOver: 'Turn over',
    rotate: 'Rotate',
  } as Record<string, string>,

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
  firstRun: ['A fresh square. Grab a corner.', 'Double-click the fold to crease it.'],

  // Pointer chips
  layersBadge: (n: number) => (n === 1 ? '1 layer' : `${n} layers`),
  allLayers: 'All layers',
  topLayer: 'Top layer',
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
  keys: 'Drag a corner to fold. Shift takes every layer. F turns over, Q and E rotate.',
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
