import { useFrame } from '@react-three/fiber';
import { PaperMesh, type PaperLook } from '@paperfold/render';
import { buildFrame, type SkinFrame, skinParamsFor } from '@paperfold/skin';
import { useMemo, useRef, useState } from 'react';
import { type Group, Matrix4, Vector3 } from 'three';
import { PRESETS } from '../presets.ts';
import { type PeekView, useStore } from '../store.ts';
import { foldPose, reducedMotion } from './motion.ts';

/** The angle the live drag was showing, so a committed fold lands from there. */
export let dragTheta = 0;

const TURN_MS = 620;
/** How far a hovered corner curls up (radians). */
const PEEK_THETA = 0.85;
const ROTATE_MS = 360;

/**
 * The folded model. Each frame it asks the skin for geometry: static when nothing moves,
 * or the active fold at its current angle. The kernel's state is never touched here.
 */
export function PaperModel({ onTopHeight }: { readonly onTopHeight?: (h: number) => void }) {
  const view = useStore((s) => s.view);
  const active = useStore((s) => s.active);
  const modelMotion = useStore((s) => s.modelMotion);
  const paperMode = useStore((s) => s.paperMode);
  const glow = useStore((s) => s.glow);
  const preset = useStore((s) => s.preset);
  const frontColor = useStore((s) => s.frontColor);
  const backColor = useStore((s) => s.backColor);
  const group = useRef<Group>(null);
  const snap = view?.snapshot ?? null;

  const params = useMemo(() => (snap ? skinParamsFor(snap.paper, paperMode) : null), [snap, paperMode]);
  const staticFrame = useMemo(() => (snap && params ? buildFrame(snap, params) : null), [snap, params]);
  const [moving, setMoving] = useState<{ key: string; frame: SkinFrame } | null>(null);
  const settledKey = useRef<string>('');
  const shownTheta = useRef(0);
  // The hover curl: which peek is showing and how far it's open.
  const shownPeek = useRef<PeekView | null>(null);
  const peekTheta = useRef(0);

  useFrame((_, dt) => {
    const now = performance.now();
    const { drag, creaseOverlay, peek } = useStore.getState();
    // The live drag: the kernel-validated candidate, at the angle the pointer asks for. The
    // paper eases toward it (it never jumps), and trembles a little while it resists.
    if (snap && params && drag?.preview) {
      const target = drag.resisting ? Math.max(0, drag.theta - 0.35) : drag.theta;
      shownTheta.current += (target - shownTheta.current) * Math.min(1, dt * 14);
      const tremble = drag.resisting && !reducedMotion() ? 0.035 * Math.sin(now / 22) : 0;
      dragTheta = shownTheta.current;
      const motion = {
        before: snap,
        transition: drag.preview.transition,
        theta: Math.max(0, Math.min(Math.PI, shownTheta.current + tremble)),
        sharpnessAt: () => 0,
      };
      const frame = buildFrame(drag.preview.after, params, motion);
      setMoving({ key: 'drag', frame });
      settledKey.current = '';
      return;
    }
    if (!drag) shownTheta.current = 0;
    // Hovering a corner: the layers you'd pick up curl up a little (about 50°), and settle back
    // when you move away. A real, validated fold of that corner, shown part-way.
    if (drag?.preview) {
      shownPeek.current = null;
      peekTheta.current = 0;
    } else if (snap && params && (peek || shownPeek.current)) {
      if (peek && shownPeek.current?.key !== peek.key) {
        shownPeek.current = peek;
        peekTheta.current = 0;
      }
      const target = peek ? PEEK_THETA : 0;
      peekTheta.current = reducedMotion() ? target : peekTheta.current + (target - peekTheta.current) * Math.min(1, dt * 12);
      const sp = shownPeek.current;
      if (!peek && peekTheta.current < 0.01) {
        shownPeek.current = null;
      } else if (sp) {
        const frame = buildFrame(sp.after, params, { before: snap, transition: sp.transition, theta: peekTheta.current, sharpnessAt: () => 0 });
        setMoving({ key: 'peek', frame });
        settledKey.current = '';
        return;
      }
    }
    if (snap && params && active) {
      const pose = foldPose(active, snap, now, paperMode, creaseOverlay);
      const key = `${active.key}:${snap.hash}:${paperMode}`;
      if (!pose.motion) {
        if (moving) setMoving(null);
        settledKey.current = key;
      } else if (pose.animating || settledKey.current !== key || !moving) {
        const frame = buildFrame(snap, params, pose.motion);
        setMoving({ key, frame });
        settledKey.current = pose.animating ? '' : key;
      }
    } else if (moving) {
      setMoving(null);
    }

    // Whole-model moves: turn over (lifted, half-turn about its axis) and rotate.
    const g = group.current;
    if (!g) return;
    g.matrixAutoUpdate = false;
    const m = new Matrix4();
    if (modelMotion) {
      const k = reducedMotion() ? 1 : Math.min(1, (now - modelMotion.startedAt) / (modelMotion.transition.kind === 'turnOver' ? TURN_MS : ROTATE_MS));
      const e = 1 - Math.pow(1 - k, 3);
      const tr = modelMotion.transition;
      if (k < 1 && tr.kind === 'turnOver') {
        const p = new Vector3(tr.axis.p[0], 0, -tr.axis.p[1]);
        const axis = new Vector3(tr.axis.d[0], 0, -tr.axis.d[1]).normalize();
        const lift = 70 * Math.sin(Math.PI * e);
        m.makeTranslation(p.x, lift + 1.5, p.z)
          .multiply(new Matrix4().makeRotationAxis(axis, -Math.PI * (1 - e)))
          .multiply(new Matrix4().makeTranslation(-p.x, -1.5, -p.z));
      } else if (k < 1 && tr.kind === 'rotate') {
        const p = new Vector3(tr.center[0], 0, -tr.center[1]);
        m.makeTranslation(p.x, 0, p.z)
          .multiply(new Matrix4().makeRotationY((-tr.degrees * Math.PI * (1 - e)) / 180))
          .multiply(new Matrix4().makeTranslation(-p.x, 0, -p.z));
      }
    }
    g.matrix.copy(m);
    g.matrixWorldNeedsUpdate = true;
  });

  const p = PRESETS[preset];
  const look: PaperLook = useMemo(
    () => ({ ...p.look, front: frontColor, back: backColor }),
    [p, frontColor, backColor],
  );
  // Input and overlays work on the resting stack's top surface, not on a soft fold's loft:
  // a pointer aimed at a corner must land on that corner whatever the flap is doing.
  if (staticFrame) onTopHeight?.(staticFrame.topHeight);
  const frame = moving?.frame ?? staticFrame;
  if (!frame) return null;
  return (
    <group ref={group}>
      <PaperMesh frame={frame} look={look} glowFaces={glow} fibers={p.fibers} />
    </group>
  );
}
