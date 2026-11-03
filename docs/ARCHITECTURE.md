# Architecture

The kernel decides what's possible; everything else reads from it.

```
 mouse · touch · pen
        │
   ┌────▼─────┐  candidates   ┌──────────────────────┐  transition   ┌───────────────┐
   │  intent  ├──────────────►│ kernel (Web Worker)  ├──────────────►│ skin + render ├──► screen
   └──────────┘               │ state · layer order  │               └───────────────┘
                              │ moves · validation   │
                              │ history              │
                              └──────────┬───────────┘
                                         │ op log
                                    ┌────▼─────┐ steps ┌─────────────┐
                                    │  steps   ├──────►│ step player │
                                    └──────────┘       └─────────────┘
```

Input never moves the paper: intent asks the kernel, and the skin only animates what the kernel
validated. Nothing appears as a fold unless the kernel produced it.

## Packages

| Package | Role | Depends on |
| --- | --- | --- |
| `packages/kernel` | Headless origami kernel. Pure TS, no DOM, no three.js, deterministic. `src/` compiles with `types: []`, so it can't reach a browser or Node global by accident. | robust-predicates |
| `packages/intent` | Pointer input to candidate moves: Huzita–Justin snapping (axioms 1–5, 7), every move a drag could mean and their Tab order, crease-stroke and push gestures. | kernel |
| `packages/skin` | Realism: stack heights, soft developable bends, fillets, crease-memory shading, mesh buffers. Pure math, no three.js. | kernel |
| `packages/render` | three.js / React Three Fiber: paper material, fiber textures, studio, overlays. | kernel, skin, three, R3F, drei |
| `packages/steps` | Build steps from the op log: cleanup, names, captions as data, Yoshizawa–Randlett symbols, hand plans, verified by replay. | kernel |
| `apps/web` | React shell, kernel worker host, store, fold view, steps player, bend lab, timeline, strings. | everything |

Kernel folders: `geometry/` (vectors, robust predicates, lines, polygons, rigid transforms,
tolerances), `paper/` (crease pattern, spans, material model), `state/` (folded state, layer order,
flat view, derivations, stack levels, equivalence), `moves/` (half-turn core, fold, reverse fold,
burnish, turn over, rotate), `validate/` (invariants, full or scoped),
`history/` (op log, undo/redo, branches, hashing), `io/` (FOLD), `recognize/` (naming moves after the
fact). Move recognition lives in the kernel because it reads only kernel states.

## Data model

```ts
type Assignment = 'M' | 'V' | 'F' | 'U' | 'B';

interface Paper { outline: Vec2[]; thicknessMm: number; stiffness: number; front: Appearance; back: Appearance }

interface Crease {            // every edge, raw edges included ('B')
  id: EdgeId;
  v: [VertexId, VertexId];    // the face with v0 -> v1 on its CCW boundary is the "left" face
  assignment: Assignment;     // last folded direction: an unfolded crease keeps M/V (memory)
  angleDeg: number;           // + valley, − mountain (FOLD edges_foldAngle); Phase 0: 0 or ±180
  restAngleDeg: number;       // where it relaxes (springback, memory)
  sharpness: Span[];          // piecewise constant 0..1 along the edge
  createdBy: OpId | null;
}

interface CreasePattern {     // material space, mm
  vertices: Map<VertexId, Vec2>;
  creases: Map<EdgeId, Crease>;
  faces: Map<FaceId, { id; verts: VertexId[] }>;   // convex, CCW
  edgeIndex: Map<"min,max", EdgeId>;                // half-edge twins
}

interface FoldedState {
  placements: Map<FaceId, Rigid3>;        // material -> world (3D rotation + translation)
  layerOrder: Map<PairKey, 1 | -1>;       // overlapping pairs, key min·2²¹+max; +1: min above max (+Y)
  holds: Hold[];
}

interface KernelState { paper; cp; folded; next: IdCounters; tol: Tolerance }
```

