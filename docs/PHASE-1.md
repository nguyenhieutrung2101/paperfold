# Phase 1 notes: an MVP that feels right

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit, property and gate tests (Vitest)
pnpm typecheck
pnpm e2e          # Playwright (starts its own Vite on :4321)
```

## The gate

The brief's Phase 1 gate (section 10) is `packages/steps/test/gate.test.ts`. Four fixtures, each folded
from a fresh 100 mm sheet:

1. The square folded in half on the diagonal, an inside reverse fold of one sharp corner, then an
   outside reverse fold of the other.
2. The same on a flap with nested layers: the triangle folded in half again first, then inside at
   one corner and outside at the other.
3. The diagonal triangle, precreased along the reverse-fold line (fold and unfold), then pushed in.
4. The precrease-then-push version on the nested flap.

For each, three tests: every move **folds and validates** (all invariants, checked from scratch after
every move, not just the incremental check); every move gets **the right name** (valley fold,
crease, unfold, inside or outside reverse fold); and the **build steps replay** from a fresh sheet to
the same folded state (`sameFoldedState`, independently of the steps package's own check).
12 of 12 pass. A Playwright test does the inside reverse fold through the real UI too: the chip names
it during the drag, Tab cycles to "Fold both layers" and back, and the Steps view lists "Push the tip
inside." as a verified step.

## What works

**Folding with your hands** (`packages/intent`, `apps/web/src/fold`)

- **Live drag.** Every pointer move asks the worker for every move the drag could mean; the kernel
  validates each, and the paper bends under the pointer through the skin at the angle the pointer
  asks for (it lifts more when you move fast and settles toward flat when you slow down). The ghost
  shows the fold line (dashed valley, dash-dot mountain), where the flap lands, and rings on the
  landmarks the snap used. Letting go lands the fold from the angle you were showing.
- **A chip by the pointer names the move** ("Inside reverse fold", "Fold top layer", "Fold 2
  layers", "Fold both layers") with a Tab hint. **Tab** cycles the valid alternatives; on a closed flap
  a swing of the tip is a reverse fold first. **Shift** takes every layer. The kind you pick leads next
  time it's valid.
- **Snapping** by the Huzita–Justin axioms 1–5 and 7, plus existing creases and a soft 22.5° angle
  snap. Every candidate line is judged by one test: does it put the grabbed point within the snap
  radius of the pointer? The simplest rule wins. 16 px for a mouse, 26 px for a finger;
  Ctrl/Cmd is freehand.
- **Resistance.** An impossible drag holds the last valid pose, pulled back a little and trembling;
  the blocking layers glow warm. A second identical refusal within 30 s adds one short hint by the
  pointer ("That would tear the paper."). When another reading of the drag works (more layers, a
  reverse fold), the chip offers it instead of refusing.
- **Holds.** With Space down, a press that doesn't move pins the paper (a soft fingertip shadow marks
  it); a press that moves still folds, around the pins, so one hand holds while the other folds.
  Letting go of Space lifts the pins. On touch, a resting finger becomes a hold when a second finger
  lands. The kernel refuses a move that would drag a held
  point. Holds are recorded with the move, so the build steps know where the second hand was.
- **Creasing by stroke.** Run a finger along a folded edge: only where you pass gets sharp, and more
  passes, slower strokes and pen pressure sharpen more. Double-click or C still creases the latest
  fold whole; auto-crease is a setting.
- **Inside and outside reverse folds**, with both gestures: swing the tip (the chip says which
  reverse fold; Tab picks the other kinds), or push a folded edge in beside a precrease (always an
  inside reverse fold). The kernel's layer rules are exact (ADR-024). For a given line only one of the
  two is physically possible: inside needs the line within 90° of the tip's spine, outside needs it
  past 90°. The other would drag a layer through a fold, and the kernel says so (`blocked`, taco–tortilla).
- **Unfold and refold** along existing creases (the drag snaps to the crease).
- **Turn over** (F, Shift+F) and **rotate** (Q, E), animated.
- **Undo, redo and the timeline**: thumbnails of every state, the recognized name of every move,
  click to jump; branches stay in the history.
- **.fold save and open**, exact round trip.
- **Keyboard path**: K, arrows to pick what moves, Enter, arrows to pick where it goes, Enter folds
  (Shift+Enter every layer). Each step is announced in an `aria-live` status line.
- **Light and dark themes; first-run hints** ("A fresh square. Grab a corner." → "Run your finger along
  the fold to crease it." → "Hold Space to keep the paper still.").

**Recognition** (`packages/kernel/src/recognize`)

Post-hoc, from the crease-pattern diff and the degree-4 vertex at the spine: valley, mountain,
unfold, crease, turn over, rotate, inside reverse, outside reverse. Below confidence 0.5 the UI says
plain "Fold": a wrong name is worse than none.

**Build steps** (`packages/steps`, `apps/web/src/steps`)

- Cleans the op log: a fold and its crease are one step, fold-then-unfold is a precrease, turn-overs
  that cancel are dropped.
- Names each step, writes its caption as data ("Fold the bottom right corner up to the top left
  corner.", "Push the tip inside."), rendered by `strings.en.ts`.
- Yoshizawa–Randlett symbols: valley and mountain lines, valley, mountain and fold-and-unfold
  arrows, the push arrow, turn-over and rotate icons.
- Hand choreography: the folding hand pinches the moving flap (or pushes the spine), the other
  hand holds outside the flap's path, a fingernail runs along the crease. Left-handed swaps them.
- **Verified by replay**: the steps' own moves are replayed from a fresh sheet and must give the same
  folded state; if they don't, the player falls back to one step per move and says so.
- The player: animated semi-transparent hands, symbols, captions, play and pause, previous and next,
  scrub, 0.5× / 1× / 2×, loop a step. The list of steps doubles as the text version and as navigation.

**Kernel** (`packages/kernel`)

- Reverse folds on any closed flap, including nested layers (`moves/reverse.ts`), on a half-turn core
  shared with plain folds (`moves/foldCore.ts`).
- Incremental validation: after a move only pairs and triples touching changed faces are checked
  (sound because the previous state was valid). Full validation runs on .fold import, in every test,
  and in the gate after every move.
- Folded-state equivalence (`state/equivalence.ts`), optionally up to a rigid motion.
- Holds on every fold.

## Tests

TESTS_PLACEHOLDER

## Measured

MEASURED_PLACEHOLDER

## What doesn't work yet, or is approximated

- **Partial-angle hinge moves are not in Phase 1.** This is the one item from the Phase 1 list I
  didn't finish. The kernel is still flat-only (ADR-003). While you drag, the paper shows any angle,
  but letting go always lands it flat. Committing a fold at 90° needs non-flat placements and a
  swept-volume collision check (ADR-035). It moves to the top of Phase 2.
- **Reverse-fold motion is approximate** (labeled in `skin/src/frame.ts`). The flap's top side swings
  open rigidly about the spine, up to 95°, and closes over the tip. Real paper opens a little and
  flexes the tip through (degree-4 kinematics with bending). The tip turns on a sharp hinge, so an
  uncreased reverse fold looks creased: a soft loop would float the tip through the flap that closes
  over it. Phase 2's per-region heights can draw the bulge.
- **Only the latest fold shows softness.** Older uncreased folds are drawn as if creased (unchanged
  from Phase 0).
- **Thickness fillets add ≈π·r of paper per folded edge; the partial-crease blend is not
  developable** (ADR-010, ADR-011; unchanged).
- **Hands are stylized** capsules that ride the paper. They don't grip or deform it.
- **Steps**: captions name a target landmark only when the fold lands on one. No diagram export (SVG,
  PDF) yet, and no .fold frame per step; both are Phase 2.
- **The skin rebuilds the whole mesh each frame** during a drag (the vertex-shader bend is Phase 2).
  Fine for these models; not measured on an iPad.
- **In this container** the browser renders through SwiftShader on the CPU at 2–5 fps, so the
  Playwright tests use generous timeouts. Real GPUs aren't measured here.
- **Paper physics numbers are still placeholders** (ADR-015). No sound or haptics yet. No screenshot
  regression tests yet; they arrive with the crane golden model in Phase 2.

## Bugs found while verifying in the browser

- After an uncreased inside reverse fold, the tip showed on top of the flap. The kernel's order was
  right; the skin's soft loop lifted the tip 2·ρ (≈ 6 mm) through the layer above it. Reverse folds
  now turn on a sharp hinge, with a regression test.
- Pointer targets landed about 3 mm short during a drag. The pointer ray was intersected with the
  moving fold's top (including its soft loft) instead of the resting stack, so a corner-to-corner
  drag missed the corner snap. Fixed in `PaperModel`.
- A press exactly on a raw edge was "strictly inside" for the app but "on the edge" for the kernel,
  whose length tolerance is larger, so the fold was refused as `missed`. Grabs within 0.05 mm of an
  edge are now nudged in.
- The outline hull behind captions lost a corner when two copies of a vertex differed by rounding
  noise (≈1e-14 mm): a top-right tip was captioned "bottom right". Points are deduplicated on a 1e-6
  mm grid first, with a regression test.
- The step player skipped beats when frames were slow; the time step is now capped at 0.1 s.

## Next: Phase 2, in order

1. Hinge moves at partial angles: non-flat placements, swept-volume checks on BVHs, `settle`.
2. Squash, petal, rabbit ear, swivel, pleat, crimp (on the reverse-fold machinery: a flap, a spine
   and a degree-4 vertex), base recognition and repeat compression.
3. The crane golden model, end to end, as the gate; screenshot tests for key states.
4. Follow-along mode, diagram export (SVG, PDF), .fold frames per step.
5. Skin: per-region heights (woven orders, the reverse-fold bulge), creep accounting, the bend in a
   vertex shader. Sound and haptics, the mirror tool, difficulty estimates.
