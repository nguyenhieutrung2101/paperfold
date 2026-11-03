import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { createCuttingMatTexture, type MatColors } from './textures.ts';

export interface StudioProps {
  readonly dark: boolean;
  /** Turn shadows off for slow devices and screenshot tests. */
  readonly shadows?: boolean;
}

const MAT_LIGHT: MatColors = { base: '#3b574a', minor: 'rgba(225,238,228,0.10)', major: 'rgba(235,245,238,0.24)' };
const MAT_DARK: MatColors = { base: '#21322a', minor: 'rgba(210,228,216,0.08)', major: 'rgba(220,236,226,0.18)' };

/**
 * Soft studio light: an environment of large soft boxes for reflections and fill,
 * a key light that casts shadows between layers, and a low back light that makes thin
 * paper glow through. The table is a cutting mat with a 10 mm grid.
 */
export function Studio({ dark, shadows = true }: StudioProps) {
  const matTexture = useMemo(() => createCuttingMatTexture(dark ? MAT_DARK : MAT_LIGHT), [dark]);
  useEffect(() => () => matTexture.dispose(), [matTexture]);
  return (
    <>
      <Environment resolution={128} frames={1} environmentIntensity={dark ? 0.45 : 0.6}>
        <Lightformer form="rect" intensity={1.6} position={[0, 400, 60]} rotation-x={Math.PI / 2} scale={[700, 500, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[-420, 160, 0]} rotation-y={Math.PI / 2} scale={[300, 400, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[420, 120, -100]} rotation-y={-Math.PI / 2} scale={[300, 300, 1]} />
        <Lightformer form="rect" intensity={0.25} position={[0, 60, 500]} scale={[800, 150, 1]} />
      </Environment>
      <hemisphereLight args={[dark ? '#c9d4ff' : '#fffaf0', dark ? '#1b221e' : '#4a5a50', dark ? 0.25 : 0.35]} />
      {/* Key light, fairly low so it rakes across fibers and crease memory. */}
      <directionalLight
        position={[-260, 240, 210]}
        intensity={dark ? 1.4 : 1.75}
        color="#fff6ea"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        // A constant depth bias (about 1 mm), not a normal-offset bias: the paper is
        // double-sided, and on a face lying back side up the vertex normal points away from
        // the light, so normal offset would push lookups the wrong way (acne).
        shadow-bias={-0.0012}
        shadow-normalBias={0}
        shadow-camera-left={-240}
        shadow-camera-right={240}
        shadow-camera-top={240}
        shadow-camera-bottom={-240}
        shadow-camera-near={50}
        shadow-camera-far={900}
      />
      {/* Grazing back light: shows crease memory and lets thin paper glow. */}
      <directionalLight position={[220, 70, -260]} intensity={0.55} color="#ffe9d2" />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial map={matTexture} roughness={0.92} metalness={0} />
      </mesh>
      {shadows && (
        <ContactShadows position={[0, 0.005, 0]} scale={520} resolution={512} blur={3} far={25} opacity={0.55} frames={Infinity} />
      )}
    </>
  );
}
