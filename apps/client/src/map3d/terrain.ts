import type { LordView } from '@si/engine';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec } from '../map/camera';
import type { QualityPreset } from './quality';

type IsleView = LordView['isles'][number];
type ZoneView = LordView['zones'][number];

/** Towns keep scenery and hills this far away (the castle's model reaches about 12). */
const TOWN_CLEAR = 15;
const BEACON_CLEAR = 6;
const ROAD_HALF_WIDTH = 1.2;
/** Roads join each town to its nearest neighbors, up to this length. */
const ROAD_NEIGHBORS = 2;
const ROAD_MAX = 75;
const HILL_HEIGHT = 9;
const STREAMS = 3;
const STREAM_HALF_WIDTH = 1.6;
/** Streams start this far out from the center, as a share of the radius toward their waterfall. */
const STREAM_START = 0.72;
const MOUNTAIN_HEIGHT = 26;
const LAKE_DEPTH = 3.5;
/** Lakes fill the ground below this height. */
export const WATER_LEVEL = -1;
const CLIFF_DEPTH = 12;
/** The ground texture spans the isle and a margin for the jagged outline. */
const TEXTURE_SPAN = 1.25;
const COAST_SAMPLES = 720;
/** The outline stays within these shares of the isle radius (the ground texture reaches 1.25). */
const COAST_MIN = 0.62;
const COAST_MAX = 1.2;
/** Firm ground kept between a town and the coast. */
const SHORE_MARGIN = 26;
const MACRO_GRID = 192;

const dummy = new Object3D();
const tint = new Color();

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(a: number, b: number, x: number): number {
  return smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));
}

