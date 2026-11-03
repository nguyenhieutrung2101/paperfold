import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { FoldLine, GhostOutline, SnapRing, Studio } from '@paperfold/render';
import { useCallback, useRef } from 'react';
import { MOUSE, NeutralToneMapping, TOUCH } from 'three';
import { useStore } from '../store.ts';

/** ?shadows=0 turns shadows off (slow devices, screenshot tests). */
const SHADOWS = new URLSearchParams(location.search).get('shadows') !== '0';
import { FoldInput } from './FoldInput.tsx';
import { PaperModel } from './PaperModel.tsx';
import { clipLineToBox, footprint } from './plane.ts';

function Ghost({ heightRef }: { readonly heightRef: React.RefObject<number> }) {
  const ghost = useStore((s) => s.ghost);
  const view = useStore((s) => s.view);
  const dark = useStore((s) => s.theme === 'dark');
  if (!ghost || !view) return null;
  const seg = clipLineToBox(ghost.line, footprint(view.snapshot), 12);
  const color = ghost.ok ? (dark ? '#8fc3ff' : '#1f5fae') : '#e0652f';
  const y = (heightRef.current ?? 0) + 0.6;
  return (
    <>
      {seg && <FoldLine a={seg[0]} b={seg[1]} height={y} kind="valley" color={color} />}
      {ghost.ok && <GhostOutline polygons={ghost.landing} height={y + 0.2} color={color} opacity={0.6} />}
      {ghost.snaps.map((p, i) => (
        <SnapRing key={i} at={p} height={y} radius={2.2} color={color} />
      ))}
    </>
  );
}

export function FoldView() {
  const dark = useStore((s) => s.theme === 'dark');
  const topHeight = useRef(0);
  const onTopHeight = useCallback((h: number) => {
    topHeight.current = h;
  }, []);

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0, 330, 150], fov: 35, near: 2, far: 4000 }}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[dark ? '#141917' : '#dfe4e0']} />
      <Studio dark={dark} shadows={SHADOWS} />
      <PaperModel onTopHeight={onTopHeight} />
      <Ghost heightRef={topHeight} />
      <FoldInput topHeight={topHeight} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        target={[0, 0, 0]}
        minDistance={120}
        maxDistance={900}
        maxPolarAngle={Math.PI * 0.46}
        mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      />
    </Canvas>
  );
}
