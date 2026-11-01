import { defaultConfig } from '@si/config';
import type { Standing } from '@si/engine';
import { describe, expect, it } from 'vitest';
import { computeRewards } from '../src/rewards';

function field(n: number): Standing[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    lordId: `p${i + 1}`,
    name: `P${i + 1}`,
    color: '#fff',
    dominion: 100 - i,
    level: 1,
    towns: 1,
    alive: true,
  }));
}

describe('season rewards', () => {
  const tiers = defaultConfig.rewards.tiers;

  it('pays the top 5%, 25%, 50% and the rest in bands', () => {
    const rewards = computeRewards(field(20), tiers);
    expect(rewards.map((r) => r.tier)).toEqual([0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(rewards[0]?.legacy).toBe(100);
    expect(rewards[19]?.legacy).toBe(10);
  });

  it('always puts the winner in the top band, even with few players', () => {
    expect(computeRewards(field(2), tiers).map((r) => r.tier)).toEqual([0, 3]);
    expect(computeRewards(field(1), tiers).map((r) => r.tier)).toEqual([0]);
    expect(computeRewards([], tiers)).toEqual([]);
  });
});
