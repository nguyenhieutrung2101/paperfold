/**
 * @paperfold/render: three.js / React Three Fiber presentation of the skin's geometry.
 * WebGL2 today; everything here goes through three's renderer abstraction so a WebGPU
 * renderer can replace it later.
 */
export { PaperMesh, type PaperMeshProps } from './PaperMesh.tsx';
export { Studio, type StudioProps } from './Studio.tsx';
export { FoldLine, GhostOutline, SnapRing } from './Overlays.tsx';
export { createPaperMaterial, type PaperLook, type PaperMaterial } from './paperMaterial.ts';
export { createCuttingMatTexture, createFiberAlbedo, createFiberNormalMap } from './textures.ts';
