import {
  type CandidateKind,
  classifyStroke,
  type FoldTarget,
  foldTargets,
  pickTarget,
  type TargetContext,
  targetContext,
  type FoldedEdge,
  foldedEdges,
  precreaseLines,
  type PressZone,
  type PushFold,
  pushFold,
  type SnapContext,
  snapContext,
  type SnapPoint,
  snapFold,
  type Surface,
  surfaceOf,
  zoneAt,
} from '@paperfold/intent';
import { type Line2, perpendicularBisector, signedDistance, type Snapshot, type Vec2 } from '@paperfold/kernel';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { commitMove, creaseActive, creaseStroke, refused } from '../actions.ts';
import { kernel } from '../kernel/client.ts';
import type { DragPreview, DragQuery } from '../kernel/api.ts';
import { reasonHints, strings } from '../strings.en.ts';
import { advanceFirstRun, useStore } from '../store.ts';
import { dragTheta } from './PaperModel.tsx';
import { grabPoint, layersAt } from './plane.ts';

/** Snap radius on screen: a fingertip covers more than a mouse pointer. */
const SNAP_PX = 16;
const SNAP_TOUCH_PX = 26;
/** Common folds (in half, to the center, edge to crease…) pull from about twice as far. */
const TARGET_PX = 44;
const TARGET_TOUCH_PX = 60;
const DECIDE_PX = 8;
const NEAR_EDGE_PX = 10;
/** A crease stroke that strays this far from its edge becomes a push or a pull. */
const LEAVE_EDGE_PX = 15;
/** A press this close to a corner pinches the corner, even on a folded edge. */
const CORNER_PX = 14;
/** Scroll distance per step through the alternatives (a mouse notch is about 100). */
const WHEEL_STEP = 60;
const GRAB_MARGIN_PX = 6;

interface Gesture {
  readonly pointerId: number;
  readonly pointerType: string;
  /** The press point on the paper (table plane). */
  readonly start: Vec2;
  readonly startedAt: number;
  /** Where the press landed: what it can mean depends on it. */
  readonly zone: PressZone;
  stage: 'pending' | 'grab' | 'crease' | 'push';
  /** Layers picked up (the hover's, changed by scrolling before moving). */
  layers: number;
  /** The user stepped through the alternatives (remember what they chose). */
  chose: boolean;
  /** Pen barrel button down last time we looked. */
  barrel: boolean;
  pointer: Vec2;
  screen: { x: number; y: number };
  shift: boolean;
  freehand: boolean;
  tab: number;
  speed: number;
  last: { p: Vec2; t: number };
  /** Grab: the snapped fold line and how far the fold has turned. */
  line: Line2 | null;
  grab: Vec2;
  marks: readonly Vec2[];
  theta: number;
  /** How far the fold has actually turned, before the tilt (decides commit on release). */
  geo: number;
  /** The latest exploration and the last valid preview (for resistance). */
  result: DragPreview | null;
  lastValid: DragPreview['preview'];
  // Crease stroke
  edge: FoldedEdge | null;
  lo: number;
  hi: number;
  value: number;
  /** The common folds for this grab, worked out when the drag starts, and the one held. */
  targets: FoldTarget[] | null;
  target: FoldTarget | null;
  // Push
  pushEdge: FoldedEdge | null;
  push: PushFold | null;
}

