# Paperfold

Fold origami in realistic 3D with your own hands, in the browser. Every fold is checked against
real paper by an exact origami kernel; the paper looks and moves like paper.

**Status: Phase 1 (an MVP that feels right).** See [docs/PHASE-1.md](docs/PHASE-1.md) for what works,
what's approximated and what's next.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit and property tests
pnpm typecheck
pnpm e2e        # Playwright smoke tests
```

Drag a corner to where it should land; the paper bends under the pointer and a chip names the move.
Tab tries another way (top layer, every layer, inside or outside reverse fold), Shift takes every
layer, Ctrl/Cmd folds freehand. Run a finger along a fold to crease it (double-click or C creases the
whole fold). Hold Space and press to pin the paper. Push a folded edge in beside a precrease for an
inside reverse fold. F turns the model over, Q and E rotate it, Cmd/Ctrl+Z undoes, K folds with the
keyboard. Drag the table to orbit. **Steps** plays your design back as build steps with hands,
symbols and captions. The **Bend lab** is the paper-realism playground.

## Layout

```
packages/kernel   headless origami kernel: geometry, crease pattern, folded state, layer order,
                  moves, validation, history, FOLD I/O (pure TS, deterministic)
packages/intent   pointer input to candidate moves (Huzita–Justin snapping, Tab alternatives,
                  crease strokes, push gestures)
packages/skin     soft, thick, two-sided paper geometry from the kernel's state (pure math)
packages/render   three.js / React Three Fiber: paper material, studio, overlays, hands
packages/steps    build steps from the op log: names, captions as data, symbols, hands, replay check
apps/web          the app: worker host, store, fold view, steps player, bend lab, UI, strings.en.ts
docs/             PLAN, ARCHITECTURE, DECISIONS (ADRs), PHASE-0 and PHASE-1 notes
```

## Docs

- [Plan](docs/PLAN.md): one page, phases, decisions, where the brief pulls against itself
- [Architecture](docs/ARCHITECTURE.md): modules, data model, algorithms, risks
- [Decisions](docs/DECISIONS.md): short ADRs
- [Phase 1 notes](docs/PHASE-1.md): the gate, what works, what doesn't, measurements, what's next
- [Phase 0 notes](docs/PHASE-0.md)

## References

FOLD format (Demaine, Ku, Lang); Akitaya, Demaine and Ku, *Computing Flat-Folded States*;
Bern and Hayes, *The Complexity of Flat Origami*; Ghassaei et al., *Origami Simulator*;
Tachi, *Simulation of Rigid Origami*; Lang, *Origami Design Secrets*; the Huzita–Justin axioms,
Maekawa's and Kawasaki's theorems, the Yoshizawa–Randlett diagramming system.