/** Value noise in [0, 1]. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y, seed + o * 31) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** A seeded generator for scenery, so trees and rocks sit in the same place every time. */
export function scatter(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Beacons keep this far from town centers in 3D, so a beacon never stands inside a town's walls. */
const BEACON_TOWN_GAP = 16;

/** Where a zone's beacon is drawn: its zone position, pushed out of nearby towns. */
export function beaconSpot(view: LordView, zone: ZoneView): Vec {
  const p = { ...zone.pos };
  for (let pass = 0; pass < 3; pass++) {
    for (const t of view.towns) {
      if (t.isleId !== zone.isleId) continue;
      const dx = p.x - t.pos.x;
      const dy = p.y - t.pos.y;
      const d = Math.hypot(dx, dy);
      if (d >= BEACON_TOWN_GAP) continue;
      const a = d > 0.01 ? Math.atan2(dy, dx) : zone.id;
      p.x = t.pos.x + Math.cos(a) * BEACON_TOWN_GAP;
      p.y = t.pos.y + Math.sin(a) * BEACON_TOWN_GAP;
    }
  }
  return p;
}

interface Segment {
  a: Vec;
  b: Vec;
}

interface Patch {
  pos: Vec;
  w: number;
  d: number;
  turn: number;
  kind: number;
}

function segmentDistance(p: Vec, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return Math.hypot(p.x - s.a.x - dx * t, p.y - s.a.y - dy * t);
}

/** Roads between each town and its nearest neighbors on the same isle, without repeats. */
function roadsFor(view: LordView, isleId: number): Segment[] {
  const towns = view.towns.filter((t) => t.isleId === isleId);
  const seen = new Set<string>();
  const roads: Segment[] = [];
  for (const t of towns) {
    const near = towns
      .filter((o) => o.id !== t.id)
      .map((o) => ({ o, d: Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y) }))
      .filter((n) => n.d < ROAD_MAX)
      .sort((p, q) => p.d - q.d)
      .slice(0, ROAD_NEIGHBORS);
    for (const { o } of near) {
      const key = t.id < o.id ? `${t.id}-${o.id}` : `${o.id}-${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roads.push({ a: t.pos, b: o.pos });
    }
  }
  return roads;
}

/** The square of world space the ground texture covers. */
export function groundArea(isle: IsleView): { span: number; x0: number; z0: number } {
  const span = isle.radius * TEXTURE_SPAN * 2;
  return { span, x0: isle.pos.x - span / 2, z0: isle.pos.y - span / 2 };
}

/** Shape, height and clear ground of one isle; the same numbers build the mesh and place things on it. */
export class IsleField {
  readonly roads: Segment[];
  readonly towns: Vec[];
  readonly beacons: Vec[];
  readonly patches: Patch[] = [];
  /** Streams that run to the coast and fall off it; `a` is the angle of the waterfall. */
  readonly streams: (Segment & { angle: number })[] = [];
  readonly seed: number;
  private readonly coast: Float32Array;

  constructor(
    readonly isle: IsleView,
    view: LordView,
  ) {
    this.seed = isle.id * 7919 + 17;
    this.towns = view.towns.filter((t) => t.isleId === isle.id).map((t) => t.pos);
    this.beacons = view.zones.filter((z) => z.isleId === isle.id).map((z) => beaconSpot(view, z));
    this.roads = roadsFor(view, isle.id);
    this.coast = this.coastline();
    this.placeStreams();
  }

  /** A few streams through open ground, away from towns, roads, mountains and lakes. */
  private placeStreams(): void {
    const { pos } = this.isle;
    const rand = scatter(this.seed + 61);
    const angles = Array.from({ length: 48 }, (_, i) => ({ a: (i / 48) * Math.PI * 2, r: rand() }));
    angles.sort((p, q) => p.r - q.r);
    for (const { a } of angles) {
      if (this.streams.length >= STREAMS) break;
      if (
        this.streams.some((st) => Math.abs(Math.atan2(Math.sin(st.angle - a), Math.cos(st.angle - a))) < 1.1)
      ) {
        continue;
      }
      const r = this.radiusAt(a);
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      const from = { x: pos.x + dir.x * r * STREAM_START, y: pos.y + dir.y * r * STREAM_START };
      const to = { x: pos.x + dir.x * (r + 1.5), y: pos.y + dir.y * (r + 1.5) };
      let open = true;
      for (let k = 0; k <= 6 && open; k++) {
        const t = k / 6;
        const x = from.x + (to.x - from.x) * t * 0.95;
        const z = from.y + (to.y - from.y) * t * 0.95;
        open = this.clearance(x, z) > 6 && this.mountain(x, z) < 0.25 && this.lake(x, z) < 0.02;
      }
      if (open) this.streams.push({ a: from, b: to, angle: a });
    }
  }

  /**
   * The outline sampled all around: the engine's gentle shape, plus bays and headlands, coves and a
   * ragged edge. Noise is read on circles, so the outline closes without a seam. Towns near the shore
   * push the coast out so they always keep firm ground around them.
   */
  private coastline(): Float32Array {
    const coast = new Float32Array(COAST_SAMPLES);
    const n = this.isle.shape.length;
    const { pos, radius } = this.isle;
    const ring = (a: number, r: number, seed: number, octaves: number): number =>
      fbm(Math.cos(a) * r + 50, Math.sin(a) * r + 50, seed, octaves) - 0.5;
    for (let i = 0; i < COAST_SAMPLES; i++) {
      const a = (i / COAST_SAMPLES) * Math.PI * 2;
      const t = (i / COAST_SAMPLES) * n;
      const j = Math.floor(t);
      const k0 = this.isle.shape[j % n] ?? 1;
      const k1 = this.isle.shape[(j + 1) % n] ?? 1;
      const base = k0 + (k1 - k0) * smooth(t - j);
      const bays = ring(a, 1.7, this.seed + 41, 2) * 0.42;
      const coves = ring(a, 6, this.seed + 43, 2) * 0.12;
      const jag = ring(a, 24, this.seed + 47, 1) * 0.05;
      coast[i] = radius * Math.min(COAST_MAX, Math.max(COAST_MIN, base * (1 + bays + coves + jag)));
    }
    for (const t of this.towns) {
      const d = Math.hypot(t.x - pos.x, t.y - pos.y);
      if (d < 1) continue;
      const need = d + SHORE_MARGIN;
      const at = Math.atan2(t.y - pos.y, t.x - pos.x);
      const spread = Math.min(Math.PI / 2, (SHORE_MARGIN * 1.8) / d);
      const from = Math.floor(((at - spread) / (Math.PI * 2)) * COAST_SAMPLES);
      const to = Math.ceil(((at + spread) / (Math.PI * 2)) * COAST_SAMPLES);
      for (let s = from; s <= to; s++) {
        const i = ((s % COAST_SAMPLES) + COAST_SAMPLES) % COAST_SAMPLES;
        const off = Math.abs((s / COAST_SAMPLES) * Math.PI * 2 - at) / spread;
        // Rounded headland: full margin straight out from the town, easing back to the coast at the sides.
        const reach = need - (1 - Math.cos(Math.min(1, off) * (Math.PI / 2))) * SHORE_MARGIN * 1.5;
        coast[i] = Math.max(coast[i] ?? 0, reach);
      }
    }
    return coast;
  }

  /** Distance from the center to the outline in the direction of angle `a`. */
  radiusAt(a: number): number {
    const t = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * COAST_SAMPLES;
    const i = Math.floor(t);
    const r0 = this.coast[i % COAST_SAMPLES] ?? this.isle.radius;
    const r1 = this.coast[(i + 1) % COAST_SAMPLES] ?? this.isle.radius;
    return r0 + (r1 - r0) * (t - i);
  }

  /** 0 at the center, 1 on the outline. */
  edge(x: number, z: number): number {
    const dx = x - this.isle.pos.x;
    const dz = z - this.isle.pos.y;
    return Math.hypot(dx, dz) / this.radiusAt(Math.atan2(dz, dx));
  }

  /** How far a point is from towns, beacons and roads (0 on them). */
  clearance(x: number, z: number): number {
    const p = { x, y: z };
    let d = Infinity;
    for (const t of this.towns) d = Math.min(d, Math.hypot(t.x - x, t.y - z) - TOWN_CLEAR);
    for (const b of this.beacons) d = Math.min(d, Math.hypot(b.x - x, b.y - z) - BEACON_CLEAR);
    for (const r of this.roads) d = Math.min(d, segmentDistance(p, r) - ROAD_HALF_WIDTH - 1.5);
    for (const st of this.streams) d = Math.min(d, segmentDistance(p, st) - STREAM_HALF_WIDTH - 1.5);
    return Math.max(0, d);
  }

  /**
   * Hills, mountains and lake beds, all kept away from towns and roads, so towns, marches and taps
   * stay on y = 0. Mountains and lakes need more room, so they rise in the wild ground near the shore.
   */
  height(x: number, z: number, clear = this.clearance(x, z)): number {
    const edge = this.edge(x, z);
    const n = fbm(x / 85, z / 85, this.seed);
    const hill = Math.max(0, n - 0.45) / 0.55;
    const ripple = (fbm(x / 16, z / 16, this.seed + 5, 2) - 0.5) * 0.7;
    const flat = smoothstep(2, 14, clear);
    const rolling = (hill ** 1.3 * HILL_HEIGHT + ripple) * flat * smoothstep(1, 0.85, edge);
    const ridge = 1 - Math.abs(fbm(x / 20, z / 20, this.seed + 23) * 2 - 1);
    const peak = this.mountain(x, z) * smoothstep(8, 28, clear) * smoothstep(1, 0.93, edge);
    const mountain = peak ** 1.4 * MOUNTAIN_HEIGHT * (0.3 + 0.7 * ridge);
    const lake = this.lake(x, z) * smoothstep(10, 22, clear) * LAKE_DEPTH;
    return rolling + mountain - lake;
  }

  /** 0–1: how much a point belongs to a mountain range. */
  mountain(x: number, z: number): number {
    return smoothstep(0.56, 0.78, fbm(x / 130 + 71, z / 130 - 33, this.seed + 21));
  }

  /** 0–1: how much a point belongs to a lake; lakes stay off mountains and the shore. */
  lake(x: number, z: number): number {
    const wet = smoothstep(0.6, 0.7, fbm(x / 75 - 50, z / 75 + 20, this.seed + 31));
    return wet * (1 - this.mountain(x, z)) * smoothstep(0.82, 0.7, this.edge(x, z));
  }

  forest(x: number, z: number): number {
    return fbm(x / 60 + 40, z / 60 - 25, this.seed + 3);
  }

  inPatch(x: number, z: number, margin = 0): boolean {
    return this.patches.some((p) => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.y;
      const u = dx * Math.cos(p.turn) + dz * Math.sin(p.turn);
      const v = -dx * Math.sin(p.turn) + dz * Math.cos(p.turn);
      return Math.abs(u) < p.w / 2 + margin && Math.abs(v) < p.d / 2 + margin;
    });
  }

  /** Farm fields in open, low ground. */
  placePatches(count: number): void {
    const rand = scatter(this.seed + 99);
    for (let tries = 0; tries < count * 30 && this.patches.length < count; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * this.isle.radius * 0.85;
      const x = this.isle.pos.x + Math.cos(a) * r;
      const z = this.isle.pos.y + Math.sin(a) * r;
      if (this.clearance(x, z) < 6 || this.forest(x, z) > 0.5 || this.height(x, z) > 1.2) continue;
      if (this.edge(x, z) > 0.88 || this.inPatch(x, z, 12)) continue;
      this.patches.push({
        pos: { x, y: z },
        w: 10 + rand() * 8,
        d: 7 + rand() * 6,
        turn: rand() * Math.PI,
        kind: Math.floor(rand() * 3),
      });
    }
  }
}

/** The top of the isle: rings of near-equal triangles from the center out to the outline. */
function topGeometry(f: IsleField, step: number): { geo: BufferGeometry; rim: Vec[] } {
  const R = Math.max(4, Math.ceil(f.isle.radius / step));
  const { pos } = f.isle;
  const x0 = pos.x - f.isle.radius * TEXTURE_SPAN;
  const z0 = pos.y - f.isle.radius * TEXTURE_SPAN;
  const span = f.isle.radius * TEXTURE_SPAN * 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const rings: number[][] = [];
  const rim: Vec[] = [];
  for (let j = 0; j <= R; j++) {
    const count = j === 0 ? 1 : 6 * j;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = j === 0 ? 0 : (f.radiusAt(a) * j) / R;
      const x = pos.x + Math.cos(a) * r;
      const z = pos.y + Math.sin(a) * r;
      ids.push(positions.length / 3);
      positions.push(x, j === R ? 0 : f.height(x, z), z);
      uvs.push((x - x0) / span, 1 - (z - z0) / span);
      if (j === R) rim.push({ x, y: z });
    }
    rings.push(ids);
  }
  const tri = (a: number, b: number, c: number): void => {
    const ax = positions[a * 3] ?? 0;
    const az = positions[a * 3 + 2] ?? 0;
    const cross =
      ((positions[b * 3] ?? 0) - ax) * ((positions[c * 3 + 2] ?? 0) - az) -
      ((positions[b * 3 + 2] ?? 0) - az) * ((positions[c * 3] ?? 0) - ax);
    // Faces must wind counter-clockwise seen from above (+y).
    if (cross < 0) index.push(a, b, c);
    else index.push(a, c, b);
  };
  for (let j = 1; j <= R; j++) {
    const inner = rings[j - 1] ?? [];
    const outer = rings[j] ?? [];
    const a = inner.length;
    const b = outer.length;
    let i = 0;
    let k = 0;
    while (i < a || k < b) {
      if (k < b && (i >= a || (k + 1) / b <= (i + 1) / a)) {
        tri(inner[i % a] ?? 0, outer[k % b] ?? 0, outer[(k + 1) % b] ?? 0);
        k++;
      } else {
        tri(inner[i % a] ?? 0, outer[k % b] ?? 0, inner[(i + 1) % a] ?? 0);
        i++;
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, rim };
}

/** Non-indexed faces with one color each, for the faceted rock of cliffs and the underside. */
class Faces {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  tri(a: number[], b: number[], c: number[], color: Color): void {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals();
    return g;
  }
}

const STRATA = ['#5f7d3c', '#6b4f35', '#8a6a4a', '#76593f', '#957a5c', '#6d5641'].map((c) => new Color(c));
const STRATA_Y = [0, -0.9, -3.2, -6, -8.6, -CLIFF_DEPTH];
const UNDER = ['#7a634c', '#6a5747', '#5d5049', '#4f4741'].map((c) => new Color(c));

/** Cliff walls with layers of soil and rock, and a jagged rocky cone under the isle. */
function rockGeometry(f: IsleField, rim: Vec[]): BufferGeometry {
  const faces = new Faces();
  const { pos } = f.isle;
  const n = rim.length;
  const rows = STRATA_Y.length;
  const col = new Color();
  const shade = (base: Color | undefined, k: number): Color =>
    col.copy(base ?? UNDER[0] ?? col).multiplyScalar(0.88 + hash(k, n, f.seed) * 0.22);
  const columns = rim.map((p, i) => {
    const dx = p.x - pos.x;
    const dz = p.y - pos.y;
    const len = Math.hypot(dx, dz) || 1;
    return STRATA_Y.map((y, row) => {
      const out = row === 0 ? 0 : row === 1 ? 0.35 : (noise(i * 0.7, row * 3.1, f.seed) - 0.55) * 2.4;
      const drop = row === rows - 1 ? -noise(i * 0.4, 9, f.seed) * 5 : 0;
      return [p.x + (dx / len) * out, y + drop, p.y + (dz / len) * out];
    });
  });
  for (let i = 0; i < n; i++) {
    const a = columns[i] ?? [];
    const b = columns[(i + 1) % n] ?? [];
    for (let row = 0; row < rows - 1; row++) {
      const c = shade(STRATA[row], i * 7 + row);
      faces.quad(a[row] ?? [], a[row + 1] ?? [], b[row + 1] ?? [], b[row] ?? [], c);
    }
  }
  const depth = f.isle.radius * 0.8;
  const levels = 7;
  let prev = columns.map((c) => c[rows - 1] ?? [0, 0, 0]);
  for (let k = 1; k <= levels; k++) {
    const t = k / levels;
    const next = prev.map((_, i) => {
      if (k === levels) return [pos.x, -CLIFF_DEPTH - depth, pos.y];
      const a = (i / n) * Math.PI * 2;
      const spread = (1 - t) ** 0.85 * (0.92 + (noise(i * 0.35, k * 2.3, f.seed + 1) - 0.5) * 0.3);
      const r = f.radiusAt(a) * spread;
      return [
        pos.x + Math.cos(a) * r,
        -CLIFF_DEPTH - t ** 1.25 * depth * (0.9 + hash(i, k, f.seed) * 0.15),
        pos.y + Math.sin(a) * r,
      ];
    });
    for (let i = 0; i < n; i++) {
      const c = shade(UNDER[Math.min(UNDER.length - 1, Math.floor(t * UNDER.length))], i * 13 + k);
      faces.quad(prev[i] ?? [], next[i] ?? [], next[(i + 1) % n] ?? [], prev[(i + 1) % n] ?? [], c);
    }
    prev = next;
  }
  return faces.build();
}

function paintDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const GRASS_A = new Color('#4b9a33');
const GRASS_B = new Color('#78bf40');
const DRY_PRAIRIE = new Color('#c6bf55');
const FOREST_FLOOR = new Color('#2c6e2e');
const HILL_ROCK = new Color('#8c8577');
const SNOW = new Color('#f3f6f8');
const SAND = new Color('#dcc78b');
const WATER = new Color('#2f7fc1');
const EDGE_DIRT = new Color('#8f7650');

/** Ground texture: grass shades, meadows, forest floor, rocky hilltops, worn ground, roads and fields. */
function paintGround(f: IsleField, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const { span, x0, z0 } = groundArea(f.isle);
  const G = MACRO_GRID;
  const macro = new Float32Array(G * G * 3);
  const c = new Color();
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const x = x0 + ((gx + 0.5) / G) * span;
      const z = z0 + ((gy + 0.5) / G) * span;
      c.copy(GRASS_A).lerp(GRASS_B, fbm(x / 45, z / 45, f.seed + 8));
      const prairie = smoothstep(0.6, 0.72, fbm(x / 70 - 13, z / 70 + 7, f.seed + 9));
      c.lerp(DRY_PRAIRIE, prairie * 0.8);
      c.lerp(FOREST_FLOOR, smoothstep(0.48, 0.66, f.forest(x, z)) * 0.8);
      const h = f.height(x, z);
      c.lerp(HILL_ROCK, smoothstep(5, 10, h) * 0.9);
      c.lerp(SNOW, smoothstep(19, 22, h));
      if (f.lake(x, z) > 0.02) {
        c.lerp(SAND, smoothstep(0.5, -0.2, h));
        c.lerp(WATER, smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL - 0.5, h));
      }
      c.lerp(EDGE_DIRT, smoothstep(0.93, 1, f.edge(x, z))).convertLinearToSRGB();
      macro.set([c.r * 255, c.g * 255, c.b * 255], (gy * G + gx) * 3);
    }
  }
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const sample = (gx: number, gy: number, ch: number): number =>
    macro[(Math.min(G - 1, Math.max(0, gy)) * G + Math.min(G - 1, Math.max(0, gx))) * 3 + ch] ?? 0;
  for (let py = 0; py < size; py++) {
    const fy = (py / size) * G - 0.5;
    const gy = Math.floor(fy);
    const ty = fy - gy;
    for (let px = 0; px < size; px++) {
      const fx = (px / size) * G - 0.5;
      const gx = Math.floor(fx);
      const tx = fx - gx;
      const grain = 0.9 + hash(px, py, 3) * 0.2;
      const o = (py * size + px) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sample(gx, gy, ch) * (1 - tx) + sample(gx + 1, gy, ch) * tx;
        const bottom = sample(gx, gy + 1, ch) * (1 - tx) + sample(gx + 1, gy + 1, ch) * tx;
        data[o + ch] = (top * (1 - ty) + bottom * ty) * grain;
      }
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const px = (v: number): number => (v / span) * size;
  const to = (p: Vec): [number, number] => [px(p.x - x0), px(p.y - z0)];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of f.patches) {
    const [x, y] = to(p.pos);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.turn);
    const w = px(p.w);
    const d = px(p.d);
    ctx.fillStyle = ['#b39a5c', '#8c6b47', '#9aa64e'][p.kind] ?? '#b39a5c';
    ctx.fillRect(-w / 2, -d / 2, w, d);
    ctx.fillStyle = ['#d6c274', '#6a4f33', '#b8c262'][p.kind] ?? '#d6c274';
    const rows = Math.max(3, Math.round(p.w / 1.2));
    for (let i = 0; i < rows; i += 2) ctx.fillRect(-w / 2 + (w / rows) * i, -d / 2, w / rows, d);
    ctx.strokeStyle = 'rgba(70, 52, 30, 0.55)';
    ctx.lineWidth = Math.max(1, px(0.35));
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
  }
  for (const t of f.towns) {
    const [x, y] = to(t);
    paintDisc(ctx, x, y, px(TOWN_CLEAR), 'rgba(140, 112, 72, 0.3)');
  }
  const roadPass = (width: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = px(width);
    for (const r of f.roads) {
      const [ax, ay] = to(r.a);
      const [bx, by] = to(r.b);
      // A gentle bend, the same on both passes.
      const bend = (hash(Math.round(r.a.x + r.b.x), Math.round(r.a.y + r.b.y), f.seed) - 0.5) * 0.25;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2 - (by - ay) * bend, (ay + by) / 2 + (bx - ax) * bend, bx, by);
      ctx.stroke();
    }
  };
  roadPass(ROAD_HALF_WIDTH * 2 + 1, 'rgba(96, 78, 50, 0.6)');
  roadPass(ROAD_HALF_WIDTH * 2, '#a48a62');
  roadPass(ROAD_HALF_WIDTH * 0.7, 'rgba(190, 168, 125, 0.6)');
  for (const [width, color] of [
    [STREAM_HALF_WIDTH * 2 + 1.6, 'rgba(110, 92, 60, 0.8)'],
    [STREAM_HALF_WIDTH * 2, '#3f8fd0'],
    [STREAM_HALF_WIDTH * 0.6, 'rgba(190, 228, 255, 0.55)'],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = px(width);
    for (const st of f.streams) {
      const [ax, ay] = to(st.a);
      const [bx, by] = to(st.b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  return canvas;
}

interface Spot {
  x: number;
  y: number;
  z: number;
  turn: number;
  scale: number;
  tint: Color;
}

type SceneryKind =
  'pine' | 'oak' | 'birch' | 'bush' | 'rock' | 'grass' | 'flower' | 'crystal' | 'runestone' | 'runeglow';

/** Kinds drawn unlit, so they glow in their tint. */
const GLOWING: ReadonlySet<SceneryKind> = new Set(['crystal', 'runeglow']);
const CRYSTAL_COLORS = ['#6fe0ff', '#b58cff', '#5ff0a8', '#ff8fd6'].map((c) => new Color(c));
const RUNE_COLOR = new Color('#7fe3ff');
/** Share of roads with a rune stone beside them. */
const RUNE_SHARE = 0.22;

function colored(geo: BufferGeometry, color: string, x = 0, y = 0, z = 0): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

function join(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not merge scenery');
  g.computeVertexNormals();
  return g;
}

const TRUNK = '#6b4a2e';

function pine(): BufferGeometry {
  return join([
    colored(new CylinderGeometry(0.28, 0.38, 1.6, 5), TRUNK, 0, 0.8, 0),
    colored(new ConeGeometry(2.1, 2.8, 7), '#24733a', 0, 2.5, 0),
    colored(new ConeGeometry(1.65, 2.4, 7), '#2b8044', 0, 3.8, 0),
    colored(new ConeGeometry(1.1, 2, 7), '#338a4c', 0, 5, 0),
  ]);
}

function oak(detail: number): BufferGeometry {
  return join([
    colored(new CylinderGeometry(0.3, 0.45, 2.2, 6), TRUNK, 0, 1.1, 0),
    colored(new IcosahedronGeometry(1.9, detail), '#4a9a2e', 0, 3.6, 0),
    colored(new IcosahedronGeometry(1.35, detail), '#58a836', 1.15, 3, 0.4),
    colored(new IcosahedronGeometry(1.25, detail), '#3f8c2f', -1, 3.15, -0.5),
  ]);
}

function birch(detail: number): BufferGeometry {
  return join([
    colored(new CylinderGeometry(0.17, 0.22, 3.2, 5), '#ddd8cc', 0, 1.6, 0),
    colored(new IcosahedronGeometry(1.2, detail).scale(1, 1.5, 1), '#8cc63f', 0, 4, 0),
  ]);
}

function bush(): BufferGeometry {
  return join([
    colored(new IcosahedronGeometry(0.9, 0).scale(1, 0.75, 1), '#438a2c', 0, 0.55, 0),
    colored(new IcosahedronGeometry(0.65, 0).scale(1, 0.75, 1), '#509a34', 0.7, 0.45, 0.2),
  ]);
}

function rock(): BufferGeometry {
  return join([colored(new DodecahedronGeometry(1, 0).scale(1, 0.6, 0.85), '#9a958b', 0, 0.3, 0)]);
}

function grass(): BufferGeometry {
  const blade = (x: number, z: number, lean: number) =>
    colored(new ConeGeometry(0.1, 0.9, 3).rotateZ(lean), '#55a838', x, 0.4, z);
  return join([blade(0, 0, 0.1), blade(0.18, 0.1, -0.35), blade(-0.15, -0.08, 0.4)]);
}

function flower(): BufferGeometry {
  return join([
    colored(new CylinderGeometry(0.03, 0.03, 0.5, 3), '#4f8a3a', 0, 0.25, 0),
    colored(new IcosahedronGeometry(0.17, 0), '#ffffff', 0, 0.55, 0),
  ]);
}

const FLOWER_COLORS = ['#f4f1e6', '#f2d14b', '#e0574f', '#a978d6', '#f08cc0'].map((c) => new Color(c));

/** Trees, bushes, rocks and ground cover: forests where the forest noise is high, a few lone ones elsewhere. */
function scenerySpots(f: IsleField, q: QualityPreset): Map<SceneryKind, Spot[]> {
  const rand = scatter(f.seed + 11);
  const kinds = new Map<SceneryKind, Spot[]>();
  const add = (kind: SceneryKind, x: number, z: number, scale: number, color: Color): void => {
    const spot = { x, y: f.height(x, z), z, turn: rand() * Math.PI * 2, scale, tint: color.clone() };
    const list = kinds.get(kind);
    if (list) list.push(spot);
    else kinds.set(kind, [spot]);
  };
  const leafy = (): Color => tint.setRGB(0.82 + rand() * 0.18, 0.86 + rand() * 0.14, 0.8 + rand() * 0.2);
  const grey = (): Color => tint.setScalar(0.8 + rand() * 0.25);
  const gem = (): Color => CRYSTAL_COLORS[Math.floor(rand() * CRYSTAL_COLORS.length)] ?? RUNE_COLOR;
  const { pos, radius } = f.isle;
  const spacing = 4.2 / Math.sqrt(q.scenery);
  const reach = radius * COAST_MAX;
  const cells = Math.ceil((reach * 2) / spacing);
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const x = pos.x - reach + (gx + rand()) * spacing;
      const z = pos.y - reach + (gy + rand()) * spacing;
      const edge = f.edge(x, z);
      if (edge > 0.97) continue;
      const clear = f.clearance(x, z);
      const h = f.height(x, z, clear);
      if (edge > 0.9) {
        if (rand() < 0.12) add('rock', x, z, 0.6 + rand() * 1.4, grey());
        continue;
      }
      if (clear < 1 || f.inPatch(x, z, 1.5)) continue;
      if (h < 0.4 && f.lake(x, z) > 0.02) continue;
      if (h > 15) {
        if (rand() < 0.1) add('rock', x, z, 0.8 + rand() * 1.6, grey());
        else if (rand() < 0.05) add('crystal', x, z, 0.8 + rand() * 0.9, gem());
        continue;
      }
      if (h > 4 && rand() < 0.02) add('crystal', x, z, 0.6 + rand() * 0.7, gem());
      const forest = smoothstep(0.46, 0.64, f.forest(x, z));
      const roll = rand();
      if (roll < forest * 0.95 + 0.035) {
        const scale = 0.75 + rand() * 0.55;
        const kind = h > 3 || rand() < forest * 0.5 ? 'pine' : rand() < 0.22 ? 'birch' : 'oak';
        add(kind, x, z, scale, leafy());
      } else if (roll < forest * 0.95 + 0.06) add('bush', x, z, 0.7 + rand() * 0.6, leafy());
      else if (roll < forest * 0.95 + 0.075 + smoothstep(3, 9, h) * 0.3)
        add('rock', x, z, 0.5 + rand() * 1.3, grey());
      if (!q.groundCover) continue;
      if (rand() < 0.35) add('grass', x + rand() * 2, z + rand() * 2, 0.8 + rand() * 0.7, leafy());
      if (rand() < 0.14 * (1 - forest)) {
        add(
          'flower',
          x - rand() * 2,
          z - rand() * 2,
          0.9 + rand() * 0.5,
          FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)] ?? tint,
        );
      }
    }
  }
  // Rune stones stand beside the middle of some roads, facing along them.
  for (const r of f.roads) {
    if (rand() > RUNE_SHARE) continue;
    const dx = r.b.x - r.a.x;
    const dz = r.b.y - r.a.y;
    const len = Math.hypot(dx, dz) || 1;
    const side = rand() < 0.5 ? -1 : 1;
    const x = (r.a.x + r.b.x) / 2 + (-dz / len) * ROAD_HALF_WIDTH * 2.6 * side;
    const z = (r.a.y + r.b.y) / 2 + (dx / len) * ROAD_HALF_WIDTH * 2.6 * side;
    const turn = Math.atan2(dx, dz);
    for (const kind of ['runestone', 'runeglow'] as const) {
      const spot = { x, y: 0, z, turn, scale: 1, tint: (kind === 'runeglow' ? RUNE_COLOR : WHITE).clone() };
      const list = kinds.get(kind);
      if (list) list.push(spot);
      else kinds.set(kind, [spot]);
    }
  }
  return kinds;
}

const WHITE = new Color('#ffffff');

function crystalCluster(): BufferGeometry {
  const shard = (r: number, h: number, x: number, z: number, lean: number, color: string) =>
    colored(
      new OctahedronGeometry(1, 0)
        .scale(r, h / 2, r)
        .rotateZ(lean)
        .rotateY(x * 3),
      color,
      x,
      h / 2,
      z,
    );
  return join([
    shard(0.55, 3, 0, 0, 0, '#ffffff'),
    shard(0.35, 2, 0.65, 0.2, 0.45, '#d8d8d8'),
    shard(0.32, 1.7, -0.55, -0.3, -0.5, '#e8e8e8'),
    shard(0.25, 1.1, 0.1, 0.6, 0.3, '#cfcfcf'),
  ]);
}

/** A standing stone, its face toward ±z; the glowing runes are a separate kind on the same spot. */
function runestone(): BufferGeometry {
  return join([
    colored(new BoxGeometry(1.4, 3.2, 0.6), '#8d8a85', 0, 1.6, 0),
    colored(new BoxGeometry(1.7, 0.4, 0.9), '#6f6c67', 0, 0.2, 0),
    colored(new ConeGeometry(0.85, 0.7, 4).rotateY(Math.PI / 4), '#8d8a85', 0, 3.5, 0),
  ]);
}

function runeglow(): BufferGeometry {
  const mark = (y: number, w: number) => [
    colored(new BoxGeometry(w, 0.14, 0.05), '#ffffff', 0, y, 0.32),
    colored(new BoxGeometry(w, 0.14, 0.05), '#ffffff', 0, y, -0.32),
  ];
  return join([
    ...mark(2.6, 0.7),
    ...mark(2.1, 0.45),
    ...mark(1.6, 0.8),
    colored(new BoxGeometry(0.14, 1.3, 0.05), '#ffffff', 0, 2.1, 0.32),
    colored(new BoxGeometry(0.14, 1.3, 0.05), '#ffffff', 0, 2.1, -0.32),
  ]);
}

const SCENERY_MODELS: Record<SceneryKind, (detail: number) => BufferGeometry> = {
  pine,
  oak,
  birch,
  bush,
  rock,
  grass,
  flower,
  crystal: crystalCluster,
  runestone,
  runeglow,
};

export interface IsleMaterials {
  scenery: Material;
  /** Unlit, for crystals and runes. */
  glow: Material;
  rock: Material;
  water: Material;
  /** Flowing water of streams and waterfalls (their textures scroll). */
  stream: Material;
  fall: Material;
}

/** How far a waterfall drops below the cliff top. */
const FALL_DROP = 60;
const FALL_SPREAD = 1.7;

/** Stream beds on the ground and the sheets of water that pour off the coast. */
function waterGeometry(f: IsleField): { streams: BufferGeometry; falls: BufferGeometry } {
  const quad = (pts: number[][], uvs: number[][]): BufferGeometry => {
    const [a, b, c, d] = pts as [number[], number[], number[], number[]];
    const [ua, ub, uc, ud] = uvs as [number[], number[], number[], number[]];
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3),
    );
    g.setAttribute(
      'uv',
      new BufferAttribute(new Float32Array([...ua, ...ub, ...uc, ...ua, ...uc, ...ud]), 2),
    );
    g.computeVertexNormals();
    return g;
  };
  const beds: BufferGeometry[] = [];
  const sheets: BufferGeometry[] = [];
  for (const st of f.streams) {
    const dx = st.b.x - st.a.x;
    const dz = st.b.y - st.a.y;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * STREAM_HALF_WIDTH;
    const nz = (dx / len) * STREAM_HALF_WIDTH;
    const y = 0.07;
    const v = len / 8;
    beds.push(
      quad(
        [
          [st.a.x - nx, y, st.a.y - nz],
          [st.b.x - nx, y, st.b.y - nz],
          [st.b.x + nx, y, st.b.y + nz],
          [st.a.x + nx, y, st.a.y + nz],
        ],
        [
          [0, 0],
          [0, v],
          [1, v],
          [1, 0],
        ],
      ),
    );
    const ox = (dx / len) * 9;
    const oz = (dz / len) * 9;
    const bottom = -CLIFF_DEPTH - FALL_DROP;
    sheets.push(
      quad(
        [
          [st.b.x - nx, y, st.b.y - nz],
          [st.b.x - nx * FALL_SPREAD + ox, bottom, st.b.y - nz * FALL_SPREAD + oz],
          [st.b.x + nx * FALL_SPREAD + ox, bottom, st.b.y + nz * FALL_SPREAD + oz],
          [st.b.x + nx, y, st.b.y + nz],
        ],
        [
          [0, 0],
          [0, 4],
          [1, 4],
          [1, 0],
        ],
      ),
    );
  }
  const join2 = (list: BufferGeometry[]): BufferGeometry =>
    list.length > 0 ? (mergeGeometries(list) ?? new BufferGeometry()) : new BufferGeometry();
  return { streams: join2(beds), falls: join2(sheets) };
}

/** Blends the lords' territory (a premultiplied texture over the same square) into the ground color. */
function withTerritory(material: MeshLambertMaterial, territory: Texture): MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.territoryMap = { value: territory };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D territoryMap;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 territory = texture2D( territoryMap, vMapUv );
        diffuseColor.rgb = diffuseColor.rgb * ( 1.0 - territory.a ) + territory.rgb;`,
      );
  };
  material.customProgramCacheKey = () => 'territory';
  return material;
}

