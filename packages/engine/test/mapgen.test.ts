import { defaultConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { distance } from '../src/geometry';
import { generateWorld } from '../src/mapgen';
import { seedRng } from '../src/rng';
import { totalTroops } from '../src/troops';
import { config } from './helpers';

const cfg = defaultConfig;

describe('generateWorld', () => {
  const world = generateWorld(cfg, seedRng(1), 8);

  it('builds the Throne isle and the configured rings', () => {
    const ringSizes = cfg.map.rings.map((r) => r.isles);
    expect(world.isles).toHaveLength(1 + ringSizes.reduce((a, b) => a + b, 0));
    const throneIsle = world.isles[0];
    expect(throneIsle?.ring).toBe(0);
    expect(throneIsle?.hasBeacon).toBe(false);
    expect(throneIsle?.townIds).toEqual([world.throneTownId]);
    const throne = world.towns[world.throneTownId];
    expect(throne?.isThrone).toBe(true);
    expect(throne?.tier).toBe(cfg.throne.tier);
    expect(totalTroops(throne?.garrison ?? { LANCER: 0, ARCHER: 0, GRIFFIN: 0 })).toBe(cfg.throne.garrison);
  });

  it('places 3–5 towns per ring isle with ring tiers and neutral garrisons', () => {
    for (const isle of world.isles.slice(1)) {
      expect(isle.townIds.length).toBeGreaterThanOrEqual(cfg.map.townsPerIsle[0]);
      expect(isle.townIds.length).toBeLessThanOrEqual(cfg.map.townsPerIsle[1]);
      const ring = cfg.map.rings[isle.ring - 1];
      for (const id of isle.townIds) {
        const town = world.towns[id];
        expect(town?.isleId).toBe(isle.id);
        expect(town?.tier).toBeGreaterThanOrEqual(ring?.tiers[0] ?? 0);
        expect(town?.tier).toBeLessThanOrEqual(ring?.tiers[1] ?? 0);
        expect(totalTroops(town?.garrison ?? { LANCER: 0, ARCHER: 0, GRIFFIN: 0 })).toBe(town?.neutralCap);
      }
      const towns = isle.townIds.map((id) => world.towns[id]);
      for (let i = 0; i < towns.length; i++) {
        for (let j = i + 1; j < towns.length; j++) {
          expect(distance(towns[i]?.pos ?? { x: 0, y: 0 }, towns[j]?.pos ?? { x: 0, y: 0 })).toBeGreaterThan(
            20,
          );
        }
      }
    }
  });

  it('connects every isle and links the inner ring to the Throne', () => {
    const adj = world.isles.map(() => [] as number[]);
    for (const lane of world.lanes) {
      adj[lane.a]?.push(lane.b);
      adj[lane.b]?.push(lane.a);
    }
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length > 0) {
      const id = stack.pop() as number;
      for (const n of adj[id] ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    expect(seen.size).toBe(world.isles.length);
    for (const isle of world.isles.filter((i) => i.ring === 1)) expect(adj[0]).toContain(isle.id);
  });

  it('starts every lord on a different outer isle', () => {
    expect(new Set(world.lordIsles).size).toBe(8);
    for (const id of world.lordIsles) expect(world.isles[id]?.ring).toBe(cfg.map.rings.length);
  });

  it('is deterministic per seed', () => {
    expect(generateWorld(cfg, seedRng(1), 8)).toEqual(world);
    expect(generateWorld(cfg, seedRng(2), 8)).not.toEqual(world);
  });

  it('refuses more lords than outer isles', () => {
    expect(() => generateWorld(cfg, seedRng(1), 13)).toThrow(/outer isles/);
  });

  it('still connects isles that are farther apart than the lane limit', () => {
    const sparse = config({ map: { maxLaneLength: 1, laneNeighbors: 1 } });
    const w = generateWorld(sparse, seedRng(5), 4);
    expect(w.lanes.length).toBeGreaterThanOrEqual(w.isles.length - 1);
  });
});
