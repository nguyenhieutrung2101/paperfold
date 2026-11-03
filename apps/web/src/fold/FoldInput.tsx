import { creaseLines, type FoldGuess, guessFold, landmarks } from '@paperfold/intent';
import type { FoldParams, Vec2 } from '@paperfold/kernel';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { commitFold, creaseActive } from '../actions.ts';
import { kernel } from '../kernel/client.ts';
import { strings } from '../strings.en.ts';
import { useStore } from '../store.ts';
import { grabPoint, layersAt, onPaper } from './plane.ts';

const SNAP_PX = 12;
const GRAB_MARGIN_PX = 6;

/**
 * Pointer input for folding. Pointer down on the paper grabs it (and keeps the camera
 * still); anywhere else the camera controls get the event. Intent never moves the paper:
 * it proposes a fold, the kernel validates it (ghost preview), and pointer up commits.
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

    interface Drag {
      readonly pointerId: number;
      readonly from: Vec2;
      readonly marks: ReturnType<typeof landmarks>;
      readonly creases: ReturnType<typeof creaseLines>;
      guess: FoldGuess | null;
      all: boolean;
      x: number;
      y: number;
    }
    let drag: Drag | null = null;
    let inFlight = false;
    let pending: FoldParams | null = null;
    let lastKey = '';

    const paramsFor = (d: Drag): FoldParams | null =>
      d.guess
        ? { line: { p: d.guess.line.p, d: d.guess.line.d }, seed: d.guess.seed, layers: d.all ? 'all' : 1, direction: 'valley' }
        : null;

    const requestPreview = (params: FoldParams) => {
      if (inFlight) {
        pending = params;
        return;
      }
      inFlight = true;
      void kernel()
        .preview(params)
        .then((r) => {
          inFlight = false;
          const d = drag;
          if (d && d.guess) {
            const st = useStore.getState();
            st.set({
              ghost: {
                line: d.guess.line,
                landing: r.ok ? r.landing : [],
                ok: r.ok,
                snaps: [d.guess.snappedFrom?.point, d.guess.snappedTo?.point].filter((p): p is Vec2 => !!p),
                allLayers: d.all,
              },
              glow: r.ok ? new Set() : new Set(r.blockers),
            });
          }
          if (pending) {
            const next = pending;
            pending = null;
            requestPreview(next);
          }
        });
    };

    const update = (ev: PointerEvent) => {
      if (!drag) return;
      const p = toPlane(ev);
      if (!p) return;
      drag.all = ev.shiftKey;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      drag.guess = guessFold(drag.from, p, drag.marks, drag.creases, {
        radiusMm: SNAP_PX * mmPerPx(),
        freehand: ev.ctrlKey || ev.metaKey,
      });
      const params = paramsFor(drag);
      if (!params) {
        useStore.getState().set({ ghost: null });
        return;
      }
      const key = `${params.line.p.map((x) => x.toFixed(3))}|${params.line.d.map((x) => x.toFixed(4))}|${params.layers}`;
      if (key !== lastKey) {
        lastKey = key;
        requestPreview(params);
      }
    };

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const st = useStore.getState();
      const snap = st.view?.snapshot;
      if (!snap || st.mode !== 'fold') return;
      const raw = toPlane(ev);
      // A few pixels of grace around the paper, so a corner can be pinched from just outside.
      const p = raw && grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx());
      if (!p) return; // the table: let the camera orbit
      ev.stopImmediatePropagation();
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      drag = {
        pointerId: ev.pointerId,
        from: p,
        marks: landmarks(snap),
        creases: creaseLines(snap),
        guess: null,
        all: ev.shiftKey,
        x: ev.clientX,
        y: ev.clientY,
      };
      lastKey = '';
      el.style.cursor = 'grabbing';
    };

    const onMove = (ev: PointerEvent) => {
      if (drag) {
        if (ev.pointerId !== drag.pointerId) return;
        update(ev);
        return;
      }
      const snap = useStore.getState().view?.snapshot;
      const raw = snap ? toPlane(ev) : null;
      const p = snap && raw ? grabPoint(snap, raw, GRAB_MARGIN_PX * mmPerPx()) : null;
      const over = !!p;
      el.style.cursor = over ? 'grab' : '';
      if (over && snap && p) {
        const n = layersAt(snap, p);
        el.title = n > 1 ? `${strings.layersBadge(n)} · ${ev.shiftKey ? strings.allLayers : strings.topLayer}` : '';
      } else el.title = '';
    };

    const finish = (ev: PointerEvent, commit: boolean) => {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      drag = null;
      pending = null;
      el.style.cursor = '';
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      const params = commit ? paramsFor(d) : null;
      useStore.getState().set({ ghost: null });
      if (params) void commitFold(params, { x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: PointerEvent) => finish(ev, true);
    const onCancel = (ev: PointerEvent) => finish(ev, false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && drag) {
        drag = null;
        pending = null;
        el.style.cursor = '';
        useStore.getState().set({ ghost: null, glow: new Set() });
      }
      if (ev.key === 'Shift' && drag) {
        drag.all = ev.type === 'keydown';
        const params = paramsFor(drag);
        if (params) requestPreview(params);
      }
    };
    const onDouble = (ev: MouseEvent) => {
      const snap = useStore.getState().view?.snapshot;
      const p = toPlane(ev);
      if (snap && p && onPaper(snap, p)) {
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
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    el.addEventListener('dblclick', onDouble);
    return () => {
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
