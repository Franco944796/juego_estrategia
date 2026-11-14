import {
  BufferAttribute,
  Color,
  MeshDepthMaterial,
  Vector2,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { FOLIAGE_FROM, type LayerSet } from './textures';

type Shader = WebGLProgramParametersWithUniforms;

/** A change to a built-in material's shader; several can be stacked on one material. */
export interface Patch {
  key: string;
  apply(shader: Shader): void;
}

export function patched<T extends Material>(material: T, ...patches: (Patch | null)[]): T {
  const list = patches.filter((p): p is Patch => p !== null);
  material.onBeforeCompile = (shader) => {
    for (const p of list) p.apply(shader);
  };
  material.customProgramCacheKey = () => list.map((p) => p.key).join('+');
  return material;
}

/** Uniforms every patched material reads; world3d.ts sets them once per frame. */
export const shared = {
  uTime: { value: 0 },
  /** 0 by day, 1 at night: windows light up. */
  uNight: { value: 0 },
  uWindow: { value: new Color('#ffb45e') },
  uCloudTex: { value: null as Texture | null },
  uCloudDrift: { value: new Vector2() },
  /** How much a cloud shadow dims direct light. */
  uCloudShade: { value: 0 },
};

function vertex(shader: Shader, pars: string, main: string, after = '#include <project_vertex>'): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${pars}`)
    .replace(after, `${after}\n${main}`);
}

function fragment(shader: Shader, pars: string, edits: [string, string][]): void {
  let src = shader.fragmentShader.replace('#include <common>', `#include <common>\n${pars}`);
  for (const [after, code] of edits) src = src.replace(after, `${after}\n${code}`);
  shader.fragmentShader = src;
}

/** Gives the fragment shader `vSiWorld`, the world position. Other patches rely on it. */
export const worldPos: Patch = {
  key: 'world',
  apply(shader) {
    vertex(
      shader,
      'varying vec3 vSiWorld;',
      `vec4 siWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
      siWorld = instanceMatrix * siWorld;
#endif
      vSiWorld = ( modelMatrix * siWorld ).xyz;`,
    );
    fragment(shader, 'varying vec3 vSiWorld;', []);
  },
};

/** Drifting cloud shadows over anything lit; needs `worldPos` before it. */
export const cloudShadow: Patch = {
  key: 'cloud',
  apply(shader) {
    shader.uniforms.uCloudTex = shared.uCloudTex;
    shader.uniforms.uCloudDrift = shared.uCloudDrift;
    shader.uniforms.uCloudShade = shared.uCloudShade;
    fragment(shader, 'uniform sampler2D uCloudTex;\nuniform vec2 uCloudDrift;\nuniform float uCloudShade;', [
      [
        '#include <lights_fragment_end>',
        `float siCloud = texture2D( uCloudTex, vSiWorld.xz * 0.0011 + uCloudDrift ).r;
        float siSun = 1.0 - uCloudShade * smoothstep( 0.5, 0.72, siCloud );
        reflectedLight.directDiffuse *= siSun;
        reflectedLight.directSpecular *= siSun;`,
      ],
    ]);
  },
};

const TANGENT_FRAME = `
mat3 siTangentFrame( vec3 eyePos, vec3 n, vec2 uv ) {
  vec3 q0 = dFdx( eyePos );
  vec3 q1 = dFdy( eyePos );
  vec2 st0 = dFdx( uv );
  vec2 st1 = dFdy( uv );
  vec3 q1perp = cross( q1, n );
  vec3 q0perp = cross( n, q0 );
  vec3 t = q1perp * st0.x + q0perp * st1.x;
  vec3 b = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( t, t ), dot( b, b ) );
  float scale = det == 0.0 ? 0.0 : inversesqrt( det );
  return mat3( t * scale, b * scale, n );
}`;

/**
 * Photographed surfaces for models and scenery. Geometry carries `uv` (see `projectUv`) and `surf`:
 * x = layer of the array, y = glow (1 = window, lit at night; 2 = always shines in its own color).
 * The vertex color tints the photo, so skins and owner colors keep working.
 */
