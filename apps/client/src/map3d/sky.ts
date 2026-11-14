import {
  BackSide,
  CircleGeometry,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { Daylight } from './daylight';

/** Height of the cloud sea: the rocky roots of the isles sink into it. */
const SEA_LEVEL = -120;
const SEA_RADIUS = 9000;

const DOME_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const DOME_FRAGMENT = `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 cloud;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform sampler2D noise;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float up = max( d.y, 0.0 );
  vec3 col = mix( horizon, zenith, pow( up, 0.5 ) );
  float cover = smoothstep( 0.5, 0.75, texture2D( noise, d.xz / ( up + 0.12 ) * 0.12 ).r );
  col = mix( col, cloud, cover * smoothstep( 0.0, 0.2, up ) * 0.8 );
  float s = max( dot( d, sunDir ), 0.0 );
  col += sunColor * ( pow( s, 600.0 ) * 6.0 + pow( s, 24.0 ) * 0.5 );
  col = mix( col, ground, smoothstep( 0.02, -0.2, d.y ) );
  gl_FragColor = vec4( col, 1.0 );
}`;

const SEA_VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const SEA_FRAGMENT = `
uniform sampler2D noise;
uniform vec2 drift;
uniform vec3 lit;
uniform vec3 shade;
uniform vec3 abyss;
uniform vec3 haze;
uniform vec2 eye;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz * 0.0007;
  vec4 a = texture2D( noise, p + drift );
  vec4 b = texture2D( noise, p * 3.1 - drift * 1.7 );
  float n = a.r * 0.72 + b.r * 0.28;
  // The b channel is the same noise seen a little to the side: the difference shades the billows.
  float relief = clamp( ( n - ( a.b * 0.72 + b.b * 0.28 ) ) * 9.0 + 0.5, 0.0, 1.0 );
  vec3 cloud = mix( shade, lit, relief * 0.65 + 0.35 * smoothstep( 0.5, 0.8, n ) );
  float below = texture2D( noise, p * 0.45 + drift * 0.5 + 0.37 ).r;
  vec3 deep = mix( abyss, shade, smoothstep( 0.35, 0.7, below ) * 0.55 );
  vec3 col = mix( deep, cloud, smoothstep( 0.4, 0.62, n ) );
  col = mix( col, haze, smoothstep( 1500.0, 7000.0, distance( vWorld.xz, eye ) ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * What surrounds the isles: the sky that surfaces reflect and are lit by (never on screen: the
 * camera always looks down) and the sea of clouds below, which is the whole background.
 */
export class Atmosphere {
  private readonly pmrem: PMREMGenerator;
  private readonly probe = new Scene();
  private readonly dome: ShaderMaterial;
  private readonly sea: ShaderMaterial | null = null;
  private readonly seaMesh: Mesh | null = null;
  private env: WebGLRenderTarget | null = null;
  private key = '';

  constructor(renderer: WebGLRenderer, noise: Texture, parent: Scene, withSea: boolean) {
    this.pmrem = new PMREMGenerator(renderer);
    this.dome = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      uniforms: {
        zenith: { value: new Color() },
        horizon: { value: new Color() },
        ground: { value: new Color() },
        cloud: { value: new Color() },
        sunDir: { value: new Vector3(0, 1, 0) },
        sunColor: { value: new Color() },
        noise: { value: noise },
      },
    });
    this.probe.add(new Mesh(new SphereGeometry(50, 32, 16), this.dome));
    if (withSea) {
      this.sea = new ShaderMaterial({
        vertexShader: SEA_VERTEX,
        fragmentShader: SEA_FRAGMENT,
        uniforms: {
          noise: { value: noise },
          drift: { value: new Vector2() },
          lit: { value: new Color() },
          shade: { value: new Color() },
          abyss: { value: new Color() },
          haze: { value: new Color() },
          eye: { value: new Vector2() },
        },
      });
      this.seaMesh = new Mesh(new CircleGeometry(SEA_RADIUS, 48).rotateX(-Math.PI / 2), this.sea);
      this.seaMesh.position.y = SEA_LEVEL;
      this.seaMesh.frustumCulled = false;
      parent.add(this.seaMesh);
    }
  }

  /** Colors of the hour; the reflected sky is rebuilt only when the light has moved. */
  apply(scene: Scene, light: Daylight, reflect: boolean): void {
    if (this.sea) {
      const u = this.sea.uniforms;
      (u.lit?.value as Color).copy(light.cloudLit);
      (u.shade?.value as Color).copy(light.cloudShade);
      (u.abyss?.value as Color).copy(light.abyss);
      (u.haze?.value as Color).copy(light.haze);
    }
    if (!reflect || light.key === this.key) return;
    this.key = light.key;
    const u = this.dome.uniforms;
    (u.zenith?.value as Color).copy(light.zenith);
    (u.horizon?.value as Color).copy(light.horizon);
    (u.ground?.value as Color).copy(light.cloudShade);
    (u.cloud?.value as Color).copy(light.cloudLit);
    (u.sunDir?.value as Vector3).copy(light.toLight);
    (u.sunColor?.value as Color).copy(light.light).multiplyScalar(light.lightPower);
    const next = this.pmrem.fromScene(this.probe, 0.03);
    this.env?.dispose();
    this.env = next;
    scene.environment = next.texture;
    scene.environmentIntensity = light.envPower;
  }

  /** Keeps the sea under the camera and lets the clouds drift. */
  update(x: number, z: number, drift: Vector2): void {
    if (!this.sea || !this.seaMesh) return;
    this.seaMesh.position.x = x;
    this.seaMesh.position.z = z;
    (this.sea.uniforms.eye?.value as Vector2).set(x, z);
    (this.sea.uniforms.drift?.value as Vector2).copy(drift).multiplyScalar(0.6);
  }

  dispose(): void {
    this.env?.dispose();
    this.pmrem.dispose();
    this.dome.dispose();
    this.sea?.dispose();
  }
}
