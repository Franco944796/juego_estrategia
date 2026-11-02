import type { LordView } from '@si/engine';
import {
  Color,
  ConeGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Shape,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Camera, Size, Vec } from '../map/camera';
import { ownerColor, townById } from '../ui/labels';
import { placeCamera } from './camera3d';
import {
  buildBanner,
  buildBeacon,
  buildSoldier,
  buildStages,
  STAGE_SCALE,
  stageFor,
  UNIT_SCALE,
  type Model,
} from './models';

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
const UNLIT_FIRE = '#3a3f47';
const ISLE_DEPTH = 10;
/** Marching soldiers float this high on flights between isles. */
export const FLIGHT_HEIGHT = 9;
const SOLDIERS = 3;
const CLOUDS = 28;
const TREES_PER_ISLE = 70;
/** Trees keep this far from towns and zone beacons. */
const TREE_CLEARANCE = 9;

const dummy = new Object3D();
const tint = new Color();

/** A seeded generator for scenery, so trees and clouds sit in the same place every time. */
function scatter(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function lambert(color = '#ffffff', vertexColors = true): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, vertexColors, flatShading: true });
}

/** A fixed part and a part painted per instance, both sharing the instance transforms. */
class Pair {
  readonly fixed: InstancedMesh;
  readonly team: InstancedMesh;

  constructor(model: Model, capacity: number, parent: Group) {
    this.fixed = new InstancedMesh(model.fixed, lambert(), capacity);
    this.team = new InstancedMesh(model.team, lambert(), capacity);
    for (const mesh of [this.fixed, this.team]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      // Instances spread over the whole map; per-instance culling is not worth it here.
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
    this.team.setColorAt(0, tint.set('#ffffff'));
  }

  place(i: number, matrix: Object3D['matrix'], color: string): void {
    this.fixed.setMatrixAt(i, matrix);
    this.team.setMatrixAt(i, matrix);
    this.team.setColorAt(i, tint.set(color));
  }

  finish(count: number): void {
    this.fixed.count = count;
    this.team.count = count;
    this.fixed.instanceMatrix.needsUpdate = true;
    this.team.instanceMatrix.needsUpdate = true;
    if (this.team.instanceColor) this.team.instanceColor.needsUpdate = true;
  }
}

function isleShape(radius: number, shape: number[]): Shape {
  const n = shape.length;
  const s = new Shape();
  shape.forEach((k, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * radius * k;
    const y = Math.sin(a) * radius * k;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  });
  s.closePath();
  return s;
}

/** The isles, towns, beacons and marches of a lord's view, drawn with three.js. */
export class World3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly stages = buildStages();
  private readonly towns: Pair[];
  private readonly beacons: Pair;
  private readonly banners: Pair;
  private readonly soldiers: InstancedMesh;
  private readonly targets: InstancedMesh;
  private readonly selectedRing: Mesh;
  private readonly highlightRing: Mesh;
  private readonly isles = new Group();
  private readonly owned: Material[] = [];
  private builtIsles = '';
  private lastView: LordView | null = null;

