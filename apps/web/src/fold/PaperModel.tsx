import { useFrame } from '@react-three/fiber';
import { PaperMesh, type PaperLook } from '@paperfold/render';
import { buildFrame, type SkinFrame, skinParamsFor } from '@paperfold/skin';
import { useMemo, useRef, useState } from 'react';
import { type Group, Matrix4, Vector3 } from 'three';
import { PRESETS } from '../presets.ts';
import { useStore } from '../store.ts';
import { foldPose, reducedMotion } from './motion.ts';

const TURN_MS = 620;
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

  useFrame(() => {
    const now = performance.now();
    if (snap && params && active) {
      const pose = foldPose(active, snap, now, paperMode);
      const key = `${active.key}:${snap.hash}:${paperMode}`;
      if (!pose.motion) {
        if (moving) setMoving(null);
        settledKey.current = key;
      } else if (pose.animating || settledKey.current !== key || !moving) {
        const frame = buildFrame(snap, params, pose.motion);
        setMoving({ key, frame });
        onTopHeight?.(frame.topHeight);
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
  const frame = moving?.frame ?? staticFrame;
  if (!frame) return null;
  if (!moving) onTopHeight?.(frame.topHeight);
  return (
    <group ref={group}>
      <PaperMesh frame={frame} look={look} glowFaces={glow} fibers={p.fibers} />
    </group>
  );
}
