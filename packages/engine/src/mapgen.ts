import { distance } from './geometry';
import { nextFloat, type RngState } from './rng';
import type { GameConfig, Isle, Lane, Town, Vec, Zone } from './types';

const TAU = Math.PI * 2;
/** Successive towns turn by this angle, which spreads them evenly over the disc (sunflower layout). */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Isles per ring around the first one grow by this many per ring (6, 12, 18…). */
const ISLES_PER_RING = 6;

export interface MapParts {
  isles: Isle[];
  towns: Town[];
  zones: Zone[];
  lanes: Lane[];
}

function jitter(rng: RngState, amount: number): number {
  return (nextFloat(rng) * 2 - 1) * amount;
}

function isleShape(rng: RngState, cfg: GameConfig): number[] {
  const points: number[] = [];
  for (let i = 0; i < cfg.map.shapePoints; i++) points.push(1 + jitter(rng, cfg.map.shapeJitter));
  return points;
}

export function neutralTown(id: number, isleId: number, pos: Vec, tier: number, cfg: GameConfig): Town {
  const garrisonSize = cfg.neutral.garrison[tier - 1] ?? 0;
  return {
    id,
    isleId,
    pos,
    tier,
    owner: null,
    garrison: garrisonSize,
    carry: 0,
    isCapital: false,
    isThrone: false,
    neutralCap: garrisonSize,
    stationed: [],
    zoneId: null,
    privateTo: null,
    invested: 0,
  };
}

/** Where the n-th isle goes: the first in the middle, then rings of 6, 12, 18… isles around it. */
export function islePosition(cfg: GameConfig, index: number, spin: number): { pos: Vec; ring: number } {
  if (index === 0) return { pos: { x: 0, y: 0 }, ring: 0 };
  let ring = 1;
  let first = 1;
  while (index >= first + ISLES_PER_RING * ring) {
    first += ISLES_PER_RING * ring;
    ring++;
  }
  const count = ISLES_PER_RING * ring;
  const angle = spin + ((index - first) / count) * TAU;
  const r = ring * cfg.map.growth.isleSpacing;
  return { pos: { x: Math.cos(angle) * r, y: Math.sin(angle) * r }, ring };
}

/**
 * Zones of about `size` towns as annular sectors: one in the middle, then rings of 3, 6, 9… outward.
 * `members` must come sorted by distance from the isle centre (the spiral order).
 */
function buildZones(isle: Isle, members: Town[], size: number, zones: Zone[]): void {
  const count = Math.max(1, Math.ceil(members.length / size));
  const layers: number[] = [];
  for (let left = count, k = 0; left > 0; k++) {
    const z = Math.min(left, k === 0 ? 1 : 3 * k);
    layers.push(z);
    left -= z;
  }
  const per = members.length / count;
  let next = 0;
  let made = 0;
  layers.forEach((z, layer) => {
    const end = Math.round((made + z) * per);
    // Each layer starts its sectors at a different angle so the borders do not line up.
    const angle = (t: Town): number =>
      (Math.atan2(t.pos.y - isle.pos.y, t.pos.x - isle.pos.x) + Math.PI + layer * 0.9) % TAU;
    const ring = members.slice(next, end).sort((a, b) => angle(a) - angle(b) || a.id - b.id);
    for (let j = 0; j < z; j++) {
      const chunk = ring.slice(Math.round((j * ring.length) / z), Math.round(((j + 1) * ring.length) / z));
      const zone: Zone = {
        id: zones.length,
        isleId: isle.id,
        pos: {
          x: chunk.reduce((sum, t) => sum + t.pos.x, 0) / chunk.length,
          y: chunk.reduce((sum, t) => sum + t.pos.y, 0) / chunk.length,
        },
        townIds: chunk.map((t) => t.id).sort((a, b) => a - b),
        beaconOwner: null,
      };
      for (const t of chunk) t.zoneId = zone.id;
      zones.push(zone);
    }
    next = end;
    made += z;
  });
}

/** Links a new isle to its nearest isles; a far isle still gets one lane, so the map stays connected. */
function linkIsle(cfg: GameConfig, isle: Isle, isles: Isle[], lanes: Lane[]): void {
  const others = isles
    .filter((o) => o.id !== isle.id)
    .map((o) => ({ id: o.id, d: distance(o.pos, isle.pos) }))
    .sort((p, q) => p.d - q.d || p.id - q.id);
  others.forEach((o, i) => {
    if (i === 0 || (i < cfg.map.growth.laneNeighbors && o.d <= cfg.map.growth.maxLaneLength)) {
      lanes.push({ a: Math.min(o.id, isle.id), b: Math.max(o.id, isle.id) });
    }
  });
  lanes.sort((p, q) => p.a - q.a || p.b - q.b);
}

