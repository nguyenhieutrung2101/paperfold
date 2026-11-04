/**
 * @paperfold/render: three.js / React Three Fiber presentation of the skin's geometry.
 * WebGL2 today; everything here goes through three's renderer abstraction so a WebGPU
 * renderer can replace it later.
 */
export { PaperMesh, type PaperMeshProps } from './PaperMesh.tsx';
export { Studio, type StudioProps } from './Studio.tsx';
export { FoldArrow, FoldLine, GhostOutline, PushArrow, SnapRing } from './Overlays.tsx';
export { Hand, type HandPoseName, type HandProps } from './Hand.tsx';
export { createPaperMaterial, type PaperLook, type PaperMaterial } from './paperMaterial.ts';
export { buildLayerTextures, layerTexturesFrom, type LayerTextures } from './layerTextures.ts';
export { type LayerRaster, rasterizeLayerMap } from './layerRaster.ts';
export { createCuttingMatTexture, createFiberAlbedo, createFiberNormalMap } from './textures.ts';
