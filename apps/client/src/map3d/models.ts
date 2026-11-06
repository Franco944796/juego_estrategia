import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** «team» parts are white (or grey for shading) so the instance color paints them in the owner's color. */
const BASE = {
  mud: '#b48a5e',
  plaster: '#e6dbc2',
  wood: '#8d5a3b',
  darkWood: '#5a3822',
  timber: '#4a2f1d',
  stone: '#b3ada0',
  darkStone: '#857f74',
  slate: '#6c6a66',
  window: '#2a2420',
  iron: '#4a4a50',
  steel: '#a3acb6',
  skin: '#e9c29a',
  mail: '#7e848c',
  pants: '#4a3a2c',
  dirt: '#9a7d57',
  yard: '#a89272',
  paving: '#9c968a',
  soil: '#6e5236',
  crop: '#c9b45a',
  leaf: '#6f9a43',
  hay: '#d9bb62',
  water: '#3f78b0',
  flame: '#ff9a3c',
  team: '#ffffff',
  teamShade: '#c4c4c4',
  gold: '#e2b23c',
  ivory: '#ece2c6',
  belly: '#e6d4a2',
  eye: '#ffd23a',
  /** Wing skin: darker than the scales, so the wings stand out against the body. */
  membrane: '#9a9a9a',
} as const;

type Palette = Record<keyof typeof BASE, string>;
/** The palette the builders read; a skin swaps some colors while its models are built. */
const C: Palette = { ...BASE };

type V3 = [number, number, number];
const UP = new Vector3(0, 1, 0);

/** One piece: colored, with a still `anim` attribute, moved into place. */
function part(geo: BufferGeometry, color: string, x = 0, y = 0, z = 0, turn = 0): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (turn) g.rotateY(turn);
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('anim', new BufferAttribute(new Float32Array(n * 3), 3));
  return g;
}

/** Sets the `anim` attribute (flutter, swing, wing flap) of every vertex from its position. */
function moving(g: BufferGeometry, f: (p: Vector3) => [number, number, number?]): BufferGeometry {
  const pos = g.getAttribute('position');
  const anim = g.getAttribute('anim');
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const [a, b, c = 0] = f(p);
    anim.setXYZ(i, a, b, c);
  }
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not merge model parts');
  g.computeVertexNormals();
  return g;
}

/** A body standing on `y`, centered at (x, z). */
const box = (w: number, h: number, d: number, color: string, x = 0, z = 0, y = 0, turn = 0) =>
  part(new BoxGeometry(w, h, d), color, x, y + h / 2, z, turn);
const cyl = (r: number, h: number, color: string, x = 0, z = 0, y = 0, sides = 7, top = r) =>
  part(new CylinderGeometry(top, r, h, sides), color, x, y + h / 2, z);
const cone = (r: number, h: number, color: string, x = 0, z = 0, y = 0, sides = 7, turn = 0) =>
  part(new ConeGeometry(r, h, sides), color, x, y + h / 2, z, turn);
/** Four-sided roof over a square of half-width `w`. */
const pyramid = (w: number, h: number, color: string, x = 0, z = 0, y = 0) =>
  cone(w * 1.45, h, color, x, z, y, 4, Math.PI / 4);
const stone = (r: number, color: string, x: number, z: number, y = 0) =>
  part(new DodecahedronGeometry(r, 0).scale(1, 0.7, 1), color, x, y + r * 0.5, z);

/** A box `w` thick from `a` to `b`: beams, braces and rails. */
function beam(a: V3, b: V3, w: number, color: string): BufferGeometry {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const g = new BoxGeometry(w, dir.length(), w);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  const mid = from.addScaledVector(dir, 0.5);
  return part(g, color, mid.x, mid.y, mid.z);
}

/** A lying log along x. */
function log(len: number, r: number, color: string, x: number, z: number, y: number, turn = 0) {
  const g = new CylinderGeometry(r, r, len, 6).rotateZ(Math.PI / 2);
  return part(g, color, 0, 0, 0, turn).translate(x, y + r, z);
}

/** Gable roof: ridge along z, `w` wide and `d` deep, its eaves on `y`. */
function gable(w: number, d: number, h: number, color: string, x = 0, z = 0, y = 0): BufferGeometry {
  const s = new Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  return part(g, color, x, y, z);
}

/** Cloth on a pole at (x, z), from `y` up `h`; flutters more away from the pole. */
function flag(
  x: number,
  z: number,
  y: number,
  h: number,
  w = 1.3,
): { pole: BufferGeometry[]; cloth: BufferGeometry } {
  const cloth = box(w, w * 0.6, 0.06, C.team, x + w / 2, z, y + h - w * 0.65);
  return {
    pole: [
      cyl(0.09, h, C.darkWood, x, z, y, 5),
      part(new IcosahedronGeometry(0.16, 0), C.crop, x, y + h + 0.05, z),
    ],
    cloth: moving(cloth, (p) => [Math.max(0, p.x - x) * 0.18, 0]),
  };
}

function ring<T>(
  count: number,
  radius: number,
  make: (x: number, z: number, i: number, a: number) => T,
): T[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return make(Math.cos(a) * radius, Math.sin(a) * radius, i, a);
  });
}

/** Turns +z, the front of a sub-model, toward the direction of angle `a`. */
const facing = (a: number): number => Math.PI / 2 - a;

/** Parts of a model: fixed colors, team colors and smoke spouts, all in model space. */
class Kit {
  readonly fixed: BufferGeometry[] = [];
  readonly team: BufferGeometry[] = [];
  readonly smoke: Vector3[] = [];

