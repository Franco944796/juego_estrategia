import { GEAR_EFFECTS, GEAR_SLOTS } from '@si/config/constants';
import { equippedItem, itemBonus } from './gear';
import { gemBonuses } from './gems';
import type { GameState } from './types';

/** Multipliers from skills and equipment; each bonus adds to 1 (+5 % and +3 % make ×1.08). */
export interface LordMods {
  attack: number;
  /** On the lord's troops when they defend (its garrisons and its stationed contingents). */
  defense: number;
  /** On the walls of the lord's towns. */
  walls: number;
  /** On the lord's march speed. */
  speed: number;
  goldProd: number;
  troopProd: number;
  /** On the gold paid per enemy troop killed. */
  killGold: number;
  /** Share of the gold invested in a town that comes back when it is lost (0 without a chest). */
  refund: number;
  /** Production multiplier from owning many towns (1 when sprawl is off). */
  sprawl: number;
  /** On the lord's Dominion per minute (amethyst gems). */
  dominion: number;
  /** On the experience the lord's battles give (emerald gems). */
  xp: number;
}

export function neutralMods(): LordMods {
  return {
    attack: 1,
    defense: 1,
    walls: 1,
    speed: 1,
    goldProd: 1,
    troopProd: 1,
    killGold: 1,
    refund: 0,
    sprawl: 1,
    dominion: 1,
    xp: 1,
  };
}

/** Memoized lordMods for loops that read many towns while ownership stays put. */
export function modsMemo(state: GameState): (lordId: string | null) => LordMods {
  const cache = new Map<string | null, LordMods>();
  return (lordId) => {
    let mods = cache.get(lordId);
    if (!mods) {
      mods = lordMods(state, lordId);
      cache.set(lordId, mods);
    }
    return mods;
  };
}

/** Towns per owner, counted in one pass for loops that need every lord's modifiers. */
export function ownedCounts(state: GameState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const town of state.towns) {
    if (town.owner !== null) counts.set(town.owner, (counts.get(town.owner) ?? 0) + 1);
  }
  return counts;
}

/** `owned` skips counting the lord's towns when the caller already knows it. */
export function lordMods(state: GameState, lordId: string | null, owned?: number): LordMods {
  const mods = neutralMods();
  if (lordId === null) return mods;
  const lord = state.lords[lordId];
  if (!lord) return mods;
  const perPoint = state.config.skills.perPoint;
  mods.attack = 1 + perPoint.ATTACK * lord.skills.ATTACK;
  mods.goldProd = 1 + perPoint.GOLD * lord.skills.GOLD;
  mods.troopProd = 1 + perPoint.TROOPS * lord.skills.TROOPS;
  for (const slot of GEAR_SLOTS) {
    const item = equippedItem(lord, slot);
    if (item) mods[GEAR_EFFECTS[slot]] += itemBonus(state, item);
  }
  const gems = gemBonuses(state.config, lord);
  mods.goldProd += gems.TOPAZ;
  mods.troopProd += gems.RUBY;
  mods.defense += gems.SAPPHIRE;
  mods.dominion += gems.AMETHYST;
  mods.xp += gems.EMERALD;
  const { freeTowns, penaltyPerTown } = state.config.towns.sprawl;
  if (penaltyPerTown > 0) {
    let count = owned;
    if (count === undefined) {
      count = 0;
      for (const town of state.towns) if (town.owner === lordId) count++;
    }
    mods.sprawl = 1 / (1 + Math.max(0, count - freeTowns) * penaltyPerTown);
  }
  return mods;
}
