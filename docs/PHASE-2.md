# Phase 2: progress notes

Phase 2 is "breadth and teaching", and its gate is the traditional crane end to end (PLAN.md).
This file tracks what's done, what isn't, and what's approximate. Decisions are in DECISIONS.md
(ADR-043 to ADR-045).

## Done so far

### A. Readable folded paper (plan 2 of PHASE-1-POLISH.md, ADR-043)

![Before, after, and on the lightbox](images/phase2-readability.png)

- Free flaps rest a few degrees open (real paper; at most 3 mm at the far end).
- Every state gets a layer map, drawn into two textures off the main thread. The paper shows:
  - contact shadows past every layer on top;
  - thin lines on cut edges;
  - rounded, lit folded edges;
  - ridges where an edge underneath presses through.
- **Lightbox:** hold L (a tap or the View switch keeps it on). Light comes from below, and each
  layer dims it, so hidden flaps show as darker steps.
- A lower camera and a more raking key light.

### B. Squash and petal folds (ADR-044, ADR-045)

- A general move for turning several parts of the paper at once, with a layer-order solver.
  Squash and petal folds are built on it, and reverse folds now go through it too.
- The kernel checks every result in full, as before. The crane's squashes, petals and reverse
  folds are tested to move without tearing.
- While you drag, the choice strip offers **Petal fold** and **Squash fold** (scroll or 1–9).
  - The petal comes right after "top layer", because that is what a corner drag means when the
    top layer can't fold alone.
  - The squash comes after the plain folds.
- Squash and petal folds are named from what changed, like every other move. Build steps show
  them with a caption and diagram lines and arrows (no hands yet).

### C. The crane

![Preliminary base, bird base, the crane](images/phase2-crane.png)

`kernel/test/crane.ts` folds a 150 mm square into a traditional crane in 21 moves:

1. Diagonal fold, then fold in half again.
2. Squash, turn over, squash (preliminary base).
3. Kite precreases.
4. Petal fold, turn over, petal fold (bird base).
5. Narrow the four leg edges.
6. Reverse fold the neck and the tail; they go up between the wings.
7. Reverse fold the head. Rotate.

Tests:

- The kernel accepts every step and every state validates in full.
- The build steps name both squashes, both petals and all three reverse folds, and replay from a
  flat sheet to the same crane.
- In the app, the whole sequence plays with its animations and no errors (screenshots above).

## Not done yet (in order)

1. **Folding the wings down flat.** After the legs are narrowed, each wing is joined at its
   narrowed corners to the body's inner layers. A rigid flat fold of one wing is refused as
   `joined`; real paper bends a little there. The crane is drawn wings up for now. Spreading the
   wings needs the next item.
2. **Partial-angle hinge moves** (non-flat states, swept-volume checks, `settle`), then 3D
   shaping: spread the wings, puff the body.
3. **Hands for squash and petal steps**, and the crane as an e2e test driven by the pointer.
4. Rabbit ear, swivel, pleat, crimp (the multi-part move makes these mostly a matter of saying
   which parts turn about which lines). Spread squash.
5. Base recognition (preliminary, bird, kite, fish, waterbomb, blintz, frog, windmill), repeat
   compression, follow-along mode, diagram export (SVG, PDF), .fold frames per step.
6. Sound and haptics, timeline branches, the mirror tool, difficulty estimates, the bend in a
   vertex shader.

## What stays approximate

- **Readability look.** The shadow width, line weights, bevel and ridge heights, the rest lift
  cap and per-layer transmission are tuned by eye (ADR-043).
- **The petal's side flaps** end up on the petal's face, as kite folds put them. That's the only
  stacking the creases allow with the inner layers kite-folded.
- **Squash and petal motions** are exact rigid motions (no tearing). They are one path among
  several the paper could take; real paper also flexes.
