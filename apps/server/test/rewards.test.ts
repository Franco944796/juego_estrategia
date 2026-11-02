import { defaultConfig } from '@si/config';
import type { Standing } from '@si/engine';
import { describe, expect, it } from 'vitest';
import { computeRewards, leagueMoves } from '../src/rewards';

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

describe('leagues', () => {
  const leagues = defaultConfig.leagues;
  const to = (n: number, league: number) => leagueMoves(field(n), league, leagues).map((m) => m.to);

  it('promotes everyone out of bronze', () => {
    expect(to(4, 0)).toEqual([1, 1, 1, 1]);
  });

  it('promotes the better half of silver and relegates nobody', () => {
    expect(to(4, 1)).toEqual([2, 2, 1, 1]);
    expect(to(5, 1)).toEqual([2, 2, 2, 1, 1]);
  });

  it('keeps the better half of gold and sends the rest down', () => {
    expect(to(4, 2)).toEqual([2, 2, 1, 1]);
    expect(to(5, 2)).toEqual([2, 2, 2, 1, 1]);
    expect(to(1, 2)).toEqual([2]);
    expect(leagueMoves(field(2), 9, leagues)).toEqual([]);
  });

  it('pays more Legacy in the higher leagues', () => {
    const tiers = defaultConfig.rewards.tiers;
    expect(computeRewards(field(1), tiers, 1.5)[0]?.legacy).toBe(150);
    expect(computeRewards(field(1), tiers, 2)[0]?.legacy).toBe(200);
  });
});
