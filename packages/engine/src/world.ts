import { levelScale } from './economy';
import { dropItem } from './gear';
import { checkGrowth } from './growth';
import { pick } from './rng';
import type { DomainEvent, GameState, Lord, LordInit, Personality, Town } from './types';

/** Turns `town` into the capital of a new lord and registers the lord. */
export function foundLord(
  state: GameState,
  init: LordInit,
  town: Town,
  personality: Personality | null,
): Lord {
  const cfg = state.config;
  town.owner = init.id;
  town.tier = cfg.lords.capitalTier;
  town.isCapital = true;
  town.neutralCap = 0;
  town.carry = 0;
  town.garrison = cfg.lords.startTroops;
  const lord: Lord = {
    id: init.id,
    name: init.name,
    color: init.color,
    isBot: init.isBot,
    personality,
    gold: cfg.lords.startGold,
    dominion: 0,
    skills: { GOLD: 0, TROOPS: 0, ATTACK: 0 },
    items: (init.items ?? []).map((item) => ({ id: item.id, slot: item.slot, rarity: item.rarity })),
    gear: {},
    capitalId: town.id,
    alive: true,
    exiles: 0,
    stats: { captures: 0, townsLost: 0, battlesWon: 0, battlesLost: 0, troopsKilled: 0, troopsLost: 0 },
    style: init.style ?? cfg.cosmetics.styles[0]?.id ?? '',
    clanId: init.clanId ?? null,
    level: 1,
    xp: 0,
  };
  // Only owned items in their own slot can be worn.
  for (const [slot, id] of Object.entries(init.gear ?? {})) {
    const item = lord.items.find((owned) => owned.id === id);
    if (item && item.slot === slot) lord.gear[item.slot] = item.id;
  }
  state.lords[init.id] = lord;
  state.lordOrder.push(init.id);
  return lord;
}

export function getLord(state: GameState, lordId: string): Lord | undefined {
  return Object.prototype.hasOwnProperty.call(state.lords, lordId) ? state.lords[lordId] : undefined;
}

export function getTown(state: GameState, townId: number): Town | undefined {
  return Number.isInteger(townId) ? state.towns[townId] : undefined;
}

export function townsOf(state: GameState, lordId: string): Town[] {
  return state.towns.filter((town) => town.owner === lordId);
}

const adjacencyCache = new WeakMap<GameState['lanes'], number[][]>();

/** Isle adjacency lists, cached per lanes array (growth replaces the array instead of mutating it). */
export function isleNeighbors(state: GameState): number[][] {
  const cached = adjacencyCache.get(state.lanes);
  if (cached) return cached;
  const adj: number[][] = state.isles.map(() => []);
  for (const lane of state.lanes) {
    adj[lane.a]?.push(lane.b);
    adj[lane.b]?.push(lane.a);
  }
  adjacencyCache.set(state.lanes, adj);
  return adj;
}

export function islesLinked(state: GameState, a: number, b: number): boolean {
  return a === b || (isleNeighbors(state)[a]?.includes(b) ?? false);
}

/** Towns a march from `from` may target: same isle or an isle one lane away. */
export function reachableTowns(state: GameState, from: Town): Town[] {
  const isles = [from.isleId, ...(isleNeighbors(state)[from.isleId] ?? [])];
  const result: Town[] = [];
  for (const isleId of isles) {
    for (const townId of state.isles[isleId]?.townIds ?? []) {
      if (townId !== from.id) result.push(state.towns[townId] as Town);
    }
  }
  return result;
}

/** A zone's beacon is lit for the lord who owns every town in it. */
export function recomputeZone(
  state: GameState,
  zoneId: number | null,
  at: number,
  events: DomainEvent[],
): void {
  const zone = zoneId === null ? undefined : state.zones[zoneId];
  if (!zone) return;
  const owners = zone.townIds.map((id) => state.towns[id]?.owner ?? null);
  const first = owners[0] ?? null;
  const lit = first !== null && owners.every((owner) => owner === first) ? first : null;
  if (lit !== zone.beaconOwner) {
    zone.beaconOwner = lit;
    events.push({ type: 'BEACON_CHANGED', at, zoneId: zone.id, owner: lit });
  }
}

/** The highest-tier town (lowest id on ties) becomes the capital; the Throne never does. */
function moveCapital(state: GameState, lord: Lord, at: number, events: DomainEvent[]): void {
  let best: Town | null = null;
  for (const town of state.towns) {
    if (town.owner !== lord.id || town.isThrone) continue;
    if (best === null || town.tier > best.tier) best = town;
  }
  for (const town of state.towns) if (town.owner === lord.id) town.isCapital = false;
  if (best) best.isCapital = true;
  lord.capitalId = best ? best.id : null;
  events.push({ type: 'CAPITAL_MOVED', at, lordId: lord.id, townId: lord.capitalId });
}

