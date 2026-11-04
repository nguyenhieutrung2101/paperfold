import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type DirectionalLight, type HemisphereLight, type MeshStandardMaterial } from 'three';
import { createCuttingMatTexture, type MatColors } from './textures.ts';

export interface StudioProps {
  readonly dark: boolean;
  /** Turn shadows off for slow devices and screenshot tests. */
  readonly shadows?: boolean;
  /** The table becomes a lightbox: it glows and the room light dims (eases in and out). */
  readonly lightbox?: boolean;
}

const MAT_LIGHT: MatColors = { base: '#3b574a', minor: 'rgba(225,238,228,0.10)', major: 'rgba(235,245,238,0.24)' };
const MAT_DARK: MatColors = { base: '#21322a', minor: 'rgba(210,228,216,0.08)', major: 'rgba(220,236,226,0.18)' };
const BOX_GLOW = new Color('#fbf6ec');

/**
 * Soft studio light: an environment of large soft boxes for reflections and fill,
 * a key light that casts shadows between layers, and a low back light that makes thin
 * paper glow through. The table is a cutting mat with a 10 mm grid.
 *
 * The key light is low (about 25° above the table), so it rakes across the paper: steps
 * between layers cast thin shadows and the ridges of edges underneath catch it (Phase 2).
 */
export function Studio({ dark, shadows = true, lightbox = false }: StudioProps) {
  const matTexture = useMemo(() => createCuttingMatTexture(dark ? MAT_DARK : MAT_LIGHT), [dark]);
  useEffect(() => () => matTexture.dispose(), [matTexture]);
  const key = useRef<DirectionalLight>(null);
  const back = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const boxed = useRef(0);
  const keyIntensity = dark ? 1.9 : 2.35;
  const hemiIntensity = dark ? 0.25 : 0.35;
  useFrame((_, dt) => {
    const target = lightbox ? 1 : 0;
    boxed.current += (target - boxed.current) * Math.min(1, dt * 10);
    if (Math.abs(boxed.current - target) < 0.003) boxed.current = target;
    const room = 1 - 0.7 * boxed.current;
    if (key.current) key.current.intensity = keyIntensity * room;
    if (back.current) back.current.intensity = 0.55 * room;
    if (hemi.current) hemi.current.intensity = hemiIntensity * room;
    if (mat.current) {
      mat.current.emissive.copy(BOX_GLOW);
      mat.current.emissiveIntensity = 1.05 * boxed.current;
    }
  });
  return (
    <>
      <Environment resolution={128} frames={1} environmentIntensity={dark ? 0.45 : 0.6}>
        <Lightformer form="rect" intensity={1.6} position={[0, 400, 60]} rotation-x={Math.PI / 2} scale={[700, 500, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[-420, 160, 0]} rotation-y={Math.PI / 2} scale={[300, 400, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[420, 120, -100]} rotation-y={-Math.PI / 2} scale={[300, 300, 1]} />
        <Lightformer form="rect" intensity={0.25} position={[0, 60, 500]} scale={[800, 150, 1]} />
      </Environment>
      <hemisphereLight ref={hemi} args={[dark ? '#c9d4ff' : '#fffaf0', dark ? '#1b221e' : '#4a5a50', hemiIntensity]} />
      {/* Key light, low so it rakes across fibers, steps and crease memory. */}
      <directionalLight
        ref={key}
        position={[-300, 175, 225]}
        intensity={keyIntensity}
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
      <directionalLight ref={back} position={[220, 70, -260]} intensity={0.55} color="#ffe9d2" />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial ref={mat} map={matTexture} roughness={0.92} metalness={0} />
      </mesh>
      {shadows && !lightbox && (
        <ContactShadows position={[0, 0.005, 0]} scale={520} resolution={512} blur={3} far={25} opacity={0.55} frames={Infinity} />
      )}
    </>
  );
}
