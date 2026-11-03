# Phase 0 notes: plan and spikes

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit + property tests (Vitest)
pnpm typecheck    # every package, sources and tests
pnpm e2e          # Playwright smoke tests (starts its own Vite on :4321)
PROPERTY_RUNS=3000 pnpm test   # heavier property run
```

`?shadows=0` turns shadows off (slow GPUs, screenshot tests).

## What works

**Spike A: the kernel** (`packages/kernel`)

- Folds a sheet (square or any convex outline) along arbitrary lines: top layer, k layers or all,
  valley or mountain, including unfolding and refolding along existing creases.
- Exact layer order: local rewrite per move, then full verification of every invariant on every
  commit (isometry, connectivity, consistency, transitivity, taco–taco, taco–tortilla,
  tortilla–tortilla, Maekawa, Kawasaki). Fails closed.
- Refusals with reason codes and blocking faces: `joined` (with a suggested layer count),
  `tucked`, `held`, `missed`, `degenerate`, `too-thick`.
- Burnish (partial sharpness spans, rest angles, thick-stack cap), turn over, rotate.
- History: op log as a tree with undo, redo, jump and branches; deterministic replay; state hashes.
- FOLD 1.2 export/import with an exact round trip.

**Spike B: paper that looks real** (`packages/skin`, `packages/render`, Bend lab)

- Two-sided paper (front/back per fragment), procedural fiber normal and albedo maps, faint
  sheen, back-light translucency, visible raw-edge thickness, studio light, contact and cast
  shadows, a cutting mat with a 10 mm grid. Light and dark themes.
- Soft developable bends: the arc consumes exactly its material length, so the flap creeps.
- Stacked layers wrap on concentric arcs (r_i = r_0 + i·t) with real thickness offsets.
- Springback to the kernel's rest angle; crease sharpening from the middle outward.
- Stroke creasing in the Bend lab: only where you pass gets sharp; partially creased folds keep a
  soft loop where you didn't press, and the flap closes more as more of it is creased.
- Crease memory: unfolded creases keep a few degrees, drawn as a shading groove.

**The app** (`apps/web`): drag to fold with a validated ghost preview and snapping, warm refusal
with a one-line hint, double-click or C to crease, F / Q / E, undo/redo timeline, paper presets
and colors, real/ideal paper, auto-crease, .fold open/export, first-run hints, all strings in
`strings.en.ts`.

## Tests

- 57 Vitest tests across kernel (geometry, folds, refusals, unfold/refold, burnish, turn/rotate,
  validator negatives, 5 property suites), skin (bend developability, concentric wrap, frame
  consistency at the end of a fold), intent (snapping) and the app's fold animation.
- Property tests: random sequences of up to 30 moves with degenerate line families; every
  invariant holds, replay is bit-identical, undo/redo is exact, FOLD round-trips exactly. Green at
  3,000 runs × 5 seeds. They found four real bugs on the way: a line that misses the paper, a
  near-corner sliver, catastrophic cancellation in polygon areas, and weld-tilted short creases
  (now ADR-005 and ADR-008).
- 3 Playwright smoke tests: fold, crease, undo/redo; a `joined` refusal with its hint; the lab.

## Measured (Node 22, this container, no GPU)

Repeated halving folds of every layer:

| faces (= layers) | fold incl. full validation | validation alone | static frame | moving frame |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 1.5 ms | 0.5 ms | 1.2 ms | 3.8 ms |
| 16 | 3.6 ms | 1.8 ms | 1.1 ms | 8.3 ms |
| 32 | 9.5 ms | 4.4 ms | 1.3 ms | 15.6 ms |
| 64 | 33.7 ms | 20.6 ms | 3.8 ms | 19.0 ms |

Fine for Phase 0 models; not yet the brief's budget at 500 faces (see "Next").

## What doesn't work yet, or is approximated

- **Flat states only.** No partial hinge angles or 3D shaping in the kernel (ADR-003). Springback
  is the skin animating the kernel's rest angle.
- **No live bend under the pointer.** The ghost shows the fold line and landing outline; the paper
  animates after you let go.
- **Only the latest fold shows softness.** Older uncreased folds are drawn as if creased.
- **Stroke creasing is only in the Bend lab**; the fold view uses double-click or C.
- **Thickness fillets add ≈π·r of paper** at each folded edge; creep is only modeled in the moving
  fold (ADR-010). **Partial-crease blend zone is not developable** (ADR-011).
- **Woven layer orders** get approximate heights (cycles broken by face id).
- **Paper physics numbers are placeholders** (ADR-015).
- No holds UI (the kernel enforces holds), no Tab alternatives, no named moves, no build steps,
  no ambient occlusion pass, no sound yet. FOLD import reads Paperfold files only.
- Validation and frame building need to get incremental before large models (numbers above).

## Next: Phase 1, in order

1. Intent: live candidates under the pointer (worker round trip per frame, latest wins), Tab
   alternatives, holds (Space / resting finger), stroke creasing, Huzita–Justin axioms 1–5 and 7.
2. Kernel: hinge moves at partial angles (3D placements, sampled sweep on BVHs), `settle`.
3. Incremental validation with a spatial index; skin bend map in the vertex shader.
4. Inside and outside reverse folds: both gestures, degree-4 kinematics, labels; the section-10
   fixtures as the gate.
5. Recognizer (post-hoc naming) and steps (cleanup, captions, hands), .fold frames per step.
