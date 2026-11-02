import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Low poly palette; «team» parts are white so the instance color paints them in the owner's color. */
const C = {
  mud: '#c79a6a',
  wood: '#8d5a3b',
  darkWood: '#5e3b24',
  stone: '#b4b6bb',
  darkStone: '#80848c',
  skin: '#f0c9a0',
  cloth: '#4a5568',
  team: '#ffffff',
} as const;

/** One piece: flat-shaded, colored, moved into place. */
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
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not merge model parts');
  g.computeVertexNormals();
  return g;
}

/** A body standing on the ground (y = 0), centered at (x, z). */
const box = (w: number, h: number, d: number, color: string, x = 0, z = 0, y = 0, turn = 0) =>
  part(new BoxGeometry(w, h, d), color, x, y + h / 2, z, turn);
const cyl = (r: number, h: number, color: string, x = 0, z = 0, y = 0, sides = 7) =>
  part(new CylinderGeometry(r, r, h, sides), color, x, y + h / 2, z);
const cone = (r: number, h: number, color: string, x = 0, z = 0, y = 0, sides = 7, turn = 0) =>
  part(new ConeGeometry(r, h, sides), color, x, y + h / 2, z, turn);
/** Four-sided roof on top of a box of half-width `w`. */
const pyramid = (w: number, h: number, color: string, x = 0, z = 0, y = 0) =>
  cone(w * 1.45, h, color, x, z, y, 4, Math.PI / 4);

function flag(x: number, z: number, y: number, h: number): { pole: BufferGeometry; cloth: BufferGeometry } {
  return {
    pole: cyl(0.12, h, C.darkWood, x, z, y, 4),
    cloth: box(1.3, 0.8, 0.08, C.team, x + 0.65, z, y + h - 0.85),
  };
}

function ring(count: number, radius: number, make: (x: number, z: number, i: number) => BufferGeometry) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return make(Math.cos(a) * radius, Math.sin(a) * radius, i);
  });
}

function hut(x: number, z: number, scale = 1): { fixed: BufferGeometry[]; team: BufferGeometry[] } {
  return {
    fixed: [
      cyl(2.4 * scale, 2.4 * scale, C.mud, x, z),
      box(0.9 * scale, 1.4 * scale, 0.4, C.darkWood, x, z + 2.25 * scale),
    ],
    team: [cone(3.2 * scale, 2.8 * scale, C.team, x, z, 2.3 * scale)],
  };
}

export interface Model {
  fixed: BufferGeometry;
  team: BufferGeometry;
  /** Height of the top of the model, for the labels above it. */
  height: number;
  /** Distance from the center to the model's outer edge, for labels in front of it. */
  radius: number;
}

function model(fixed: BufferGeometry[], team: BufferGeometry[], height: number): Model {
  const g = merge(fixed);
  g.computeBoundingBox();
  const box = g.boundingBox;
  const radius = box ? Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) : 5;
  return { fixed: g, team: merge(team), height, radius };
}

/** Level 1–9: a round mud hut with a thatched roof (painted in the owner's color). */
function stageHut(): Model {
  const h = hut(0, 0);
  return model([...h.fixed, cyl(0.5, 0.5, C.wood, 3.2, 1.2, 0, 5)], h.team, 5.4);
}

/** Level 10–29: a timber house inside a fence. */
function stageHouse(): Model {
  const posts = ring(12, 5.8, (x, z) => cyl(0.22, 1.3, C.darkWood, x, z, 0, 4));
  return model(
    [
      box(4.6, 3, 4, C.wood),
      box(1, 1.6, 0.3, C.darkWood, 0, 2.05),
      box(0.7, 1.6, 0.7, C.darkStone, 1.4, -1, 3.6),
      ...posts,
    ],
    [pyramid(2.3, 2.6, C.team, 0, 0, 3)],
    6,
  );
}

/** Level 30–59: three huts around a watchtower. */
function stageVillage(): Model {
  const huts = ring(3, 4.6, (x, z) => merge(hut(x, z, 0.62).fixed));
  const roofs = ring(3, 4.6, (x, z) => cone(3.2 * 0.62, 2.8 * 0.62, C.team, x, z, 2.3 * 0.62));
  const posts = ring(16, 7.4, (x, z) => cyl(0.22, 1.3, C.darkWood, x, z, 0, 4));
  return model(
    [...huts, box(2.4, 7, 2.4, C.wood), box(3, 0.4, 3, C.darkWood, 0, 0, 6.2), ...posts],
    [...roofs, pyramid(1.5, 2.2, C.team, 0, 0, 6.6)],
    9,
  );
}