/**
 * Pointer input for folding (brief, section 5; Phase 1 polish, plan 1). Input never moves the
 * paper: intent proposes candidates, the kernel validates them in the worker, the skin shows the
 * chosen one live under the pointer, and letting go commits it.
 *
 * - Hover shows what a press would pick up: a corner's layers curl up a little (a real,
 *   validated fold shown part-way) with a badge; a folded edge glows and says it can be pushed.
 * - Where you press decides the kind of move. A corner (always, even on a folded edge) or the
 *   paper: pick it up and fold it over, point to point, snapped by Huzita–Justin. A folded
 *   edge: along it creases; across it pushes (inside reverse fold) or pulls (outside); a crease
 *   stroke that strays off the edge becomes a push or pull.
 * - While the button is down, scroll (or Tab, 1–9, a tap on the strip, a pen's barrel) steps
 *   through what else the press or drag could mean: before moving, how many layers; during the
 *   drag, every valid fold. The last choice per kind of press leads next time.
 * - Shift takes every layer; Ctrl/Cmd is freehand; Esc cancels.
 * - Impossible: the paper resists (rubber band and a slight tremble), the blocking layer glows,
 *   and on a second try one hint appears by the pointer.
 * - With Space down, a press that doesn't move pins the paper (a press that moves still folds,
 *   around the pins); on touch, a resting finger holds. Letting go of Space lifts the pins.
 * - K folds with the keyboard: pick a landmark, pick a target, Enter.
 */
