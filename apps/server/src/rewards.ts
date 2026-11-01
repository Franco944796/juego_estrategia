import type { GameConfig } from '@si/config';
import type { Standing } from '@si/engine';
import type { Reward } from '@si/protocol';

/**
 * Each band holds the top `topShare` of the field, rounded up and never empty, so with few players the
 * winner still lands in the top band.
 */
export function computeRewards(standings: Standing[], tiers: GameConfig['rewards']['tiers']): Reward[] {
  const n = standings.length;
  const cutoffs = tiers.map((t) => Math.max(1, Math.ceil(n * t.topShare)));
  return standings.map((s) => {
    const found = cutoffs.findIndex((cutoff) => s.rank <= cutoff);
    const tier = found < 0 ? tiers.length - 1 : found;
    return { lordId: s.lordId, rank: s.rank, tier, legacy: tiers[tier]?.legacy ?? 0 };
  });
}