/** One isle: textured hilly top, cliffs and underside, and its scenery. */
export function buildIsle(
  view: LordView,
  isle: IsleView,
  q: QualityPreset,
  materials: IsleMaterials,
  anisotropy: number,
  territory: Texture,
): { group: Group; field: IsleField; disposable: (Material | Texture)[] } {
  const f = new IsleField(isle, view);
  f.placePatches(Math.round(14 * q.scenery));
  const group = new Group();
  const { geo, rim } = topGeometry(f, q.terrainStep);
  const texture = new CanvasTexture(paintGround(f, q.groundTexture));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  const top = withTerritory(new MeshLambertMaterial({ map: texture, flatShading: true }), territory);
  const land = new Mesh(geo, top);
  land.receiveShadow = true;
  const rocks = new Mesh(rockGeometry(f, rim), materials.rock);
  rocks.receiveShadow = true;
  // One sheet of water under the whole isle, inside its coast: only lake beds dip below it.
  const sheet = new Shape();
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const r = f.radiusAt(a) * 0.85;
    // Shapes lie in x-y; turning them flat maps y to -z, so the outline is mirrored here.
    if (i === 0) sheet.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
    else sheet.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  const water = new Mesh(
    new ShapeGeometry(sheet).rotateX(-Math.PI / 2).translate(isle.pos.x, WATER_LEVEL, isle.pos.y),
    materials.water,
  );
  water.receiveShadow = true;
  const flowing = waterGeometry(f);
  const streams = new Mesh(flowing.streams, materials.stream);
  const falls = new Mesh(flowing.falls, materials.fall);
  group.add(land, rocks, water, streams, falls);
  for (const [kind, spots] of scenerySpots(f, q)) {
    const mesh = new InstancedMesh(
      SCENERY_MODELS[kind](q.roundCrowns ? 1 : 0),
      GLOWING.has(kind) ? materials.glow : materials.scenery,
      spots.length,
    );
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.turn, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, s.tint);
    });
    mesh.castShadow = kind !== 'grass' && kind !== 'flower' && kind !== 'runeglow';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(1);
  return { group, field: f, disposable: [texture, top] };
}