  add(...g: BufferGeometry[]): this {
    this.fixed.push(...g);
    return this;
  }

  paint(...g: BufferGeometry[]): this {
    this.team.push(...g);
    return this;
  }

  chimney(x: number, y: number, z: number): this {
    this.smoke.push(new Vector3(x, y, z));
    return this;
  }

  /** Adds another kit turned, scaled and moved to (x, z). */
  put(other: Kit, x: number, z: number, turn = 0, scale = 1): this {
    const m = new Matrix4().compose(
      new Vector3(x, 0, z),
      new Quaternion().setFromAxisAngle(UP, turn),
      new Vector3(scale, scale, scale),
    );
    this.fixed.push(...other.fixed.map((g) => g.applyMatrix4(m)));
    this.team.push(...other.team.map((g) => g.applyMatrix4(m)));
    this.smoke.push(...other.smoke.map((v) => v.applyMatrix4(m)));
    return this;
  }
}

/** A rectangular wall of `side` with battlements on its outer edge, `t` thick. */
function curtain(k: Kit, side: number, h: number, t: number, gate = 0): void {
  const half = side / 2 - t / 2;
  for (const s of [-1, 1]) {
    k.add(box(t, h, side, C.stone, s * half, 0), box(t + 0.3, 0.7, side + 0.3, C.darkStone, s * half, 0));
    k.add(box(side, h, t, C.stone, 0, -half), box(side + 0.3, 0.7, t + 0.3, C.darkStone, 0, -half));
  }
  if (gate) {
    const seg = (side - gate) / 2;
    for (const s of [-1, 1]) k.add(box(seg, h, t, C.stone, s * (gate / 2 + seg / 2), half));
  } else k.add(box(side, h, t, C.stone, 0, half));
  const count = Math.round(side / 1.25);
  const step = side / count;
  for (let i = 0; i < count; i++) {
    const u = -side / 2 + step * (i + 0.5);
    const outer = side / 2 - 0.25;
    k.add(box(0.55, 0.65, 0.5, C.stone, u, -outer, h), box(0.5, 0.65, 0.55, C.stone, -outer, u, h));
    k.add(box(0.5, 0.65, 0.55, C.stone, outer, u, h));
    if (Math.abs(u) > gate / 2) k.add(box(0.55, 0.65, 0.5, C.stone, u, outer, h));
  }
}

/** A round stone tower with a ring of merlons and a cone roof. */
/** `roof` 0 leaves the top open, a platform inside the merlons (the castle's dragon nest). */
function roundTower(k: Kit, x: number, z: number, r: number, h: number, roof = 1.15): void {
  k.add(cyl(r + 0.15, 0.8, C.darkStone, x, z, 0, 10), cyl(r, h, C.stone, x, z, 0, 10));
  k.add(cyl(r + 0.2, 0.35, C.darkStone, x, z, h - 0.35, 10));
  k.add(...ring(9, r - 0.05, (dx, dz, _i, a) => box(0.45, 0.6, 0.4, C.stone, x + dx, z + dz, h, facing(a))));
  for (const a of [0.4, 2.5, 4.4]) {
    k.add(box(0.22, 0.9, 0.1, C.window, x + Math.cos(a) * r, z + Math.sin(a) * r, h * 0.55, facing(a)));
  }
  if (roof === 0) {
    k.add(cyl(r - 0.1, 0.3, C.darkStone, x, z, h - 0.1, 10));
    k.paint(cyl(r + 0.22, 0.2, C.teamShade, x, z, h - 0.6, 10));
    return;
  }
  k.paint(
    cone(r * roof + 0.2, r * 1.5 + 0.8, C.team, x, z, h + 0.2, 10),
    cyl(r * roof + 0.25, 0.25, C.teamShade, x, z, h + 0.1, 10),
  );
}

/** Merlons around the top of a square block of half-width `w`. */
function battlements(k: Kit, x: number, z: number, w: number, y: number): void {
  const count = Math.max(2, Math.round((w * 2) / 1.2));
  const step = (w * 2) / count;
  for (let i = 0; i < count; i++) {
    const u = -w + step * (i + 0.5);
    k.add(
      box(0.5, 0.6, 0.45, C.stone, x + u, z - w + 0.2, y),
      box(0.5, 0.6, 0.45, C.stone, x + u, z + w - 0.2, y),
      box(0.45, 0.6, 0.5, C.stone, x - w + 0.2, z + u, y),
      box(0.45, 0.6, 0.5, C.stone, x + w - 0.2, z + u, y),
    );
  }
}