export function FoldInput({ topHeight }: { readonly topHeight: React.RefObject<number> }) {
  const { gl, camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as {
    object: { position: { set(x: number, y: number, z: number): void } };
    target: { set(x: number, y: number, z: number): void };
    update(): void;
  } | null;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const st = () => useStore.getState();

    const toPlane = (ev: { clientX: number; clientY: number }): Vec2 | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const plane = new Plane(new Vector3(0, 1, 0), -(topHeight.current ?? 0));
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return [hit.x, -hit.z];
    };
    const mmPerPx = () => {
      const dist = camera.position.length();
      const fov = 'fov' in camera ? ((camera as unknown as { fov: number }).fov * Math.PI) / 180 : 0.6;
      return (2 * dist * Math.tan(fov / 2)) / Math.max(1, sizeRef.current.height);
    };

    // What snapping and gestures need from the current state, computed once per snapshot.
    let cachedFor: Snapshot | null = null;
    let cache: { ctx: SnapContext; edges: FoldedEdge[]; precreases: Line2[]; surface: Surface; targets: TargetContext } | null = null;
    const contextFor = (snap: Snapshot) => {
      if (snap !== cachedFor || !cache) {
        cachedFor = snap;
        const surface = surfaceOf(snap);
        cache = {
          ctx: snapContext(snap),
          edges: foldedEdges(snap),
          precreases: precreaseLines(snap),
          surface,
          targets: targetContext(snap, surface),
        };
      }
      return cache;
    };
    const zoneOf = (snap: Snapshot, p: Vec2): PressZone => {
      const c = contextFor(snap);
      const px = mmPerPx();
      return zoneAt(p, c.surface, c.edges, { cornerMm: CORNER_PX * px, nearMm: NEAR_EDGE_PX * px });
    };
    const zoneKind = (z: PressZone) => z.kind;
    /** Screen direction from the model's middle to (x, y): labels go that way, off the paper. */
    const awayFrom = (x: number, y: number) => {
      const snap = st().view?.snapshot;
      const corners = snap ? contextFor(snap).surface.corners : [];
      if (corners.length === 0) return { x: 0.7, y: 0.7 };
      let cx = 0;
      let cy = 0;
      for (const c of corners) {
        cx += c[0] / corners.length;
        cy += c[1] / corners.length;
      }
      const r = el.getBoundingClientRect();
      const v = new Vector3(cx, topHeight.current ?? 0, -cy).project(camera);
      const dx = x - (r.left + ((v.x + 1) / 2) * r.width);
      const dy = y - (r.top + ((1 - v.y) / 2) * r.height);
      const l = Math.hypot(dx, dy);
      return l < 1 ? { x: 0.7, y: 0.7 } : { x: dx / l, y: dy / l };
    };

    let g: Gesture | null = null;
    let lastTargetKey: string | null = null;
    let holdKey = false;
    const touchHolds = new Map<number, Vec2>();

    // ---- exploration: the worker validates every candidate; the latest query wins ----
    let latest: Promise<DragPreview | null> = Promise.resolve(null);
    let inFlight = false;
    let pending: DragQuery | null = null;
    const runExplore = (q: DragQuery): Promise<DragPreview | null> => {
      if (inFlight) {
        pending = q;
        return latest;
      }
      inFlight = true;
      latest = kernel()
        .explore(q)
        .then((r) => {
          inFlight = false;
          if (g) applyResult(r);
          const next = pending;
          pending = null;
          return next ? runExplore(next) : r;
        });
      return latest;
    };

    const applyResult = (r: DragPreview) => {
      if (!g) return;
      g.result = r;
      if (r.preview) g.lastValid = r.preview;
      st().set({
        glow: r.preview ? new Set() : new Set(r.refusal?.blockers ?? []),
      });
      publish();
    };

    const queryFor = (gg: Gesture): DragQuery | null => {
      const holds = [...st().holds, ...touchHolds.values()];
      const preferred = st().preferredByZone[zoneKind(gg.zone)];
      if (gg.stage === 'push' && gg.push) {
        // A push leads with its reverse fold (inside when pushed in, outside when pulled
        // out), then folding every layer along the same line.
        const lead: CandidateKind[] = [gg.push.kind === 'inside' ? 'inside-reverse' : 'outside-reverse', 'fold-all'];
        return { line: gg.push.line, seed: gg.push.seed, holds, allLayers: true, index: gg.tab, lead, ...(preferred ? { preferred } : {}) };
      }
      if (!gg.line) return null;
      return {
        line: { p: gg.line.p, d: gg.line.d },
        seed: gg.start,
        holds,
        allLayers: gg.shift,
        index: gg.tab,
        layers: gg.layers,
        ...(preferred ? { preferred } : {}),
      };
    };
    /** The common-fold landings worth showing: the dozen nearest the pointer. */
    const nearTargets = (gg: Gesture): Vec2[] => {
      if (!gg.targets || gg.freehand) return [];
      const seen = new Set<string>();
      const pts: Vec2[] = [];
      for (const t of gg.targets) {
        const k = `${Math.round(t.landing[0] * 10)},${Math.round(t.landing[1] * 10)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pts.push(t.landing);
      }
      return pts
        .map((q) => ({ q, d: Math.hypot(q[0] - gg.pointer[0], q[1] - gg.pointer[1]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 12)
        .map((x) => x.q);
    };
    /** Step to another alternative (scroll, Tab, 1–4, the strip, the pen's barrel). */
    const choose = (index: number) => {
      if (!g || (g.stage !== 'grab' && g.stage !== 'push')) return;
      g.tab = index;
      g.chose = true;
      const q = queryFor(g);
      if (q) void runExplore(q);
    };

    /** Push the gesture's state to the store for the paper, the ghost and the chip. */
    const publish = () => {
      if (!g || (g.stage !== 'grab' && g.stage !== 'push')) return;
      const r = g.result;
      const resisting = r !== null && r.preview === null;
      st().set({
        choose: (i: number) => choose(i),
        hover: null,
        peek: null,
        drag: {
          preview: r?.preview ?? (resisting ? g.lastValid : null),
          theta: g.theta,
          resisting,
          candidates: r?.candidates ?? [],
          selected: r?.selected ?? 0,
          line: g.stage === 'push' ? (g.push?.line ?? null) : g.line,
          marks: g.marks,
          pointer: g.screen,
          away: awayFrom(g.screen.x, g.screen.y),
          targets: g.stage === 'grab' ? nearTargets(g) : [],
          guide: g.target?.guide ?? null,
          snapKind: g.target?.kind ?? null,
        },
      });
    };

    const cancel = () => {
      g = null;
      pending = null;
      el.style.cursor = '';
      st().set({ drag: null, creaseOverlay: null, glow: new Set(), choose: null, peek: null });
    };

    // ---- pointer handlers ----
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const s = st();
      const snap = s.view?.snapshot;
      if (!snap || s.mode !== 'fold') return;
      const raw = toPlane(ev);
      const p = raw && grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx());
      if (!p) return; // the table: let the camera orbit
      ev.stopImmediatePropagation();
      ev.preventDefault();

      // Touch: a finger already resting on the paper becomes a hold when another one lands.
      if (g && ev.pointerType === 'touch' && g.pointerType === 'touch' && g.stage === 'pending') {
        const moved = Math.hypot(g.pointer[0] - g.start[0], g.pointer[1] - g.start[1]);
        if (moved < 3 * mmPerPx() + 1) {
          touchHolds.set(g.pointerId, g.start);
          st().set({ holds: [...st().holds] });
          advanceFirstRun(3);
          g = null;
        }
      }
      if (g) return;
      el.setPointerCapture(ev.pointerId);
      const now = performance.now();
      lastTargetKey = null;
      const zone = zoneOf(snap, p);
      // Pick up what the hover showed (the corner curl's layers), unless it was elsewhere.
      const hv = s.hover;
      const layers = hv && hv.zone === zone.kind ? hv.layers : 1;
      if (hv) s.set({ hover: { ...hv, pressed: true } });
      g = {
        pointerId: ev.pointerId,
        pointerType: ev.pointerType,
        start: p,
        startedAt: now,
        zone,
        layers,
        chose: false,
        barrel: false,
        stage: 'pending',
        pointer: p,
        screen: { x: ev.clientX, y: ev.clientY },
        shift: ev.shiftKey,
        freehand: ev.ctrlKey || ev.metaKey,
        tab: 0,
        speed: 0,
        last: { p, t: now },
        line: null,
        grab: p,
        marks: [],
        theta: 0,
        geo: 0,
        result: null,
        lastValid: null,
        edge: null,
        lo: 0,
        hi: 0,
        value: 0,
        targets: null,
        target: null,
        pushEdge: null,
        push: null,
      };
      el.style.cursor = zone.kind === 'folded-edge' ? 'pointer' : 'grabbing';
    };

    const onMove = (ev: PointerEvent) => {
      const s = st();
      if (!g || ev.pointerId !== g.pointerId) {
        if (!g) hover(ev);
        return;
      }
      const snap = s.view?.snapshot;
      const p = toPlane(ev);
      if (!snap || !p) return;
      const now = performance.now();
      const dt = Math.max(1, now - g.last.t);
      const inst = (Math.hypot(p[0] - g.last.p[0], p[1] - g.last.p[1]) / dt) * 1000; // mm/s
      g.speed = g.speed * 0.75 + inst * 0.25;
      g.last = { p, t: now };
      g.pointer = p;
      g.screen = { x: ev.clientX, y: ev.clientY };
      g.shift = ev.shiftKey;
      g.freehand = ev.ctrlKey || ev.metaKey;
      // A pen's barrel button steps to the next alternative.
      if (ev.pointerType === 'pen') {
        const barrel = (ev.buttons & 2) !== 0;
        if (barrel && !g.barrel) choose(g.tab + 1);
        g.barrel = barrel;
      }
      const { ctx, precreases } = contextFor(snap);
      const px = mmPerPx();
      const snapRadius = (g.pointerType === 'touch' ? SNAP_TOUCH_PX : SNAP_PX) * px;

      if (g.stage === 'pending') {
        // Where the press landed decides: corners and the paper are picked up; on a folded
        // edge, along it creases and across it pushes.
        const intent = classifyStroke(g.start, p, g.zone, { decideMm: DECIDE_PX * px });
        if (intent.kind === 'pending') return;
        s.set({ hover: null });
        if (intent.kind === 'crease') {
          g.stage = 'crease';
          g.edge = intent.edge;
          const u0 = along(intent.edge.line, g.start);
          g.lo = u0;
          g.hi = u0;
          s.set({ peek: null });
        } else if (intent.kind === 'push') {
          g.stage = 'push';
          g.pushEdge = intent.edge;
        } else {
          g.stage = 'grab';
        }
      }

      // A crease stroke runs along the edge. One that leaves it (well off to either side) is a
      // push or a pull: pulling the tip around the outside starts almost along the edge.
      if (g.stage === 'crease' && g.edge) {
        const off = (p[0] - g.edge.a[0]) * g.edge.inward[0] + (p[1] - g.edge.a[1]) * g.edge.inward[1];
        if (Math.abs(off) > LEAVE_EDGE_PX * px) {
          g.stage = 'push';
          g.pushEdge = g.edge;
          s.set({ creaseOverlay: null });
        }
      }

      if (g.stage === 'crease' && g.edge) {
        const u = along(g.edge.line, p);
        g.lo = Math.min(g.lo, u);
        g.hi = Math.max(g.hi, u);
        // More passes, more pressure and slower strokes crease harder.
        const pressure = ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5;
        const slow = Math.max(0.4, Math.min(1.4, 1.4 - g.speed / 250));
        g.value = Math.min(1, g.value + 0.05 * (0.6 + pressure) * slow);
        s.set({ creaseOverlay: { line: g.edge.line, lo: g.lo, hi: g.hi, value: g.value } });
        return;
      }

      if (g.stage === 'push' && g.pushEdge) {
        // The pressed point of the edge goes where the pointer is (or, beside a precrease,
        // the push follows it): a reverse fold, inside when pushed in, outside when pulled out.
        const pf = pushFold(g.start, p, g.pushEdge, { snap: ctx, precreases }, { radiusMm: snapRadius, nearMm: NEAR_EDGE_PX * px, freehand: g.freehand });
        if (!pf) {
          g.push = null;
          s.set({ drag: null });
          return;
        }
        g.push = pf;
        g.marks = pf.marks;
        const tilt = 0.06 + 0.5 * Math.min(1, g.speed / 260);
        g.geo = pf.theta;
        g.theta = pf.precrease ? pf.theta : Math.min(pf.theta, Math.PI - tilt);
        const q = queryFor(g);
        if (q) void runExplore(q);
        publish();
        return;
      }

      if (g.stage === 'grab') {
        const snapped = snapFold(g.start, p, ctx, { radiusMm: snapRadius, freehand: g.freehand });
        if (!snapped) {
          g.line = null;
          s.set({ drag: null });
          return;
        }
        // Refolding along a crease that's already there wins (unfold, refold). Otherwise the
        // common folds pull from well away; then the Huzita–Justin snaps; then freehand.
        let line = snapped.line;
        let marks = snapped.marks;
        g.target = null;
        if (snapped.rule !== 0 && !g.freehand) {
          g.targets ??= foldTargets(snapped.grab, contextFor(snap).targets, { onEdgeMm: snapRadius * 0.6 });
          const targetRadius = (g.pointerType === 'touch' ? TARGET_TOUCH_PX : TARGET_PX) * px;
          const pick = pickTarget(g.targets, p, targetRadius, lastTargetKey);
          if (pick) {
            g.target = pick.target;
            line = pick.target.line;
            marks = [snapped.grab, ...pick.target.marks];
          }
        }
        lastTargetKey = g.target?.key ?? null;
        g.line = line;
        g.grab = snapped.grab;
        g.marks = marks;
        // How far the fold has turned: where the grabbed point is now, relative to the line.
        const x0 = signedDistance(line, snapped.grab);
        const x = signedDistance(line, p);
        const geo = Math.acos(Math.max(-1, Math.min(1, x0 === 0 ? 1 : x / x0)));
        // Lifted as if pinched; more when you move fast, close to flat when you slow down.
        const tilt = 0.06 + 0.5 * Math.min(1, g.speed / 260);
        g.theta = Math.min(geo, Math.PI - tilt);
        g.geo = geo;
        const q = queryFor(g);
        if (q) void runExplore(q);
        publish();
      }
    };

    const finish = async (ev: PointerEvent, commit: boolean) => {
      const tl = touchHolds.get(ev.pointerId);
      if (tl) {
        touchHolds.delete(ev.pointerId);
        st().set({ holds: [...st().holds] });
        return;
      }
      const gg = g;
      if (!gg || ev.pointerId !== gg.pointerId) return;
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      el.style.cursor = '';
      const at = { x: ev.clientX, y: ev.clientY };
      const holds = [...st().holds, ...touchHolds.values()];
      if (!commit) {
        cancel();
        return;
      }
      if (gg.stage === 'crease' && gg.edge) {
        g = null;
        await creaseStroke(gg.edge.line, gg.lo, gg.hi, Math.max(0.15, gg.value), at);
        return;
      }
      if (gg.stage === 'pending') {
        cancel();
        const hv = st().hover;
        if (hv) st().set({ hover: { ...hv, pressed: false } });
        // The second hand: with Space down, a press that doesn't move pins the paper there.
        // A press that moves folds as usual, around the pins (one hand holds, the other folds).
        if (holdKey) {
          st().set({ holds: [...st().holds, gg.start] });
          advanceFirstRun(3);
        }
        return;
      }
      // Wait for the latest exploration so we commit what the user last saw. The live
      // preview stays up until the committed fold takes over, so nothing flashes back.
      const r = await latest;
      const result = gg.result ?? r;
      g = null;
      const turned = gg.stage === 'push' && gg.push?.precrease ? gg.theta > Math.PI * 0.45 : gg.geo > Math.PI / 2;
      st().set({ choose: null });
      if (result?.preview && turned) {
        const kind = result.candidates[result.selected]?.kind;
        // Remember what was chosen for this kind of press: it leads next time.
        if (gg.chose && kind) st().set({ preferredByZone: { ...st().preferredByZone, [zoneKind(gg.zone)]: kind } });
        if (gg.stage === 'push') advanceFirstRun(4);
        const grab = gg.stage === 'push' && gg.push ? gg.push.seed : gg.start;
        await commitMove(result.preview.move, at, { grab, holds }, dragTheta);
        st().set({ drag: null });
      } else {
        st().set({ drag: null });
        if (result?.refusal && turned) refused(result.refusal, at);
        else st().set({ glow: new Set() });
      }
    };

    // ---- hover: show what you'd pick up before you press ----
    let hoverKey = '';
    let hoverLayers = 1;
    let peekKey = '';
    let peekSeq = 0;
    const clearHover = () => {
      hoverKey = '';
      peekKey = '';
      peekSeq++;
      if (st().hover || st().peek) st().set({ hover: null, peek: null });
    };
    /** Ask the worker to lift this corner a little by the layers you'd take. Latest wins. */
    const requestPeek = (corner: Vec2, layers: number) => {
      const key = `${corner[0]},${corner[1]}:${layers}:${st().view?.snapshot.hash ?? ''}`;
      if (key === peekKey) return;
      peekKey = key;
      const seq = ++peekSeq;
      void kernel()
        .peek({ corner, layers })
        .then((r) => {
          if (seq !== peekSeq) return;
          const h = st().hover;
          if (!h || h.zone !== 'corner') return;
          hoverLayers = r.layers;
          if (g && g.stage === 'pending') g.layers = r.layers;
          st().set({
            hover: { ...h, layers: r.layers, min: r.min, total: Math.max(1, r.total) },
            peek: r.preview ? { key, after: r.preview.after, transition: r.preview.transition } : null,
          });
        });
    };
    const hover = (ev: PointerEvent) => {
      const s = st();
      const snap = s.view?.snapshot;
      if (!snap || s.mode !== 'fold' || s.keyboard || s.drag) {
        clearHover();
        return;
      }
      const raw = toPlane(ev);
      const p = raw && grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx());
      if (!p) {
        el.style.cursor = '';
        clearHover();
        return;
      }
      const zone = zoneOf(snap, p);
      el.style.cursor = holdKey ? 'crosshair' : zone.kind === 'folded-edge' ? 'pointer' : 'grab';
      const key = zone.kind === 'corner' ? `c:${zone.point.join(',')}` : zone.kind === 'folded-edge' ? `e:${zone.edge.a.join(',')}:${zone.edge.b.join(',')}` : 'p';
      if (key !== hoverKey) {
        hoverKey = key;
        hoverLayers = 1;
      }
      const screen = { x: ev.clientX, y: ev.clientY };
      const away = awayFrom(screen.x, screen.y);
      if (zone.kind === 'corner') {
        const prev = s.hover;
        const same = prev?.zone === 'corner' && prev.corner?.[0] === zone.point[0] && prev.corner?.[1] === zone.point[1];
        s.set({
          hover: {
            zone: 'corner',
            screen,
            away,
            layers: same ? prev!.layers : hoverLayers,
            min: same ? prev!.min : 1,
            total: same ? prev!.total : layersAt(snap, p),
            corner: zone.point,
            pressed: false,
          },
        });
        requestPeek(zone.point, hoverLayers);
        return;
      }
      peekKey = '';
      peekSeq++;
      const total = layersAt(snap, p);
      s.set({
        peek: null,
        hover:
          zone.kind === 'folded-edge'
            ? { zone: 'folded-edge', screen, away, layers: total, min: total, total, edge: { a: zone.edge.a, b: zone.edge.b }, pressed: false }
            : { zone: 'paper', screen, away, layers: Math.min(hoverLayers, Math.max(1, total)), min: 1, total, pressed: false },
      });
    };

    // ---- scroll while the button is down: change your mind without letting go ----
    let wheelAcc = 0;
    const onWheel = (ev: WheelEvent) => {
      if (!g) return; // not pressed: the camera zooms as usual
      ev.preventDefault();
      ev.stopImmediatePropagation();
      wheelAcc += ev.deltaY;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      const dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      if (g.stage === 'pending') {
        // Before moving: how many layers you take.
        const snap = st().view?.snapshot;
        if (!snap || g.zone.kind === 'folded-edge') return;
        const h = st().hover;
        const total = Math.max(1, h?.total ?? layersAt(snap, g.start));
        const next = Math.max(h?.min ?? 1, Math.min(total, g.layers + dir));
        if (next === g.layers) return;
        g.layers = next;
        hoverLayers = next;
        if (h) st().set({ hover: { ...h, layers: next, pressed: true } });
        if (g.zone.kind === 'corner') requestPeek(g.zone.point, next);
        return;
      }
      if (g.stage === 'grab' || g.stage === 'push') choose(g.tab + dir);
    };

    // ---- keyboard ----
    let kbList: SnapPoint[] = [];
    let kbIndex = 0;
    let kbFrom: Vec2 | null = null;
    const kbText = () => {
      const cur = kbList[kbIndex];
      const what = cur ? (strings.landmarkKinds[cur.kind] ?? cur.kind) : '';
      return kbFrom ? strings.keyboardTo(kbIndex + 1, kbList.length, what) : strings.keyboardFrom(kbIndex + 1, kbList.length, what);
    };
    const kbPublish = () => {
      const cur = kbList[kbIndex];
      if (!cur) return;
      st().set({ keyboard: { stage: kbFrom ? 'to' : 'from', from: kbFrom, current: cur.point, text: kbText() } });
    };
    const kbStart = (snap: Snapshot) => {
      const pts = contextFor(snap).ctx.points;
      const c = pts.reduce((a, p) => [a[0] + p.point[0] / pts.length, a[1] + p.point[1] / pts.length] as Vec2, [0, 0] as Vec2);
      kbList = [...pts].sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === 'corner' ? -1 : 1) ||
          Math.atan2(b.point[1] - c[1], b.point[0] - c[0]) - Math.atan2(a.point[1] - c[1], a.point[0] - c[0]),
      );
      kbIndex = 0;
      kbFrom = null;
      kbPublish();
    };
    const kbCommit = async (allLayers: boolean) => {
      const snap = st().view?.snapshot;
      const to = kbList[kbIndex]?.point;
      if (!snap || !kbFrom || !to) return;
      const from = kbFrom;
      st().set({ keyboard: null });
      kbFrom = null;
      const seed = grabPoint(snap, from, 3);
      if (!seed) return;
      const line = perpendicularBisector(from, to);
      const r = await kernel().explore({ line, seed, holds: [...st().holds], allLayers, index: 0 });
      const at = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      if (r.preview) await commitMove(r.preview.move, at, { grab: seed });
      else if (r.refusal) st().showHint(reasonHints[r.refusal.reason], at.x, at.y);
    };

    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) {
        if (ev.key !== 'Escape') return;
      }
      if (st().mode !== 'fold') return;
      if (ev.type === 'keydown' && ev.key === ' ') {
        holdKey = true;
        ev.preventDefault();
        return;
      }
      if (ev.type === 'keyup' && ev.key === ' ') {
        holdKey = false;
        st().set({ holds: [] });
        return;
      }
      if (ev.type !== 'keydown') {
        if (ev.key === 'Shift' && g && g.stage === 'grab') {
          g.shift = false;
          const q = queryFor(g);
          if (q) void runExplore(q);
        }
        return;
      }
      if (ev.key === 'Escape') {
        if (g) cancel();
        if (st().keyboard) {
          kbFrom = null;
          st().set({ keyboard: null });
        }
        return;
      }
      if (ev.key === 'Tab' && g && (g.stage === 'grab' || g.stage === 'push')) {
        ev.preventDefault();
        choose(g.tab + (ev.shiftKey ? -1 : 1));
        return;
      }
      if (/^[1-9]$/.test(ev.key) && g && (g.stage === 'grab' || g.stage === 'push')) {
        ev.preventDefault();
        choose(Number(ev.key) - 1);
        return;
      }
      if (ev.key === 'Shift' && g && g.stage === 'grab') {
        g.shift = true;
        const q = queryFor(g);
        if (q) void runExplore(q);
        return;
      }
      // Keyboard folding.
      const snap = st().view?.snapshot;
      if (!snap) return;
      if (!st().keyboard && (ev.key === 'k' || ev.key === 'K') && !ev.metaKey && !ev.ctrlKey) {
        kbStart(snap);
        return;
      }
      if (st().keyboard) {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
          kbIndex = (kbIndex + 1) % kbList.length;
          kbPublish();
          ev.preventDefault();
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
          kbIndex = (kbIndex - 1 + kbList.length) % kbList.length;
          kbPublish();
          ev.preventDefault();
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          if (!kbFrom) {
            kbFrom = kbList[kbIndex]!.point;
            kbList = kbList.filter((p) => p.point !== kbFrom);
            kbIndex = 0;
            kbPublish();
          } else void kbCommit(ev.shiftKey);
        }
      }
    };

    const onDouble = (ev: MouseEvent) => {
      const snap = st().view?.snapshot;
      const raw = toPlane(ev);
      if (snap && raw && grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx())) {
        void creaseActive({ x: ev.clientX, y: ev.clientY });
        return;
      }
      // Double-click the table: back to the top view.
      const c = controlsRef.current;
      if (c) {
        c.object.position.set(0, 330, 150);
        c.target.set(0, 0, 0);
        c.update();
      }
    };

    const onUp = (ev: PointerEvent) => void finish(ev, true);
    const onCancel = (ev: PointerEvent) => void finish(ev, false);
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    el.addEventListener('dblclick', onDouble);
    // Capture on the window, so a scroll during a drag never reaches the camera controls.
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    el.addEventListener('pointerleave', clearHover);
    // Development only: table plane <-> screen, so e2e tests can aim at real landmarks.
    const dev = import.meta.env.DEV ? (window as unknown as { __paperfold?: Record<string, unknown> }).__paperfold : undefined;
    if (dev) {
      dev.toScreen = (p: Vec2) => {
        const r = el.getBoundingClientRect();
        const v = new Vector3(p[0], topHeight.current ?? 0, -p[1]).project(camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      };
      dev.toPlane = (x: number, y: number) => toPlane({ clientX: x, clientY: y });
    }
    return () => {
      if (dev) {
        delete dev.toScreen;
        delete dev.toPlane;
      }
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      el.removeEventListener('dblclick', onDouble);
      window.removeEventListener('wheel', onWheel, { capture: true });
      el.removeEventListener('pointerleave', clearHover);
    };
  }, [gl, camera, topHeight]);

  return null;
}

function along(l: Line2, p: Vec2): number {
  return (p[0] - l.p[0]) * l.d[0] + (p[1] - l.p[1]) * l.d[1];
}
