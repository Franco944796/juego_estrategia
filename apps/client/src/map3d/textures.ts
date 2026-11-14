import {
  CanvasTexture,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
} from 'three';

/**
 * Layers of the surface arrays of models and scenery. Photos come from public/assets/tex (see
 * scripts/fetch-textures.mjs); `plain` is a flat layer and the last three are drawn here.
 */
export const BUILD_LAYERS = [
  'plain',
  'stone',
  'planks',
  'plaster',
  'roof',
  'thatch',
  'cobble',
  'bark',
  'boulder',
  'leaves',
  'needles',
  'blades',
] as const;
export type BuildLayer = (typeof BUILD_LAYERS)[number];
export const layerOf = (name: BuildLayer): number => BUILD_LAYERS.indexOf(name);
/** Layers from this one on are cut-out foliage cards. */
export const FOLIAGE_FROM = layerOf('leaves');

export const GROUND_LAYERS = ['grass', 'forest', 'rock', 'dirt', 'sand', 'snow'] as const;

/** Color layers hold the photo divided by its average, halved so brighter spots fit: 128 = unchanged. */
const NEUTRAL = 128;
const FLAT_NORMAL = 128;
const ROUGH = 235;

export interface LayerSet {
  /** rgb = color relative to the layer's average (x0.5), a = cut-out. */
  color: DataArrayTexture;
  /** rg = normal, b = roughness. */
  normal: DataArrayTexture;
  dispose(): void;
}

const linear = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function arrayTexture(data: Uint8Array, size: number, depth: number, anisotropy: number): DataArrayTexture {
  const t = new DataArrayTexture(data, size, size, depth);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

function filled(size: number, depth: number, rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(size * size * depth * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
}

function pixels(source: CanvasImageSource, size: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size, size);
  try {
    return ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Opened from disk (file://) the browser does not let the page read image pixels.
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function writeColor(target: Uint8Array, layer: number, size: number, src: Uint8ClampedArray): void {
  const n = size * size;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) mean[ch] = (mean[ch] ?? 0) + (linear[src[i * 4 + ch] ?? 0] ?? 0);
  }
  const base = layer * n * 4;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) {
      const ratio = (linear[src[i * 4 + ch] ?? 0] ?? 0) / Math.max(1e-4, (mean[ch] ?? 0) / n);
      target[base + i * 4 + ch] = Math.min(255, Math.round(ratio * NEUTRAL));
    }
    target[base + i * 4 + 3] = src[i * 4 + 3] ?? 255;
  }
}

function writeRaw(target: Uint8Array, layer: number, size: number, src: Uint8ClampedArray): void {
  target.set(src, layer * size * size * 4);
}

/** Seeded, so the drawn cards are the same on every load. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Drawer = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

/**
 * Clumps of broad leaves with gaps between them: grey shades around the neutral value, so the
 * tree's own color tints them.
 */
const drawLeaves: Drawer = (ctx, size, rand) => {
  const clumps = Array.from({ length: 11 }, () => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * size * 0.3;
    return { x: size / 2 + Math.cos(a) * r, y: size / 2 + Math.sin(a) * r, r: size * (0.1 + rand() * 0.08) };
  });
  const leaves = 1200;
  for (let i = 0; i < leaves; i++) {
    const clump = clumps[i % clumps.length];
    if (!clump) continue;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * clump.r;
    // Later leaves lie on top and catch more light.
    const shade = 45 + (i / leaves) * 95 + rand() * 60;
    const warm = rand() * 26 - 8;
    ctx.fillStyle = `rgb(${shade + warm}, ${shade + 6}, ${shade - warm * 1.5})`;
    ctx.beginPath();
    ctx.ellipse(
      clump.x + Math.cos(a) * r,
      clump.y + Math.sin(a) * r,
      size * (0.014 + rand() * 0.014),
      size * (0.007 + rand() * 0.008),
      rand() * Math.PI,
      0,
      7,
    );
    ctx.fill();
  }
};

