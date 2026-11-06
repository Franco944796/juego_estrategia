import { GEAR_SLOTS, RARITIES } from '@si/config/constants';
import { nextFloat, nextInt } from './rng';
import type { DomainEvent, GameConfig, GameState, GearSlot, Item, Lord } from './types';

export function itemLevel(item: Item): number {
  return item.level ?? 1;
}

export function itemBonus(state: GameState, item: Item): number {
  const gear = state.config.gear;
  if (item.slot === 'CHEST') return gear.refundByRarity[item.rarity];
  return gear.rarityBonus[item.rarity] + (itemLevel(item) - 1) * gear.levelBonus[item.rarity];
}

/** Scrap to raise an item from its level to the next. */
export function upgradeScrapCost(cfg: GameConfig, item: Item): number {
  return cfg.gear.upgradeScrap * itemLevel(item);
}

/** What destroying an item gives: its rarity's scrap plus half of what was put into it. */
export function destroyScrap(cfg: GameConfig, item: Item): number {
  return cfg.gear.scrapByRarity[item.rarity] + Math.floor((item.scrap ?? 0) / 2);
}

/**
 * Puts an item in a list of owned items (a lord's or an account's). A duplicate (same slot and rarity)
 * joins the one already there as a copy, and every `copiesPerLevel` × level copies raise it a level.
 * Chests never level, and an item at the top level takes no more copies: those stay separate items, so
 * they can be destroyed for scrap. Returns the item that took it in, when it became a copy.
 */
export function stockItem(cfg: GameConfig, items: Item[], item: Item): Item | null {
  const max = cfg.gear.maxItemLevel;
  const owned =
    item.slot === 'CHEST'
      ? undefined
      : items.find((o) => o.slot === item.slot && o.rarity === item.rarity && itemLevel(o) < max);
  if (!owned) {
    items.push({ ...item });
    return null;
  }
  let copies = (owned.copies ?? 0) + 1;
  let level = itemLevel(owned);
  while (level < max && copies >= cfg.gear.copiesPerLevel * level) {
    copies -= cfg.gear.copiesPerLevel * level;
    level++;
  }
  owned.level = level;
  owned.copies = level < max ? copies : 0;
  return owned;
}

export function equippedItem(lord: Lord, slot: GearSlot): Item | undefined {
  const id = lord.gear[slot];
  return id === undefined ? undefined : lord.items.find((item) => item.id === id);
}

export function equipItem(lord: Lord, item: Item, at: number, events: DomainEvent[]): void {
  lord.gear[item.slot] = item.id;
  events.push({ type: 'ITEM_EQUIPPED', at, lordId: lord.id, item: { ...item } });
}

/**
 * A random item for a lord who just reached `level`: any slot, rarity weighted by the level. The id
 * joins the season start, the seed, the lord and the level, so it stays unique across seasons (demo
 * games all start at time 0, hence the seed).
 */
export function dropItem(
  state: GameState,
  lord: Lord,
  level: number,
  at: number,
  events: DomainEvent[],
): Item {
  const { dropOdds } = state.config.gear;
  const row = [...dropOdds].reverse().find((r) => level >= r.minLevel) ?? dropOdds[0];
  const weights = row?.weights ?? [1];
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = nextFloat(state.rng) * total;
  let index = 0;
  while (index < weights.length - 1 && roll >= (weights[index] ?? 0)) {
    roll -= weights[index] ?? 0;
    index++;
  }
  const item: Item = {
    id: `${state.startsAt.toString(36)}-${state.seed.toString(36)}-${lord.id}-${level}`,
    slot: GEAR_SLOTS[nextInt(state.rng, 0, GEAR_SLOTS.length - 1)] ?? 'WEAPON',
    rarity: RARITIES[index] ?? 'COMMON',
  };
  const into = stockItem(state.config, lord.items, item);
  events.push({
    type: 'ITEM_FOUND',
    at,
    lordId: lord.id,
    item: { ...item },
    source: 'LEVEL',
    ...(into ? { into: { ...into } } : {}),
  });
  return item;
}

/** Adds an item bought outside the season rules (the Legacy shop); ignored if the id is known. */
export function grantItem(state: GameState, lordId: string, item: Item, at: number): DomainEvent[] {
  const lord = Object.prototype.hasOwnProperty.call(state.lords, lordId) ? state.lords[lordId] : undefined;
  if (!lord || lord.items.some((owned) => owned.id === item.id)) return [];
  const copy = { id: item.id, slot: item.slot, rarity: item.rarity };
  const into = stockItem(state.config, lord.items, copy);
  return [
    { type: 'ITEM_FOUND', at, lordId, item: copy, source: 'SHOP', ...(into ? { into: { ...into } } : {}) },
  ];
}

/** The owned, unequipped item that beats the one in its slot by the most (first id on ties). */
export function bestUpgrade(state: GameState, lord: Lord): Item | null {
  let best: Item | null = null;
  let gain = 0;
  for (const item of lord.items) {
    const current = equippedItem(lord, item.slot);
    const delta = itemBonus(state, item) - (current ? itemBonus(state, current) : 0);
    if (delta > gain) {
      best = item;
      gain = delta;
    }
  }
  return best;
}
