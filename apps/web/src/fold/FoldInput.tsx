import {
  classifyStroke,
  type FoldedEdge,
  foldedEdges,
  precreaseLines,
  type SnapContext,
  snapContext,
  type SnapPoint,
  snapFold,
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
const DECIDE_PX = 8;
const NEAR_EDGE_PX = 10;
const GRAB_MARGIN_PX = 6;

interface Gesture {
  readonly pointerId: number;
  readonly pointerType: string;
  /** The press point on the paper (table plane). */
  readonly start: Vec2;
  readonly startedAt: number;
  stage: 'pending' | 'grab' | 'crease' | 'push';
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
  // Push
  push: { line: Line2; seed: Vec2; edge: FoldedEdge } | null;
}

/**
 * Pointer input for folding (brief, section 5). Input never moves the paper: intent proposes
 * candidates, the kernel validates them in the worker, the skin shows the chosen one live
 * under the pointer, and letting go commits it.
 *
 * - Press on the paper; the first few millimetres decide: along a fold creases it, pushing a
 *   folded edge in beside a precrease makes an inside reverse fold, anything else grabs.
 * - Grab: the point-to-point fold line snaps (Huzita–Justin), the flap lifts and follows the
 *   pointer, tilting more when you move fast. Shift takes every layer; Tab cycles the other
 *   ways to read the drag; Ctrl/Cmd is freehand; Esc cancels.
 * - Impossible: the paper resists (rubber band and a slight tremble), the blocking layer
 *   glows, and on a second try one hint appears by the pointer.
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
    let cache: { ctx: SnapContext; edges: FoldedEdge[]; precreases: Line2[] } | null = null;
    const contextFor = (snap: Snapshot) => {
      if (snap !== cachedFor || !cache) {
        cachedFor = snap;
        cache = { ctx: snapContext(snap), edges: foldedEdges(snap), precreases: precreaseLines(snap) };
      }
      return cache;
    };

    let g: Gesture | null = null;
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
      if (gg.stage === 'push' && gg.push) {
        return { line: gg.push.line, seed: gg.push.seed, holds, allLayers: true, index: 0, only: ['inside-reverse'] };
      }
      if (!gg.line) return null;
      const preferred = st().preferred;
      return {
        line: { p: gg.line.p, d: gg.line.d },
        seed: gg.start,
        holds,
        allLayers: gg.shift,
        index: gg.tab,
        ...(preferred ? { preferred } : {}),
      };
    };

    /** Push the gesture's state to the store for the paper, the ghost and the chip. */
    const publish = () => {
      if (!g || (g.stage !== 'grab' && g.stage !== 'push')) return;
      const r = g.result;
      const resisting = r !== null && r.preview === null;
      st().set({
        drag: {
          preview: r?.preview ?? (resisting ? g.lastValid : null),
          theta: g.theta,
          resisting,
          candidates: r?.candidates ?? [],
          selected: r?.selected ?? 0,
          line: g.stage === 'push' ? (g.push?.line ?? null) : g.line,
          marks: g.marks,
          pointer: g.screen,
        },
      });
    };

    const cancel = () => {
      g = null;
      pending = null;
      el.style.cursor = '';
      st().set({ drag: null, creaseOverlay: null, glow: new Set() });
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
      g = {
        pointerId: ev.pointerId,
        pointerType: ev.pointerType,
        start: p,
        startedAt: now,
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
        push: null,
      };
      el.style.cursor = 'grabbing';
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
      const { ctx, edges, precreases } = contextFor(snap);
      const px = mmPerPx();

      if (g.stage === 'pending') {
        const intent = classifyStroke(g.start, p, { edges, precreases }, { decideMm: DECIDE_PX * px, nearMm: NEAR_EDGE_PX * px });
        if (intent.kind === 'pending') return;
        if (intent.kind === 'crease') {
          g.stage = 'crease';
          g.edge = intent.edge;
          const u0 = along(intent.edge.line, g.start);
          g.lo = u0;
          g.hi = u0;
        } else if (intent.kind === 'push') {
          g.stage = 'push';
          g.push = { line: intent.line, seed: intent.seed, edge: intent.edge };
          const q = queryFor(g);
          if (q) void runExplore(q);
        } else {
          g.stage = 'grab';
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

      if (g.stage === 'push' && g.push) {
        const depth = (p[0] - g.start[0]) * g.push.edge.inward[0] + (p[1] - g.start[1]) * g.push.edge.inward[1];
        g.theta = Math.max(0, Math.min(1, depth / 12)) * Math.PI;
        publish();
        return;
      }

      if (g.stage === 'grab') {
        const snapped = snapFold(g.start, p, ctx, { radiusMm: (g.pointerType === 'touch' ? SNAP_TOUCH_PX : SNAP_PX) * px, freehand: g.freehand });
        if (!snapped) {
          g.line = null;
          s.set({ drag: null });
          return;
        }
        g.line = snapped.line;
        g.grab = snapped.grab;
        g.marks = snapped.marks;
        // How far the fold has turned: where the grabbed point is now, relative to the line.
        const x0 = signedDistance(snapped.line, snapped.grab);
        const x = signedDistance(snapped.line, p);
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
      const turned = gg.stage === 'push' ? gg.theta > Math.PI * 0.45 : gg.geo > Math.PI / 2;
      if (result?.preview && turned) {
        const kind = result.candidates[result.selected]?.kind;
        if (gg.tab > 0 && kind) st().set({ preferred: kind });
        await commitMove(result.preview.move, at, { grab: gg.start, holds }, dragTheta);
        st().set({ drag: null });
      } else {
        st().set({ drag: null });
        if (result?.refusal && turned) refused(result.refusal, at);
        else st().set({ glow: new Set() });
      }
    };

    const hover = (ev: PointerEvent) => {
      const snap = st().view?.snapshot;
      const raw = snap ? toPlane(ev) : null;
      const p = snap && raw ? grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx()) : null;
      el.style.cursor = p ? (holdKey ? 'crosshair' : 'grab') : '';
      if (p && snap) {
        const n = layersAt(snap, p);
        el.title = n > 1 ? `${strings.layersBadge(n)} · ${ev.shiftKey ? strings.allLayers : strings.topLayer}` : '';
      } else el.title = '';
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
        g.tab += 1;
        const q = queryFor(g);
        if (q) void runExplore(q);
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
    };
  }, [gl, camera, topHeight]);

  return null;
}

function along(l: Line2, p: Vec2): number {
  return (p[0] - l.p[0]) * l.d[0] + (p[1] - l.p[1]) * l.d[1];
}
