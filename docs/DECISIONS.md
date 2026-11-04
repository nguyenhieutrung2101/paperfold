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

Unit tests per module; fast-check property tests (fixed seed by default since Phase 1, so the suite
is reproducible; `PROPERTY_SEED` varies it) over random move sequences whose fold lines are
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

---

Phase 1

## ADR-021 · Incremental validation, scoped to what a move changed

**Chose** `checkInvariants(state, { changed })`: after a move, only pairs and triples that touch a
changed face are checked (connectivity, consistency, layer order, taco–taco, taco–tortilla,
tortilla–tortilla, transitivity from the smallest changed face, flat vertices). It is sound because the
previous state was valid and untouched pairs can't have broken. **Full validation** still runs in every
test, after every move of the gate fixtures, and on every .fold import (files are untrusted; a tampered
file is refused as `invalid`). Kawasaki's tolerance scales with the vertex's conditioning.

## ADR-022 · Numeric pair keys for layer order

**Chose** `PairKey = min · 2²¹ + max` (a safe integer for up to two million faces) instead of `"f,g"`
strings: no string building on the hot path, and keys sort numerically. FOLD files store rows
`[f, g, s]`; the old `"f,g"` form still loads.

## ADR-023 · One half-turn core for plain and reverse folds

**Chose** `moves/foldCore.ts`: `prepareHalfTurn` (orient the line, take the stack at the seed, flood the
moving set, check joined and held faces) and `applyHalfTurn` (split, turn placements by π about the
line, apply an order rule per changed pair, derive crease angles, re-derive placements, scoped
validation). A plain fold and a reverse fold differ only in which faces move and the order rule, so
every guarantee (slivers refused, fail-closed validation, exact transitions) holds for both.

## ADR-024 · Reverse-fold layer rules

