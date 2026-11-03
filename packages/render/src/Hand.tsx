import { useMemo } from 'react';
import { CapsuleGeometry, Color, EqualDepth, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';

export type HandPoseName = 'pinch' | 'hold' | 'push' | 'nail';

export interface HandProps {
  readonly pose: HandPoseName;
  readonly side: 'left' | 'right';
  /** Where the working fingertip touches, world mm. */
  readonly at: readonly [number, number, number];
  /** Horizontal direction the fingers point (toward `at`), world. */
  readonly toward: readonly [number, number];
  readonly opacity: number;
  readonly color?: string;
  /** Overall size; 1 is a real adult hand. Slightly smaller reads better over a 15 cm sheet. */
  readonly scale?: number;
}

/** Segment pitches (degrees, negative = pointing down) from knuckle to tip, per finger. */
interface PoseDef {
  readonly index: readonly number[];
  readonly others: readonly number[];
  /** Thumb tip relative to the index tip (local: x forward, y up, z toward the pinky). */
  readonly thumbTip: readonly [number, number, number];
  /** Palm tilt about the knuckle line (degrees). */
  readonly palm: number;
}

const POSES: Record<HandPoseName, PoseDef> = {
  // Thumb and index meet at the corner being pinched.
  pinch: { index: [-5, -35, -60], others: [-25, -75, -95], thumbTip: [1, -4, -5], palm: 18 },
  // Flat fingertips pressing the paper down.
  hold: { index: [-12, -18, -22], others: [-12, -18, -24], thumbTip: [-55, -2, -30], palm: 12 },
  // Index finger pushing a spine in; the rest in a loose fist.
  push: { index: [-35, -45, -55], others: [-40, -100, -120], thumbTip: [-45, 8, -16], palm: 35 },
  // A fingernail running along a fold: index tip down, steep.
  nail: { index: [-30, -60, -80], others: [-40, -95, -115], thumbTip: [-40, 6, -18], palm: 30 },
};

const SEGMENTS = [24, 17, 14];
const RADIUS = 7.5;

interface Capsule {
  readonly mid: Vector3;
  readonly q: Quaternion;
  readonly length: number;
  readonly radius: number;
}

function capsuleBetween(a: Vector3, b: Vector3, radius: number): Capsule {
  const dir = new Vector3().subVectors(b, a);
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return { mid: new Vector3().addVectors(a, b).multiplyScalar(0.5), q, length, radius };
}

/** A finger as a chain from its knuckle, given pitches; returns capsules and the tip. */
function chain(knuckle: Vector3, pitches: readonly number[], lengths: readonly number[], radius: number): { caps: Capsule[]; tip: Vector3 } {
  const caps: Capsule[] = [];
  let p = knuckle.clone();
  pitches.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const next = p.clone().add(new Vector3(Math.cos(a) * lengths[i]!, Math.sin(a) * lengths[i]!, 0));
    caps.push(capsuleBetween(p, next, radius * (1 - i * 0.08)));
    p = next;
  });
  return { caps, tip: p };
}

/**
 * A stylized, semi-transparent hand (brief, section 7, "Hands"): soft gray, no detail, never
 * hiding the paper. Built so the working fingertip sits exactly on `at`, with the fingers
 * reaching toward it from outside.
 */
export function Hand({ pose, side, at, toward, opacity, color = '#aeb6bf', scale = 0.8 }: HandProps) {
  const def = POSES[pose];
  const caps = useMemo(() => {
    // Local frame: x forward (fingers), y up, z toward the pinky. Index tip at the origin.
    const backward = (pitches: readonly number[]) => {
      let p = new Vector3(0, 0, 0);
      for (let i = pitches.length - 1; i >= 0; i--) {
        const a = (pitches[i]! * Math.PI) / 180;
        p = p.clone().sub(new Vector3(Math.cos(a) * SEGMENTS[i]!, Math.sin(a) * SEGMENTS[i]!, 0));
      }
      return p;
    };
    const knuckle = backward(def.index);
    const out: Capsule[] = [...chain(knuckle, def.index, SEGMENTS, RADIUS).caps];
    // The other fingers, along the knuckle line toward the pinky, a little shorter.
    for (let k = 1; k <= 3; k++) {
      const base = knuckle.clone().add(new Vector3(-2 * k, -0.5 * k, 15.5 * k));
      const scale = 1 - 0.07 * k;
      out.push(...chain(base, def.others, SEGMENTS.map((l) => l * scale), RADIUS * (1 - 0.05 * k)).caps);
    }
    // Palm: a couple of thick capsules behind the knuckles, tilted.
    const tilt = (def.palm * Math.PI) / 180;
    const back = new Vector3(-Math.cos(tilt) * 58, Math.sin(tilt) * 58, 0);
    for (let k = 0; k <= 2; k++) {
      const a = knuckle.clone().add(new Vector3(-6, 2, 4 + 18 * k));
      out.push(capsuleBetween(a, a.clone().add(back), 15));
    }
    // Thumb: from the palm's thumb side to its tip.
    const thumbBase = knuckle.clone().add(back.clone().multiplyScalar(0.55)).add(new Vector3(0, -6, -14));
    const thumbTip = new Vector3(...def.thumbTip);
    const mid = thumbBase.clone().lerp(thumbTip, 0.5).add(new Vector3(0, 4, -10));
    out.push(capsuleBetween(thumbBase, mid, 9.5), capsuleBetween(mid, thumbTip, 8));
    return out;
  }, [def]);

  // Two passes so the hand is one even veil: depth first, then color only where the nearest
  // surface is. Overlapping capsules would otherwise stack their transparency into a solid gray.
  const depthOnly = useMemo(() => new MeshBasicMaterial({ colorWrite: false, depthWrite: true }), []);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({ color: new Color(color), transparent: true, opacity, roughness: 0.65, depthWrite: false, depthFunc: EqualDepth }),
    [color, opacity],
  );
  const geoms = useMemo(() => caps.map((c) => new CapsuleGeometry(c.radius, Math.max(0.01, c.length), 4, 10)), [caps]);

  // Orient: local +x toward `toward`; mirror z for the left hand.
  const yaw = Math.atan2(-toward[1], toward[0]);
  const mirror = side === 'left' ? -1 : 1;
  return (
    <group position={[at[0], at[1] + 1.5, at[2]]} rotation={[0, yaw, 0]} scale={[scale, scale, mirror * scale]}>
      {caps.map((c, i) => (
        <mesh key={`d${i}`} geometry={geoms[i]!} material={depthOnly} position={c.mid} quaternion={c.q} renderOrder={9} />
      ))}
      {caps.map((c, i) => (
        <mesh key={`c${i}`} geometry={geoms[i]!} material={material} position={c.mid} quaternion={c.q} renderOrder={10} />
      ))}
    </group>
  );
}