export function detail(layers: LayerSet, glow = 1): Patch {
  return {
    key: `detail${glow}`,
    apply(shader) {
      const standard = shader.fragmentShader.includes('#include <roughnessmap_fragment>');
      shader.uniforms.siColor = { value: layers.color };
      shader.uniforms.siNormal = { value: layers.normal };
      shader.uniforms.uNight = shared.uNight;
      shader.uniforms.uWindow = shared.uWindow;
      vertex(
        shader,
        'attribute vec2 surf;\nvarying vec2 vSurf;\nvarying vec2 vSiUv;',
        'vSurf = surf;\nvSiUv = uv;',
        '#include <begin_vertex>',
      );
      fragment(
        shader,
        `uniform sampler2DArray siColor;
uniform sampler2DArray siNormal;
uniform float uNight;
uniform vec3 uWindow;
varying vec2 vSurf;
varying vec2 vSiUv;
${TANGENT_FRAME}`,
        [
          [
            '#include <map_fragment>',
            `float siLayer = floor( vSurf.x + 0.5 );
            vec4 siD = texture( siColor, vec3( vSiUv, siLayer ) );
            vec4 siN = texture( siNormal, vec3( vSiUv, siLayer ) );
            diffuseColor.rgb *= pow( siD.rgb * 2.0, vec3( 1.35 ) );
            diffuseColor.a *= siD.a;`,
          ],
          [
            '#include <normal_fragment_begin>',
            `#ifdef DOUBLE_SIDED
            // Foliage cards keep the rounded normals of their crown on both faces.
            if ( siLayer >= ${FOLIAGE_FROM.toFixed(1)} ) normal *= faceDirection;
#endif`,
          ],
          [
            '#include <normal_fragment_maps>',
            `vec3 siBump = vec3( siN.rg * 2.0 - 1.0, 0.0 );
            siBump.z = sqrt( max( 0.0, 1.0 - dot( siBump.xy, siBump.xy ) ) );
            if ( siLayer < ${FOLIAGE_FROM.toFixed(1)} ) {
              normal = normalize( siTangentFrame( - vViewPosition, normal, vSiUv ) * siBump );
            }`,
          ],
          ...(standard
            ? ([['#include <roughnessmap_fragment>', 'roughnessFactor *= siN.b;']] as [string, string][])
            : []),
          [
            '#include <emissivemap_fragment>',
            `float siLit = step( 0.5, vSurf.y ) * step( vSurf.y, 1.5 );
            totalEmissiveRadiance += uWindow * siLit * uNight * ${glow.toFixed(2)};
            totalEmissiveRadiance += diffuseColor.rgb * step( 1.5, vSurf.y ) * ${(glow * 1.6).toFixed(2)};`,
          ],
        ],
      );
    },
  };
}

/** Trees and grass lean with the wind: more the higher a vertex stands, each plant with its own phase. */
export const sway: Patch = {
  key: 'sway',
  apply(shader) {
    shader.uniforms.uTime = shared.uTime;
    vertex(
      shader,
      'uniform float uTime;',
      `#ifdef USE_INSTANCING
      float siPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
      float siPhase = 0.0;
#endif
      float siBend = max( 0.0, position.y - 0.4 ) * 0.022;
      transformed.x += sin( uTime * 1.4 + siPhase ) * siBend;
      transformed.z += cos( uTime * 1.1 + siPhase * 1.7 ) * siBend;`,
      '#include <begin_vertex>',
    );
  },
};

/** The depth material for cut-out scenery, so shadows have the shape of the leaves. */
export function cutoutDepth(layers: LayerSet): MeshDepthMaterial {
  const patch: Patch = {
    key: 'cutout',
    apply(shader) {
      shader.uniforms.siColor = { value: layers.color };
      vertex(
        shader,
        'attribute vec2 surf;\nvarying vec2 vSurf;\nvarying vec2 vSiUv;',
        'vSurf = surf;\nvSiUv = uv;',
        '#include <begin_vertex>',
      );
      fragment(shader, 'uniform sampler2DArray siColor;\nvarying vec2 vSurf;\nvarying vec2 vSiUv;', [
        [
          '#include <map_fragment>',
          'if ( texture( siColor, vec3( vSiUv, floor( vSurf.x + 0.5 ) ) ).a < 0.4 ) discard;',
        ],
      ]);
    },
  };
  return patched(new MeshDepthMaterial(), sway, patch);
}

