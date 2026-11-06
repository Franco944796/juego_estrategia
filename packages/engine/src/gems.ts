import { GEM_COLORS } from '@si/config/constants';
import { equippedItem } from './gear';
import type { GameConfig, Gem, GemColor, Item, Lord } from './types';

export function gemLevel(gem: Gem): number {
  return gem.level ?? 1;
}

/** What a gem adds: its league's base value, plus `levelShare` of it per level past the first. */
export function gemValue(cfg: GameConfig, gem: Gem): number {
  const leagues = cfg.leagues;
  const base = (leagues[gem.league] ?? leagues[leagues.length - 1])?.gemBonus ?? 0;
  return base * (1 + (gemLevel(gem) - 1) * cfg.gems.levelShare);
}

export function socketsOf(cfg: GameConfig, item: Item): number {
  return cfg.gear.sockets[item.rarity];
}

/**
 * Puts a gem in a list of owned gems. A duplicate (same color and league) joins the one already there
 * as a copy, and every `copiesPerLevel` × level copies raise it a level, like items do. A gem at the
 * top level takes no more copies. Returns the gem that took it in, when it became a copy.
 */
export function stockGem(cfg: GameConfig, gems: Gem[], gem: Gem): Gem | null {
  const max = cfg.gems.maxLevel;
  const owned = gems.find((o) => o.color === gem.color && o.league === gem.league && gemLevel(o) < max);
  if (!owned) {
    gems.push({ ...gem });
    return null;
  }
  let copies = (owned.copies ?? 0) + 1;
  let level = gemLevel(owned);
  while (level < max && copies >= cfg.gear.copiesPerLevel * level) {
    copies -= cfg.gear.copiesPerLevel * level;
    level++;
  }
  owned.level = level;
  owned.copies = level < max ? copies : 0;
  return owned;
}

/** The item a gem is set in, if any. */
export function gemHolder(lord: Lord, gemId: string): Item | undefined {
  return lord.items.find((item) => item.gems?.includes(gemId));
}

/** Bonus by color from the gems set in the lord's worn items. */
export function gemBonuses(cfg: GameConfig, lord: Lord): Record<GemColor, number> {
  const out = Object.fromEntries(GEM_COLORS.map((c) => [c, 0])) as Record<GemColor, number>;
  for (const slot of Object.keys(lord.gear) as (keyof Lord['gear'])[]) {
    const item = equippedItem(lord, slot);
    for (const id of item?.gems ?? []) {
      const gem = lord.gems.find((g) => g.id === id);
      if (gem) out[gem.color] += gemValue(cfg, gem);
    }
  }
  return out;
}
