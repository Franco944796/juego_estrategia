import type { LordView } from '@si/engine';
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  type Group,
} from 'three';
import { ownerColor, townById } from '../ui/labels';
import { stageFor } from './models';

const SPARKS = 720;
const RINGS = 48;
const GRAVITY = 14;

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: number;
  color: Color;
}

interface Ring {
  x: number;
  z: number;
  born: number;
  life: number;
  reach: number;
  color: Color;
}

const dummy = new Object3D();
const tint = new Color();

/**
 * Bursts of light for what just happened on the map, read from the difference between two views:
 * a town changing hands, a town growing into its next stage and an army reaching its target.
 */
export class Effects {
  private readonly sparks: InstancedMesh;
  private readonly rings: InstancedMesh;
  private live: Spark[] = [];
  private waves: Ring[] = [];

  /** `glow` is how much brighter than white the lights are drawn (they bloom with the screen passes). */
  constructor(
    parent: Group,
    private readonly glow: number,
  ) {
    const material = (): MeshBasicMaterial =>
      new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.sparks = new InstancedMesh(new IcosahedronGeometry(1, 0), material(), SPARKS);
    this.rings = new InstancedMesh(
      new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2).translate(0, 0.35, 0),
      material(),
      RINGS,
    );
    for (const mesh of [this.sparks, this.rings]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, tint.set('#000000'));
      parent.add(mesh);
    }
  }

  private burst(
    x: number,
    y: number,
    z: number,
    color: string,
    time: number,
    count: number,
    power: number,
  ): void {
    for (let i = 0; i < count && this.live.length < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = (0.35 + Math.random() * 0.65) * power;
      this.live.push({
        x,
        y,
        z,
        vx: Math.cos(a) * out,
        vy: (0.9 + Math.random() * 1.3) * power,
        vz: Math.sin(a) * out,
        born: time,
        life: 700 + Math.random() * 900,
        size: 0.22 + Math.random() * 0.3,
        color: new Color(color),
      });
    }
  }

  private wave(x: number, z: number, color: string, time: number, reach: number): void {
    if (this.waves.length < RINGS) {
      this.waves.push({ x, z, born: time, life: 1100, reach, color: new Color(color) });
    }
  }

  /** Compares the view that was on screen with the new one and starts the bursts. */
  watch(before: LordView, after: LordView, time: number): void {
    const was = new Map(before.towns.map((t) => [t.id, t]));
    for (const town of after.towns) {
      const old = was.get(town.id);
      if (!old) continue;
      const { x, y: z } = town.pos;
      if (old.owner !== town.owner && town.owner !== null) {
        const color = ownerColor(after, town.owner);
        this.wave(x, z, color, time, 22);
        this.burst(x, 3, z, color, time, 36, 9);
      } else if (stageFor(town.tier) > stageFor(old.tier)) {
        this.wave(x, z, '#ffd98a', time, 16);
        this.burst(x, 2, z, '#ffd98a', time, 28, 7);
      }
    }
    const marching = new Set(after.marches.map((m) => m.id));
    for (const m of before.marches) {
      if (marching.has(m.id)) continue;
      const target = townById(before, m.to);
      // An army that reached a town it did not own fought there.
      if (!target || target.owner === m.owner) continue;
      this.burst(target.pos.x, 2.5, target.pos.y, '#ffb066', time, 18, 6);
      this.burst(target.pos.x, 2.5, target.pos.y, '#fff1d6', time, 8, 4);
    }
  }

  update(time: number): void {
    this.live = this.live.filter((s) => time - s.born < s.life);
    this.live.forEach((s, i) => {
      const t = (time - s.born) / 1000;
      const age = (time - s.born) / s.life;
      dummy.position.set(s.x + s.vx * t, s.y + s.vy * t - GRAVITY * 0.5 * t * t * 0.35, s.z + s.vz * t);
      dummy.scale.setScalar(s.size * (1 - age * 0.6));
      dummy.updateMatrix();
      this.sparks.setMatrixAt(i, dummy.matrix);
      // Additive light fades by getting darker.
      this.sparks.setColorAt(i, tint.copy(s.color).multiplyScalar(this.glow * (1 - age) ** 1.5));
    });
    this.sparks.count = this.live.length;
    this.waves = this.waves.filter((r) => time - r.born < r.life);
    this.waves.forEach((r, i) => {
      const age = (time - r.born) / r.life;
      dummy.position.set(r.x, 0, r.z);
      dummy.scale.setScalar(4 + (1 - (1 - age) ** 3) * r.reach);
      dummy.updateMatrix();
      this.rings.setMatrixAt(i, dummy.matrix);
      this.rings.setColorAt(i, tint.copy(r.color).multiplyScalar(this.glow * 0.8 * (1 - age) ** 2));
    });
    this.rings.count = this.waves.length;
    dummy.scale.setScalar(1);
    for (const mesh of [this.sparks, this.rings]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
