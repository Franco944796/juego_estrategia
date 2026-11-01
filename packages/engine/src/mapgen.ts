import { TROOP_TYPES } from '@si/config/constants';
import { distance } from './geometry';
import { nextFloat, nextInt, nextRange, type RngState } from './rng';
import { splitGarrison } from './troops';
import type { GameConfig, Isle, Lane, Town, Vec } from './types';

const TAU = Math.PI * 2;

export interface World {
  isles: Isle[];
  towns: Town[];
  lanes: Lane[];
  throneTownId: number;
  /** Isle id of each lord's starting isle, in the order the lords were given. */
  lordIsles: number[];
}

function jitter(rng: RngState, amount: number): number {
  return (nextFloat(rng) * 2 - 1) * amount;
}

function isleShape(rng: RngState, cfg: GameConfig): number[] {
  const points: number[] = [];
  for (let i = 0; i < cfg.map.shapePoints; i++) points.push(1 + jitter(rng, cfg.map.shapeJitter));
  return points;
}

function makeTown(
  id: number,
  isleId: number,
  pos: Vec,
  tier: number,
  cfg: GameConfig,
  spec: Town['spec'],
): Town {
  const garrisonSize = cfg.neutral.garrison[tier - 1] ?? 0;
  return {
    id,
    isleId,
    pos,
    tier,
    spec,
    owner: null,
    garrison: splitGarrison(garrisonSize, spec, cfg.neutral.mainShare),
    carry: 0,
    isCapital: false,
    isThrone: false,
    neutralCap: garrisonSize,
  };
}

function placeTowns(
  rng: RngState,
  cfg: GameConfig,
  isle: Isle,
  tiers: [number, number],
  towns: Town[],
): void {
  const count = nextInt(rng, cfg.map.townsPerIsle[0], cfg.map.townsPerIsle[1]);
  const ringRadius = isle.radius * cfg.map.townRing;
  const spots: Vec[] = [];
  // With four or more towns one sits in the middle, so the ring keeps its spacing.
  const onRing = count >= 4 ? count - 1 : count;
  if (count >= 4) spots.push({ x: isle.pos.x, y: isle.pos.y });
  const start = nextFloat(rng) * TAU;
  for (let j = 0; j < onRing; j++) {
    const a = start + (j * TAU) / onRing;
    spots.push({ x: isle.pos.x + Math.cos(a) * ringRadius, y: isle.pos.y + Math.sin(a) * ringRadius });
  }
  const specOffset = nextInt(rng, 0, TROOP_TYPES.length - 1);
  spots.forEach((spot, j) => {
    const pos = {
      x: spot.x + jitter(rng, cfg.map.townJitter),
      y: spot.y + jitter(rng, cfg.map.townJitter),
    };
    const spec = TROOP_TYPES[(specOffset + j) % TROOP_TYPES.length] ?? 'LANCER';
    const town = makeTown(towns.length, isle.id, pos, nextInt(rng, tiers[0], tiers[1]), cfg, spec);
    towns.push(town);
    isle.townIds.push(town.id);
  });
}

/** Appends a ring of isles (with their towns) at `radius` around the Throne; returns the new isles. */
export function addRing(
  cfg: GameConfig,
  rng: RngState,
  isles: Isle[],
  towns: Town[],
  ring: number,
  radius: number,
  count: number,
  tiers: [number, number],
): Isle[] {
  const added: Isle[] = [];
  const offset = (nextFloat(rng) * TAU) / count;
  for (let k = 0; k < count; k++) {
    const angle = offset + (k * TAU) / count + jitter(rng, cfg.map.angleJitter);
    const r = radius + jitter(rng, cfg.map.radiusJitter);
    const isle: Isle = {
      id: isles.length,
      ring,
      pos: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
      radius: nextRange(rng, cfg.map.isleRadius[0], cfg.map.isleRadius[1]),
      shape: isleShape(rng, cfg),
      townIds: [],
      hasBeacon: true,
      beaconOwner: null,
    };
    isles.push(isle);
    added.push(isle);
    placeTowns(rng, cfg, isle, tiers, towns);
  }
  return added;
}

export function buildLanes(cfg: GameConfig, isles: Isle[]): Lane[] {
  const n = isles.length;
  const key = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
  const lanes = new Map<number, Lane>();
  const add = (a: number, b: number): void => {
    lanes.set(key(a, b), { a: Math.min(a, b), b: Math.max(a, b) });
  };

  const ringIsles = isles.filter((isle) => isle.ring > 0);
  for (const isle of ringIsles) if (isle.ring === 1) add(0, isle.id);
  for (const isle of ringIsles) {
    const nearest = ringIsles
      .filter((other) => other.id !== isle.id)
      .map((other) => ({ id: other.id, d: distance(isle.pos, other.pos) }))
      .filter((c) => c.d <= cfg.map.maxLaneLength)
      .sort((p, q) => p.d - q.d || p.id - q.id)
      .slice(0, cfg.map.laneNeighbors);
    for (const c of nearest) add(isle.id, c.id);
  }

  // Kruskal pass so the graph is always connected, even with sparse or far isles.
  const parent = isles.map((isle) => isle.id);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };
  for (const lane of lanes.values()) union(lane.a, lane.b);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = isles[i] as Isle;
      const b = isles[j] as Isle;
      pairs.push({ a: a.id, b: b.id, d: distance(a.pos, b.pos) });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  for (const p of pairs) if (union(p.a, p.b)) add(p.a, p.b);

  return [...lanes.values()].sort((p, q) => p.a - q.a || p.b - q.b);
}

export function generateWorld(cfg: GameConfig, rng: RngState, lordCount: number): World {
  const isles: Isle[] = [];
  const towns: Town[] = [];

  const throneIsle: Isle = {
    id: 0,
    ring: 0,
    pos: { x: 0, y: 0 },
    radius: cfg.map.throneIsleRadius,
    shape: isleShape(rng, cfg),
    townIds: [],
    hasBeacon: false,
    beaconOwner: null,
  };
  isles.push(throneIsle);
  const throneSpec = TROOP_TYPES[nextInt(rng, 0, TROOP_TYPES.length - 1)] ?? 'LANCER';
  const throne = makeTown(0, 0, { x: 0, y: 0 }, cfg.throne.tier, cfg, throneSpec);
  throne.isThrone = true;
  throne.garrison = splitGarrison(cfg.throne.garrison, throneSpec, cfg.neutral.mainShare);
  throne.neutralCap = cfg.throne.garrison;
  towns.push(throne);
  throneIsle.townIds.push(throne.id);

  cfg.map.rings.forEach((ring, ringIndex) => {
    addRing(cfg, rng, isles, towns, ringIndex + 1, ring.radius, ring.isles, ring.tiers);
  });

  const outerRing = cfg.map.rings.length;
  const outer = isles.filter((isle) => isle.ring === outerRing);
  if (lordCount > outer.length) {
    throw new Error(`the map has ${outer.length} outer isles for ${lordCount} lords`);
  }
  const start = nextInt(rng, 0, outer.length - 1);
  const lordIsles: number[] = [];
  for (let l = 0; l < lordCount; l++) {
    const isle = outer[(start + Math.floor((l * outer.length) / lordCount)) % outer.length] as Isle;
    lordIsles.push(isle.id);
  }

  return { isles, towns, lanes: buildLanes(cfg, isles), throneTownId: throne.id, lordIsles };
}