/**
 * Maps `uv` onto flat-shaded, non-indexed geometry, `scale` texture repeats per unit: on every face
 * u runs level and v runs up the slope, so courses of stone, boards and rows of roof tiles lie
 * level on walls, towers and roofs alike. Level faces map (x, z).
 */
export function projectUv(g: BufferGeometry, scale: number): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax;
    const uy = pos.getY(i + 1) - ay;
    const uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax;
    const vy = pos.getY(i + 2) - ay;
    const vz = pos.getZ(i + 2) - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const flat = Math.hypot(nx, nz);
    // Level direction along the face, and the direction up its slope.
    const cx = nz / (flat || 1);
    const cz = -nx / (flat || 1);
    const sx = ny * cz;
    const sy = nz * cx - nx * cz;
    const sz = -ny * cx;
    for (let k = i; k < i + 3; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      if (flat < 0.2) uv.set([x * scale, z * scale], k * 2);
      else uv.set([(x * cx + z * cz) * scale, (x * sx + y * sy + z * sz) * scale], k * 2);
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}

/** Sets the `surf` attribute of every vertex. */
export function setSurf(g: BufferGeometry, layer: number, glow = 0): BufferGeometry {
  const n = g.getAttribute('position').count;
  const surf = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) surf.set([layer, glow], i * 2);
  g.setAttribute('surf', new BufferAttribute(surf, 2));
  return g;
}

export interface GroundMaps {
  layers: LayerSet;
  /** Lords' territory, premultiplied, over the same square as the ground color. */
  territory: Texture;
  /** r = forest floor, g = rock, b = sand, a = snow; rows run toward +z. */
  splat: Texture;
  /** r = trodden earth: roads and the yards of towns. */
  paths: Texture;
}

/** World units covered by one repeat of the ground photos. */
const GROUND_TILE = 11;

const GROUND_AXES = `
            vec3 siEast = normalize( ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
            vec3 siNorth = normalize( ( viewMatrix * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz );`;

/**
 * The top of an isle: the painted ground gives the color of each place and the photos of grass,
 * forest floor, rock, earth, sand and snow give its grain and relief. Needs `worldPos`.
 */
export function ground(maps: GroundMaps): Patch {
  return {
    key: 'ground',
    apply(shader) {
      shader.uniforms.siColor = { value: maps.layers.color };
      shader.uniforms.siNormal = { value: maps.layers.normal };
      shader.uniforms.territoryMap = { value: maps.territory };
      shader.uniforms.siSplat = { value: maps.splat };
      shader.uniforms.siPaths = { value: maps.paths };
      const blend = (layer: number, weight: string): string => `
            if ( ${weight} > 0.02 ) {
              siAlbedo = mix( siAlbedo, textureGrad( siColor, vec3( siUv, ${layer}.0 ), siDx, siDy ).rgb, ${weight} );
              siRelief = mix( siRelief, textureGrad( siNormal, vec3( siUv, ${layer}.0 ), siDx, siDy ).rgb, ${weight} );
            }`;
      fragment(
        shader,
        `uniform sampler2DArray siColor;
uniform sampler2DArray siNormal;
uniform sampler2D territoryMap;
uniform sampler2D siSplat;
uniform sampler2D siPaths;`,
        [
          [
            '#include <map_fragment>',
            `vec4 siWeights = texture2D( siSplat, vec2( vMapUv.x, 1.0 - vMapUv.y ) );
            float siEarth = texture2D( siPaths, vMapUv ).r;
            vec2 siUv = vec2( vSiWorld.x, - vSiWorld.z ) / ${GROUND_TILE.toFixed(1)};
            vec2 siDx = dFdx( siUv );
            vec2 siDy = dFdy( siUv );
            vec3 siAlbedo = textureGrad( siColor, vec3( siUv, 0.0 ), siDx, siDy ).rgb;
            vec3 siRelief = textureGrad( siNormal, vec3( siUv, 0.0 ), siDx, siDy ).rgb;
            ${blend(1, 'siWeights.r')}
            ${blend(2, 'siWeights.g')}
            ${blend(4, 'siWeights.b')}
            ${blend(5, 'siWeights.a')}
            ${blend(3, 'siEarth')}
            // The photos are pushed a little past their own contrast: seen from this far they flatten.
            diffuseColor.rgb *= pow( siAlbedo * 2.0, vec3( 1.5 ) );
            vec4 territory = texture2D( territoryMap, vMapUv );
            diffuseColor.rgb = diffuseColor.rgb * ( 1.0 - territory.a ) + territory.rgb;`,
          ],
          ['#include <roughnessmap_fragment>', 'roughnessFactor *= siRelief.b;'],
          [
            '#include <normal_fragment_maps>',
            `vec3 siBump = vec3( siRelief.rg * 2.0 - 1.0, 0.0 );
            siBump.z = sqrt( max( 0.0, 1.0 - dot( siBump.xy, siBump.xy ) ) );
            ${GROUND_AXES}
            normal = normalize( siEast * siBump.x + siNorth * siBump.y + normal * siBump.z );`,
          ],
        ],
      );
    },
  };
}