  constructor(canvas: HTMLCanvasElement, capacity = 512) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 900, 2600);
    this.scene.add(new HemisphereLight('#e6f0ff', '#4a3b2f', 1.6));
    const sun = new DirectionalLight('#fff1d6', 2.4);
    sun.position.set(-0.6, 1, 0.5);
    this.scene.add(sun, this.isles);

    const units = new Group();
    this.scene.add(units);
    this.towns = this.stages.map((model) => new Pair(model, capacity, units));
    this.beacons = new Pair(buildBeacon(), 128, units);
    this.banners = new Pair(buildBanner(), 256, units);
    this.soldiers = new InstancedMesh(buildSoldier(), lambert(), 256 * SOLDIERS);
    this.soldiers.frustumCulled = false;
    this.soldiers.count = 0;
    units.add(this.soldiers);

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
    units.add(this.targets, this.selectedRing, this.highlightRing);
    this.addClouds();
  }

  setSize(size: Size): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

  render(input: Scene3DInput): void {
    const { view, time } = input;
    if (view !== this.lastView) {
      this.buildIsles(view);
      this.placeTowns(view);
      this.placeBeacons(view);
      this.lastView = view;
    }
    this.placeMarches(input);
    this.placeRings(input);
    placeCamera(input.cam, input.size, this.camera);
    this.isles.position.y = Math.sin(time / 2600) * 0.4;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) m.dispose();
      }
    });
    for (const m of this.owned) m.dispose();
    this.renderer.dispose();
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

  /** Isles change only when the map grows, so they are rebuilt from scratch then. */
  private buildIsles(view: LordView): void {
    const key = view.isles.map((i) => i.id).join();
    if (key === this.builtIsles) return;
    this.builtIsles = key;
    for (const child of [...this.isles.children]) {
      this.isles.remove(child);
      child.traverse((obj) => {
        if (obj instanceof Mesh) obj.geometry.dispose();
      });
    }
    const grass = lambert('#6fbf4b', false);
    const cliff = lambert('#8a6a4a', false);
    const rock = lambert('#6b5442', false);
    const bark = lambert('#6b4226', false);
    const leaves = lambert('#2f8f4e', false);
    this.owned.push(grass, cliff, rock, bark, leaves);
    for (const isle of view.isles) {
      const top = new ExtrudeGeometry(isleShape(isle.radius, isle.shape), {
        depth: ISLE_DEPTH,
        bevelEnabled: false,
        curveSegments: 2,
      });
      top.rotateX(Math.PI / 2);
      const land = new Mesh(top, [grass, cliff]);
      land.position.set(isle.pos.x, 0, isle.pos.y);
      const under = new Mesh(new ConeGeometry(isle.radius * 0.9, isle.radius * 0.85, 11), rock);
      under.rotation.x = Math.PI;
      under.position.set(isle.pos.x, -ISLE_DEPTH - isle.radius * 0.42, isle.pos.y);
      this.isles.add(land, under);
      this.isles.add(this.trees(view, isle.id, bark, leaves));
    }
  }

  private trees(view: LordView, isleId: number, bark: Material, leaves: Material): Group {
    const isle = view.isles[isleId];
    const group = new Group();
    if (!isle) return group;
    const rand = scatter(isleId + 11);
    const blockers: Vec[] = [
      ...view.towns.filter((t) => t.isleId === isleId).map((t) => t.pos),
      ...view.zones.filter((z) => z.isleId === isleId).map((z) => z.pos),
    ];
    const trunks = new InstancedMesh(
      new ConeGeometry(0.5, 2.4, 5).translate(0, 1.2, 0),
      bark,
      TREES_PER_ISLE,
    );
    const crowns = new InstancedMesh(
      new ConeGeometry(2.2, 5, 6).translate(0, 4.4, 0),
      leaves,
      TREES_PER_ISLE,
    );
    let n = 0;
    for (let tries = 0; tries < TREES_PER_ISLE * 6 && n < TREES_PER_ISLE; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * isle.radius * 0.88;
      const p = { x: isle.pos.x + Math.cos(a) * r, y: isle.pos.y + Math.sin(a) * r };
      if (blockers.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < TREE_CLEARANCE)) continue;
      dummy.position.set(p.x, 0, p.y);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.setScalar(0.8 + rand() * 0.6);
      dummy.updateMatrix();
      trunks.setMatrixAt(n, dummy.matrix);
      crowns.setMatrixAt(n, dummy.matrix);
      n++;
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    trunks.count = n;
    crowns.count = n;
    group.add(trunks, crowns);
    return group;
  }

  private placeTowns(view: LordView): void {
    const counts = this.towns.map(() => 0);
    for (const town of view.towns) {
      const stage = stageFor(town.tier);
      const pair = this.towns[stage];
      if (!pair || (counts[stage] ?? 0) >= pair.fixed.instanceMatrix.count) continue;
      dummy.position.set(town.pos.x, 0, town.pos.y);
      // A fixed turn per town, so neighbors do not all face the same way.
      dummy.rotation.set(0, (town.id * 2.39996) % (Math.PI * 2), 0);
      dummy.scale.setScalar(STAGE_SCALE[stage] ?? 1);
      dummy.updateMatrix();
      const color = town.owner === null ? NEUTRAL_ROOF : ownerColor(view, town.owner);
      pair.place(counts[stage] ?? 0, dummy.matrix, color);
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    this.towns.forEach((pair, i) => pair.finish(counts[i] ?? 0));
  }

  private placeBeacons(view: LordView): void {
    let n = 0;
    for (const zone of view.zones) {
      dummy.position.set(zone.pos.x, 0, zone.pos.y);
      dummy.scale.setScalar(UNIT_SCALE);
      dummy.updateMatrix();
      const color = zone.beaconOwner ? ownerColor(view, zone.beaconOwner) : UNLIT_FIRE;
      this.beacons.place(n++, dummy.matrix, color);
    }
    dummy.scale.setScalar(1);
    this.beacons.finish(n);
  }

  private placeMarches(input: Scene3DInput): void {
    const { view, gameNow, time } = input;
    let banners = 0;
    let soldiers = 0;
    for (const m of view.marches) {
      const from = townById(view, m.from);
      const to = townById(view, m.to);
      if (!from || !to) continue;
      const span = Math.max(1, m.arriveAt - m.departAt);
      const f = Math.min(1, Math.max(0, (gameNow - m.departAt) / span));
      const x = from.pos.x + (to.pos.x - from.pos.x) * f;
      const z = from.pos.y + (to.pos.y - from.pos.y) * f;
      const heading = Math.atan2(to.pos.x - from.pos.x, to.pos.y - from.pos.y);
      const lift = m.sky ? FLIGHT_HEIGHT + Math.sin(time / 300 + m.id) : 0;
      dummy.scale.setScalar(UNIT_SCALE);
      for (let k = 0; k < SOLDIERS; k++) {
        const side = (k - (SOLDIERS - 1) / 2) * UNIT_SCALE;
        const back = (1.8 + Math.abs(side) * 0.7) * UNIT_SCALE;
        const bob = Math.abs(Math.sin(time / 140 + m.id + k)) * 0.35;
        dummy.position.set(
          x - Math.sin(heading) * back + Math.cos(heading) * side * 1.5,
          lift + bob,
          z - Math.cos(heading) * back - Math.sin(heading) * side * 1.5,
        );
        dummy.rotation.set(0, heading, 0);
        dummy.updateMatrix();
        if (soldiers < this.soldiers.instanceMatrix.count)
          this.soldiers.setMatrixAt(soldiers++, dummy.matrix);
      }
      dummy.position.set(x, lift, z);
      dummy.rotation.set(0, heading - Math.PI / 2, 0);
      dummy.updateMatrix();
      const color = m.incoming ? '#ff4d4d' : ownerColor(view, m.owner);
      if (banners < 256) this.banners.place(banners++, dummy.matrix, color);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    this.soldiers.count = soldiers;
    this.soldiers.instanceMatrix.needsUpdate = true;
    this.banners.finish(banners);
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
