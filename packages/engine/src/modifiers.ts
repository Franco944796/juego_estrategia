import { TROOP_TYPES } from '@si/config/constants';
import type { GameState, Troops } from './types';

export interface LordMods {
  attack: Troops;
  defense: Troops;
  speed: Troops;
  goldProd: number;
  troopProd: number;
  upgradeCost: number;
  /** Raised headwind floor, or null when no edict changes it. */
  headwindMin: number | null;
  fort: number;
  plunder: number;
  dominion: number;
  winnerLosses: number;
  /** Production multiplier from owning many towns (1 when sprawl is off). */
  sprawl: number;
}

function ones(): Troops {
  return { LANCER: 1, ARCHER: 1, GRIFFIN: 1 };
}

export function neutralMods(): LordMods {
  return {
    attack: ones(),
    defense: ones(),
    speed: ones(),
    goldProd: 1,
    troopProd: 1,
    upgradeCost: 1,
    headwindMin: null,
    fort: 1,
    plunder: 1,
    dominion: 1,
    winnerLosses: 1,
    sprawl: 1,
  };
}

export function lordMods(state: GameState, lordId: string | null): LordMods {
  const mods = neutralMods();
  if (lordId === null) return mods;
  const lord = state.lords[lordId];
  if (!lord) return mods;
  for (const edict of lord.edicts) {
    const e = state.config.edicts.catalog[edict];
    for (const type of TROOP_TYPES) {
      mods.attack[type] *= e.attack?.[type] ?? 1;
      mods.defense[type] *= e.defense?.[type] ?? 1;
      mods.speed[type] *= e.speed?.[type] ?? 1;
    }
    mods.goldProd *= e.goldProd ?? 1;
    mods.troopProd *= e.troopProd ?? 1;
    mods.upgradeCost *= e.upgradeCost ?? 1;
    if (e.headwindMin !== undefined) {
      mods.headwindMin = Math.max(mods.headwindMin ?? 0, e.headwindMin);
    }
    mods.fort *= e.fort ?? 1;
    mods.plunder *= e.plunder ?? 1;
    mods.dominion *= e.dominion ?? 1;
    mods.winnerLosses *= e.winnerLosses ?? 1;
  }
  const { freeTowns, penaltyPerTown } = state.config.towns.sprawl;
  if (penaltyPerTown > 0) {
    let owned = 0;
    for (const town of state.towns) if (town.owner === lordId) owned++;
    mods.sprawl = 1 / (1 + Math.max(0, owned - freeTowns) * penaltyPerTown);
  }
  return mods;
}
