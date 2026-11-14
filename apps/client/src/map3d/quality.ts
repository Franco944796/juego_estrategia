export type Quality = 'high' | 'medium' | 'low';
export type QualitySetting = Quality | 'auto';

export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'high', 'medium', 'low'];

export interface QualityPreset {
  antialias: boolean;
  maxPixelRatio: number;
  /** Shadow map side in texels; 0 turns shadows off. */
  shadowMap: number;
  /** Side of each isle's ground texture in pixels. */
  groundTexture: number;
  /** Distance between terrain vertices, in world units. */
  terrainStep: number;
  /** Share of the full tree, rock and bush count. */
  scenery: number;
  /** Texture filtering of the tilted ground; costly on weak GPUs. */
  anisotropy: number;
  /**
   * Side in pixels of the photographed surface textures (stone, wood, grass…); 0 keeps the flat
   * colors, the cheap lights and the simple trees of the first 3D map.
   */
  detail: 0 | 256 | 512;
  /** Screen passes: `full` adds ambient occlusion and edge smoothing to the glow and color of `lite`. */
  post: 'full' | 'lite' | 'none';
  /** The sea of clouds under the isles (a shader over the whole background). */
  cloudSea: boolean;
  /** Side of each isle's territory texture in pixels. */
  territory: number;
  /** Grass tufts and flowers. */
  groundCover: boolean;
  /** Chimney smoke and march dust. */
  particles: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  high: {
    antialias: true,
    maxPixelRatio: 2,
    shadowMap: 2048,
    groundTexture: 2048,
    terrainStep: 7,
    scenery: 1,
    anisotropy: 8,
    detail: 512,
    post: 'full',
    cloudSea: true,
    territory: 768,
    groundCover: true,
    particles: true,
  },
  medium: {
    antialias: true,
    maxPixelRatio: 1.5,
    shadowMap: 1024,
    groundTexture: 1024,
    terrainStep: 9,
    scenery: 0.7,
    anisotropy: 4,
    detail: 256,
    post: 'lite',
    cloudSea: true,
    territory: 512,
    groundCover: true,
    particles: true,
  },
  low: {
    antialias: false,
    maxPixelRatio: 1,
    shadowMap: 0,
    groundTexture: 1024,
    terrainStep: 13,
    scenery: 0.4,
    anisotropy: 1,
    detail: 0,
    post: 'none',
    cloudSea: false,
    territory: 512,
    groundCover: false,
    particles: false,
  },
};

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

function rendererName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** A guess from the hardware the browser reports; phones get medium, software WebGL gets low. */
export function detectQuality(): Quality {
  const cores = navigator.hardwareConcurrency || 4;
  // Chrome caps deviceMemory at 8 and Safari does not report it.
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  if (SOFTWARE_GL.test(rendererName())) return 'low';
  if (cores <= 4 || memory <= 2) return 'low';
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (touch || cores <= 6 || memory <= 4) return 'medium';
  return 'high';
}

let detected: Quality | null = null;

export function resolveQuality(setting: QualitySetting): Quality {
  if (setting !== 'auto') return setting;
  detected ??= detectQuality();
  return detected;
}

/** Called when «auto» runs too slow, so the rest of the session uses the next level down. */
export function lowerAutoQuality(): boolean {
  const current = resolveQuality('auto');
  const next: Quality | null = current === 'high' ? 'medium' : current === 'medium' ? 'low' : null;
  if (!next) return false;
  detected = next;
  return true;
}