/** A half-timbered house facing +z: stone footing, plaster, beams, windows, gable roof, chimney. */
function house(w: number, d: number, wallH: number, roofH: number, chimney = true): Kit {
  const k = new Kit();
  const base = 0.45;
  const top = base + wallH;
  k.add(box(w + 0.3, base, d + 0.3, C.darkStone), box(w, wallH, d, C.plaster, 0, 0, base));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.add(box(0.22, wallH, 0.22, C.timber, (sx * w) / 2, (sz * d) / 2, base));
  for (const sz of [-1, 1]) {
    k.add(box(w + 0.05, 0.18, 0.2, C.timber, 0, (sz * d) / 2, base + wallH * 0.55));
    k.add(box(w + 0.05, 0.18, 0.2, C.timber, 0, (sz * d) / 2, top - 0.18));
  }
  for (const sx of [-1, 1]) k.add(box(0.2, 0.18, d, C.timber, (sx * w) / 2, 0, base + wallH * 0.55));
  k.add(box(0.85, 1.45, 0.12, C.darkWood, 0, d / 2 + 0.03, base));
  const wy = base + wallH * 0.62;
  for (const sx of w > 3 ? [-1, 1] : []) {
    k.add(box(0.62, 0.55, 0.1, C.window, sx * w * 0.3, d / 2 + 0.04, wy));
    k.add(box(0.62, 0.55, 0.1, C.window, sx * w * 0.3, -d / 2 - 0.04, wy));
  }
  for (const sx of [-1, 1]) k.add(box(0.1, 0.55, 0.62, C.window, (sx * w) / 2 + sx * 0.04, 0, wy));
  k.paint(gable(w + 0.7, d + 0.6, roofH, C.team, 0, 0, top));
  k.add(box(0.18, 0.18, d + 0.7, C.timber, 0, 0, top + roofH - 0.1));
  if (chimney) {
    const cx = w * 0.26;
    const cz = -d * 0.2;
    k.add(
      box(0.55, roofH + 0.9, 0.55, C.darkStone, cx, cz, top),
      box(0.7, 0.18, 0.7, C.slate, cx, cz, top + roofH + 0.9),
    );
    k.chimney(cx, top + roofH + 1.3, cz);
  }
  return k;
}

/** A fence of posts and two rails on an arc of radius `r`, leaving the front (+z) open. */
function fence(k: Kit, r: number, posts: number, gap = 0.35): void {
  const at = ring(posts, r, (x, z, _i, a) => ({ x, z, open: Math.abs(a - Math.PI / 2) < gap }));
  at.forEach((p, i) => {
    if (p.open) return;
    k.add(cyl(0.13, 1.25, C.darkWood, p.x, p.z, 0, 4));
    const q = at[(i + 1) % at.length];
    if (!q || q.open) return;
    for (const y of [0.5, 1]) k.add(beam([p.x, y, p.z], [q.x, y, q.z], 0.1, C.wood));
  });
}

/** Pointed logs on a straight line from (x1, z1) to (x2, z2). */
function stakes(k: Kit, x1: number, z1: number, x2: number, z2: number, h: number, r = 0.32): void {
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / (r * 1.9)));
  for (let i = 0; i <= n; i++) {
    const x = x1 + ((x2 - x1) * i) / n;
    const z = z1 + ((z2 - z1) * i) / n;
    const lift = (i % 3) * 0.15;
    k.add(cyl(r, h + lift, C.wood, x, z, 0, 5), cone(r, 0.7, C.wood, x, z, h + lift, 5));
  }
}

function woodpile(k: Kit, x: number, z: number, turn: number): void {
  k.add(
    log(1.5, 0.2, C.wood, x, z - 0.21, 0, turn),
    log(1.5, 0.2, C.darkWood, x, z + 0.21, 0, turn),
    log(1.5, 0.2, C.wood, x, z, 0.36, turn),
  );
}

function barrel(k: Kit, x: number, z: number): void {
  k.add(
    cyl(0.34, 0.75, C.wood, x, z, 0, 8),
    cyl(0.36, 0.08, C.iron, x, z, 0.12, 8),
    cyl(0.36, 0.08, C.iron, x, z, 0.55, 8),
  );
}

function campfire(k: Kit, x: number, z: number): void {
  k.add(...ring(6, 0.48, (dx, dz) => stone(0.17, C.darkStone, x + dx, z + dz)));
  const fire = cone(0.28, 0.75, C.flame, x, z, 0.05, 5);
  k.add(moving(fire, (p) => [Math.max(0, p.y - 0.1) * 0.25, 0]));
}

function haystack(k: Kit, x: number, z: number, s = 1): void {
  k.add(cyl(0.75 * s, 0.6 * s, C.hay, x, z, 0, 7), cone(0.75 * s, 0.9 * s, C.hay, x, z, 0.6 * s, 7));
}

/** A small tilled plot with rows of crops. */
function field(k: Kit, x: number, z: number, w: number, d: number, turn: number): void {
  const plot = new Kit().add(box(w, 0.1, d, C.soil));
  const rows = Math.max(2, Math.round(w / 0.55));
  for (let i = 0; i < rows; i++) {
    const u = -w / 2 + (w / rows) * (i + 0.5);
    plot.add(box(0.28, 0.32, d - 0.3, i % 2 ? C.crop : C.leaf, u, 0, 0.08));
  }
  k.put(plot, x, z, turn);
}

function well(k: Kit, x: number, z: number): void {
  k.add(cyl(0.6, 0.75, C.stone, x, z, 0, 8), cyl(0.45, 0.05, C.water, x, z, 0.68, 8));
  for (const s of [-1, 1]) k.add(box(0.12, 1.5, 0.12, C.darkWood, x + s * 0.5, z, 0.7));
  k.add(log(1.2, 0.08, C.darkWood, x, z, 1.95));
  k.paint(gable(1.5, 1.2, 0.6, C.team, x, z, 2.15));
}

export interface Model {
  fixed: BufferGeometry;
  team: BufferGeometry;
  /** Height of the top of the model, for the labels above it. */
  height: number;
  /** Distance from the center to the model's outer edge, for labels in front of it. */
  radius: number;
  /** Where chimney smoke starts, in model space. */
  smoke: Vector3[];
  /** Still parts pushed out along smooth normals, drawn inside out for a dark outline. */
  outline: BufferGeometry;
}

