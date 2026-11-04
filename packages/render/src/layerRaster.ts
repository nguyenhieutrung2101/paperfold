import type { LayerMapData } from '@paperfold/skin';

/**
 * The layer map rasterized in sheet coordinates (see layerTextures.ts for what each channel
 * holds). Plain 2D canvas work with no three.js, so it runs in a worker (OffscreenCanvas) or,
 * where that's missing, on the main thread.
 */
export interface LayerRaster {
  readonly key: string;
  readonly res: number;
  readonly a: Uint8Array;
  readonly b: Uint8Array;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Pt = readonly [number, number];

function canvas(size: number): { c: AnyCanvas; g: Ctx } {
  let c: AnyCanvas;
  if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(size, size);
  else {
    c = document.createElement('canvas');
    c.width = size;
    c.height = size;
  }
  const g = c.getContext('2d', { willReadFrequently: true }) as Ctx | null;
  if (!g) throw new Error('no 2D canvas');
  return { c, g };
}

let filterWorks: boolean | null = null;
/** Does this browser's 2D canvas blur with ctx.filter? (Safari's didn't for a long time.) */
function canFilter(): boolean {
  if (filterWorks !== null) return filterWorks;
  const t = canvas(9);
  t.g.filter = 'blur(2px)';
  t.g.fillStyle = '#fff';
  t.g.fillRect(4, 4, 1, 1);
  filterWorks = t.g.getImageData(1, 4, 1, 1).data[3]! > 0;
  return filterWorks;
}

/**
 * A soft copy (radius about `px` pixels): a Gaussian blur where the canvas has one, else a
 * pyramid (halve, then double back up) that's smooth enough for shading.
 */
function softened(src: AnyCanvas, px: number): AnyCanvas {
  const size = src.width;
  const out = canvas(size);
  if (canFilter()) {
    out.g.filter = `blur(${px.toFixed(2)}px)`;
    out.g.drawImage(src, 0, 0);
    out.g.filter = 'none';
    return out.c;
  }
  const levels: AnyCanvas[] = [src];
  let s = size;
  while (s > 8 && size / s < px * 1.6) {
    s = Math.max(8, Math.round(s / 2));
    const next = canvas(s);
    next.g.imageSmoothingEnabled = true;
    next.g.imageSmoothingQuality = 'high';
    next.g.drawImage(levels[levels.length - 1]!, 0, 0, s, s);
    levels.push(next.c);
  }
  if (levels.length === 1) {
    out.g.drawImage(src, 0, 0);
    return out.c;
  }
  let cur = levels[levels.length - 1]!;
  for (let i = levels.length - 2; i >= 0; i--) {
    const w = levels[i]!.width;
    const up = i === 0 ? out : canvas(w);
    up.g.imageSmoothingEnabled = true;
    up.g.imageSmoothingQuality = 'high';
    up.g.drawImage(cur, 0, 0, w, w);
    cur = up.c;
  }
  return out.c;
}

export function rasterizeLayerMap(data: LayerMapData, res = 768): LayerRaster {
  const px = (p: Pt): [number, number] => [p[0] * res, (1 - p[1]) * res];
  const mmToPx = res / data.sizeMm;
  const path = (g: Ctx, poly: readonly Pt[]) => {
    g.beginPath();
    poly.forEach((p, i) => {
      const [x, y] = px(p);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
  };
  const eachFace = (g: Ctx, draw: (f: LayerMapData['faces'][number]) => void) => {
    for (const f of data.faces) {
      g.save();
      path(g, f.clip);
      g.clip();
      draw(f);
      g.restore();
    }
  };

  // Contact shadows: what lies on each face, filled, then softened outward past its edges. Drawn
  // at half resolution (it's soft anyway) and scaled up: the blur is most of the cost.
  const half = Math.max(8, Math.round(res / 2));
  const shadow = canvas(half);
  shadow.g.scale(half / res, half / res);
  shadow.g.fillStyle = '#fff';
  eachFace(shadow.g, (f) => {
    for (const poly of f.above) {
      path(shadow.g, poly);
      shadow.g.fill();
    }
  });
  const shadowHalf = softened(shadow.c, Math.max(1, (1.1 * mmToPx * half) / res));
  const shadowSoft = canvas(res);
  shadowSoft.g.imageSmoothingEnabled = true;
  shadowSoft.g.drawImage(shadowHalf, 0, 0, res, res);

  // Ridges: the edges of what lies underneath, as soft lines.
  const ridge = canvas(res);
  ridge.g.strokeStyle = '#fff';
  ridge.g.lineWidth = Math.max(1, 0.5 * mmToPx);
  eachFace(ridge.g, (f) => {
    for (const poly of f.below) {
      path(ridge.g, poly);
      ridge.g.stroke();
    }
  });
  const ridgeSoft = softened(ridge.c, Math.max(1, 0.35 * mmToPx));

  // Folded edges are round (a bevel that catches the light); cut edges get a thin dark line.
  const rim = canvas(res);
  const cut = canvas(res);
  rim.g.strokeStyle = '#fff';
  // Lines are clipped to the face, so only the inner half of each stroke shows.
  rim.g.lineWidth = Math.max(1, 1.0 * mmToPx);
  cut.g.strokeStyle = '#fff';
  cut.g.lineWidth = Math.max(1, 1.0 * mmToPx);
  eachFace(rim.g, (f) => {
    for (const [a, b] of f.folded) {
      rim.g.beginPath();
      rim.g.moveTo(...px(a));
      rim.g.lineTo(...px(b));
      rim.g.stroke();
    }
  });
  eachFace(cut.g, (f) => {
    for (const [a, b] of f.raw) {
      cut.g.beginPath();
      cut.g.moveTo(...px(a));
      cut.g.lineTo(...px(b));
      cut.g.stroke();
    }
  });
  const rimSoft = softened(rim.c, Math.max(1, 0.45 * mmToPx));

  // Layer counts: each face below or above adds one step (1/8) in its channel.
  const counts = canvas(res);
  counts.g.globalCompositeOperation = 'lighter';
  eachFace(counts.g, (f) => {
    counts.g.fillStyle = 'rgb(32,0,0)';
    for (const poly of f.below) {
      path(counts.g, poly);
      counts.g.fill();
    }
    counts.g.fillStyle = 'rgb(0,32,0)';
    for (const poly of f.above) {
      path(counts.g, poly);
      counts.g.fill();
    }
  });

  const read = (c: AnyCanvas) => (c.getContext('2d', { willReadFrequently: true }) as Ctx).getImageData(0, 0, res, res).data;
  const s = read(shadowSoft.c);
  const r = read(ridgeSoft);
  const m = read(rimSoft);
  const k = read(counts.c);
  const e = read(cut.c);
  const A = new Uint8Array(res * res * 4);
  const B = new Uint8Array(res * res * 4);
  // The single-channel canvases are white with varying alpha: the alpha is the value. The counts
  // are opaque colors added up; premultiply so a half-covered edge pixel counts half.
  // Canvas rows run top to bottom; texture rows bottom to top (v up).
  for (let y = 0; y < res; y++) {
    const src = y * res * 4;
    const dst = (res - 1 - y) * res * 4;
    for (let x = 0; x < res * 4; x += 4) {
      const ka = k[src + x + 3]! / 255;
      A[dst + x] = s[src + x + 3]!;
      A[dst + x + 1] = r[src + x + 3]!;
      A[dst + x + 2] = m[src + x + 3]!;
      A[dst + x + 3] = 255;
      B[dst + x] = Math.round(k[src + x]! * ka);
      B[dst + x + 1] = Math.round(k[src + x + 1]! * ka);
      B[dst + x + 2] = e[src + x + 3]!;
      B[dst + x + 3] = 255;
    }
  }
  return { key: data.key, res, a: A, b: B };
}