/**
 * Adds a big isle: `map.isle.towns` neutral towns on a sunflower spiral (higher tiers inside), split into
 * zones, with `map.spawn.slots` shore spots where lords appear.
 */
export function addIsle(cfg: GameConfig, rng: RngState, parts: MapParts, spin: number, at: number): Isle {
  const id = parts.isles.length;
  const { pos, ring } = islePosition(cfg, id, spin);
  const { radius: R, shore, towns: n, tierBands, tiers, zoneSize } = cfg.map.isle;
  const isle: Isle = {
    id,
    ring,
    pos,
    radius: R + shore + cfg.map.spawn.privateSpacing,
    shape: isleShape(rng, cfg),
    townIds: [],
    slots: [],
    bornAt: at,
  };
  const turn = nextFloat(rng) * TAU;
  const created: Town[] = [];
  for (let i = 0; i < n; i++) {
    const r = R * Math.sqrt((i + 0.5) / n);
    const a = turn + i * GOLDEN_ANGLE;
    const band = tierBands.findIndex((b) => r / R < b);
    const tier = tiers[band < 0 ? tiers.length - 1 : band] ?? 1;
    const townPos = {
      x: pos.x + Math.cos(a) * r + jitter(rng, cfg.map.isle.jitter),
      y: pos.y + Math.sin(a) * r + jitter(rng, cfg.map.isle.jitter),
    };
    const town = neutralTown(parts.towns.length, id, townPos, tier, cfg);
    parts.towns.push(town);
    created.push(town);
    isle.townIds.push(town.id);
  }
  buildZones(isle, created, zoneSize, parts.zones);
  const slotTurn = nextFloat(rng) * TAU;
  const slotRadius = R + shore / 2;
  for (let k = 0; k < cfg.map.spawn.slots; k++) {
    const a = slotTurn + (k / cfg.map.spawn.slots) * TAU;
    isle.slots.push({
      pos: { x: pos.x + Math.cos(a) * slotRadius, y: pos.y + Math.sin(a) * slotRadius },
      lordId: null,
    });
  }
  parts.isles.push(isle);
  if (id > 0) linkIsle(cfg, isle, parts.isles, parts.lanes);
  return isle;
}

/** Spots for a lord's starter towns around its shore slot: nearest first along the shore, then outward. */
export function starterSpots(cfg: GameConfig, isle: Isle, slot: Vec, count: number): Vec[] {
  const dx = slot.x - isle.pos.x;
  const dy = slot.y - isle.pos.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const step = cfg.map.spawn.privateSpacing;
  const span = Math.ceil(Math.sqrt(count)) + 1;
  const spots: { r: number; a: number; d: number }[] = [];
  for (let layer = 0; layer <= span; layer++) {
    for (let o = -span; o <= span; o++) {
      if (layer === 0 && o === 0) continue;
      const rr = r + layer * step;
      spots.push({ r: rr, a: angle + (o * step) / rr, d: layer * layer + o * o });
    }
  }
  return spots
    .sort((p, q) => p.d - q.d)
    .slice(0, count)
    .map((p) => ({ x: isle.pos.x + Math.cos(p.a) * p.r, y: isle.pos.y + Math.sin(p.a) * p.r }));
}

/** The first isle of a season; with the Throne enabled its central town becomes the Throne. */
export function generateWorld(
  cfg: GameConfig,
  rng: RngState,
  startsAt: number,
): MapParts & { throneTownId: number | null; spin: number } {
  const parts: MapParts = { isles: [], towns: [], zones: [], lanes: [] };
  const spin = nextFloat(rng) * TAU;
  addIsle(cfg, rng, parts, spin, startsAt);
  let throneTownId: number | null = null;
  const center = parts.towns[0];
  if (cfg.throne.enabled && center) {
    center.isThrone = true;
    center.tier = cfg.throne.tier;
    center.garrison = cfg.throne.garrison;
    center.neutralCap = cfg.throne.garrison;
    const zone = parts.zones.find((z) => z.id === center.zoneId);
    if (zone) zone.townIds = zone.townIds.filter((id) => id !== center.id);
    center.zoneId = null;
    throneTownId = center.id;
  }
  return { ...parts, throneTownId, spin };
}