const OUTLINE_THICKNESS = 0.07;

/** Moving parts (flags, flames, legs) are left out: a still outline would not follow them. */
function outlineOf(parts: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const anim = g.getAttribute('anim');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      let still = true;
      for (let k = i; k < i + 3; k++) {
        if (anim && (anim.getX(k) !== 0 || anim.getY(k) !== 0 || anim.getZ(k) !== 0)) still = false;
      }
      if (!still) continue;
      for (let k = i; k < i + 3; k++) positions.push(pos.getX(k), pos.getY(k), pos.getZ(k));
    }
  }
  const raw = new BufferGeometry();
  raw.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const g = mergeVertices(raw, 1e-3);
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + normal.getX(i) * OUTLINE_THICKNESS,
      pos.getY(i) + normal.getY(i) * OUTLINE_THICKNESS,
      pos.getZ(i) + normal.getZ(i) * OUTLINE_THICKNESS,
    );
  }
  return g;
}

/** `ground` is the trodden yard under the model; it does not count for the radius. */
function model(k: Kit, height: number, ground?: { r: number; color: string }): Model {
  if (ground) ornament?.(k, ground.r);
  const g = merge(k.fixed);
  g.computeBoundingBox();
  const b = g.boundingBox;
  const radius = b ? Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z) : 5;
  const team = merge(k.team);
  const fixed = ground ? merge([g, cyl(ground.r, 0.08, ground.color, 0, 0, 0, 16)]) : g;
  return { fixed, team, height, radius, smoke: k.smoke, outline: outlineOf([g, team]) };
}

/** Level 1–9: a round hut with a cone roof, a campfire, firewood and a barrel. */
function stageHut(): Model {
  const k = new Kit();
  k.add(cyl(2.35, 0.35, C.darkStone, 0, 0, 0, 10), cyl(2.2, 2.1, C.mud, 0, 0, 0.3, 10));
  k.add(box(0.9, 1.5, 0.3, C.darkWood, 0, 2.12, 0.3), box(1.2, 0.18, 0.35, C.timber, 0, 2.15, 1.8));
  k.paint(cone(3, 2.5, C.team, 0, 0, 2.2, 10), cone(0.55, 0.75, C.teamShade, 0, 0, 4.35, 6));
  k.paint(cyl(3.02, 0.2, C.teamShade, 0, 0, 2.2, 10));
  woodpile(k, 2.6, -1.3, 0.9);
  campfire(k, -2.5, 1.7);
  barrel(k, 1.95, 1.9);
  return model(k, 5.2, { r: 3.8, color: C.dirt });
}

/** Level 10–29: a half-timbered house with a shed, a well and a field inside a fence. */
function stageHouse(): Model {
  const k = new Kit().put(house(4.6, 3.8, 2.5, 2.2), 0, -0.3);
  const shed = new Kit().add(box(1.6, 1.3, 1.4, C.wood)).paint(gable(1.9, 1.7, 0.9, C.team, 0, 0, 1.3));
  k.put(shed, -3.5, -2.5, 0.3);
  field(k, 3, -2.9, 2.2, 2, -0.4);
  well(k, -3.4, 2.3);
  haystack(k, 3.6, 1.8, 0.8);
  fence(k, 5.6, 18);
  return model(k, 5.8, { r: 6, color: C.yard });
}

/** Level 30–59: houses around a watchtower inside a palisade. */
function stageVillage(): Model {
  const k = new Kit();
  const legs: V3[] = [
    [-1.1, 0, -1.1],
    [1.1, 0, -1.1],
    [1.1, 0, 1.1],
    [-1.1, 0, 1.1],
  ];
  legs.forEach(([x, , z], i) => {
    k.add(box(0.4, 6, 0.4, C.wood, x, z));
    const [nx, , nz] = legs[(i + 1) % legs.length] ?? legs[0] ?? [0, 0, 0];
    k.add(
      beam([x, 0.6, z], [nx, 3.2, nz], 0.16, C.darkWood),
      beam([nx, 0.6, nz], [x, 3.2, z], 0.16, C.darkWood),
    );
    k.add(box(0.14, 0.9, 0.14, C.darkWood, x * 1.3, z * 1.3, 6.3));
    k.add(beam([x * 1.3, 7, z * 1.3], [nx * 1.3, 7, nz * 1.3], 0.12, C.darkWood));
  });
  k.add(box(3.4, 0.3, 3.4, C.darkWood, 0, 0, 6));
  k.paint(pyramid(1.75, 2, C.team, 0, 0, 7.2));
  const top = flag(0, 0, 9.1, 1.8);
  k.add(...top.pole).paint(top.cloth);
  for (const [i, a] of [0.5, 2.6, 4.6].entries()) {
    k.put(house(3.4, 2.8, 2, 1.7, i !== 1), Math.cos(a) * 4.7, Math.sin(a) * 4.7, facing(a) + Math.PI, 0.8);
  }
  haystack(k, -2, 3.8);
  haystack(k, -1.1, 4.6, 0.7);
  well(k, 2.3, 3.4);
  const posts = 48;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.2) continue;
    const r = 7.3;
    const h = 2.3 + (i % 3) * 0.15;
    k.add(cyl(0.42, h, C.wood, Math.cos(a) * r, Math.sin(a) * r, 0, 5));
    k.add(cone(0.42, 0.6, C.wood, Math.cos(a) * r, Math.sin(a) * r, h, 5));
  }
  return model(k, 10.4, { r: 7.8, color: C.dirt });
}