/** Top-down crown colors and sizes for the 2D map, wider than in 3D so they read from above. */
const CANOPY: Partial<Record<SceneryKind, { color: string; r: number }>> = {
  pine: { color: '#21683a', r: 3 },
  oak: { color: '#418f2c', r: 3.4 },
  birch: { color: '#80bb3a', r: 2.1 },
  bush: { color: '#3d802a', r: 1.6 },
  rock: { color: '#9a958b', r: 1.2 },
  crystal: { color: '#8fe8ff', r: 1.4 },
  runestone: { color: '#8d8a85', r: 1.1 },
};

const SHADE_GRID = 160;
/** Direction the 2D light comes from (upper left), as a slope weight per axis. */
const SHADE_X = -0.7;
const SHADE_Z = -0.7;

/** Relief and lakes for the 2D map, on a small image stretched smoothly over the ground. */
function hillshade(ctx: CanvasRenderingContext2D, f: IsleField, size: number): void {
  const { span, x0, z0 } = groundArea(f.isle);
  const G = SHADE_GRID;
  const step = span / G;
  const heights = new Float32Array((G + 1) * (G + 1));
  for (let gy = 0; gy <= G; gy++) {
    for (let gx = 0; gx <= G; gx++) heights[gy * (G + 1) + gx] = f.height(x0 + gx * step, z0 + gy * step);
  }
  const shade = document.createElement('canvas');
  shade.width = G;
  shade.height = G;
  const sctx = shade.getContext('2d');
  if (!sctx) return;
  const image = sctx.createImageData(G, G);
  const data = image.data;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const h = (dx: number, dy: number): number => heights[(gy + dy) * (G + 1) + gx + dx] ?? 0;
      const o = (gy * G + gx) * 4;
      const here = h(0, 0);
      if (here < WATER_LEVEL + 0.1) {
        const deep = Math.min(1, (WATER_LEVEL - here) / 2);
        data.set([58 - deep * 20, 143 - deep * 25, 214 - deep * 20, 240], o);
        continue;
      }
      const slope = ((h(1, 0) - here) * SHADE_X + (h(0, 1) - here) * SHADE_Z) / step;
      const light = Math.max(-1, Math.min(1, slope * 1.6));
      if (light > 0) data.set([255, 250, 230, light * 90], o);
      else data.set([20, 25, 40, -light * 115], o);
    }
  }
  sctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shade, 0, 0, size, size);
}

