import { MINUTE_MS } from '@si/config/constants';
import { lordMods, type LordMods } from './modifiers';
import { cloneTroops, totalTroops } from './troops';
import type { GameState, Town, Troops, TroopType } from './types';

export interface TownRates {
  gold: number;
  troops: number;
  cap: number;
}

export function beaconLitFor(state: GameState, town: Town): boolean {
  const isle = state.isles[town.isleId];
  return !!isle && isle.hasBeacon && isle.beaconOwner !== null && isle.beaconOwner === town.owner;
}

export function townRates(state: GameState, town: Town, mods?: LordMods): TownRates {
  const cfg = state.config;
  const i = town.tier - 1;
  const base = (cfg.towns.troopsPerMin[i] ?? 0) * cfg.troops[town.spec].prodMult;
  if (town.owner === null) {
    const troops = town.neutralCap > 0 ? base * cfg.neutral.regenMult : 0;
    return { gold: 0, troops, cap: town.neutralCap };
  }
  const m = mods ?? lordMods(state, town.owner);
  let mult = 1;
  if (town.isCapital) mult *= cfg.towns.capitalProdMult;
  if (beaconLitFor(state, town)) mult *= 1 + cfg.beacon.prodBonus;
  return {
    gold: (cfg.towns.goldPerMin[i] ?? 0) * mult * m.goldProd * m.sprawl,
    troops: base * mult * m.troopProd * m.sprawl,
    cap: cfg.towns.garrisonCap[i] ?? 0,
  };
}

/** Production pauses at the cap; reinforcements may still push a garrison above it. */
export function growGarrison(
  garrison: Troops,
  carry: number,
  spec: TroopType,
  ratePerMin: number,
  dtMin: number,
  cap: number,
): { garrison: Troops; carry: number } {
  const total = totalTroops(garrison);
  if (total >= cap) return { garrison, carry: 0 };
  if (ratePerMin <= 0 || dtMin <= 0) return { garrison, carry };
  const amount = carry + ratePerMin * dtMin;
  let add = Math.floor(amount);
  let rest = amount - add;
  if (total + add >= cap) {
    add = cap - total;
    rest = 0;
  }
  if (add === 0) return { garrison, carry: rest };
  const next = cloneTroops(garrison);
  next[spec] += add;
  return { garrison: next, carry: rest };
}

export function dominionRates(state: GameState): Map<string, number> {
  const cfg = state.config;
  const rates = new Map<string, number>();
  const bump = (id: string, value: number): void => {
    rates.set(id, (rates.get(id) ?? 0) + value);
  };
  for (const town of state.towns) {
    if (town.owner !== null) bump(town.owner, cfg.dominion.perTier[town.tier - 1] ?? 0);
  }
  for (const isle of state.isles) {
    if (isle.hasBeacon && isle.beaconOwner !== null) bump(isle.beaconOwner, cfg.beacon.dominionPerMin);
  }
  const throne = state.towns[state.throneTownId];
  if (throne?.owner) bump(throne.owner, cfg.throne.dominionPerMin);
  for (const [id, value] of rates) rates.set(id, value * lordMods(state, id).dominion);
  return rates;
}

function elapsedMin(state: GameState, t: number): number {
  return (Math.min(t, state.endsAt) - state.accruedAt) / MINUTE_MS;
}

/** Settles production up to t. Only call it at commands and scheduled events, so replays match. */
export function accrueTo(state: GameState, t: number): void {
  const dtMin = elapsedMin(state, t);
  if (dtMin <= 0) return;
  const mods = new Map<string, LordMods>();
  for (const town of state.towns) {
    let m: LordMods | undefined;
    if (town.owner !== null) {
      m = mods.get(town.owner) ?? lordMods(state, town.owner);
      mods.set(town.owner, m);
    }
    const rates = townRates(state, town, m);
    if (town.owner !== null) {
      const lord = state.lords[town.owner];
      if (lord) lord.gold += rates.gold * dtMin;
    }
    const grown = growGarrison(town.garrison, town.carry, town.spec, rates.troops, dtMin, rates.cap);
    town.garrison = grown.garrison;
    town.carry = grown.carry;
  }
  for (const [id, rate] of dominionRates(state)) {
    const lord = state.lords[id];
    if (lord) lord.dominion += rate * dtMin;
  }
  state.accruedAt = Math.min(t, state.endsAt);
}

// The projections repeat accrueTo's arithmetic in the same order, so a check made on a projection
// still holds after the real accrual (no float drift below a validated cost).

export function projectedGold(state: GameState, lordId: string, t: number): number {
  const lord = state.lords[lordId];
  if (!lord) return 0;
  const dtMin = elapsedMin(state, t);
  if (dtMin <= 0) return lord.gold;
  const m = lordMods(state, lordId);
  let gold = lord.gold;
  for (const town of state.towns) {
    if (town.owner === lordId) gold += townRates(state, town, m).gold * dtMin;
  }
  return gold;
}

export function projectedDominion(state: GameState, lordId: string, t: number): number {
  const lord = state.lords[lordId];
  if (!lord) return 0;
  const dtMin = elapsedMin(state, t);
  if (dtMin <= 0) return lord.dominion;
  return lord.dominion + (dominionRates(state).get(lordId) ?? 0) * dtMin;
}

export function projectedGarrison(state: GameState, town: Town, t: number): Troops {
  const dtMin = elapsedMin(state, t);
  if (dtMin <= 0) return town.garrison;
  const rates = townRates(state, town);
  return growGarrison(town.garrison, town.carry, town.spec, rates.troops, dtMin, rates.cap).garrison;
}

export function goldRate(state: GameState, lordId: string): number {
  const m = lordMods(state, lordId);
  let rate = 0;
  for (const town of state.towns) if (town.owner === lordId) rate += townRates(state, town, m).gold;
  return rate;
}

/** Null at the maximum tier. */
export function upgradeCost(state: GameState, town: Town): number | null {
  const base = state.config.towns.upgradeCost[town.tier - 1];
  if (base === undefined || town.tier >= state.config.towns.maxTier) return null;
  return base * lordMods(state, town.owner).upgradeCost;
}

export function respecCost(state: GameState, town: Town): number {
  return state.config.towns.respecCostPerTier * town.tier;
}

export function fortification(state: GameState, town: Town): number {
  const cfg = state.config;
  let fort = 1 + cfg.towns.fortPerTier * (town.tier - 1);
  if (town.isCapital) fort *= cfg.towns.capitalFort;
  if (town.isThrone) fort *= cfg.throne.fortMult;
  if (town.owner !== null && !town.isCapital) {
    const capitalId = state.lords[town.owner]?.capitalId;
    const capital = capitalId === null || capitalId === undefined ? undefined : state.towns[capitalId];
    if (capital?.isleId === town.isleId) fort *= cfg.towns.homeIsleFort;
  }
  return fort * lordMods(state, town.owner).fort;
}
