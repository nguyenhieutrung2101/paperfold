import type { MeshData, SkinFrame } from '@paperfold/skin';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, MeshStandardMaterial } from 'three';
import { createPaperMaterial, type PaperLook } from './paperMaterial.ts';
import { createFiberAlbedo, createFiberNormalMap } from './textures.ts';

function toGeometry(mesh: MeshData, glowFaces: ReadonlySet<number>): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  const glow = new Float32Array(mesh.faceIds.length);
  if (glowFaces.size > 0) {
    for (let i = 0; i < glow.length; i++) glow[i] = glowFaces.has(mesh.faceIds[i]!) ? 1 : 0;
  }
  g.setAttribute('glow', new BufferAttribute(glow, 1));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

const EMPTY = new Set<number>();

export interface PaperMeshProps {
  readonly frame: SkinFrame;
  readonly look: PaperLook;
  /** Faces to light warm (the kernel's blockers). */
  readonly glowFaces?: ReadonlySet<number>;
  /** Fiber texture repeats across the sheet. */
  readonly fiberRepeat?: number;
  readonly fibers?: { readonly count: number; readonly length: number };
}

/** The paper itself: one two-sided surface per face, plus visible raw-edge thickness. */
export function PaperMesh({ frame, look, glowFaces = EMPTY, fiberRepeat = 3, fibers }: PaperMeshProps) {
  const fiberCount = fibers?.count ?? 1400;
  const fiberLength = fibers?.length ?? 22;
  const textures = useMemo(() => {
    const normal = createFiberNormalMap({ fibers: fiberCount, fiberLength });
    const albedo = createFiberAlbedo({ fibers: fiberCount, fiberLength });
    normal.repeat.set(fiberRepeat, fiberRepeat);
    albedo.repeat.set(fiberRepeat, fiberRepeat);
    return { normal, albedo };
  }, [fiberCount, fiberLength, fiberRepeat]);
  useEffect(
    () => () => {
      textures.normal.dispose();
      textures.albedo.dispose();
    },
    [textures],
  );

  // Created once per texture set; colors and translucency are updated in place below.
  const paper = useMemo(() => createPaperMaterial(look, textures.normal, textures.albedo), [textures]);
  useEffect(() => () => paper.dispose(), [paper]);
  useEffect(() => paper.setLook(look), [paper, look]);

  const edgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color('#f4efe4'),
        roughness: 0.95,
        side: DoubleSide,
        // Raw-edge walls share their top and bottom lines with the paper surface; push them
        // back a hair so the surface wins where they meet.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    [],
  );
  useEffect(() => {
    // The cut edge shows the paper's core: a lighter blend of both sides.
    edgeMaterial.color.set(look.back).lerp(new Color('#ffffff'), 0.35).lerp(new Color(look.front), 0.15);
  }, [edgeMaterial, look.back, look.front]);
  useEffect(() => () => edgeMaterial.dispose(), [edgeMaterial]);

  const paperGeometry = useMemo(() => toGeometry(frame.paper, glowFaces), [frame, glowFaces]);
  const edgeGeometry = useMemo(() => toGeometry(frame.edges, EMPTY), [frame]);
  useEffect(() => () => paperGeometry.dispose(), [paperGeometry]);
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  return (
    <group>
      <mesh geometry={paperGeometry} material={paper.material} castShadow receiveShadow />
      <mesh geometry={edgeGeometry} material={edgeMaterial} castShadow />
    </group>
  );
}