States are immutable. A move copies only the maps it changes; untouched vertices, creases, faces
and placements are shared by reference, which keeps undo, branches and per-step frames cheap.

**Spaces.** Material space is the flat sheet (mm). World space has the table on the XZ plane and
+Y up. For flat states the kernel works in table-plane coordinates (x, y) with X = x and Z = −y,
which are screen coordinates in the default top view; a material frame with determinant +1 there
has its front facing up.

**Ops** carry the move, the grab and hold grips (face, material point, world point), and before/after
state hashes. The build steps read grips to place the hands.

## Key algorithms

### Fold (moves/fold.ts on moves/foldCore.ts)

Folding the picked-up layers 180° about a line, valley (up and over) or mountain (down and under):

1. **Selection.** Faces whose interior contains the grab point, sorted top to bottom by the
   pairwise layer order. Take the top k, or all.
2. **Classify** every vertex once against the line, by its canonical world position, with the weld
   band (so every face around a vertex agrees).
3. **Moving set = flood fill** from the grabbed faces over every crease that has an endpoint
   strictly on the grabbed side; creases lying on the line are never crossed. All moving pieces
   lie on the grabbed side (a crease shared by faces on both sides would have to lie on the line).
4. **Joined?** If the fill reached layers under the grab that weren't picked up, refuse `joined`
   and suggest how many layers would work.
5. **Sweep check.** A flat 180° turn lifts every moving point off the table plane at once, so in
   the zero-thickness model the moving sheet can only hit a stationary layer that lies over it
   (valley) or under it (mountain) where they overlap on the grabbed side. Any such pair refuses
   `tucked` with that layer as the blocker.
6. **Split** moving faces that straddle the line; each crossed edge gets one new vertex shared by
   both faces on it. Pieces thinner than four length tolerances are refused (`degenerate`).
7. **Placements:** moving faces take a half-turn about the line.
8. **Layer order is rewritten locally:** both stationary — keep; both moving — flip; moving vs
   stationary — moving on top (valley) or underneath (mountain). Flat-foldability from scratch is
   NP-hard (Bern and Hayes 1996); we never solve it, we update and then verify.
9. **Fold angles** are re-derived from geometry and order: faces on opposite sides of a crease are
   at 0°; on the same side, +180° if the right face lies on the left face's front side.
10. **Placements are re-derived** from the crease graph (below), then **every invariant is
    checked**. Any violation refuses the move as `internal` (fail closed); property tests assert
    this never happens from valid input.

The result carries the exact transition: the hinge line, direction, moving faces, every new
face's start placement and parent. The skin animates exactly that.

### Reverse fold (moves/reverse.ts)

1. **Spine.** The folded creases the line touches or crosses whose faces both move: the tip's spine.
   They must all meet the line at one point P. A line that crosses no folded edge is `unsupported`.
2. **Sides.** The stack at the seed is split at the innermost adjacent pair of faces meeting along the
   spine: T (top side) and B (bottom side). Faces are grouped by flooding without crossing folded
   creases on the spine line. Each face is placed above, inside or below the flap.
3. **Half-turn** of the tip about the line (the shared core), with the reverse-fold order rule:
   same-side moving pairs flip, cross-side pairs keep their order. Inside: T's tip goes under T's
   flap layers and over B's. Outside: T's tip over the flap, B's under it. Layers above or below
   the flap stay there. A stationary layer in the gap makes the move `unsupported`.
4. **Validate** (scoped). Whatever fails is `blocked` with the faces that would pass through a fold.
   For a given line only one of inside/outside survives: inside needs the line within 90° of the
   tip's spine, outside past 90°.

The transition adds what the skin needs: the T/B split, the flap's top and bottom faces, and the
spine (P and the direction away from the tip).

### Recognition (recognize/recognize.ts)