/** Square of four walls around (0, 0), `side` long, with their thickness inside. */
function walls(side: number, h: number, color: string): BufferGeometry[] {
  const t = 0.9;
  const half = side / 2 - t / 2;
  return [
    box(side, h, t, color, 0, -half),
    box(side, h, t, color, 0, half),
    box(t, h, side, color, -half, 0),
    box(t, h, side, color, half, 0),
  ];
}

/** Level 60–89: a palisade fort with a stone keep and banners. */
function stageFort(): Model {
  const flags = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => flag(sx * 5.3, sz * 5.3, 3, 2.6)));
  return model(
    [...walls(12, 3, C.wood), box(5, 6.5, 5, C.stone), ...flags.map((f) => f.pole)],
    [pyramid(2.5, 2.6, C.team, 0, 0, 6.5), ...flags.map((f) => f.cloth)],
    9.5,
  );
}

function towerAt(x: number, z: number, r: number, h: number) {
  return { body: cyl(r, h, C.stone, x, z, 0, 8), roof: cone(r * 1.3, r * 1.6, C.team, x, z, h, 8) };
}

/** Level 90–99: stone walls with corner towers and a tall keep. */
function stageCitadel(): Model {
  const towers = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => towerAt(sx * 6.6, sz * 6.6, 1.6, 6)));
  return model(
    [...walls(14, 4, C.stone), box(6, 7.5, 6, C.darkStone), ...towers.map((t) => t.body)],
    [pyramid(3, 3, C.team, 0, 0, 7.5), ...towers.map((t) => t.roof)],
    11,
  );
}

/** Level 100: a full castle with battlements, a gatehouse, round towers and a central donjon. */
function stageCastle(): Model {
  const towers = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => towerAt(sx * 8.4, sz * 8.4, 2.1, 8)));
  const merlons = [-1, 1].flatMap((side) =>
    Array.from({ length: 7 }, (_, i) => [
      box(0.8, 0.8, 0.8, C.stone, -6 + i * 2, side * 8.3, 5),
      box(0.8, 0.8, 0.8, C.stone, side * 8.3, -6 + i * 2, 5),
    ]).flat(),
  );
  const turrets = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => towerAt(sx * 3.4, sz * 3.4, 0.9, 10)));
  const top = flag(0, 0, 15, 3.4);
  return model(
    [
      ...walls(18, 5, C.stone),
      ...merlons,
      box(4, 6.5, 3, C.darkStone, 0, 9),
      box(1.8, 3, 0.4, C.darkWood, 0, 10.6),
      box(7.5, 10, 7.5, C.stone),
      cyl(1.8, 15, C.darkStone, 0, 0, 0, 8),
      top.pole,
      ...towers.map((t) => t.body),
      ...turrets.map((t) => t.body),
    ],
    [
      cone(2.4, 3, C.team, 0, 0, 15, 8),
      top.cloth,
      ...towers.map((t) => t.roof),
      ...turrets.map((t) => t.roof),
    ],
    19,
  );
}

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

export function buildStages(): Model[] {
  return [stageHut(), stageHouse(), stageVillage(), stageFort(), stageCitadel(), stageCastle()];
}

/** A marching soldier: body, head and spear; about 2.4 units tall. */
export function buildSoldier(): BufferGeometry {
  return merge([
    cyl(0.45, 1.5, C.cloth, 0, 0, 0, 6),
    part(new IcosahedronGeometry(0.42, 0), C.skin, 0, 1.85, 0),
    cyl(0.07, 2.6, C.darkWood, 0.55, 0, 0.1, 4),
  ]);
}

/** The march banner: a pole (fixed) and a cloth for the owner's color. */
export function buildBanner(): Model {
  const f = flag(0, 0, 0, 3.6);
  return { fixed: merge([f.pole]), team: merge([f.cloth]), height: 3.6, radius: 1.4 };
}

/** A zone beacon: a stone pillar and a fire that takes its holder's color when lit. */
export function buildBeacon(): Model {
  return {
    fixed: merge([cyl(1, 4.5, C.darkStone, 0, 0, 0, 6), cyl(1.4, 0.5, C.stone, 0, 0, 4.5, 6)]),
    team: merge([cone(0.9, 2.2, C.team, 0, 0, 5, 5)]),
    height: 7.2,
    radius: 1.4,
  };
}