export interface WaterMaps {
  /** r = depth of the lake bed under the water level (0 at the shore, 1 deep); rows run toward +z. */
  depth: Texture;
  ripples: Texture;
  /** The square of world space the depth map covers. */
  x0: number;
  z0: number;
  span: number;
}

/**
 * Lakes: clear at the shore and dark where deep, with a line of foam, ripples that drift and the
 * sky reflected on them. Needs `worldPos`.
 */
export function water(maps: WaterMaps): Patch {
  return {
    key: 'water',
    apply(shader) {
      shader.uniforms.siDepth = { value: maps.depth };
      shader.uniforms.siRipples = { value: maps.ripples };
      shader.uniforms.siArea = { value: [maps.x0, maps.z0, maps.span] };
      shader.uniforms.uTime = shared.uTime;
      fragment(
        shader,
        `uniform sampler2D siDepth;
uniform sampler2D siRipples;
uniform vec3 siArea;
uniform float uTime;`,
        [
          [
            '#include <map_fragment>',
            `float siDeep = texture2D( siDepth, ( vSiWorld.xz - siArea.xy ) / siArea.z ).r;
            vec2 siFlow = vSiWorld.xz * 0.055;
            vec3 siR1 = texture2D( siRipples, siFlow + uTime * vec2( 0.011, 0.007 ) ).rgb * 2.0 - 1.0;
            vec3 siR2 = texture2D( siRipples, siFlow * 1.9 - uTime * vec2( 0.008, 0.013 ) ).rgb * 2.0 - 1.0;
            vec2 siRipple = ( siR1.xy + siR2.xy ) * 0.5;
            vec3 siShallow = vec3( 0.13, 0.36, 0.34 );
            vec3 siDark = vec3( 0.015, 0.075, 0.13 );
            diffuseColor.rgb = mix( siShallow, siDark, smoothstep( 0.05, 0.75, siDeep ) );
            float siFoam = smoothstep( 0.13, 0.04, siDeep ) * smoothstep( - 0.25, 0.35, siRipple.x + siRipple.y );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.85, 0.9, 0.9 ), siFoam * 0.75 );
            diffuseColor.a = smoothstep( 0.0, 0.05, siDeep ) * mix( 0.62, 0.96, smoothstep( 0.0, 0.6, siDeep ) );`,
          ],
          ['#include <roughnessmap_fragment>', 'roughnessFactor = mix( roughnessFactor, 0.7, siFoam );'],
          [
            '#include <normal_fragment_maps>',
            `${GROUND_AXES}
            normal = normalize( normal + ( siEast * siRipple.x + siNorth * siRipple.y ) * 0.28 );`,
          ],
        ],
      );
    },
  };
}
