# Paperfold: the plan

One page. The details live in [ARCHITECTURE.md](ARCHITECTURE.md), the reasoning in
[DECISIONS.md](DECISIONS.md), and what each phase delivered in [PHASE-0.md](PHASE-0.md) and
[PHASE-1.md](PHASE-1.md).

## What we're building

A browser app where you fold origami in 3D with your hands: grab the paper, fold it, crease it.
Every fold is checked against real paper, the app knows named moves, and any design turns into
animated build steps. The brief's working title was Foldwell; this repo is **Paperfold** (ADR-014).

## How it's built

An exact, headless **kernel** (TypeScript, in a Web Worker) is the single source of truth: crease
pattern, folded state, layer order, moves, validation, history. Everything else reads from it.

- **Intent** turns pointer input into candidate moves. It never moves the paper.
- **Kernel** validates and commits moves as pure transactions: `(state, params) → state + exact transition | refusal + reason + blockers`.
- **Skin** draws the kernel's state as soft, thick, two-sided paper. It never changes a decision.
- **Steps** reads the op log and writes the build steps, verified by replaying them.

## Phases

| Phase | Ends with | Gate |
| --- | --- | --- |
| **0. Plan and spikes** (done) | Docs; Spike A: kernel folds along arbitrary lines with correct layer order, undo, property-tested invariants; Spike B: paper that looks real | `pnpm dev` runs, tests green |
| **1. MVP that feels right** (this delivery) | Grab/fold/crease with live soft bend under the pointer, holds, Huzita–Justin snapping, Tab alternatives, unfold and refold, inside and outside reverse folds, timeline, .fold save/load, build steps with hands. **Not done: partial-angle hinge moves** (ADR-035) | Reverse-fold fixtures pass (12/12) |
| **2. Breadth and teaching** | Partial-angle hinge moves first; squash, petal, rabbit ear, swivel, pleat, crimp; bases; follow-along; diagrams; presets; sound; branches | Traditional crane end to end |
| **3. Advanced** | Crease-pattern view, collapse solver, sinks, 3D shaping, CP import, video export, share links | |

I'll stop after each phase for your go-ahead.

## Decisions that change what you'll see or use

1. **The kernel is still flat-only after Phase 1.** Every committed state lies flat (fold angles 0 or
   ±180°). While you drag, the paper shows any angle, but letting go lands flat. Partial angles and 3D
   shaping need non-flat collision checks and arrive first in Phase 2 (ADR-035). The data model
   already uses 3D rigid placements, so nothing gets rewritten.
2. **Point-to-point folding.** Drag a point to where it should land. The fold line snaps by the
   Huzita–Justin axioms 1–5 and 7 and to existing creases. The chip by the pointer names the move and
   Tab tries the other readings; on a closed flap the first reading is a reverse fold.
3. **Creasing is a stroke**: run a finger along the fold and only that part gets sharp. Double-click
   or C still creases the latest fold whole.
4. **Soft folds are honest about the kernel.** A fresh fold lands soft and springs back to the
   kernel's stored rest angle; creasing animates from the middle outward. Older soft folds are drawn
   creased once a newer fold happens, and reverse folds turn on a sharp hinge (labeled limitations,
   Phase 2).
5. **Real vs ideal paper** is already a toggle (thickness, soft bends, springback on or off).

## Where the brief pulls against itself (and what I did)

- **"Physically honest" vs a zero-thickness kernel.** Exact flat-folding theory (layer order,
  Maekawa, Kawasaki, taco/tortilla constraints) is zero-thickness. Thickness is real in the skin
  and caps how sharp a thick stack can crease, but a 64-layer fold real paper couldn't close is
  still legal in the kernel. Closest workable thing: keep the exact kernel, add a thickness budget
  check per move in Phase 2 (reject folds whose stack would exceed what the paper can wrap).
- **"Developable soft bends" + "outer layers wrap inner ones" + "the skin never moves the paper".**
  Wrapping thick stacks needs extra material at every folded edge, which a rigid kernel face can't
  supply. The soft part of each bend is exactly developable (arc length = material length); the
  thickness part is a fillet that adds about π·r of paper (about 1.6 mm for the outermost of 16 layers of kami). Labeled
  in code; Phase 2 replaces it with creep accounting.
- **60 fps with live kernel validation at 500 faces.** Full validation is O(F³) in the worst case.
  Phase 1 made validation incremental (only pairs and triples touched by the move); full validation
  stays in tests, the gate and .fold import. A spatial index for overlap pairs is next.

## Risks I'm watching

Validation cost at scale, the reverse-fold motion (approximate in Phase 1; needs bounded elastic
bending for multi-layer flaps), committing non-flat states, global layer cycles in the skin's height
model, and WebGL quirks on iPad. Each has a plan in
ARCHITECTURE.md, section "Risks".
