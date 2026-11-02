import type { GameConfig } from '@si/config';
import type { Standing } from '@si/engine';
import type { Reward } from '@si/protocol';

/**
 * Each band holds the top `topShare` of the field, rounded up and never empty, so with few players the
 * winner still lands in the top band.
 */
export function computeRewards(
  standings: Standing[],
  tiers: GameConfig['rewards']['tiers'],
  legacyMult = 1,
): Reward[] {
  const n = standings.length;
  const cutoffs = tiers.map((t) => Math.max(1, Math.ceil(n * t.topShare)));
  return standings.map((s) => {
    const found = cutoffs.findIndex((cutoff) => s.rank <= cutoff);
    const tier = found < 0 ? tiers.length - 1 : found;
    return {
      lordId: s.lordId,
      rank: s.rank,
      tier,
      legacy: Math.round((tiers[tier]?.legacy ?? 0) * legacyMult),
    };
  });
}

/**
 * League changes at a season end: the top `promoteShare` (rounded up) go up one league, the bottom
 * `relegateShare` (rounded down) go down one. Everyone else stays.
 */
export function leagueMoves(
  standings: Standing[],
  league: number,
  leagues: GameConfig['leagues'],
): { lordId: string; from: number; to: number }[] {
  const rules = leagues[league];
  if (!rules) return [];
  const n = standings.length;
  const up = Math.ceil(n * rules.promoteShare);
  const down = Math.floor(n * rules.relegateShare);
  return standings.map((s) => {
    let to = league;
    if (s.rank <= up && league < leagues.length - 1) to = league + 1;
    else if (s.rank > n - down && league > 0) to = league - 1;
    return { lordId: s.lordId, from: league, to };
  });
}