/** A wooden corner tower of a palisade. */
function woodTower(k: Kit, x: number, z: number, withFlag: boolean): void {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.add(box(0.35, 4.6, 0.35, C.wood, x + sx * 0.8, z + sz * 0.8));
  k.add(box(2.3, 0.25, 2.3, C.darkWood, x, z, 4.4));
  for (const s of [-1, 1]) {
    k.add(box(2.3, 0.7, 0.14, C.wood, x, z + s * 1.1, 4.6), box(0.14, 0.7, 2.3, C.wood, x + s * 1.1, z, 4.6));
  }
  k.paint(pyramid(1.25, 1.6, C.team, x, z, 5.6));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.add(box(0.14, 0.4, 0.14, C.darkWood, x + sx * 1, z + sz * 1, 5.3));
  if (withFlag) {
    const f = flag(x, z, 7.1, 1.5, 1.1);
    k.add(...f.pole).paint(f.cloth);
  }
}

/** Level 60–89: a log palisade with corner towers, a gate and a stone keep. */
function stageFort(): Model {
  const k = new Kit();
  const h = 5.7;
  stakes(k, -h, -h, h, -h, 3);
  stakes(k, -h, -h, -h, h, 3);
  stakes(k, h, -h, h, h, 3);
  stakes(k, -h, h, -1.6, h, 3);
  stakes(k, 1.6, h, h, h, 3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) woodTower(k, sx * h, sz * h, sz > 0);
  for (const s of [-1, 1]) k.add(box(0.6, 4.2, 0.6, C.darkWood, s * 1.5, h));
  k.add(box(3.6, 0.5, 0.7, C.darkWood, 0, h, 3.8), box(2.4, 3, 0.2, C.timber, 0, h + 0.1));
  const keep = new Kit();
  keep.add(box(5.6, 0.8, 5.6, C.darkStone), box(5, 6.8, 5, C.stone, 0, 0, 0.8));
  battlements(keep, 0, 0, 2.5, 7.6);
  keep.add(box(1.1, 1.8, 0.15, C.darkWood, 0, 2.55, 0.8));
  for (const y of [3.3, 5])
    for (const s of [-1, 1]) keep.add(box(0.3, 0.8, 0.12, C.window, s * 1.2, 2.55, y));
  keep.paint(pyramid(1.8, 2.4, C.team, 0, 0, 7.6));
  k.put(keep, 0, -1.4);
  k.put(house(3, 2.2, 1.8, 1.4), -3.4, 2.8, Math.PI / 2, 0.85);
  barrel(k, 3.2, 2.2);
  barrel(k, 3.8, 2.6);
  woodpile(k, 3.4, 3.6, 0.2);
  return model(k, 10.6, { r: 6.6, color: C.yard });
}

