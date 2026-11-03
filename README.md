# Paperfold

Fold origami in realistic 3D with your own hands, in the browser. Every fold is checked against
real paper by an exact origami kernel; the paper looks and moves like paper.

**Status: Phase 0 (plan and spikes).** See [docs/PHASE-0.md](docs/PHASE-0.md) for what works.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit and property tests
pnpm typecheck
pnpm e2e        # Playwright smoke tests
```

Drag a corner to where it should land. Shift takes every layer. Double-click (or C) creases the
fold. F turns the model over, Q and E rotate it, Cmd/Ctrl+Z undoes. Drag the table to orbit. The
**Bend lab** tab is the paper-realism playground: bend a stack, then run the pointer along the fold
to crease just that part.

## Layout

```
packages/kernel   headless origami kernel: geometry, crease pattern, folded state, layer order,
                  moves, validation, history, FOLD I/O (pure TS, deterministic)
packages/intent   pointer input to candidate moves (point-to-point folds, snapping)
packages/skin     soft, thick, two-sided paper geometry from the kernel's state (pure math)
packages/render   three.js / React Three Fiber: paper material, studio, overlays
apps/web          the app: worker host, store, fold view, bend lab, UI, strings.en.ts
docs/             PLAN, ARCHITECTURE, DECISIONS (ADRs), PHASE-0 notes
```

## Docs

- [Plan](docs/PLAN.md): one page, phases, decisions, where the brief pulls against itself
- [Architecture](docs/ARCHITECTURE.md): modules, data model, algorithms, risks
- [Decisions](docs/DECISIONS.md): short ADRs
- [Phase 0 notes](docs/PHASE-0.md): what works, what doesn't, measurements, what's next

## References

FOLD format (Demaine, Ku, Lang); Akitaya, Demaine and Ku, *Computing Flat-Folded States*;
Bern and Hayes, *The Complexity of Flat Origami*; Ghassaei et al., *Origami Simulator*;
Tachi, *Simulation of Rigid Origami*; Lang, *Origami Design Secrets*; the Huzita–Justin axioms,
Maekawa's and Kawasaki's theorems, the Yoshizawa–Randlett diagramming system.
