import type { Material } from 'three';

/** Seconds of animation, shared by every animated material. */
export const animClock = { value: 0 };

/** Leg swing of marching soldiers in radians per second; world3d bobs the bodies at the same rate. */
export const STEP_RATE = 1000 / 140;
/** Wing beats of a flying dragon, in radians per second. */
const WING_RATE = 6;

/**
 * Moves vertices with the `anim` attribute (see models.ts): x = flutter of cloth and flames along z
 * (phase from the instance position), y = leg and arm swing along z (all in step), z = wing beat along
 * y, scaled by the per-instance `flap` (dragons only; it reads 0 on every other mesh).
 */
export function animated<T extends Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animClock;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 anim;\nattribute float flap;\nuniform float uTime;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
        float animPhase = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
#else
        float animPhase = 0.0;
#endif
        transformed.z += sin(uTime * 4.0 + position.x * 1.7 + position.y * 0.9 + animPhase) * anim.x;
        transformed.z += sin(uTime * ${STEP_RATE.toFixed(3)}) * anim.y;
        transformed.y += sin(uTime * ${WING_RATE.toFixed(3)}) * anim.z * flap;`,
      );
  };
  material.customProgramCacheKey = () => 'anim';
  return material;
}