/** A conifer bough seen flat: a stem with needles on both sides, hanging from the top middle. */
const drawNeedles: Drawer = (ctx, size, rand) => {
  ctx.lineCap = 'round';
  const bough = (x0: number, y0: number, x1: number, y1: number, width: number): void => {
    const steps = 46;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const reach = width * (1 - t * 0.75);
      for (const side of [-1, 1]) {
        const shade = 80 + rand() * 90;
        ctx.strokeStyle = `rgb(${shade - 6}, ${shade + 8}, ${shade - 4})`;
        ctx.lineWidth = size * 0.012;
        const nx = -(y1 - y0);
        const ny = x1 - x0;
        const len = Math.hypot(nx, ny) || 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + (nx / len) * side * reach + (x1 - x0) * 0.08,
          y + (ny / len) * side * reach + (y1 - y0) * 0.08 + rand() * size * 0.02,
        );
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgb(96, 84, 70)';
    ctx.lineWidth = size * 0.016;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  bough(size * 0.5, size * 0.02, size * 0.5, size * 0.97, size * 0.2);
  bough(size * 0.5, size * 0.1, size * 0.1, size * 0.8, size * 0.13);
  bough(size * 0.5, size * 0.1, size * 0.9, size * 0.8, size * 0.13);
};

/** A tuft of grass blades growing from the bottom edge. */
const drawBlades: Drawer = (ctx, size, rand) => {
  for (let i = 0; i < 46; i++) {
    const x = size * (0.12 + rand() * 0.76);
    const lean = (rand() - 0.5) * size * 0.4;
    const h = size * (0.4 + rand() * 0.55);
    const w = size * (0.016 + rand() * 0.016);
    const shade = 85 + rand() * 95;
    ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade - 14})`;
    ctx.beginPath();
    ctx.moveTo(x - w, size);
    ctx.quadraticCurveTo(x + lean * 0.3, size - h * 0.6, x + lean, size - h);
    ctx.quadraticCurveTo(x + lean * 0.4, size - h * 0.5, x + w, size);
    ctx.fill();
  }
};

const DRAWN: Partial<Record<string, Drawer>> = {
  leaves: drawLeaves,
  needles: drawNeedles,
  blades: drawBlades,
};

function drawnPixels(draw: Drawer, size: number, seed: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  draw(ctx, size, lcg(seed));
  const data = ctx.getImageData(0, 0, size, size).data;
  // Empty pixels get a mid grey: smaller mip levels blend them in, and black would rim the cards.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) data.set([105, 110, 100], i);
  }
  return data;
}

/**
 * The surface arrays for `names`, flat at first; the photos replace the flat layers once they have
 * all arrived (or stay flat if they cannot be read).
 */
export function loadLayers(names: readonly string[], size: number, anisotropy: number): LayerSet {
  const depth = names.length;
  const color = arrayTexture(filled(1, depth, [NEUTRAL, NEUTRAL, NEUTRAL, 255]), 1, depth, 1);
  const normal = arrayTexture(filled(1, depth, [FLAT_NORMAL, FLAT_NORMAL, ROUGH, 255]), 1, depth, 1);
  let disposed = false;

  const fill = async (): Promise<void> => {
    const colors = filled(size, depth, [NEUTRAL, NEUTRAL, NEUTRAL, 255]);
    const normals = filled(size, depth, [FLAT_NORMAL, FLAT_NORMAL, ROUGH, 255]);
    let photos = 0;
    await Promise.all(
      names.map(async (name, layer) => {
        const draw = DRAWN[name];
        if (draw) {
          const drawn = drawnPixels(draw, size, layer + 1);
          // Cards are not normalized: their greys already sit around the neutral value.
          if (drawn) writeRaw(colors, layer, size, drawn);
          return;
        }
        if (name === 'plain') return;
        const base = new URL(`assets/tex/${size}/${name}`, document.baseURI).href;
        const [d, n] = await Promise.all([loadImage(`${base}_d.webp`), loadImage(`${base}_n.webp`)]);
        const dp = d && pixels(d, size);
        const np = n && pixels(n, size);
        if (!dp || !np) return;
        writeColor(colors, layer, size, dp);
        writeRaw(normals, layer, size, np);
        photos++;
      }),
    );
    if (disposed) return;
    for (const [texture, data] of [
      [color, colors],
      [normal, normals],
    ] as const) {
      // A new size needs new storage on the GPU, which three allocates after a dispose.
      texture.dispose();
      texture.image = { data, width: size, height: size, depth };
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
    if (photos === 0) console.info('3D map: surface photos not available, using flat colors');
  };
  void fill();

  return {
    color,
    normal,
    dispose: () => {
      disposed = true;
      color.dispose();
      normal.dispose();
    },
  };
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that repeats every `period` cells. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const at = (i: number, j: number): number =>
    hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(xi, yi);
  const b = at(xi + 1, yi);
  const c = at(xi, yi + 1);
  const d = at(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tileFbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = cells;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise(u * period, v * period, period, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function repeating(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/**
 * Seamless cloud noise: r = billowy clouds, g = finer detail, b = the same as r seen a little to the
 * side (shaders light the clouds with the difference). Used for the cloud sea and cloud shadows.
 */
export function cloudNoise(size = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return repeating(canvas);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const o = (y * size + x) * 4;
      image.data[o] = tileFbm(u, v, 4, 5, 3) * 255;
      image.data[o + 1] = tileFbm(u, v, 16, 3, 9) * 255;
      image.data[o + 2] = tileFbm(u + 0.012, v + 0.008, 4, 5, 3) * 255;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return repeating(canvas);
}

/** Seamless ripples for water: rg = slope of a noise field, as a normal map. */
export function rippleNormals(size = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return repeating(canvas);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = tileFbm(x / size, y / size, 6, 4, 21);
  }
  const at = (x: number, y: number): number => h[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  const image = ctx.createImageData(size, size);
  const strength = 0.9 * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      image.data[o] = (-dx / len) * 127.5 + 127.5;
      image.data[o + 1] = (-dy / len) * 127.5 + 127.5;
      image.data[o + 2] = (1 / len) * 127.5 + 127.5;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return repeating(canvas);
}
