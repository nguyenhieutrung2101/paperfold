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

Hover a corner to see which layers you'd pick up, then drag it to where it should land; the paper
bends under the pointer, and common folds (in half, to the center, edge to a crease) snap from well
away, with faint dots showing where they land. Push a folded edge in to tuck the tip inside (inside reverse fold), pull it
out to wrap it around (outside), or run along it to crease it. While the button is down, scroll (or
Tab, 1–9) to pick how many layers or another way to fold; small pictures by the pointer show the
choices. Shift takes every layer, Ctrl/Cmd folds freehand, double-click or C creases the whole fold.
Hold Space and press to pin the paper. F turns the model over, Q and E rotate it, Cmd/Ctrl+Z undoes, K folds with the
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
