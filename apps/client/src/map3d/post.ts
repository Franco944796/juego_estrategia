import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { HalfFloatType, type Camera, type Scene, type WebGLRenderer } from 'three';

/** Lights brighter than this bloom: only fires, runes, crystals and lit windows reach it. */
const BLOOM_FROM = 1.15;

/**
 * The screen passes after the scene is drawn: glow, film-like tones and color; `full` adds contact
 * shadows (ambient occlusion) and smoothed edges.
 */
export function buildPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  level: 'full' | 'lite',
  antialias: boolean,
): EffectComposer {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    // The occlusion pass reads depth, which multisampled targets do not give it.
    multisampling: level === 'lite' && antialias ? 4 : 0,
  });
  composer.addPass(new RenderPass(scene, camera));
  if (level === 'full') {
    const ao = new N8AOPostPass(scene, camera);
    ao.configuration.aoRadius = 5;
    ao.configuration.distanceFalloff = 1;
    ao.configuration.intensity = 2.6;
    // Not at half size: n8ao 2.0.1's half-size targets break on three r187 (its render target
    // shim returns an array where three now expects one texture).
    ao.setQualityMode('Low');
    composer.addPass(ao);
  }
  const bloom = new BloomEffect({
    luminanceThreshold: BLOOM_FROM,
    luminanceSmoothing: 0.25,
    intensity: level === 'full' ? 0.9 : 0.7,
    mipmapBlur: true,
    radius: 0.72,
    levels: level === 'full' ? 7 : 5,
  });
  const effects = [
    bloom,
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    new HueSaturationEffect({ saturation: 0.08 }),
    new BrightnessContrastEffect({ contrast: 0.06 }),
    new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
  ];
  composer.addPass(new EffectPass(camera, ...effects));
  if (level === 'full')
    composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  return composer;
}
