import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setSurf } from './surface';
import { layerOf, type BuildLayer } from './textures';

/**
 * Trees, bushes, grass and rocks for the detailed levels: trunks with photographed bark and crowns
 * made of cut-out cards (see textures.ts), all with `uv`, `color` and `surf` for the `detail` patch.
 */

const UP = new Vector3(0, 1, 0);

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function paint(g: BufferGeometry, color: Color, layer: BuildLayer): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return setSurf(flat, layerOf(layer));
}

/** A card a-b-c-d (the image's top edge is a-b); every corner takes the normal `normalAt` gives it. */
function card(
  [a, b, c, d]: [Vector3, Vector3, Vector3, Vector3],
  normalAt: (p: Vector3) => Vector3,
  color: Color,
  layer: BuildLayer,
): BufferGeometry {
  const corners = [a, b, c, a, c, d];
  const uvs = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1],
  ];
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(corners.flatMap((p) => [p.x, p.y, p.z])), 3),
  );
  g.setAttribute(
    'normal',
    new BufferAttribute(
      new Float32Array(
        corners.flatMap((p) => {
          const n = normalAt(p).normalize();
          return [n.x, n.y, n.z];
        }),
      ),
      3,
    ),
  );
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs.flat()), 2));
  return paint(g, color, layer);
}

function trunk(low: number, high: number, height: number, sides: number, color: Color): BufferGeometry {
  const g = new CylinderGeometry(high, low, height, sides, 1, true).translate(0, height / 2, 0);
  const uv = g.getAttribute('uv');
  // Bark repeats twice around and once every two units up.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * (height / 2));
  return paint(g, color, 'bark');
}

function joined(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not merge scenery');
  return g;
}

interface Crown {
  /** Center height and radii of the crown. */
  y: number;
  rx: number;
  ry: number;
  cards: number;
  size: number;
  leaf: string;
}

/** Leaf cards spread over a crown; they are shaded as one rounded mass, darker inside and below. */
function crownCards(crown: Crown, rand: () => number): BufferGeometry[] {
  const center = new Vector3(0, crown.y, 0);
  const radii = new Vector3(crown.rx, crown.ry, crown.rx);
  const base = new Color(crown.leaf);
  const rounded = (p: Vector3): Vector3 => p.clone().sub(center).divide(radii).addScaledVector(UP, 0.45);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < crown.cards; i++) {
    const a = rand() * Math.PI * 2;
    const lift = -0.35 + rand() * 1.3;
    const out = new Vector3(Math.cos(a), lift, Math.sin(a)).normalize();
    const mid = center.clone().add(
      out
        .clone()
        .multiply(radii)
        .multiplyScalar(0.5 + rand() * 0.35),
    );
    // The card faces outward, tipped a little at random, so every side of the crown shows leaves.
    const facing = out
      .clone()
      .add(new Vector3(rand() - 0.5, rand() - 0.2, rand() - 0.5).multiplyScalar(0.8))
      .normalize();
    const side = new Vector3().crossVectors(facing, UP);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().multiplyScalar(crown.size);
    const rise = new Vector3().crossVectors(side, facing).normalize().multiplyScalar(crown.size);
    const shade = 0.62 + 0.38 * Math.min(1, Math.max(0, (out.y + 0.4) / 1.3));
    parts.push(
      card(
        [
          mid.clone().sub(side).add(rise),
          mid.clone().add(side).add(rise),
          mid.clone().add(side).sub(rise),
          mid.clone().sub(side).sub(rise),
        ],
        rounded,
        base.clone().multiplyScalar(shade * (0.9 + rand() * 0.2)),
        'leaves',
      ),
    );
  }
  return parts;
}

const BARK = new Color('#9a8672');
const BIRCH_BARK = new Color('#e9e4d6');

export function oak(cards: number): BufferGeometry {
  const rand = lcg(31);
  return joined([
    trunk(0.42, 0.26, 2.6, 6, BARK),
    ...crownCards({ y: 3.7, rx: 2.3, ry: 1.75, cards, size: 1.25, leaf: '#5f8438' }, rand),
  ]);
}