export interface FlatIsle {
  /** Ground with roads, fields and tree crowns seen from above. */
  canvas: HTMLCanvasElement;
  field: IsleField;
  span: number;
  x0: number;
  z0: number;
}

/** The isle for the 2D map, painted once: the 3D ground texture plus the scenery seen from above. */
export function flatIsle(view: LordView, isle: IsleView, q: QualityPreset, size: number): FlatIsle {
  const f = new IsleField(isle, view);
  f.placePatches(Math.round(14 * q.scenery));
  const canvas = paintGround(f, size);
  const { span, x0, z0 } = groundArea(isle);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, field: f, span, x0, z0 };
  const px = size / span;
  hillshade(ctx, f, size);
  const c = new Color();
  const spots = [...scenerySpots(f, { ...q, groundCover: false })].flatMap(([kind, list]) => {
    const look = CANOPY[kind];
    return look ? list.map((s) => ({ s, look })) : [];
  });
  // Back to front, so crowns lower on the map cover the ones above them.
  spots.sort((a, b) => a.s.z - b.s.z);
  for (const { s, look } of spots) {
    const x = (s.x - x0) * px;
    const y = (s.z - z0) * px;
    const r = look.r * s.scale * px;
    ctx.fillStyle = 'rgba(20, 35, 15, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.45, y + r * 0.35, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    c.set(look.color).multiply(s.tint);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 220, 0.12)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas, field: f, span, x0, z0 };
}