/** Level 90–99: stone walls with round corner towers, a gatehouse and a tall keep. */
function stageCitadel(): Model {
  const k = new Kit();
  const side = 14;
  curtain(k, side, 4, 0.9, 3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundTower(k, sx * 6.6, sz * 6.6, 1.6, 6.2);
  for (const s of [-1, 1]) {
    k.add(box(1.9, 5.4, 1.9, C.stone, s * 2.2, 6.8), box(2.1, 0.7, 2.1, C.darkStone, s * 2.2, 6.8));
    battlements(k, s * 2.2, 6.8, 0.95, 5.4);
    k.paint(pyramid(0.95, 1.6, C.team, s * 2.2, 6.8, 5.4));
  }
  k.add(box(2.6, 1.3, 1.2, C.stone, 0, 6.8, 3), box(2.4, 2.9, 0.2, C.timber, 0, 7.45));
  const keep = new Kit();
  keep.add(box(6.6, 0.8, 6.6, C.darkStone), box(6, 7.4, 6, C.stone, 0, 0, 0.8));
  battlements(keep, 0, 0, 3, 8.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundTower(keep, sx * 3, sz * 3, 0.75, 9.4, 1.3);
  for (const y of [3, 5.4])
    for (const s of [-1, 1]) keep.add(box(0.35, 0.9, 0.12, C.window, s * 1.4, 3.05, y));
  keep.add(box(1.3, 2, 0.15, C.darkWood, 0, 3.05, 0.8));
  keep.paint(pyramid(2.3, 3, C.team, 0, 0, 8.2));
  const top = flag(0, 0, 11, 2.2);
  keep.add(...top.pole).paint(top.cloth);
  k.put(keep, 0, -1);
  for (const s of [-1, 1]) k.put(house(3, 2.2, 1.8, 1.4), s * 4.1, 4, ((s * Math.PI) / 2) * -1, 0.75);
  return model(k, 13.4, { r: 8.2, color: C.paving });
}

/** Level 100: a full castle with an outer wall, big towers, a gatehouse, a keep and a donjon. */
function stageCastle(): Model {
  const k = new Kit();
  const side = 18;
  curtain(k, side, 5, 1, 3.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundTower(k, sx * 8.4, sz * 8.4, 2.2, 8);
  for (const [x, z] of [
    [-9, 0],
    [9, 0],
    [0, -9],
  ] as const) {
    k.add(box(2.6, 6.6, 2.6, C.stone, x, z), box(2.9, 0.8, 2.9, C.darkStone, x, z));
    battlements(k, x, z, 1.3, 6.6);
    k.paint(pyramid(1.3, 1.8, C.team, x, z, 6.6));
  }
  for (const s of [-1, 1]) roundTower(k, s * 2.5, 9.2, 1.35, 7.2);
  k.add(box(3.4, 1.6, 2.4, C.stone, 0, 9.1, 4.4), box(2.8, 3.6, 0.2, C.timber, 0, 10.2));
  for (let i = 0; i < 5; i++) k.add(box(0.1, 3.3, 0.1, C.iron, -1.1 + i * 0.55, 10.35, 0.2));
  battlements(k, 0, 9.1, 1.7, 6);
  const keep = new Kit();
  keep.add(box(8.2, 0.9, 8.2, C.darkStone), box(7.5, 9.2, 7.5, C.stone, 0, 0, 0.9));
  battlements(keep, 0, 0, 3.75, 10.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundTower(keep, sx * 3.6, sz * 3.6, 0.95, 12, 1.25);
  for (const y of [3.4, 6.2, 8.4]) {
    for (const s of [-1, 0, 1]) keep.add(box(0.4, 1, 0.12, C.window, s * 1.9, 3.8, y));
  }
  keep.add(box(1.6, 2.4, 0.15, C.darkWood, 0, 3.8, 0.9));
  roundTower(keep, 0, 0, 1.9, DONJON_HEIGHT, 0);
  k.put(keep, 0, DRAGON_PERCH.z);
  for (const s of [-1, 1]) k.put(house(3.6, 2.4, 2, 1.6), s * 5.4, 5, (-s * Math.PI) / 2, 0.8);
  return model(k, 22.4, { r: 10.6, color: C.paving });
}

const DONJON_HEIGHT = 15.2;
/** Where the castle's dragon sits, on the open top of the donjon (model space, before the stage scale). */
export const DRAGON_PERCH = new Vector3(0, DONJON_HEIGHT + 0.2, -1.2);

export const STAGE_FROM = [1, 10, 30, 60, 90, 100] as const;
/** Small stages are drawn bigger so a hut still reads on the map; castles grow less to fit. */
export const STAGE_SCALE = [2, 1.6, 1.4, 1.4, 1.3, 1.15] as const;
/** Marching soldiers and banners at the scale of the towns. */
export const UNIT_SCALE = 2;

export function stageFor(level: number): number {
  let stage = 0;
  STAGE_FROM.forEach((from, i) => {
    if (level >= from) stage = i;
  });
  return stage;
}

/** Set while a skin's stages are built: adds its decorations around the yard of radius `r`. */
let ornament: ((k: Kit, r: number) => void) | null = null;

/** Decorations stand at the back corners of the yard, away from the gate (+z). */
function backCorners(r: number, make: (x: number, z: number) => BufferGeometry[]): BufferGeometry[] {
  return [-2.3, -0.85].flatMap((a) => make(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9));
}

const crystal = (r: number, h: number, color: string, x: number, z: number, lean = 0): BufferGeometry =>
  part(new OctahedronGeometry(1, 0).scale(r, h / 2, r).rotateZ(lean), color, x, h / 2, z);

interface Skin {
  colors: Partial<Palette>;
  ornament?: (k: Kit, r: number) => void;
}

/**
 * The 3D look of each cosmetic style (ids from `cosmetics.styles`): materials of walls, wood and yard,
 * plus a decoration. Roofs and flags keep the owner's color in every skin.
 */
const SKINS: Record<string, Skin> = {
  classic: { colors: {} },
  tower: {
    colors: {
      stone: '#8a93a3',
      darkStone: '#5d6573',
      plaster: '#cfd5de',
      mud: '#8a8f99',
      wood: '#5b4636',
      darkWood: '#3a2c22',
      timber: '#2b2119',
      paving: '#7d8594',
      yard: '#8f8a80',
    },
    ornament: (k, r) =>
      k.add(
        ...backCorners(r, (x, z) => [
          cyl(0.32, 4.2, C.darkStone, x, z, 0, 6),
          cone(0.5, 1.6, C.slate, x, z, 4.2, 6),
          cyl(0.42, 0.3, C.iron, x, z, 3.2, 6),
        ]),
      ),
  },
  hex: {
    colors: {
      stone: '#d8c49a',
      darkStone: '#b09366',
      plaster: '#efe0bd',
      mud: '#caa877',
      wood: '#9c6b3f',
      paving: '#cdb88c',
      yard: '#c4ad80',
    },
    ornament: (k, r) =>
      k.add(
        ...backCorners(r, (x, z) => [
          cyl(0.55, 2.4, C.stone, x, z, 0, 6),
          cyl(0.7, 0.3, C.darkStone, x, z, 2.4, 6),
          part(new OctahedronGeometry(0.35, 0), C.gold, x, 3.05, z),
        ]),
      ),
  },
  diamond: {
    colors: {
      stone: '#eceae4',
      darkStone: '#c9c4b8',
      plaster: '#f6f3ec',
      paving: '#dcd8ce',
      yard: '#cfc8b6',
      timber: '#b8902f',
      darkWood: '#8a6a22',
      window: '#2c3e66',
    },
    ornament: (k, r) =>
      k.add(
        ...backCorners(r, (x, z) => [
          box(0.9, 1.4, 0.9, C.stone, x, z),
          part(new OctahedronGeometry(0.55, 0).scale(1, 1.4, 1), C.gold, x, 2.3, z),
        ]),
      ),
  },
  star: {
    colors: {
      stone: '#c9d3c2',
      darkStone: '#97a58f',
      plaster: '#eef2e4',
      wood: '#6f8a4a',
      darkWood: '#4f6636',
      timber: '#3c4d2a',
      paving: '#b4bfa8',
      yard: '#a9b394',
      window: '#22402f',
    },
    ornament: (k, r) =>
      k.add(
        ...backCorners(r, (x, z) => [
          cyl(0.1, 2.6, C.darkWood, x, z, 0, 5),
          box(0.5, 0.6, 0.5, C.gold, x, z, 2.5),
          part(new IcosahedronGeometry(0.22, 0), '#fff2b0', x, 2.8, z),
        ]),
      ),
  },
  crystal: {
    colors: {
      stone: '#4a4458',
      darkStone: '#2f2a3a',
      plaster: '#6c6480',
      mud: '#5a5266',
      wood: '#3d3448',
      darkWood: '#2a2333',
      timber: '#211b29',
      paving: '#3e3a4a',
      yard: '#4a4556',
      window: '#7fe3ff',
    },
    ornament: (k, r) =>
      k.add(
        ...backCorners(r, (x, z) => [
          crystal(0.45, 2.8, '#7fe3ff', x, z),
          crystal(0.3, 1.8, '#b48cff', x + 0.6, z + 0.3, 0.4),
          crystal(0.28, 1.5, '#7fe3ff', x - 0.5, z - 0.2, -0.45),
        ]),
      ),
  },
};

export const SKIN_IDS = Object.keys(SKINS);

/** The six stages in a style's skin (an unknown style falls back to the classic look). */
export function buildStages(style = 'classic'): Model[] {
  const skin = SKINS[style] ?? SKINS.classic ?? { colors: {} };
  Object.assign(C, BASE, skin.colors);
  ornament = skin.ornament ?? null;
  try {
    return [stageHut(), stageHouse(), stageVillage(), stageFort(), stageCitadel(), stageCastle()];
  } finally {
    Object.assign(C, BASE);
    ornament = null;
  }
}

/** How far a leg or arm vertex swings: more the farther it is from the hip or shoulder. */
const limb =
  (side: number, pivot: number, k: number) =>
  (p: Vector3): [number, number] => [0, side * Math.max(0, pivot - p.y) * k];

/** A marching soldier facing +z, about 2.5 units tall; tunic and shield in the owner's color. */
export function buildSoldier(): Model {
  const k = new Kit();
  for (const s of [-1, 1]) {
    const leg = merge([
      box(0.28, 0.9, 0.3, C.pants, s * 0.17, 0, 0.05),
      box(0.3, 0.22, 0.4, C.timber, s * 0.17, 0.05, 0),
    ]);
    k.add(moving(leg, limb(s, 0.95, 0.5)));
    k.add(moving(box(0.2, 0.72, 0.24, C.mail, s * 0.47, 0, 1.05), limb(-s, 1.8, 0.35)));
  }
  k.add(box(0.8, 0.14, 0.5, C.timber, 0, 0, 1.1), box(0.62, 0.3, 0.4, C.mail, 0, 0, 1.6));
  k.add(part(new IcosahedronGeometry(0.3, 1), C.skin, 0, 2.08, 0));
  k.add(cyl(0.34, 0.22, C.steel, 0, 0, 2.1, 8), cone(0.32, 0.42, C.steel, 0, 0, 2.3, 8));
  k.add(cyl(0.05, 3.1, C.darkWood, 0.58, 0.18, 0.45, 4), cone(0.1, 0.4, C.steel, 0.58, 0.18, 3.55, 4));
  k.paint(box(0.7, 0.75, 0.44, C.team, 0, 0, 0.9));
  k.paint(
    box(0.1, 0.85, 0.7, C.team, -0.62, 0.1, 0.75),
    box(0.12, 0.22, 0.22, C.teamShade, -0.68, 0.1, 1.05),
  );
  return model(k, 2.6);
}

/** The march banner: a pole with a cross bar (fixed) and a hanging cloth for the owner's color. */
export function buildBanner(): Model {
  const k = new Kit();
  k.add(cyl(0.1, 4.4, C.darkWood, 0, 0, 0, 5), log(1.5, 0.06, C.darkWood, 0, 0, 4.05));
  k.add(part(new IcosahedronGeometry(0.18, 0), C.crop, 0, 4.55, 0));
  const top = 4.1;
  k.paint(moving(box(1.3, 1.7, 0.06, C.team, 0, 0, top - 1.7), (p) => [Math.max(0, top - p.y) * 0.22, 0]));
  return model(k, 4.6);
}

/**
 * An arcane beacon: a stepped base with rune stones and a tapered obelisk whose rune bands glow in
 * the holder's color. Its crystal floats above it and is drawn apart (`buildBeaconCrystal`), so it
 * can turn.
 */
export function buildBeacon(): Model {
  const k = new Kit();
  k.add(cyl(1.7, 0.35, C.darkStone, 0, 0, 0, 8), cyl(1.35, 0.35, C.stone, 0, 0, 0.35, 8));
  k.add(...ring(4, 1.55, (x, z, _i, a) => box(0.35, 0.7, 0.25, C.darkStone, x, z, 0.35, facing(a))));
  k.add(cyl(0.85, 4.4, C.darkStone, 0, 0, 0.7, 4, 0.45));
  for (const [x, z, y] of [
    [-0.55, 0.55, 3.6],
    [0.55, 0.55, 3.6],
    [0.55, -0.55, 3.6],
    [-0.55, -0.55, 3.6],
  ] as const) {
    k.add(beam([x * 0.6, 5, z * 0.6], [x * 1.2, y + 2.6, z * 1.2], 0.12, C.iron));
  }
  // Rune bands: they take the holder's color and, with the beacon's unlit material, glow.
  k.paint(cyl(0.8, 0.22, C.team, 0, 0, 1.6, 4, 0.74), cyl(0.68, 0.22, C.team, 0, 0, 3.2, 4, 0.6));
  k.paint(...ring(4, 1.55, (x, z, _i, a) => box(0.12, 0.35, 0.27, C.team, x, z, 0.5, facing(a))));
  return model(k, 7.6);
}

/** Where the beacon crystal floats, in the beacon's model space. */
export const BEACON_CRYSTAL_HEIGHT = 6.4;

export function buildBeaconCrystal(): BufferGeometry {
  return merge([crystal(0.6, 2.2, C.team, 0, 0), crystal(0.25, 0.9, C.teamShade, 0.55, 0.1, 0.5)]);
}

/** Wing flap (anim.z): rises toward the tip; both wings beat together. */
const wingFlap = (p: Vector3): [number, number, number] => [0, 0, Math.max(0, Math.abs(p.x) - 0.7) * 0.42];

/** One wing as a two-sided membrane between its bones; `side` 1 is the dragon's left (+x). */
function wing(k: Kit, side: number): void {
  const pts: V3[] = [
    [side * 0.7, 2.7, 0.7],
    [side * 6.2, 3.6, -0.4],
    [side * 4.6, 1.6, -2.2],
    [side * 2.6, 1.3, -2.8],
    [side * 0.8, 2.3, -1.5],
  ];
  const [root, tip, f1, f2, back] = pts as [V3, V3, V3, V3, V3];
  const tris: [V3, V3, V3][] = [
    [root, tip, f1],
    [root, f1, f2],
    [root, f2, back],
  ];
  const positions: number[] = [];
  for (const [a, b, c] of tris) positions.push(...a, ...b, ...c, ...a, ...c, ...b);
  const membrane = new BufferGeometry();
  membrane.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  membrane.computeVertexNormals();
  k.paint(moving(part(membrane, C.membrane), wingFlap));
  for (const end of [tip, f1, f2]) k.paint(moving(beam(root, end, 0.1, C.teamShade), wingFlap));
}

/**
 * The dragon of a level-100 castle, facing +z with its feet on y = 0: scales in the owner's color,
 * ivory horns and spikes, wings that beat by shader (anim.z, scaled per dragon by `flap`).
 */
export function buildDragon(): Model {
  const k = new Kit();
  k.paint(part(new IcosahedronGeometry(1, 1).scale(1.05, 0.95, 2.1), C.team, 0, 1.75, 0));
  k.add(part(new IcosahedronGeometry(1, 1).scale(0.8, 0.6, 1.7), C.belly, 0, 1.35, 0.15));
  const neck: V3[] = [
    [0, 2.2, 1.7],
    [0, 3, 2.5],
    [0, 3.7, 3],
  ];
  k.paint(
    beam(neck[0] ?? [0, 0, 0], neck[1] ?? [0, 0, 0], 0.7, C.team),
    beam(neck[1] ?? [0, 0, 0], neck[2] ?? [0, 0, 0], 0.55, C.team),
  );
  const head = new ConeGeometry(0.5, 1.7, 6).rotateX(Math.PI / 2);
  k.paint(part(head, C.team, 0, 3.85, 3.75), part(new IcosahedronGeometry(0.55, 1), C.team, 0, 3.9, 3.05));
  k.add(part(new ConeGeometry(0.42, 1.2, 5).rotateX(Math.PI / 2), C.belly, 0, 3.55, 3.7));
  for (const s of [-1, 1]) {
    k.add(part(new ConeGeometry(0.13, 1.1, 5).rotateX(-0.9), C.ivory, s * 0.32, 4.35, 2.75));
    k.add(part(new IcosahedronGeometry(0.11, 0), C.eye, s * 0.33, 4.05, 3.4));
  }
  const tail: V3[] = [
    [0, 1.7, -1.9],
    [0, 1.3, -3.4],
    [0.4, 0.9, -4.8],
    [1.1, 0.6, -6],
  ];
  for (let i = 0; i + 1 < tail.length; i++) {
    k.paint(beam(tail[i] ?? [0, 0, 0], tail[i + 1] ?? [0, 0, 0], 0.55 - i * 0.14, C.team));
  }
  k.add(part(new ConeGeometry(0.35, 0.9, 4).rotateX(-Math.PI / 2), C.ivory, 1.3, 0.55, -6.5));
  for (const [z, y] of [
    [1.2, 2.75],
    [0.2, 2.8],
    [-0.8, 2.7],
    [-1.8, 2.45],
  ] as const) {
    k.add(part(new ConeGeometry(0.17, 0.6, 4), C.ivory, 0, y, z));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const hip: V3 = [sx * 0.7, 1.5, sz * 1.1];
      const foot: V3 = [sx * 0.85, 0.15, sz * 1.1 + 0.25];
      k.paint(beam(hip, foot, 0.32, C.teamShade));
      k.add(
        part(new ConeGeometry(0.16, 0.35, 4).rotateX(Math.PI / 2), C.ivory, foot[0], 0.1, foot[2] + 0.25),
      );
    }
  }
  wing(k, 1);
  wing(k, -1);
  return model(k, 4.8);
}
