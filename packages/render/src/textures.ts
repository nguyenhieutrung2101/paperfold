import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three';

/** Small deterministic PRNG so the paper looks the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FiberOptions {
  readonly size?: number;
  /** Number of fibers; washi wants many long ones, kami few short ones. */
  readonly fibers?: number;
  readonly fiberLength?: number;
  readonly seed?: number;
}

/** Tileable height field: soft value noise plus fibers laid in random directions. */
function fiberHeight(opts: FiberOptions): { h: Float32Array; size: number } {
  const size = opts.size ?? 512;
  const rnd = mulberry32(opts.seed ?? 7);
  const h = new Float32Array(size * size);
  // Value noise, three octaves, wrapped so the texture tiles.
  for (const [cells, amp] of [
    [8, 0.5],
    [32, 0.3],
    [128, 0.2],
  ] as const) {
    const grid = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const g = (i: number, j: number) => grid[((j % cells) * cells + (i % cells)) | 0]!;
        const v =
          (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
        h[y * size + x]! += v * amp;
      }
    }
  }
  const fibers = opts.fibers ?? 1400;
  const fiberLength = opts.fiberLength ?? 22;
  for (let f = 0; f < fibers; f++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = fiberLength * (0.4 + rnd());
    const strength = 0.25 + rnd() * 0.5;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.25;
      x += Math.cos(a);
      y += Math.sin(a);
      const xi = ((Math.round(x) % size) + size) % size;
      const yi = ((Math.round(y) % size) + size) % size;
      h[yi * size + xi]! += strength;
    }
  }
  return { h, size };
}

/** Tangent-space normal map for paper fibers (linear data, tiles). */
export function createFiberNormalMap(opts: FiberOptions = {}, strength = 2.2): DataTexture {
  const { h, size } = fiberHeight(opts);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((-dx / l) * 127.5 + 127.5);
      data[i + 1] = Math.round((-dy / l) * 127.5 + 127.5);
      data[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Very subtle albedo variation (near white), multiplied into the paper color. */
export function createFiberAlbedo(opts: FiberOptions = {}, depth = 0.06): DataTexture {
  const { h, size } = fiberHeight({ ...opts, seed: (opts.seed ?? 7) + 1 });
  let max = 0;
  for (const v of h) max = Math.max(max, v);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(255 * (1 - depth + depth * (1 - h[i]! / max)));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface MatColors {
  readonly base: string;
  readonly minor: string;
  readonly major: string;
}

/** A self-healing cutting mat with a 10 mm grid: it helps people judge size. */
export function createCuttingMatTexture(colors: MatColors, mmAcross = 600, px = 2048): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors.base;
  ctx.fillRect(0, 0, px, px);
  const rnd = mulberry32(3);
  // Speckle so the mat doesn't look like flat plastic.
  for (let i = 0; i < px * 40; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(rnd() * px, rnd() * px, 1.5, 1.5);
  }
  const step = px / mmAcross;
  for (let mm = 0; mm <= mmAcross; mm += 10) {
    const major = mm % 50 === 0;
    ctx.strokeStyle = major ? colors.major : colors.minor;
    ctx.lineWidth = major ? 2.2 : 1;
    const p = Math.round(mm * step) + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
