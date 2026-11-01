import { defaultConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { distance } from '../src/geometry';
import { addIsle, generateWorld, islePosition, starterSpots, type MapParts } from '../src/mapgen';
import { seedRng } from '../src/rng';
import { totalTroops } from '../src/troops';
import { config, T0 } from './helpers';

const cfg = defaultConfig;

describe('generateWorld', () => {
  const world = generateWorld(cfg, seedRng(1), T0);
  const isle = world.isles[0];
  if (!isle) throw new Error('no isle');

  it('starts the season with one big isle of neutral towns', () => {
    expect(world.isles).toHaveLength(1);
    expect(world.lanes).toEqual([]);
    expect(isle).toMatchObject({ id: 0, ring: 0, pos: { x: 0, y: 0 }, bornAt: T0 });
    expect(world.towns).toHaveLength(cfg.map.isle.towns);
    expect(isle.townIds).toEqual(world.towns.map((t) => t.id));
    for (const town of world.towns) {
      expect(town).toMatchObject({ owner: null, isleId: 0, isThrone: false, privateTo: null });
      expect(totalTroops(town.garrison)).toBe(town.neutralCap);
    }
    expect(world.throneTownId).toBeNull();
  });

  it('puts the higher tiers in the middle', () => {
    const { radius, tierBands, tiers } = cfg.map.isle;
    for (const town of world.towns) {
      const r = distance(town.pos, isle.pos) / radius;
      if (tierBands.some((b) => Math.abs(r - b) < 0.03)) continue;
      const band = tierBands.findIndex((b) => r < b);
      expect(town.tier).toBe(tiers[band < 0 ? tiers.length - 1 : band]);
    }
    expect(new Set(world.towns.map((t) => t.tier))).toEqual(new Set(tiers));
  });

  it('keeps towns apart', () => {
    let closest = Infinity;
    for (let i = 0; i < world.towns.length; i++) {
      for (let j = i + 1; j < world.towns.length; j++) {
        const a = world.towns[i];
        const b = world.towns[j];
        if (a && b) closest = Math.min(closest, distance(a.pos, b.pos));
      }
    }
    expect(closest).toBeGreaterThan(15);
  });

  it('splits the isle into zones of about ten towns, each town in exactly one', () => {
    expect(world.zones).toHaveLength(Math.ceil(cfg.map.isle.towns / cfg.map.isle.zoneSize));
    const counted = world.zones.flatMap((z) => z.townIds).sort((a, b) => a - b);
    expect(counted).toEqual(world.towns.map((t) => t.id));
    for (const zone of world.zones) {
      expect(zone.beaconOwner).toBeNull();
      expect(zone.townIds.length).toBeGreaterThanOrEqual(cfg.map.isle.zoneSize - 1);
      expect(zone.townIds.length).toBeLessThanOrEqual(cfg.map.isle.zoneSize + 1);
      for (const id of zone.townIds) expect(world.towns[id]?.zoneId).toBe(zone.id);
    }
  });

  it('rings the shore with spawn slots outside every town', () => {
    expect(isle.slots).toHaveLength(cfg.map.spawn.slots);
    const farthest = Math.max(...world.towns.map((t) => distance(t.pos, isle.pos)));
    for (const slot of isle.slots) {
      expect(slot.lordId).toBeNull();
      expect(distance(slot.pos, isle.pos)).toBeGreaterThan(farthest);
      expect(distance(slot.pos, isle.pos)).toBeLessThan(isle.radius);
    }
  });

  it('makes the central town the Throne when the Throne is enabled', () => {
    const withThrone = generateWorld(config({ throne: { enabled: true } }), seedRng(1), T0);
    const throne = withThrone.towns[withThrone.throneTownId ?? -1];
    expect(throne).toMatchObject({ id: 0, isThrone: true, tier: cfg.throne.tier, zoneId: null });
    expect(totalTroops(throne?.garrison ?? { LANCER: 0, ARCHER: 0, GRIFFIN: 0 })).toBe(cfg.throne.garrison);
    expect(withThrone.zones.some((z) => z.townIds.includes(0))).toBe(false);
  });

  it('is deterministic per seed', () => {
    expect(generateWorld(cfg, seedRng(1), T0)).toEqual(world);
    expect(generateWorld(cfg, seedRng(2), T0)).not.toEqual(world);
  });
});

describe('growing isles', () => {
  it('places isles in rings of 6, 12, 18 around the first', () => {
    const spacing = cfg.map.growth.isleSpacing;
    expect(islePosition(cfg, 0, 0)).toEqual({ pos: { x: 0, y: 0 }, ring: 0 });
    expect(islePosition(cfg, 1, 0)).toEqual({ pos: { x: spacing, y: 0 }, ring: 1 });
    expect(islePosition(cfg, 6, 0).ring).toBe(1);
    expect(islePosition(cfg, 7, 0).ring).toBe(2);
    expect(islePosition(cfg, 18, 0).ring).toBe(2);
    expect(islePosition(cfg, 19, 0).ring).toBe(3);
    const p = islePosition(cfg, 9, 0.4).pos;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2 * spacing, 6);
  });

  it('links each new isle to its nearest isles without overlapping them', () => {
    const rng = seedRng(3);
    const parts: MapParts = generateWorld(cfg, rng, T0);
    for (let i = 1; i < 8; i++) addIsle(cfg, rng, parts, 0, T0 + i);
    expect(parts.lanes).toContainEqual({ a: 0, b: 1 });
    expect(parts.lanes).toContainEqual({ a: 1, b: 2 });
    for (const lane of parts.lanes) {
      const a = parts.isles[lane.a];
      const b = parts.isles[lane.b];
      if (a && b) expect(distance(a.pos, b.pos)).toBeLessThanOrEqual(cfg.map.growth.maxLaneLength);
    }
    for (const a of parts.isles) {
      for (const b of parts.isles) {
        if (a.id < b.id) expect(distance(a.pos, b.pos)).toBeGreaterThan(a.radius + b.radius);
      }
    }
    expect(parts.zones.at(-1)?.isleId).toBe(7);
    expect(parts.towns).toHaveLength(8 * cfg.map.isle.towns);
  });

  it('still links an isle that is farther than the lane limit', () => {
    const sparse = config({ map: { growth: { maxLaneLength: 1 } } });
    const rng = seedRng(5);
    const parts: MapParts = generateWorld(sparse, rng, T0);
    for (let i = 0; i < 3; i++) addIsle(sparse, rng, parts, 0, T0);
    expect(parts.lanes).toHaveLength(3);
  });

  it('spreads starter spots along the shore first, then outward', () => {
    const world = generateWorld(cfg, seedRng(1), T0);
    const isle = world.isles[0];
    const slot = isle?.slots[0]?.pos;
    if (!isle || !slot) throw new Error('no slot');
    const spots = starterSpots(cfg, isle, slot, 3);
    expect(spots).toHaveLength(3);
    for (const spot of spots) {
      expect(distance(spot, slot)).toBeCloseTo(cfg.map.spawn.privateSpacing, 0);
      expect(distance(spot, isle.pos)).toBeGreaterThanOrEqual(distance(slot, isle.pos) - 4);
    }
    expect(starterSpots(cfg, isle, slot, 7)).toHaveLength(7);
  });
});