export function setOwner(
  state: GameState,
  town: Town,
  newOwner: string,
  at: number,
  events: DomainEvent[],
): void {
  const previous = town.owner;
  town.owner = newOwner;
  town.carry = 0;
  town.stationed = [];
  town.neutralCap = 0;
  town.privateTo = null;
  const wasCapital = town.isCapital;
  town.isCapital = false;
  events.push({ type: 'TOWN_CAPTURED', at, townId: town.id, from: previous, to: newOwner });

  if (previous !== null) {
    const loser = getLord(state, previous);
    if (loser) {
      loser.stats.townsLost++;
      if (wasCapital) moveCapital(state, loser, at, events);
    }
  }
  const winner = getLord(state, newOwner);
  if (winner && winner.capitalId === null && !town.isThrone) {
    town.isCapital = true;
    winner.capitalId = town.id;
    events.push({ type: 'CAPITAL_MOVED', at, lordId: winner.id, townId: town.id });
  }
  recomputeZone(state, town.zoneId, at, events);
  checkGrowth(state, at, events);
}

/**
 * A lord with no towns and no marches in flight restarts on a free neutral town (newest isle first,
 * lowest tier), or is eliminated when none is left.
 */
export function checkExile(state: GameState, lordId: string, at: number, events: DomainEvent[]): void {
  const lord = getLord(state, lordId);
  if (!lord || !lord.alive) return;
  if (state.towns.some((town) => town.owner === lordId)) return;
  if (state.marches.some((march) => march.owner === lordId)) return;

  if (state.config.exile.enabled) {
    const neutral = state.towns.filter(
      (town) => town.owner === null && !town.isThrone && town.privateTo === null,
    );
    if (neutral.length > 0) {
      const newest = Math.max(...neutral.map((town) => town.isleId));
      const free = neutral.filter((town) => town.isleId === newest);
      const minTier = Math.min(...free.map((town) => town.tier));
      const town = pick(
        state.rng,
        free.filter((t) => t.tier === minTier),
      );
      town.owner = lordId;
      town.garrison = state.config.exile.troops;
      town.carry = 0;
      town.neutralCap = 0;
      town.isCapital = true;
      lord.capitalId = town.id;
      lord.exiles++;
      events.push({ type: 'LORD_EXILED', at, lordId, townId: town.id });
      recomputeZone(state, town.zoneId, at, events);
      checkGrowth(state, at, events);
      return;
    }
  }
  lord.alive = false;
  lord.capitalId = null;
  events.push({ type: 'LORD_ELIMINATED', at, lordId });
}

/** Two different lords in the same clan. */
export function areAllies(state: GameState, a: string | null, b: string | null): boolean {
  if (a === null || b === null || a === b) return false;
  const clan = getLord(state, a)?.clanId ?? null;
  return clan !== null && clan === (getLord(state, b)?.clanId ?? null);
}

/** Fills fields added after a state was saved (older demo saves and server snapshots). */
export function migrateState(state: GameState): GameState {
  for (const town of state.towns) town.stationed ??= [];
  for (const id of state.lordOrder) {
    const lord = state.lords[id];
    if (!lord) continue;
    lord.clanId ??= null;
    lord.level ??= 1;
    lord.xp ??= 0;
    lord.style ??= state.config.cosmetics.styles[0]?.id ?? '';
  }
  for (const report of state.reports) report.allies ??= [];
  return state;
}

/**
 * League rule: part of a lord's dead troops reappear at once in its capital, or in its highest-level
 * town without one. Returns how many were placed (none when the lord holds no town).
 */
export function recoverTroops(state: GameState, lordId: string, lost: number, share: number): number {
  const amount = Math.floor(lost * share);
  if (amount <= 0) return 0;
  const lord = getLord(state, lordId);
  let home =
    lord?.capitalId === null || lord?.capitalId === undefined ? undefined : state.towns[lord.capitalId];
  if (!home) {
    for (const town of state.towns) {
      if (town.owner === lordId && (!home || town.tier > home.tier)) home = town;
    }
  }
  if (!home) return 0;
  home.garrison += amount;
  return amount;
}

/** Experience needed to go from `level` to the next one; it grows with the town level scale. */
export function xpForLevel(state: GameState, level: number): number {
  return Math.round(state.config.levels.xpBase * levelScale(state.config, level));
}

/** Adds battle experience; each level reached is a skill point, and every few levels an item. */
export function gainXp(state: GameState, lord: Lord, xp: number, at: number, events: DomainEvent[]): void {
  const cfg = state.config.levels;
  lord.xp += xp;
  while (lord.level < cfg.maxLevel && lord.xp >= xpForLevel(state, lord.level)) {
    lord.xp -= xpForLevel(state, lord.level);
    lord.level++;
    events.push({ type: 'LEVEL_UP', at, lordId: lord.id, level: lord.level });
    if (lord.level % state.config.gear.dropEveryLevels === 0) dropItem(state, lord, lord.level, at, events);
  }
  if (lord.level >= cfg.maxLevel) lord.xp = 0;
}