export function birch(cards: number): BufferGeometry {
  const rand = lcg(47);
  return joined([
    trunk(0.2, 0.13, 3.6, 5, BIRCH_BARK),
    ...crownCards(
      { y: 4.2, rx: 1.3, ry: 1.9, cards: Math.ceil(cards * 0.7), size: 0.95, leaf: '#93ad4c' },
      rand,
    ),
  ]);
}

export function bush(cards: number): BufferGeometry {
  const rand = lcg(59);
  return joined(
    crownCards({ y: 0.6, rx: 1, ry: 0.6, cards: Math.ceil(cards * 0.5), size: 0.7, leaf: '#62833a' }, rand),
  );
}

/** A conifer: boughs hang from the trunk in tiers, longer toward the ground. */
export function pine(tiers: number): BufferGeometry {
  const rand = lcg(71);
  const needles = new Color('#4d7340');
  const height = 6.4;
  const parts = [trunk(0.3, 0.08, height, 5, BARK)];
  for (let t = 0; t < tiers; t++) {
    const u = t / Math.max(1, tiers - 1);
    const y = 1.5 + u * (height - 1.9);
    const reach = 2.5 - u * 1.7;
    const boughs = 5;
    for (let k = 0; k < boughs; k++) {
      const a = ((k + (t % 2) * 0.5 + rand() * 0.3) / boughs) * Math.PI * 2;
      const out = new Vector3(Math.cos(a), -0.42 - rand() * 0.12, Math.sin(a))
        .normalize()
        .multiplyScalar(reach);
      const side = new Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(reach * 0.46);
      const root = new Vector3(0, y, 0);
      const tip = root.clone().add(out);
      const shade = 0.7 + u * 0.3;
      parts.push(
        card(
          [root.clone().sub(side), root.clone().add(side), tip.clone().add(side), tip.clone().sub(side)],
          (p) => new Vector3(p.x * 0.5, 1, p.z * 0.5),
          needles.clone().multiplyScalar(shade * (0.92 + rand() * 0.16)),
          'needles',
        ),
      );
    }
  }
  // The leader: two crossed boughs hanging from the very top.
  for (const a of [0, Math.PI / 2]) {
    const side = new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.55);
    const top = new Vector3(0, height + 0.5, 0);
    const low = new Vector3(0, height - 1.2, 0);
    parts.push(
      card(
        [top.clone().sub(side), top.clone().add(side), low.clone().add(side), low.clone().sub(side)],
        (p) => new Vector3(p.x, 0.6, p.z),
        needles,
        'needles',
      ),
    );
  }
  return joined(parts);
}

/** A tuft of grass: two crossed cards lit like the ground under them. */
export function grassTuft(): BufferGeometry {
  const color = new Color('#86a34c');
  const parts: BufferGeometry[] = [];
  for (const a of [0.3, 0.3 + Math.PI / 2]) {
    const side = new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.75);
    const top = new Vector3(0, 1.05, 0);
    const base = new Vector3(0, -0.05, 0);
    parts.push(
      card(
        [top.clone().sub(side), top.clone().add(side), base.clone().add(side), base.clone().sub(side)],
        () => UP.clone(),
        color,
        'blades',
      ),
    );
  }
  return joined(parts);
}

function hash3(x: number, y: number, z: number): number {
  let h =
    Math.imul((x * 73.1) | 0, 374761393) ^
    Math.imul((y * 91.7) | 0, 668265263) ^
    Math.imul((z * 57.3) | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A weathered boulder: a lumpy, flattened ball with smooth normals and the rock photo wrapped around it. */
export function boulder(detail: number): BufferGeometry {
  const raw = new IcosahedronGeometry(1, detail);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const g = mergeVertices(raw, 1e-4);
  const pos = g.getAttribute('position');
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const lump = 0.78 + hash3(p.x, p.y, p.z) * 0.42;
    pos.setXYZ(i, p.x * lump, Math.max(-0.2, p.y * lump * 0.62) + 0.25, p.z * lump * 0.88);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv.set([Math.atan2(pos.getZ(i), pos.getX(i)) / Math.PI, pos.getY(i) * 0.6], i * 2);
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return paint(g, new Color('#a39a8c'), 'boulder');
}

/** Gives a plain colored model the attributes the detailed material reads. */
export function plain(g: BufferGeometry): BufferGeometry {
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  return setSurf(g, layerOf('plain'));
}
