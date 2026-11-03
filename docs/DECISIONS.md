# Decisions

Short ADRs. Each says what we chose, why, and what it costs. Newest last.

## ADR-001 · Monorepo with pnpm workspaces

**Chose** `packages/{kernel,intent,skin,render}` and `apps/web`, with the brief's boundaries.
Packages export their TypeScript sources directly (`"exports": "./src/index.ts"`); Vite and Vitest
compile them, so there's no per-package build step. `recognize` and `steps` join in Phase 1.
**Cost:** consumers must be TS-aware bundlers, which is all we have.

## ADR-002 · TypeScript 7, strict, erasable syntax only

**Chose** TS 7.0 (native compiler) with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `erasableSyntaxOnly`, so every file also runs under Node's type
stripping (handy for debugging scripts). No `any`. Kernel `src/` compiles with `types: []`, so it
can't touch DOM or Node globals; tests have their own tsconfig.

## ADR-003 · Phase 0 kernel states are flat

**Chose** to commit only flat-folded states (every fold angle 0 or ±180°). Partial angles need
hinge moves and a constrained solver, which are Phase 1 work. **But** placements are stored as 3D
rigid transforms from day one, and fold angles are signed degrees, so nothing gets rewritten.

## ADR-004 · Layer order as pairwise relations, updated locally, verified always

**Chose** FOLD-style `faceOrders` semantics (only overlapping pairs) stored as a map from face pair
to ±1 with a **world-up** reference instead of FOLD's "relative to g's normal". World-up makes
turn-over a sign flip and keeps moves simple; `io/fold.ts` converts. Moves rewrite only the pairs
they touch; every commit is then checked against the facewise constraints (taco–taco,
taco–tortilla, tortilla–tortilla, transitivity). **Cost:** O(F³) worst-case validation (see risks).

## ADR-005 · Two tolerance bands; slivers are refused

**Chose** a weld band of 1e-9 × sheet size and a length band of 1e-6 × sheet size, plus exact
`orient2d` outside the bands. A fold line passing between the bands near a vertex would cut a
sliver thinner than anything we can reason about, so the fold is refused as `degenerate`.
**Why:** one band (1e-6) let welded vertices tilt short creases enough to swing faces out of place
by more than the tolerance; the property tests caught it.

## ADR-006 · Crease pattern as vertex cycles plus an edge index

**Chose** faces as CCW vertex cycles and a `"min,max" → edge` index instead of pointer-linked
half-edge records. It is a half-edge structure in substance (each consecutive vertex pair is a
half-edge; the index finds its twin), but immutable maps share structure and serialize trivially.
Adjacency is derived and cached per crease pattern.

## ADR-007 · FOLD files carry an exact kernel state

**Chose** standard FOLD 1.2 fields (crease pattern frame with remembered M/V, a folded-form frame
with world coordinates, current assignments, fold angles and `faceOrders` in FOLD's convention)
plus a namespaced `paperfold:state` with the exact kernel state, so export → import round-trips
bit for bit and behaves identically afterwards. Plain FOLD crease patterns from other tools import
in Phase 3 (collapse).

## ADR-008 · Placements are re-derived along a maximum spanning tree

**Chose** to re-derive every placement after each fold from the root face across the crease graph,
choosing the **longest** creases first (Prim, ties by id). Short creases define rotation axes
poorly; long ones don't. Off-tree creases are loop-closure checks.

## ADR-009 · Selection and direction

**Chose** layers counted from the top at the grab point (top, k, or all), and direction (valley up
and over, mountain down and under) as a separate parameter. If the flood fill reaches layers under
the grab that weren't picked up, the move is refused as `joined` with a suggested layer count; the
Tab alternatives in Phase 1 turn that into "fold both layers".

## ADR-010 · Skin geometry model

**Chose** one mid-surface per face at its stack height (longest chain below × gap), raw-edge walls
for visible thickness, Bézier fillets wherever a crease's two faces don't meet, and a developable
cylinder for the soft part of a fold in motion. The thickness part of each bend is a fillet that
adds about π·r of paper. **Labeled approximation**, removed by Phase 2 creep accounting.

## ADR-011 · Partial creases pin the flap at the sharpest section

**Chose**, when sharpness varies along a fold, to place the rigid flap by the sharpest section and
let softer sections puff into a bigger loop that blends back within ~12 mm. Per-section radii alone
made the flap shear into steps. **Labeled** non-developable in the blend zone.

## ADR-012 · Rendering

**Chose** `MeshPhysicalMaterial` patched with `onBeforeCompile` (front/back color, back-light
transmission, glow) over a custom `ShaderMaterial`, to keep three's lights, shadows, environment
and tone mapping. Procedural fiber textures (no assets). Neutral tone mapping. Constant shadow depth
bias, because double-sided paper flips normals and breaks normal-offset bias. WebGL2 through
three's renderer abstraction, so a WebGPU renderer can come later.

## ADR-013 · Kernel in a Web Worker via Comlink; the UI sees snapshots

**Chose** a `KernelHost` that owns the history inside the worker. The UI sends moves and receives
`Snapshot`s (plain data) and `Transition`s. The UI can't mutate kernel state even by accident.

## ADR-014 · Name: Paperfold

**Chose** Paperfold to match the repository (the brief's "Foldwell" was a working title). The name
lives in `strings.en.ts` and the package scope `@paperfold/*`.

## ADR-015 · Placeholder paper physics

**Chose** hand-tuned curves in `kernel/src/paper/physics.ts`: springback 4° + 14°·stiffness for an
uncreased fold (a flap on the table is held down by its weight), crease memory 2–8°, and a sharpness
cap that falls off past 8 stacked layers. Presets use plausible, unmeasured thickness and stiffness.
**Labeled** as placeholders; Phase 2 tunes them with real sheets.

## ADR-016 · Determinism and hashing

**Chose** a two-lane 32-bit hash over the exact IEEE-754 bytes of a canonical state walk (ids
sorted). Signed zeros are canonicalized because JSON (FOLD files, share links) can't carry −0.

## ADR-017 · Orientation sign convention

robust-predicates' README says `orient2d` is positive for counter-clockwise points; the code returns
the opposite. We negate it once in `geometry/predicates.ts` and pin the convention with a test.

## ADR-018 · Test strategy

Unit tests per module; fast-check property tests over random move sequences whose fold lines are
deliberately degenerate (through existing vertices, along existing creases, corner-to-corner
bisectors, 22.5° families) and that assert every invariant, replay determinism, exact undo/redo
and FOLD round-trips; negative tests proving the validator catches broken states; Playwright smoke
tests in headless Chromium (SwiftShader). `PROPERTY_RUNS=3000 pnpm test` for a heavier run.

## ADR-019 · The Bend lab

**Chose** to give Spike B its own view: a candidate fold computed by the kernel, rendered by the
skin at any angle, with stroke creasing that sharpens only where you pass (more passes, slower
strokes and pen pressure sharpen more), springback on release, layer count and thickness controls.
It is the playground for the realism work and the reference for Phase 1's live drag.

## ADR-020 · Phase 0 interaction subset

**Chose** point-to-point dragging with snapping (corners, midpoints, existing creases; Ctrl/Cmd for
freehand), Shift for all layers, ghost preview validated by the kernel, warm refusal with one hint,
double-click or C to crease, F / Shift+F to turn over, Q / E to rotate, Cmd/Ctrl+Z to undo. The
flap doesn't bend under the pointer yet (that's Phase 1's live candidate loop).
