import { EDICT_IDS } from '@si/config/constants';
import { pick, shuffle } from './rng';
import { cloneTroops } from './troops';
import type { DomainEvent, EdictId, GameState, Lord, LordInit, Personality, Town } from './types';

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
  town.spec = init.spec ?? (personality ? cfg.bots.personalities[personality].preferredSpec : town.spec);
  town.garrison = cloneTroops(cfg.lords.startTroops);
  const lord: Lord = {
    id: init.id,
    name: init.name,
    color: init.color,
    isBot: init.isBot,
    personality,
    gold: cfg.lords.startGold,
    dominion: 0,
    glory: 0,
    edicts: [],
    draft: null,
    draftsOpened: 0,
    capitalId: town.id,
    alive: true,
    exiles: 0,
    stats: { captures: 0, townsLost: 0, battlesWon: 0, battlesLost: 0, troopsKilled: 0, troopsLost: 0 },
    style: init.style ?? cfg.cosmetics.styles[0]?.id ?? '',
  };
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

/** Isle adjacency lists, cached per lanes array (the lanes never change during a season). */
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

export function recomputeBeacon(state: GameState, isleId: number, at: number, events: DomainEvent[]): void {
  const isle = state.isles[isleId];
  if (!isle || !isle.hasBeacon) return;
  const owners = isle.townIds.map((id) => state.towns[id]?.owner ?? null);
  const first = owners[0] ?? null;
  const lit = first !== null && owners.every((owner) => owner === first) ? first : null;
  if (lit !== isle.beaconOwner) {
    isle.beaconOwner = lit;
    events.push({ type: 'BEACON_CHANGED', at, isleId, owner: lit });
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
  town.neutralCap = 0;
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
  recomputeBeacon(state, town.isleId, at, events);
}

/**
 * A lord with no towns and no marches in flight restarts on a free neutral town (outermost ring
 * first, lowest tier), or is eliminated when none is left.
 */
export function checkExile(state: GameState, lordId: string, at: number, events: DomainEvent[]): void {
  const lord = getLord(state, lordId);
  if (!lord || !lord.alive) return;
  if (state.towns.some((town) => town.owner === lordId)) return;
  if (state.marches.some((march) => march.owner === lordId)) return;

  if (state.config.exile.enabled) {
    const ringOf = (town: Town): number => state.isles[town.isleId]?.ring ?? 0;
    const neutral = state.towns.filter((town) => town.owner === null && !town.isThrone);
    if (neutral.length > 0) {
      const outermost = Math.max(...neutral.map(ringOf));
      const free = neutral.filter((town) => ringOf(town) === outermost);
      const minTier = Math.min(...free.map((town) => town.tier));
      const town = pick(
        state.rng,
        free.filter((t) => t.tier === minTier),
      );
      town.owner = lordId;
      town.garrison = cloneTroops(state.config.exile.troops);
      town.carry = 0;
      town.neutralCap = 0;
      town.isCapital = true;
      lord.capitalId = town.id;
      lord.exiles++;
      events.push({ type: 'LORD_EXILED', at, lordId, townId: town.id });
      recomputeBeacon(state, town.isleId, at, events);
      return;
    }
  }
  lord.alive = false;
  lord.capitalId = null;
  lord.draft = null;
  events.push({ type: 'LORD_ELIMINATED', at, lordId });
}

export function chooseEdict(
  state: GameState,
  lord: Lord,
  edict: EdictId,
  at: number,
  events: DomainEvent[],
): void {
  lord.edicts.push(edict);
  lord.draft = null;
  events.push({ type: 'EDICT_CHOSEN', at, lordId: lord.id, edict });
  openDrafts(state, lord, at, events);
}

/** Opens one draft per glory threshold crossed; bots pick at once by their preference list. */
export function openDrafts(state: GameState, lord: Lord, at: number, events: DomainEvent[]): void {
  const { gloryThresholds, draftSize } = state.config.edicts;
  while (lord.alive && lord.draft === null && lord.draftsOpened < gloryThresholds.length) {
    const threshold = gloryThresholds[lord.draftsOpened] ?? Infinity;
    if (lord.glory < threshold) return;
    lord.draftsOpened++;
    const pool = EDICT_IDS.filter((id) => !lord.edicts.includes(id));
    if (pool.length === 0) return;
    const options = shuffle(state.rng, [...pool]).slice(0, draftSize);
    lord.draft = options;
    events.push({ type: 'EDICT_DRAFT', at, lordId: lord.id, options });
    if (lord.isBot && lord.personality) {
      const prefs = state.config.bots.personalities[lord.personality].edictPreference;
      const choice = prefs.find((id) => options.includes(id)) ?? (options[0] as EdictId);
      chooseEdict(state, lord, choice, at, events);
      return;
    }
  }
}
