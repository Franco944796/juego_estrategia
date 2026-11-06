import { defaultConfig } from '@si/config';
import { windFactor, type LordView } from '@si/engine';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Group,
} from 'three';
import type { Vec } from '../map/camera';
import { windColor } from '../map/render';
import { townById } from '../ui/labels';
import { scatter, type IsleField } from './terrain';

/** Same blue as the crystals on the isles: an idle lane is just arcane light. */
const IDLE = '#7fe3ff';
const IDLE_OPACITY = 0.7;
const SEGMENTS = 48;
const WIDTH = 16;
/** World units of bridge per rune tile. */
const TILE = 40;
/** Ends sit a little inside the coast, so the arc grows out of the cliff top. */
const INSET = 0.97;
const BASE = 0.6;

export interface BridgeTop {
  x: number;
  y: number;
  height: number;
}

function bridgeRise(length: number): number {
  return Math.min(28, length * 0.07);
}

/** A soft glowing band down the middle of the tile with a rune every so often. */
function runeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const glow = ctx.createLinearGradient(0, 0, 64, 0);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glow.addColorStop(0.25, 'rgba(255, 255, 255, 0.2)');
    glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    glow.addColorStop(0.75, 'rgba(255, 255, 255, 0.2)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 256);
    const rand = scatter(11);
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const y = 32 + k * 64;
      ctx.beginPath();
      ctx.moveTo(32, y - 16);
      ctx.lineTo(32, y + 16);
      for (let s = 0; s < 2; s++) {
        const from = y - 12 + rand() * 24;
        const side = rand() < 0.5 ? -1 : 1;
        ctx.moveTo(32, from);
        ctx.lineTo(32 + side * 11, from + (rand() < 0.5 ? -9 : 9));
      }
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** A flat ribbon arching from `a` to `b`; u runs across it, v along it in rune tiles. */
function ribbon(a: Vec, b: Vec): BufferGeometry {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const rise = bridgeRise(length);
  const nx = -(b.y - a.y) / length;
  const nz = (b.x - a.x) / length;
  const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const uvs = new Float32Array((SEGMENTS + 1) * 2 * 2);
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const x = a.x + (b.x - a.x) * t;
    const z = a.y + (b.y - a.y) * t;
    const y = BASE + rise * Math.sin(Math.PI * t);
    for (let side = 0; side < 2; side++) {
      const k = i * 2 + side;
      const off = (side - 0.5) * WIDTH;
      positions.set([x + nx * off, y, z + nz * off], k * 3);
      uvs.set([side, (t * length) / TILE], k * 2);
    }
    if (i < SEGMENTS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

interface Bridge {
  a: number;
  b: number;
  material: MeshBasicMaterial;
  top: BridgeTop;
}

/** Light bridges along the sky lanes; while sending, the source's lanes take the wind's color. */
export class Bridges {
  private readonly texture = runeTexture();
  private bridges: Bridge[] = [];

  constructor(private readonly group: Group) {}

  build(view: LordView, fields: Map<number, IsleField>): void {
    this.clear();
    for (const lane of view.lanes) {
      const ia = view.isles[lane.a];
      const ib = view.isles[lane.b];
      const fa = fields.get(lane.a);
      const fb = fields.get(lane.b);
      if (!ia || !ib || !fa || !fb) continue;
      const toward = Math.atan2(ib.pos.y - ia.pos.y, ib.pos.x - ia.pos.x);
      const back = toward + Math.PI;
      const ra = fa.radiusAt(toward) * INSET;
      const rb = fb.radiusAt(back) * INSET;
      const a = { x: ia.pos.x + Math.cos(toward) * ra, y: ia.pos.y + Math.sin(toward) * ra };
      const b = { x: ib.pos.x + Math.cos(back) * rb, y: ib.pos.y + Math.sin(back) * rb };
      const material = new MeshBasicMaterial({
        map: this.texture,
        color: IDLE,
        transparent: true,
        opacity: IDLE_OPACITY,
        depthWrite: false,
        side: DoubleSide,
      });
      this.group.add(new Mesh(ribbon(a, b), material));
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const top = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, height: BASE + bridgeRise(length) };
      this.bridges.push({ a: lane.a, b: lane.b, material, top });
    }
  }

  update(view: LordView, sendFrom: number | null, time: number): void {
    this.texture.offset.y = -time / 1400;
    const source = townById(view, sendFrom)?.isleId ?? null;
    for (const bridge of this.bridges) {
      const active = source !== null && (bridge.a === source || bridge.b === source);
      if (!active) {
        bridge.material.color.set(IDLE);
        bridge.material.opacity = IDLE_OPACITY;
        continue;
      }
      const src = view.isles[source];
      const dst = view.isles[bridge.a === source ? bridge.b : bridge.a];
      if (!src || !dst) continue;
      const { tailwindMax, headwindMin } = defaultConfig.wind;
      bridge.material.color.set(
        windColor(windFactor(src.pos, dst.pos, view.wind.dir, tailwindMax, headwindMin)),
      );
      bridge.material.opacity = 1;
    }
  }

  /** The middle of the bridge between two isles, in either order. */
  top(a: number, b: number): BridgeTop | null {
    const bridge = this.bridges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    return bridge ? bridge.top : null;
  }

  dispose(): void {
    this.clear();
    this.texture.dispose();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof Mesh) child.geometry.dispose();
    }
    for (const bridge of this.bridges) bridge.material.dispose();
    this.bridges = [];
  }
}
