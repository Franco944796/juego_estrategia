import { WIND_VECTORS, type LordView } from '@si/engine';
import {
  BackSide,
  InstancedBufferAttribute,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Camera, Size, Vec } from '../map/camera';
import { ownerColor, townById } from '../ui/labels';
import { animClock, animated, STEP_RATE } from './animate';
import { Bridges, type BridgeTop } from './bridges';
import { placeCamera, TILT } from './camera3d';
import {
  BEACON_CRYSTAL_HEIGHT,
  buildBanner,
  buildBeacon,
  buildBeaconCrystal,
  buildDragon,
  buildSoldier,
  buildStages,
  DRAGON_PERCH,
  STAGE_SCALE,
  stageFor,
  UNIT_SCALE,
  type Model,
} from './models';
import { QUALITY, type Quality, type QualityPreset } from './quality';
import { beaconSpot, buildIsle, groundArea, scatter, WATER_LEVEL, type IsleField } from './terrain';
import { Territory } from './territory';

export interface Scene3DInput {
  view: LordView;
  cam: Camera;
  size: Size;
  time: number;
  gameNow: number;
  selected: number | null;
  sendFrom: number | null;
  highlight: number | null;
  /** Towns the selected one may target while picking a destination. */
  targets: Set<number> | null;
}

const SKY = '#5b8fc9';
const NEUTRAL_ROOF = '#d9cfbf';
const OUTLINE = '#1c1712';
const UNLIT_FIRE = '#3a3f47';
/** Marching soldiers float this high on flights between isles. */
export const FLIGHT_HEIGHT = 9;
const SOLDIERS = 3;
const CLOUDS = 28;
const PUFFS = 3;
const SMOKE_CAPACITY = 1200;
const DUST_CAPACITY = 256 * PUFFS;
/** Toward the sun: from the upper left, a little in front, so shadows fall right and back. */
const SUN_DIR = new Vector3(-0.7, 1.1, 0.35).normalize();
const SUN_DISTANCE = 700;
const FOG_NEAR = 900;
const FOG_FAR = 2600;

const dummy = new Object3D();
const tint = new Color();
const spot = new Vector3();

function lambert(color = '#ffffff', vertexColors = true): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, vertexColors, flatShading: true });
}

/** A fixed part and a part painted per instance, both sharing the instance transforms. */
class Pair {
  readonly fixed: InstancedMesh;
  readonly team: InstancedMesh;
  private readonly outline: InstancedMesh | null;

  /** Per-instance wing beat strength (dragons only); see animate.ts. */
  private readonly flaps: InstancedBufferAttribute[] = [];

