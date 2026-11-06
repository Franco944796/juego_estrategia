import { MINUTE_MS } from '@si/config/constants';
import { distance } from './geometry';
import { lordMods, ownedCounts, type LordMods } from './modifiers';
import type { GameConfig, GameState, Town } from './types';

const exponents = new WeakMap<GameConfig, number>();

/**
 * Multiplier of everything that grows with the level: 1 at level 1, `scale.second` at level 2 and
 * `scale.top` at maxTier. Its logarithm grows as (level - 1) ^ p with p < 1, so early levels jump most.
 */
export function levelScale(cfg: GameConfig, level: number): number {
  const { second, top } = cfg.towns.scale;
  const a = Math.log10(second);
  let p = exponents.get(cfg);
  if (p === undefined) {
    const span = cfg.towns.maxTier - 1;
    p = span > 1 ? Math.log(Math.log10(top) / a) / Math.log(span) : 1;
    exponents.set(cfg, p);
  }
  return 10 ** (a * Math.max(0, level - 1) ** p);
}

/** Two significant digits, so wall values read as round numbers (20, 50, 92, 160…). */
function roundish(value: number): number {
  if (value < 100) return Math.round(value);
  const unit = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / unit) * unit;
}

/** `mult` is the owner's wall bonus (helmets). */
export function wallsAt(cfg: GameConfig, level: number, mult = 1): number {
  return roundish(cfg.towns.walls * levelScale(cfg, level) * mult);
}

export function plunderAt(cfg: GameConfig, level: number): number {
  return cfg.plunder.base * levelScale(cfg, level);
}

export interface TownRates {
  gold: number;
  troops: number;
  /** Neutral towns regenerate up to their starting garrison; owned towns never stop. */
  cap: number;
}

export function beaconLitFor(state: GameState, town: Town): boolean {
  const zone = town.zoneId === null ? undefined : state.zones[town.zoneId];
  return !!zone && zone.beaconOwner !== null && zone.beaconOwner === town.owner;
}

export function townRates(state: GameState, town: Town, mods?: LordMods): TownRates {
  const cfg = state.config;
  const scale = levelScale(cfg, town.tier);
  const base = cfg.towns.troopsPerMin * scale;
  if (town.owner === null) {
    const troops = town.neutralCap > 0 ? base * cfg.neutral.regenMult : 0;
    return { gold: 0, troops, cap: town.neutralCap };
  }
  const m = mods ?? lordMods(state, town.owner);
  let mult = 1;
  if (town.isCapital) mult *= cfg.towns.capitalProdMult;
  if (beaconLitFor(state, town)) mult *= 1 + cfg.beacon.prodBonus;
  return {
    gold: cfg.towns.goldPerMin * scale * mult * m.goldProd * m.sprawl,
    troops: base * mult * m.troopProd * m.sprawl,
    cap: Infinity,
  };
}

/** Production pauses at the cap; reinforcements may still push a garrison above it. */
export function growGarrison(
  garrison: number,
  carry: number,
  ratePerMin: number,
  dtMin: number,
  cap: number,
): { garrison: number; carry: number } {
  if (garrison >= cap) return { garrison, carry: 0 };
  if (ratePerMin <= 0 || dtMin <= 0) return { garrison, carry };
  const amount = carry + ratePerMin * dtMin;
  let add = Math.floor(amount);
  let rest = amount - add;
  if (garrison + add >= cap) {
    add = cap - garrison;
    rest = 0;
  }
  return { garrison: garrison + add, carry: rest };
}

export function dominionRates(state: GameState): Map<string, number> {
  const cfg = state.config;
  const rates = new Map<string, number>();
  const bump = (id: string, value: number): void => {
    rates.set(id, (rates.get(id) ?? 0) + value);
  };
  for (const town of state.towns) {
    if (town.owner !== null) bump(town.owner, cfg.dominion.perTier * town.tier);
  }
  for (const zone of state.zones) {
    if (zone.beaconOwner !== null) bump(zone.beaconOwner, cfg.beacon.dominionPerMin);
  }
  const throne = state.throneTownId === null ? undefined : state.towns[state.throneTownId];
  if (throne?.owner) bump(throne.owner, cfg.throne.dominionPerMin);
  for (const [id, rate] of rates) rates.set(id, rate * lordMods(state, id).dominion);
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
  const owned = ownedCounts(state);
  for (const town of state.towns) {
    let m: LordMods | undefined;
    if (town.owner !== null) {
      m = mods.get(town.owner) ?? lordMods(state, town.owner, owned.get(town.owner) ?? 0);
      mods.set(town.owner, m);
    }
    const rates = townRates(state, town, m);
    if (town.owner !== null) {
      const lord = state.lords[town.owner];
      if (lord) lord.gold += rates.gold * dtMin;
    }
    const grown = growGarrison(town.garrison, town.carry, rates.troops, dtMin, rates.cap);
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

export function projectedGarrison(state: GameState, town: Town, t: number): number {
  const dtMin = elapsedMin(state, t);
  if (dtMin <= 0) return town.garrison;
  const rates = townRates(state, town);
  return growGarrison(town.garrison, town.carry, rates.troops, dtMin, rates.cap).garrison;
}

export function goldRate(state: GameState, lordId: string): number {
  const m = lordMods(state, lordId);
  let rate = 0;
  for (const town of state.towns) if (town.owner === lordId) rate += townRates(state, town, m).gold;
  return rate;
}

/** Cost of the next level; null at the maximum level. */
export function upgradeCost(state: GameState, town: Town): number | null {
  return upgradeCostAt(state.config, town.tier);
}

export function upgradeCostAt(cfg: GameConfig, tier: number): number | null {
  if (tier >= cfg.towns.maxTier) return null;
  return cfg.towns.upgradeCost * levelScale(cfg, tier);
}

/** How many of the next `maxLevels` levels `gold` pays for, one after another, and their total cost. */
export function upgradePlan(
  cfg: GameConfig,
  tier: number,
  gold: number,
  maxLevels: number,
): { levels: number; cost: number } {
  let levels = 0;
  let cost = 0;
  while (levels < maxLevels) {
    const next = upgradeCostAt(cfg, tier + levels);
    if (next === null || cost + next > gold) break;
    cost += next;
    levels++;
  }
  return { levels, cost };
}

export function townWalls(state: GameState, town: Town, ownerMods?: LordMods): number {
  return wallsAt(state.config, town.tier, (ownerMods ?? lordMods(state, town.owner)).walls);
}

export function fortification(state: GameState, town: Town): number {
  const cfg = state.config;
  let fort = 1 + cfg.towns.fortPerTier * (town.tier - 1);
  if (town.isCapital) fort *= cfg.towns.capitalFort;
  if (town.isThrone) fort *= cfg.throne.fortMult;
  if (town.owner !== null && !town.isCapital) {
    const capitalId = state.lords[town.owner]?.capitalId;
    const capital = capitalId === null || capitalId === undefined ? undefined : state.towns[capitalId];
    if (capital && distance(capital.pos, town.pos) <= cfg.towns.homeRadius) fort *= cfg.towns.homeFort;
  }
  return fort;
}