The seed's stack is split at the innermost adjacent pair of faces that meet along the spine (the folded
edge the line crosses) into a top side T and a bottom side B. Among moving faces, pairs on the same
side flip, pairs across sides keep their order. Moving against stationary: **inside**, the tip goes
under T's flap layers and over B's; **outside**, T's tip goes over the flap and B's under it. Whatever
was above the flap stays above the tip, whatever was below stays below. A stationary layer caught in
the gap between the two sides makes the move `unsupported`; invariant failures are `blocked`. The line
must cross the spine at one point P; the tip is the part beyond the line. **Consequence:** for a given
line exactly one of inside/outside is possible (inside within 90° of the tip's spine, outside past it).
The kernel refuses the other with the layer that would pass through a fold, and the UI only offers
what is possible.

## ADR-025 · Recognition is post-hoc and conservative

**Chose** to name a move from the result, not from the gesture: diff the crease patterns (created,
refolded, unfolded, flipped creases), then read the degree-4 vertex at P. Both new creases with the
spine's sign → inside reverse, opposite → outside. Valley and mountain come from the layer order of
mover against stayer; a whole-model rigid motion is a turn-over or rotate. Confidence below 0.5 shows
plain "Fold". Names come from the kernel state, so a precreased push and a direct swing get the same
name, and so do steps replayed from a file.

## ADR-026 · Folded-state equivalence

**Chose** `sameFoldedState(a, b)`: faces matched by material centroid (face ids differ between
histories), then placements and pairwise layer order compared within `tolMm`, optionally up to a rigid
motion of the whole model. The gate and the steps' replay check both use it.

## ADR-027 · Build steps: captions as data, verified by replay

**Chose** to keep every caption, symbol and hand plan as data (`{ kind: 'fold', from: { v, h, what },
dir, to }`); only `strings.en.ts` turns them into words. Positions are described against the model's
outline in the current view (top/middle/bottom, left/center/right; corner, edge or point). Cleanup:
a fold and its crease are one step, fold-then-unfold is a precrease, cancelling turn-overs are dropped.
**Verified** by replaying the steps' moves from a fresh sheet and comparing with `sameFoldedState`. If
that fails, fall back to one step per move and tell the user.

## ADR-028 · Live drag: explore every candidate in the worker, latest wins

**Chose** to send the pointer's snapped line to the worker on every move. The worker builds every
candidate (top layer, 2–3 layers, all layers, inside and outside reverse), validates each with the
real kernel, caches the results per line, and returns them in Tab order. The selected candidate's
after-state and exact transition come back too. The main thread keeps only the latest request.
The skin draws the after-state at θ = min(acos(x/x₀), π − tilt(speed)). **Rejected** validating only
the shown candidate: Tab would then stall on a round trip, and the chip couldn't know which
alternatives exist.

## ADR-029 · Candidate order and Tab (superseded by ADR-037)

**Chose**: on a closed flap where a reverse fold is valid, a swing of the tip means [inside reverse,
outside reverse, all layers, top layer, k layers]. Otherwise top layer first, or all layers with Shift.
Invalid candidates drop out; if none is valid, the first stays so its refusal can be shown and
explained. The last kind picked leads the next time it is valid.

## ADR-030 · Gestures: the first 8 px decide (refined by ADR-037)

**Chose** to read a stroke's first 8 px. Along a folded edge (within 10 px of it) → crease stroke:
sharpness only where the finger passes. Across a folded edge inward near a precrease → push: an
inside reverse fold along the precrease. Anything else → grab: point-to-point folding. With Space
down, a press released before it moves pins the paper and a press that moves folds around the pins
(a mouse user's left hand holds while the right folds); letting go of Space lifts them. On touch a
resting finger holds while another folds.

## ADR-031 · Snapping: one test for every rule

**Chose** to generate candidate lines from the Huzita–Justin axioms 1–5 and 7 over landmarks and lines
near the pointer, plus existing creases and a soft 22.5° angle. Each candidate is accepted only if it
puts the grabbed point within the snap radius of the pointer. Among those, the simplest rule wins:
crease, A2, A1, A5, A4, A3, A7, angle. Radius 16 px for a mouse, 26 px for touch. The pointer ray
meets the **resting** stack's top, never a soft fold's loft: aiming at a corner lands on the corner.

## ADR-032 · Refusals and hints

**Chose** (brief, section 5): the first refusal is silent apart from the paper resisting and the
blocking layers glowing. A second refusal for the same reason within 30 s adds one short hint by the
pointer. When another reading of the drag is possible (more layers, a reverse fold) it is offered
instead of a refusal: the chip says "Fold both layers" rather than refusing `joined`.

## ADR-033 · Reverse-fold motion in the skin (approximation; superseded by ADR-039)

**Chose** to animate the kernel's exact half-turn for the tip while the flap's top side swings open
rigidly about the spine, up to 95° (`reverseOpening(k) = 95°·sin(πk)`), and closes again. For outside
reverse folds the bottom side's tip swings under. The tip turns on a **sharp hinge**: a soft loop
would land 2·ρ proud of its layer and poke through the flap closing over it. **Labeled** in code. Real
paper opens a little and flexes the tip through; Phase 2 adds degree-4 kinematics with bending and
per-region heights for the bulge.

## ADR-034 · Steps player choreography

**Chose** fixed beats per step (hands in, the move, a pause, the crease, unfold for precreases, hands
out) over 3.2 s at 1×. Hands are procedural, semi-transparent capsules posed per hand plan (pinch,
hold, push, nail) whose working fingertip sits exactly on the skin's point for the gripped material.
Each hand is drawn as one even veil (a depth pass, then color only at the nearest surface, so
overlapping fingers don't stack into solid gray) at 0.8 of real size. A hand whose body would lie
over the fold line fades to 30 % (brief: hands never cover the fold line). A slow frame slows the
film rather than skipping beats.

## ADR-035 · Partial-angle hinge moves deferred to Phase 2

**Chose** to keep the kernel flat-only through Phase 1 and spend the time on the gate (reverse folds,
recognition, steps) and on the feel of the live drag. A committed partial angle needs non-flat
placements, a swept-volume collision check and a `settle` move. Doing that half-way would weaken the
kernel's guarantees. During a drag the skin shows any angle; letting go lands flat. **This is the one
Phase 1 item not delivered.**

## ADR-036 · Development hooks

**Chose** to expose `window.__paperfold` (kernel client, store, `toScreen` and `toPlane`) in development
builds only (`import.meta.env.DEV`), so Playwright tests aim at real landmarks in millimetres instead of
hard-coded pixels. Production builds don't include it.

---

Phase 1 polish

## ADR-037 · Where you press says what you mean

**Problem.** A mouse can't feel how many layers it's holding or whether it's pinching a corner or
pushing an edge. Guessing from the drag alone misread common moves: a closed flap's corner led with
"inside reverse fold", and dragging one end of a folded edge onto the other (the classic second fold)
was read as a crease stroke.

**Chose** press zones (`intent/surface.ts`):

- **Corners**, found from the visible paper's outline (silhouette corners and the corners of flaps
  lying on top, never where an unfolded crease meets an edge), always win: a press there is a pinch.
- **Visible folded edges** are next: along one creases it, across it pushes (inside reverse fold) or
  pulls (outside). A crease stroke that strays more than about 15 px off its edge becomes a push or
  pull, because an outside reverse fold's pull starts almost along the edge.
- **Everywhere else on the paper** is a pick-up.

A pick-up leads with a plain fold of the layers you picked (then more, then fewer; reverse folds
last). A push leads with its reverse fold, then every layer. **Deviation from the brief:** its fixed
Tab order (inside, outside, both, top) becomes the order *after* the zone's first guess.

**Pushes need no precrease.** The pressed point of the edge goes where the pointer is, so the line
is the one taking one to the other (snapped like any fold, without moving the pressed point to a
landmark). Beside a precrease, the push follows the precrease and only its depth matters (the old
behavior).

## ADR-038 · See it before you press, change it while you hold

- **Hover:** a corner's layers curl up about 50°. That's a real kernel fold of the corner shown
  part-way, so a corner that can't move alone (joined) visibly takes the layers it must. A badge says
  "Top layer", "2 layers" or "Both layers". A folded edge glows and says "Push in: tuck the tip
  inside". The badge and the strip sit on the side of the pointer away from the model.
- **While the button is down, the scroll wheel picks:** before moving, how many layers; during the
  drag, which of the valid folds. It never zooms then; otherwise it zooms as before. Tab, Shift+Tab
  and 1–9 do the same. On touch a second finger taps the strip. A pen's barrel button steps forward.
- **The strip:** up to nine small pictures of the valid folds, the shown one highlighted, its name
  underneath.
- **Memory:** the choice made for a kind of press (corner, folded edge, paper) leads next time it's
  valid.
- **Kernel:** a crease that changes nothing is refused (`unchanged`), so it can't add an empty
  timeline step. Recognition calls any sharpening a crease, not just one that raises the fold's
  sharpest point.

## ADR-039 · Reverse folds move rigidly, without tearing

**Problem.** The Phase 1 motion opened the flap's top side rigidly about the spine while the tip
swung about its own hinge. The tip is attached to that side along the reverse-fold line, so the two
pulled apart mid-motion (up to about 70 mm on a 150 mm sheet). The strips that join every crease
stretched across the gap into a visible tube. It was worse when a folded-back flap was attached to
the opening side. The landed state was right, which is why the Phase 1 checks (at rest) missed it.

**Chose** (`skin/src/reverse.ts`) the true rigid motion where it exists, a one-piece swing where it
doesn't:

- **The degree-4 motion.** The vertex at P has four creases: the body's spine, the tip's spine and
  the reverse-fold line on each side. Its rigid motion from "tip outside" to "tip reversed" passes
  through the unfolded state. So the flap's top side (its layers, the tip layers on it, and
  everything joined to them) first swings open flat about the spine. Then it closes while each tip
  layer turns about its own hinge, solved in closed form: the tip's spine lies at the sector angle α
  from both hinges, on the intersection of two cones. The inside branch goes up into the opening.
  The outside branch wraps under, so the model rises just enough to keep the tip off the table.
- **The swing.** When the top side can't open, because it's joined to the bottom side elsewhere or
  something of the bottom side lies over it (a corner folded over both layers), both tip layers swing
  over as one piece and tuck in as they land. APPROXIMATION: real paper opens locally and flexes;
  bending is Phase 2.

**Tested** on every reverse-fold fixture (inside and outside, nested, precreased, and a corner folded
over both layers): every crease stays joined within the layer gaps at 47 points of the motion, and
the landing matches the static frame exactly.