  constructor(
    model: Model,
    capacity: number,
    parent: Group,
    team: Material = animated(lambert()),
    outline: Material | null = null,
    flapping = false,
  ) {
    if (flapping) {
      for (const g of [model.fixed, model.team]) {
        const flap = new InstancedBufferAttribute(new Float32Array(capacity), 1);
        flap.setUsage(DynamicDrawUsage);
        g.setAttribute('flap', flap);
        this.flaps.push(flap);
      }
    }
    this.fixed = new InstancedMesh(model.fixed, animated(lambert()), capacity);
    this.team = new InstancedMesh(model.team, team, capacity);
    this.outline = outline ? new InstancedMesh(model.outline, outline, capacity) : null;
    if (this.outline) {
      this.outline.instanceMatrix.setUsage(DynamicDrawUsage);
      this.outline.count = 0;
      this.outline.frustumCulled = false;
      parent.add(this.outline);
    }
    for (const mesh of [this.fixed, this.team]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      // Instances spread over the whole map; per-instance culling is not worth it here.
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.team.setColorAt(0, tint.set('#ffffff'));
  }

  get capacity(): number {
    return this.fixed.instanceMatrix.count;
  }

  place(i: number, matrix: Object3D['matrix'], color: string, flap = 0): void {
    for (const f of this.flaps) f.setX(i, flap);
    this.fixed.setMatrixAt(i, matrix);
    this.team.setMatrixAt(i, matrix);
    this.team.setColorAt(i, tint.set(color));
    this.outline?.setMatrixAt(i, matrix);
  }

  finish(count: number): void {
    this.fixed.count = count;
    this.team.count = count;
    this.fixed.instanceMatrix.needsUpdate = true;
    this.team.instanceMatrix.needsUpdate = true;
    if (this.team.instanceColor) this.team.instanceColor.needsUpdate = true;
    for (const f of this.flaps) f.needsUpdate = true;
    if (this.outline) {
      this.outline.count = count;
      this.outline.instanceMatrix.needsUpdate = true;
    }
  }
}

interface DragonHome {
  /** The dragon's seat on the donjon, in world space. */
  perch: Vector3;
  x: number;
  z: number;
  turn: number;
  scale: number;
  color: string;
  phase: number;
}

const DRAGON_STAGE = 5;
const DRAGON_CAPACITY = 64;
const DRAGON_CYCLE_MS = 32_000;
/** Shares of the cycle: resting until TAKEOFF, rising until CIRCLE, circling until LAND. */
const DRAGON_TAKEOFF = 0.55;
const DRAGON_CIRCLE = 0.62;
const DRAGON_LAND = 0.92;
/** The dragon is bigger than the castle's own scale, so it is the first thing seen on the map. */
const DRAGON_SCALE = 1.6;
const DRAGON_RADIUS = 40;
const DRAGON_ALTITUDE = 16;
const DRAGON_BANK = 0.35;
/** A resting dragon's wings still stir a little. */
const DRAGON_REST_FLAP = 0.12;

/** Where a castle's dragon is at cycle share `u` (wraps past 1). */
function dragonAt(home: DragonHome, u: number, out: Vector3): Vector3 {
  const t = fract(u);
  const start = Math.atan2(home.perch.z - home.z, home.perch.x - home.x);
  const circle = (a: number, v: Vector3): Vector3 =>
    v.set(
      home.x + Math.cos(a) * DRAGON_RADIUS,
      home.perch.y + DRAGON_ALTITUDE + Math.sin(a * 2) * 1.5,
      home.z + Math.sin(a) * DRAGON_RADIUS,
    );
  const ease = (x: number): number => x * x * (3 - 2 * x);
  if (t < DRAGON_TAKEOFF) return out.copy(home.perch);
  if (t < DRAGON_CIRCLE) {
    const s = (t - DRAGON_TAKEOFF) / (DRAGON_CIRCLE - DRAGON_TAKEOFF);
    circle(start, out);
    return out.lerp(home.perch, 1 - ease(s)).setY(out.y + Math.sin(Math.PI * s) * 3);
  }
  if (t < DRAGON_LAND) {
    return circle(start + ((t - DRAGON_CIRCLE) / (DRAGON_LAND - DRAGON_CIRCLE)) * Math.PI * 2, out);
  }
  const s = (t - DRAGON_LAND) / (1 - DRAGON_LAND);
  circle(start, out);
  return out.lerp(home.perch, ease(s)).setY(out.y + Math.sin(Math.PI * s) * 3);
}

/** Streaks of flowing water that tile vertically; scrolling it makes the water run. */
function flowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#3f93d6';
    ctx.fillRect(0, 0, 64, 128);
    const rand = scatter(5);
    for (let i = 0; i < 46; i++) {
      const x = rand() * 64;
      const y = rand() * 128;
      const h = 10 + rand() * 30;
      ctx.fillStyle = `rgba(225, 242, 255, ${0.25 + rand() * 0.45})`;
      ctx.fillRect(x, y, 1.5 + rand() * 2.5, h);
      // Wrap the streak, so the tile has no seam.
      if (y + h > 128) ctx.fillRect(x, y - 128, 1.5, h);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Soft puffs (chimney smoke, march dust) placed every frame. */
function puffs(color: string, opacity: number, capacity: number, parent: Group): InstancedMesh {
  const mesh = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false }),
    capacity,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  parent.add(mesh);
  return mesh;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** The isles, towns, beacons and marches of a lord's view, drawn with three.js. */
export class World3D {
  private readonly q: QualityPreset;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly root = new Group();
  private readonly sun = new DirectionalLight('#fff0d4', 2.8);
  private readonly stages = buildStages();
  /** Town models per cosmetic style, built the first time a lord with that style shows up. */
  private readonly townSets = new Map<string, Pair[]>();
  private readonly units = new Group();
  private readonly outline: Material | null;
  private readonly capacity: number;
  private readonly dragons: Pair;
  private dragonHomes: DragonHome[] = [];
  private readonly crystals: InstancedMesh;
  private beaconSpots: { x: number; z: number; color: string }[] = [];
  private readonly beacons: Pair;
  private readonly banners: Pair;
  private readonly soldiers: Pair;
  private readonly smoke: InstancedMesh;
  private readonly dust: InstancedMesh;
  private readonly targets: InstancedMesh;
  private readonly selectedRing: Mesh;
  private readonly highlightRing: Mesh;
  private readonly isles = new Group();
  private readonly bridges: Bridges;
  private readonly owned: (Material | Texture)[] = [];
  private readonly sceneryMaterial = lambert();
  private readonly rockMaterial = lambert();
  private readonly waterMaterial = new MeshPhongMaterial({
    color: '#3a8fd6',
    specular: '#d8ecff',
    shininess: 90,
    transparent: true,
    opacity: 0.88,
  });
  private territories: { territory: Territory; texture: CanvasTexture }[] = [];
  private readonly glowMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly streamFlow = flowTexture();
  private readonly fallFlow = flowTexture();
  private readonly streamMaterial = new MeshBasicMaterial({
    map: this.streamFlow,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  private readonly fallMaterial = new MeshBasicMaterial({
    map: this.fallFlow,
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
    depthWrite: false,
  });
  private fields: IsleField[] = [];
  /** Chimney tops in world space, with a phase each. */
  private chimneys: { x: number; y: number; z: number; phase: number; scale: number }[] = [];
  private builtIsles = '';
  private lastView: LordView | null = null;

  constructor(canvas: HTMLCanvasElement, quality: Quality, capacity = 512) {
    this.q = QUALITY[quality];
    this.renderer = new WebGLRenderer({ canvas, antialias: this.q.antialias });
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, FOG_NEAR, FOG_FAR);
    this.scene.add(new HemisphereLight('#dde9ff', '#5a4a36', 1.2));
    this.scene.add(this.sun, this.sun.target, this.root);
    if (this.q.shadowMap > 0) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFSoftShadowMap;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.35;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = SUN_DISTANCE * 2;
    }
    this.owned.push(
      this.sceneryMaterial,
      this.rockMaterial,
      this.waterMaterial,
      this.glowMaterial,
      this.streamMaterial,
      this.fallMaterial,
      this.streamFlow,
      this.fallFlow,
    );
    this.root.add(this.isles);
    const lanes = new Group();
    this.root.add(lanes);
    this.bridges = new Bridges(lanes);

    const units = this.units;
    this.root.add(units);
    this.capacity = capacity;
    const outline = this.q.outlines ? new MeshBasicMaterial({ color: OUTLINE, side: BackSide }) : null;
    this.outline = outline;
    if (outline) this.owned.push(outline);
    this.townSets.set(
      'classic',
      this.stages.map((model) => new Pair(model, capacity, units, animated(lambert()), outline)),
    );
    this.dragons = new Pair(buildDragon(), DRAGON_CAPACITY, units, animated(lambert()), null, true);
    this.crystals = new InstancedMesh(
      buildBeaconCrystal(),
      new MeshBasicMaterial({ vertexColors: true }),
      128,
    );
    this.crystals.instanceMatrix.setUsage(DynamicDrawUsage);
    this.crystals.frustumCulled = false;
    this.crystals.count = 0;
    units.add(this.crystals);
    this.beacons = new Pair(
      buildBeacon(),
      128,
      units,
      animated(new MeshBasicMaterial({ vertexColors: true })),
      outline,
    );
    this.banners = new Pair(buildBanner(), 256, units);
    this.soldiers = new Pair(buildSoldier(), 256 * SOLDIERS, units);
    this.smoke = puffs('#ebe7df', 0.45, SMOKE_CAPACITY, units);
    this.dust = puffs('#c9b48e', 0.45, DUST_CAPACITY, units);

    const ring = (inner: number, outer: number): BufferGeometry =>
      new RingGeometry(inner, outer, 40).rotateX(-Math.PI / 2).translate(0, 0.2, 0);
    this.targets = new InstancedMesh(
      ring(9, 10.5),
      new MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85 }),
      capacity,
    );
    this.targets.frustumCulled = false;
    this.targets.count = 0;
    this.selectedRing = new Mesh(ring(10, 11.8), new MeshBasicMaterial({ color: '#ffffff' }));
    this.highlightRing = new Mesh(ring(12, 14), new MeshBasicMaterial({ color: '#ffd166' }));
    // Marks drawn over hills and yards, which a coarse terrain mesh can lift above y = 0.
    for (const mark of [this.targets, this.selectedRing, this.highlightRing]) {
      (mark.material as Material).depthTest = false;
      mark.renderOrder = 10;
    }
    units.add(this.targets, this.selectedRing, this.highlightRing);
    this.addClouds();
  }

  setSize(size: Size): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio));
    this.renderer.setSize(size.width, size.height, false);
  }

  /** Height of the drawn model for a town level, for labels and taps. */
  modelHeight(level: number): number {
    const stage = stageFor(level);
    return (this.stages[stage]?.height ?? 6) * (STAGE_SCALE[stage] ?? 1);
  }

  /** How far the drawn model reaches from the town's center. */
  modelRadius(level: number): number {
    const stage = stageFor(level);
    return (this.stages[stage]?.radius ?? 5) * (STAGE_SCALE[stage] ?? 1);
  }

  bridgeTop(a: number, b: number): BridgeTop | null {
    return this.bridges.top(a, b);
  }

  /** Height of the ground at a map point (0 off the isles and on towns and roads). */
  groundAt(p: Vec): number {
    for (const f of this.fields) {
      if (f.edge(p.x, p.y) < 1.05) return Math.max(WATER_LEVEL, f.height(p.x, p.y));
    }
    return 0;
  }

  render(input: Scene3DInput): void {
    const { view, time } = input;
    animClock.value = time / 1000;
    // Water runs toward the coast along the streams and down the falls (texture v grows that way).
    this.streamFlow.offset.y = -time / 2400;
    this.fallFlow.offset.y = -time / 900;
    if (view !== this.lastView) {
      this.buildIsles(view);
      for (const t of this.territories) if (t.territory.update(view)) t.texture.needsUpdate = true;
      this.placeTowns(view);
      this.placeBeacons(view);
      this.lastView = view;
    }
    this.placeMarches(input);
    this.placeDragons(time);
    this.placeCrystals(time);
    this.placeSmoke(view, time);
    this.placeRings(input);
    this.bridges.update(view, input.sendFrom, time);
    placeCamera(input.cam, input.size, this.camera);
    this.fitFog();
    if (this.q.shadowMap > 0) this.fitShadow(input.cam, input.size);
    this.root.position.y = Math.sin(time / 2600) * 0.4;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.bridges.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) m.dispose();
      }
    });
    for (const m of this.owned) m.dispose();
    for (const t of this.territories) t.texture.dispose();
    this.renderer.dispose();
  }

  /** Fog starts past what the camera looks at, so zooming out over several isles does not hide them. */
  private fitFog(): void {
    const fog = this.scene.fog;
    if (!(fog instanceof Fog)) return;
    const distance = this.camera.position.y / Math.sin(TILT);
    fog.near = distance + FOG_NEAR;
    fog.far = distance * 2 + FOG_FAR;
  }

  /** Keeps the shadow map over what the camera sees, in steps, so shadows do not shimmer. */
  private fitShadow(cam: Camera, size: Size): void {
    const reach = Math.min(1100, Math.max(70, ((size.width + size.height) / cam.zoom) * 0.6));
    const r = 2 ** (Math.ceil(Math.log2(reach) * 4) / 4);
    const texel = (2 * r) / this.q.shadowMap;
    const x = Math.round(cam.x / texel) * texel;
    const z = Math.round((cam.y - r * 0.15) / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(SUN_DIR, SUN_DISTANCE);
    const shadowCam = this.sun.shadow.camera;
    if (shadowCam.right !== r) {
      shadowCam.left = -r;
      shadowCam.right = r;
      shadowCam.top = r;
      shadowCam.bottom = -r;
      shadowCam.updateProjectionMatrix();
    }
  }

  private addClouds(): void {
    const rand = scatter(7);
    const clouds = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshLambertMaterial({ color: '#f4f8ff', flatShading: true }),
      CLOUDS * 3,
    );
    let i = 0;
    for (let c = 0; c < CLOUDS; c++) {
      const a = rand() * Math.PI * 2;
      const r = 320 + rand() * 600;
      const y = -60 - rand() * 120;
      for (let k = 0; k < 3; k++) {
        dummy.position.set(Math.cos(a) * r + k * 14, y + (k === 1 ? 5 : 0), Math.sin(a) * r);
        dummy.scale.setScalar(14 + rand() * 10);
        dummy.updateMatrix();
        clouds.setMatrixAt(i++, dummy.matrix);
      }
    }
    dummy.scale.setScalar(1);
    this.scene.add(clouds);
  }

  /**
   * Isles are rebuilt only when the map grows or the town count changes (roads, hills and trees keep
   * clear of towns, and a lord joining online can add one).
   */
  private buildIsles(view: LordView): void {
    const key = `${view.isles.map((i) => i.id).join()}|${view.towns.length}`;
    if (key === this.builtIsles) return;
    this.builtIsles = key;
    for (const child of [...this.isles.children]) {
      this.isles.remove(child);
      child.traverse((obj) => {
        if (obj instanceof Mesh) obj.geometry.dispose();
      });
    }
    this.fields = [];
    const anisotropy = Math.min(this.q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    const materials = {
      scenery: this.sceneryMaterial,
      glow: this.glowMaterial,
      rock: this.rockMaterial,
      water: this.waterMaterial,
      stream: this.streamMaterial,
      fall: this.fallMaterial,
    };
    for (const t of this.territories) t.texture.dispose();
    this.territories = [];
    for (const isle of view.isles) {
      const territory = new Territory(groundArea(isle), isle.id, this.q.territory);
      const texture = new CanvasTexture(territory.canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.premultiplyAlpha = true;
      this.territories.push({ territory, texture });
      const built = buildIsle(view, isle, this.q, materials, anisotropy, texture);
      this.owned.push(...built.disposable);
      this.fields.push(built.field);
      this.isles.add(built.group);
    }
    this.bridges.build(view, new Map(this.fields.map((f, i) => [view.isles[i]?.id ?? -1, f])));
  }

  private townsFor(style: string): Pair[] {
    let set = this.townSets.get(style);
    if (!set) {
      set = buildStages(style).map(
        (model) => new Pair(model, this.capacity, this.units, animated(lambert()), this.outline),
      );
      this.townSets.set(style, set);
    }
    return set;
  }

  private placeTowns(view: LordView): void {
    const counts = new Map<Pair, number>();
    const styles = new Map(view.lords.map((l) => [l.id, l.style]));
    this.chimneys = [];
    this.dragonHomes = [];
    for (const town of view.towns) {
      const stage = stageFor(town.tier);
      const style = (town.owner !== null && styles.get(town.owner)) || 'classic';
      const pair = this.townsFor(style)[stage];
      const n = pair ? (counts.get(pair) ?? 0) : 0;
      if (!pair || n >= pair.capacity) continue;
      const scale = STAGE_SCALE[stage] ?? 1;
      // A fixed turn per town, so neighbors do not all face the same way.
      const turn = (town.id * 2.39996) % (Math.PI * 2);
      dummy.position.set(town.pos.x, 0, town.pos.y);
      dummy.rotation.set(0, turn, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      const color = town.owner === null ? NEUTRAL_ROOF : ownerColor(view, town.owner);
      pair.place(n, dummy.matrix, color);
      counts.set(pair, n + 1);
      for (const [k, local] of (this.stages[stage]?.smoke ?? []).entries()) {
        spot.copy(local).applyMatrix4(dummy.matrix);
        this.chimneys.push({
          x: spot.x,
          y: spot.y,
          z: spot.z,
          phase: fract(town.id * 0.618 + k * 0.37),
          scale,
        });
      }
      // Only a capital that reached the last stage keeps a dragon; other castles stay without one.
      if (stage === DRAGON_STAGE && town.isCapital && this.dragonHomes.length < DRAGON_CAPACITY) {
        this.dragonHomes.push({
          perch: DRAGON_PERCH.clone().applyMatrix4(dummy.matrix),
          x: town.pos.x,
          z: town.pos.y,
          turn,
          scale,
          color,
          phase: fract(town.id * 0.377),
        });
      }
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    for (const set of this.townSets.values()) for (const pair of set) pair.finish(counts.get(pair) ?? 0);
  }

  /** A capital's dragon rests on its donjon, now and then takes off, circles the castle and lands. */
  private placeDragons(time: number): void {
    let n = 0;
    for (const home of this.dragonHomes) {
      const u = fract(time / DRAGON_CYCLE_MS + home.phase);
      const pos = dragonAt(home, u, new Vector3());
      const ahead = dragonAt(home, u + 0.004, new Vector3()).sub(pos);
      const flying = u >= DRAGON_TAKEOFF;
      const yaw = flying && ahead.lengthSq() > 1e-6 ? Math.atan2(ahead.x, ahead.z) : home.turn;
      const circling = u >= DRAGON_CIRCLE && u < DRAGON_LAND;
      const pitch = flying ? -Math.atan2(ahead.y, Math.hypot(ahead.x, ahead.z)) * 0.6 : 0;
      dummy.position.copy(pos);
      dummy.rotation.set(pitch, yaw, circling ? -DRAGON_BANK : 0, 'YXZ');
      dummy.scale.setScalar(home.scale * DRAGON_SCALE);
      dummy.updateMatrix();
      this.dragons.place(n++, dummy.matrix, home.color, flying ? 1 : DRAGON_REST_FLAP);
    }
    dummy.rotation.set(0, 0, 0, 'XYZ');
    dummy.scale.setScalar(1);
    this.dragons.finish(n);
  }

  /** Beacon crystals float, turn and bob above their obelisks. */
  private placeCrystals(time: number): void {
    let n = 0;
    for (const b of this.beaconSpots) {
      const bob = Math.sin(time / 700 + b.x * 0.1) * 0.35;
      dummy.position.set(b.x, (BEACON_CRYSTAL_HEIGHT + bob) * UNIT_SCALE, b.z);
      dummy.rotation.set(0, time / 900 + b.z * 0.1, 0);
      dummy.scale.setScalar(UNIT_SCALE);
      dummy.updateMatrix();
      this.crystals.setMatrixAt(n, dummy.matrix);
      this.crystals.setColorAt(n++, tint.set(b.color));
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    this.crystals.count = n;
    this.crystals.instanceMatrix.needsUpdate = true;
    if (this.crystals.instanceColor) this.crystals.instanceColor.needsUpdate = true;
  }

  private placeBeacons(view: LordView): void {
    let n = 0;
    this.beaconSpots = [];
    for (const zone of view.zones) {
      if (n >= this.beacons.capacity) break;
      const at = beaconSpot(view, zone);
      dummy.position.set(at.x, 0, at.y);
      dummy.scale.setScalar(UNIT_SCALE);
      dummy.updateMatrix();
      const color = zone.beaconOwner ? ownerColor(view, zone.beaconOwner) : UNLIT_FIRE;
      this.beacons.place(n++, dummy.matrix, color);
      this.beaconSpots.push({ x: at.x, z: at.y, color });
    }
    dummy.scale.setScalar(1);
    this.beacons.finish(n);
  }

  /** Smoke rises from chimneys and drifts with the wind. */
  private placeSmoke(view: LordView, time: number): void {
    if (!this.q.particles) return;
    const wind = WIND_VECTORS[view.wind.dir] ?? { x: 0, y: 0 };
    let n = 0;
    for (const c of this.chimneys) {
      for (let k = 0; k < PUFFS && n < SMOKE_CAPACITY; k++) {
        const age = fract(time / 2800 + c.phase + k / PUFFS);
        const drift = age * age * 5 * c.scale;
        dummy.position.set(c.x + wind.x * drift, c.y + age * 5 * c.scale, c.z + wind.y * drift);
        dummy.scale.setScalar((0.3 + age * 0.9) * (1 - age * age) * c.scale);
        dummy.updateMatrix();
        this.smoke.setMatrixAt(n++, dummy.matrix);
      }
    }
    dummy.scale.setScalar(1);
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  private placeMarches(input: Scene3DInput): void {
    const { view, gameNow, time } = input;
    let banners = 0;
    let soldiers = 0;
    let dust = 0;
    const put = (x: number, y: number, z: number, turn: number): void => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, turn, 0);
      dummy.updateMatrix();
    };
    // All soldiers march in step; the body is highest when the legs pass each other.
    const bob = Math.abs(Math.cos((time / 1000) * STEP_RATE)) * 0.3;
    for (const m of view.marches) {
      const from = townById(view, m.from);
      const to = townById(view, m.to);
      if (!from || !to) continue;
      const span = Math.max(1, m.arriveAt - m.departAt);
      const f = Math.min(1, Math.max(0, (gameNow - m.departAt) / span));
      const x = from.pos.x + (to.pos.x - from.pos.x) * f;
      const z = from.pos.y + (to.pos.y - from.pos.y) * f;
      const heading = Math.atan2(to.pos.x - from.pos.x, to.pos.y - from.pos.y);
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const color = m.incoming ? '#ff4d4d' : ownerColor(view, m.owner);
      const ground = (px: number, pz: number): number =>
        m.sky ? FLIGHT_HEIGHT + Math.sin(time / 300 + m.id) : this.groundAt({ x: px, y: pz });
      dummy.scale.setScalar(UNIT_SCALE);
      for (let k = 0; k < SOLDIERS && soldiers < this.soldiers.capacity; k++) {
        const side = (k - (SOLDIERS - 1) / 2) * UNIT_SCALE;
        const back = (1.8 + Math.abs(side) * 0.7) * UNIT_SCALE;
        const sx = x - sin * back + cos * side * 1.5;
        const sz = z - cos * back - sin * side * 1.5;
        put(sx, ground(sx, sz) + bob, sz, heading);
        this.soldiers.place(soldiers++, dummy.matrix, color);
      }
      if (banners < this.banners.capacity) {
        put(x, ground(x, z), z, heading - Math.PI / 2);
        this.banners.place(banners++, dummy.matrix, color);
      }
      if (!this.q.particles || m.sky || f <= 0 || f >= 1) continue;
      for (let k = 0; k < PUFFS && dust < DUST_CAPACITY; k++) {
        const age = fract(time / 900 + k / PUFFS + m.id * 0.17);
        const back = (2.6 + age * 3) * UNIT_SCALE;
        const wobble = Math.sin(m.id * 3.1 + k * 2.3) * 1.2 * UNIT_SCALE;
        const dx = x - sin * back + cos * wobble;
        const dz = z - cos * back - sin * wobble;
        dummy.position.set(dx, ground(dx, dz) + 0.4 + age * 1.4, dz);
        dummy.scale.setScalar((0.5 + age * 1.2) * (1 - age) * UNIT_SCALE);
        dummy.updateMatrix();
        this.dust.setMatrixAt(dust++, dummy.matrix);
      }
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    this.soldiers.finish(soldiers);
    this.banners.finish(banners);
    this.dust.count = dust;
    this.dust.instanceMatrix.needsUpdate = true;
  }

  private placeRings(input: Scene3DInput): void {
    const { view, time, selected, highlight, targets } = input;
    const pulse = 1 + Math.sin(time / 220) * 0.06;
    const at = (mesh: Mesh, townId: number | null, scale: number): void => {
      const town = townById(view, townId);
      mesh.visible = !!town;
      if (!town) return;
      mesh.position.set(town.pos.x, 0, town.pos.y);
      mesh.scale.setScalar(scale);
    };
    at(this.selectedRing, input.sendFrom ?? selected, pulse);
    at(this.highlightRing, highlight, 1 + Math.sin(time / 180) * 0.15);
    let n = 0;
    for (const id of targets ?? []) {
      const town = townById(view, id);
      if (!town) continue;
      dummy.position.set(town.pos.x, 0, town.pos.y);
      dummy.updateMatrix();
      this.targets.setMatrixAt(n++, dummy.matrix);
    }
    this.targets.count = n;
    this.targets.instanceMatrix.needsUpdate = true;
  }
}