Post-hoc. Same faces, same creases, rigid placements → turn over or rotate. Otherwise diff the crease
patterns (created, refolded, unfolded, flipped) and look at the degree-4 vertex at P: two new creases
with the spine's sign make an inside reverse fold, with the opposite sign an outside one. Plain folds
are valley or mountain by the layer order of mover against stayer. Confidence below 0.5 → "Fold".

### Build steps (packages/steps)

1. **Group** the op log: a fold and the burnishes on its line are one step; fold-then-unfold on one
   line is a precrease; turn-overs that cancel are dropped.
2. **Describe** each step from the states before and after it: name (recognizer), caption as data
   (landmarks placed against the model's outline in the view), symbols (fold lines, arrows, push
   arrow, turn-over/rotate), hand plan (folding hand pinches the recorded grab, or the nearest
   corner of the flap; the holding hand is on stationary paper behind the line and outside the
   flap's landing; a fingernail along the crease).
3. **Verify:** replay every step's moves from the initial state; `sameFoldedState` with the design or
   fall back to one step per op.

### Invariants (validate/invariants.ts), checked after every commit

1. **Isometry:** every placement is a proper rotation (RᵀR = I, det = 1).
2. **Connectivity:** both faces of every crease put its endpoints at the same world point.
3. **Consistency:** stored fold angles and assignments match geometry and layer order; stored
   placements match the ones derived from the crease graph.
4. **No penetration** (flat states): every overlapping face pair has an order and no stale ones;
   no 3-cycle among faces sharing a region (transitivity); and the facewise constraints of
   Akitaya, Demaine and Ku (*Computing Flat-Folded States*): taco–taco (folds along the same line
   nest, never interleave), taco–tortilla (no sheet slips inside a fold it crosses), tortilla–
   tortilla (sheets crossing along a line keep their order on both sides).
5. **Legal flat vertices:** Maekawa |M − V| = 2 and Kawasaki (alternating sectors sum to 180°)
   at every interior vertex whose creases are all flat. Kawasaki's tolerance scales with each
   crease's conditioning (weld band ÷ crease length).
6. **Determinism** is a property of the op log: replaying it rebuilds the same state bit for bit
   (history tests).

### Placement derivation (state/derive.ts)

Placements are derived from a root face by walking a **maximum spanning tree by crease length**
(Prim, ties by edge id) and rotating across each crease by its fold angle. Each placement is then
a product of exact per-crease rotations along one tree path, never an ever-growing chain of
moves, and the long creases define the axes (a short crease defines its axis poorly, and any
error there grows with the distance to the far edge of the face). Creases off the tree are the
loop-closure checks.

### Tolerances (geometry/tolerance.ts)

Two bands, relative to sheet size: **weld** (1e-9) — a vertex this close to a fold line is on it
and the cut goes through it; **len** (1e-6) — lengths, widths and gaps at or below this are zero
for positive-measure decisions and validation comparisons. Side-of-line tests use the band first,
then Shewchuk's exact `orient2d` (robust-predicates; its sign is negated, see ADR-017). Polygon
areas are computed relative to a vertex to avoid cancellation on tiny far-off slivers (a real bug
the property tests found).

### Skin (packages/skin)

- **Stack heights:** each face's level is the longest chain of overlapping faces below it; the
  mid-surface sits at (level + ½) · gap. Global cycles (legal in woven states) are broken by face
  id for now.
- **Soft fold in motion** (bend.ts): a moving layer starting at height h0 and ending at h1 wraps a
  cylinder of radius R = |h1 − h0|/2 + ρ around the hinge. Material within ρθ of the line rides the
  arc at unit speed (developable), the rest is rigid; the arc's thickness share is a fillet. Stacked
  layers share the axis, so r_i = r_0 + i·t. Creep falls out: the flap's edge pulls in by ρθ.
  Folds that move the "wrong" way for a wrap (unfolds) turn rigidly about the midway axis.
- **Partial creases:** the sharpest section pins the rigid flap; softer sections puff out into a
  bigger loop that blends back into the flap within ~12 mm (labeled non-developable).
- **Springback and memory:** the kernel stores rest angles (paper/physics.ts); the skin animates
  the fold to the rest angle after landing, and draws unfolded creases with a few degrees of
  memory as tilted normals in a narrow groove, so raking light shows the crease pattern.
- **Fillets:** wherever the two faces of a crease don't meet, a cubic Bézier strip tangent to both
  joins them: the rounded folded edge, the moving hinge, or a ramp between layers.
- **Raw edges** get a wall of the paper's thickness.

### Render (packages/render)

`MeshPhysicalMaterial` patched with `onBeforeCompile`: front/back color by `gl_FrontFacing`, a
back-light transmission term for translucency, and a per-vertex `glow` for blocking layers.
Procedural, tileable fiber normal and albedo maps. Studio: environment from local light formers
(no network), a fairly low key light that rakes across fibers, a grazing back light, contact
shadows, and a cutting mat with a 10 mm grid. Neutral tone mapping. Shadows use a constant depth
bias (double-sided paper breaks normal-offset bias).

### Worker boundary (apps/web/src/kernel)

`KernelHost` lives in a Web Worker (Comlink) and owns the history. The UI thread only receives
`Snapshot`s (plain data) and `Transition`s by structured clone, and sends moves.

## Data flow (Phase 1)

1. **Pointer down** on the paper (6 px grace margin; a grab on an edge is nudged 0.05 mm inside):
   intent records the press. Elsewhere the camera orbits. Space + press adds a hold instead.
2. **The first 8 px decide** (intent/gestures.ts): crease stroke along a folded edge, push across one
   beside a precrease, else a grab.
3. **Grab, pointer move:** intent snaps the point-to-point line (axioms 1–5, 7); the worker's
   `explore` validates every candidate, returns them in Tab order with the selected one's
   after-state and exact transition (latest request wins). The skin draws that after-state at the
   angle the pointer asks for; the ghost shows the fold line, the landing and snap rings; the chip
   names the move. If nothing is valid the paper resists and the blockers glow.
4. **Pointer up:** the worker commits the shown candidate with the grab and holds; the skin lands it
   from the angle on screen and springs back to the kernel's rest angle. A crease stroke burnishes
   only where the finger passed.
5. **Steps:** the worker builds and verifies the steps from the op log and sends plain snapshots
   per step; the player animates them.

## Risks and how I'll handle them

| Risk | Plan |
| --- | --- |
| **Validation cost.** Full validation is O(F²) pairs + O(F³) triples. The brief wants < 30 ms candidates at 500 faces. | Done in Phase 1: scoped validation of pairs/triples touching changed faces (numbers in PHASE-1.md). Next: a grid of face boxes for the overlap pairs; Rust/WASM only if that's not enough. |
| **Skin frame cost** (≈19 ms per moving frame at 64 faces). | Rebuild only moving faces per frame, cache static geometry, move the bend map into a vertex shader (uniforms: line, θ, ρ). |
| **Reverse folds** need a 1-DOF degree-4 motion and bounded elastic bending for multi-layer flaps. | Phase 1 ships exact flat results with an approximate motion (ADR-033). Phase 2: closed-form degree-4 kinematics (Huffman; Tachi) with bending, checked against a numeric loop-closure solve. |
| **3D (non-flat) states** for hinges and shaping. | Placements are already 3D; validation adds a sampled swept-volume test on BVHs (three-mesh-bvh) for non-flat moves. |
| **Woven layer orders** have no global height per face. | Per-region heights from the overlap arrangement (Phase 2). |
| **Creep and thickness accommodation** in static states. | Phase 2 skin solver; the arc model is already developable. |
| **iPad / Safari WebGL quirks**, touch and pen. | Pointer Events throughout; Playwright on WebKit in CI from Phase 1. |
