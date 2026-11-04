import { Line, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { FoldLine, GhostOutline, SnapRing, Studio } from '@paperfold/render';
import { useCallback, useMemo, useRef } from 'react';
import { MOUSE, NeutralToneMapping, TOUCH } from 'three';
import { useStore } from '../store.ts';

/** ?shadows=0 turns shadows off (slow devices, screenshot tests). */
const SHADOWS = new URLSearchParams(location.search).get('shadows') !== '0';
import { FoldInput } from './FoldInput.tsx';
import { PaperModel } from './PaperModel.tsx';
import { clipLineToBox, facePolygons, footprint } from './plane.ts';

/** What the drag will do, drawn on the paper: the fold line, where the flap lands, snaps. */
function Ghost({ heightRef }: { readonly heightRef: React.RefObject<number> }) {
  const drag = useStore((s) => s.drag);
  const view = useStore((s) => s.view);
  const dark = useStore((s) => s.theme === 'dark');
  const landing = useMemo(() => {
    const pv = drag?.preview;
    if (!pv) return [];
    const moving = new Set(pv.transition.moving);
    return facePolygons(pv.after)
      .filter((f) => moving.has(f.id))
      .map((f) => f.poly);
  }, [drag?.preview]);
  if (!drag || !view || !drag.line) return null;
  const seg = clipLineToBox(drag.line, footprint(view.snapshot), 12);
  const color = drag.resisting ? '#e0652f' : dark ? '#8fc3ff' : '#1f5fae';
  const kind = drag.candidates[drag.selected]?.kind;
  const mountain = kind === 'inside-reverse' || drag.preview?.transition.kind === 'fold' && drag.preview.transition.direction === -1;
  const y = (heightRef.current ?? 0) + 0.6;
  return (
    <>
      {seg && <FoldLine a={seg[0]} b={seg[1]} height={y} kind={mountain ? 'mountain' : 'valley'} color={color} />}
      {!drag.resisting && <GhostOutline polygons={landing} height={y + 0.2} color={color} opacity={0.45} />}
      {/* Where the common folds would land: faint dots you can aim for. */}
      {!drag.resisting &&
        drag.targets.map((p, i) => (
          <mesh key={`t${i}`} position={[p[0], y, -p[1]]} rotation-x={-Math.PI / 2} renderOrder={5}>
            <circleGeometry args={[1.8, 20]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ))}
      {drag.guide && (
        <Line
          points={[
            [drag.guide[0][0], y, -drag.guide[0][1]],
            [drag.guide[1][0], y, -drag.guide[1][1]],
          ]}
          color={color}
          lineWidth={7}
          transparent
          opacity={0.3}
        />
      )}
      {drag.marks.map((p, i) => (
        <SnapRing key={i} at={p} height={y} radius={2.2} color={color} />
      ))}
    </>
  );
}

/** Before you press: a ring on the corner you'd pinch, or a glow along the edge you'd push. */
function HoverMarks({ heightRef }: { readonly heightRef: React.RefObject<number> }) {
  const hover = useStore((s) => s.hover);
  const drag = useStore((s) => s.drag);
  const dark = useStore((s) => s.theme === 'dark');
  if (!hover || drag) return null;
  const color = dark ? '#8fc3ff' : '#1f5fae';
  const y = (heightRef.current ?? 0) + 0.6;
  if (hover.zone === 'corner' && hover.corner) {
    return <SnapRing at={hover.corner} height={y} radius={hover.pressed ? 3 : 4} color={color} />;
  }
  if (hover.zone === 'folded-edge' && hover.edge) {
    const a: [number, number, number] = [hover.edge.a[0], y, -hover.edge.a[1]];
    const b: [number, number, number] = [hover.edge.b[0], y, -hover.edge.b[1]];
    return (
      <>
        <Line points={[a, b]} color={color} lineWidth={9} transparent opacity={0.28} />
        <Line points={[a, b]} color={color} lineWidth={2.5} />
      </>
    );
  }
  return null;
}

/** Fingertips holding the paper down: a soft shadow where each one presses. */
function Holds({ heightRef }: { readonly heightRef: React.RefObject<number> }) {
  const holds = useStore((s) => s.holds);
  const y = (heightRef.current ?? 0) + 0.25;
  return (
    <>
      {holds.map((p, i) => (
        <group key={i} position={[p[0], y, -p[1]]} rotation-x={-Math.PI / 2}>
          <mesh>
            <circleGeometry args={[5.5, 32]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <ringGeometry args={[5.5, 6.3, 40]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Keyboard folding: rings on the picked landmark and the one in focus. */
function KeyboardMarks({ heightRef }: { readonly heightRef: React.RefObject<number> }) {
  const kb = useStore((s) => s.keyboard);
  const dark = useStore((s) => s.theme === 'dark');
  if (!kb) return null;
  const y = (heightRef.current ?? 0) + 0.6;
  const color = dark ? '#8fc3ff' : '#1f5fae';
  return (
    <>
      {kb.from && <SnapRing at={kb.from} height={y} radius={3.2} color={color} />}
      <SnapRing at={kb.current} height={y} radius={4.5} color={color} />
      {kb.from && <FoldLine a={kb.from} b={kb.current} height={y} kind="valley" color={color} />}
    </>
  );
}

export function FoldView() {
  const dark = useStore((s) => s.theme === 'dark');
  const lightbox = useStore((s) => s.lightbox || s.lightboxHeld);
  const topHeight = useRef(0);
  const onTopHeight = useCallback((h: number) => {
    topHeight.current = h;
  }, []);

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0, 305, 195], fov: 35, near: 2, far: 4000 }}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[dark ? '#141917' : '#dfe4e0']} />
      <Studio dark={dark} shadows={SHADOWS} lightbox={lightbox} />
      <PaperModel onTopHeight={onTopHeight} />
      <Ghost heightRef={topHeight} />
      <HoverMarks heightRef={topHeight} />
      <Holds heightRef={topHeight} />
      <KeyboardMarks heightRef={topHeight} />
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
