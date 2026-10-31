import { defaultConfig, withOverrides, type DeepPartial, type GameConfig } from '@si/config';
import { createGame } from '../src/game';
import { isleNeighbors } from '../src/world';
import type { GameState, LordInit, Town, Troops, TroopType } from '../src/types';

export const T0 = 1_700_000_000_000;
export const MIN = 60_000;

export function config(patch: DeepPartial<GameConfig> = {}): GameConfig {
  return withOverrides(defaultConfig, patch);
}

export function humans(n: number, spec: TroopType = 'LANCER'): LordInit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i + 1}`,
    name: `Human ${i + 1}`,
    color: '#3366cc',
    isBot: false,
    spec,
  }));
}

export function bots(n: number): LordInit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    name: `Bot ${i + 1}`,
    color: '#cc3333',
    isBot: true,
  }));
}

export function game(
  opts: { seed?: number; lords?: LordInit[]; config?: DeepPartial<GameConfig> } = {},
): GameState {
  return createGame({
    seed: opts.seed ?? 7,
    config: config(opts.config),
    startsAt: T0,
    lords: opts.lords ?? humans(2),
  });
}

export function troops(LANCER: number, ARCHER = 0, GRIFFIN = 0): Troops {
  return { LANCER, ARCHER, GRIFFIN };
}

export function capitalOf(state: GameState, lordId: string): Town {
  const id = state.lords[lordId]?.capitalId;
  const town = id === null || id === undefined ? undefined : state.towns[id];
  if (!town) throw new Error(`${lordId} has no capital`);
  return town;
}

export function lord(state: GameState, lordId: string) {
  const l = state.lords[lordId];
  if (!l) throw new Error(`unknown lord ${lordId}`);
  return l;
}

export function townsOnIsle(state: GameState, isleId: number): Town[] {
  return (state.isles[isleId]?.townIds ?? []).map((id) => state.towns[id] as Town);
}

/** Neutral towns on the same isle as `town`. */
export function neutralsBeside(state: GameState, town: Town): Town[] {
  return townsOnIsle(state, town.isleId).filter((t) => t.owner === null);
}

/** A town on an isle one lane away from `town`'s isle (never the Throne isle). */
export function townAcrossLane(state: GameState, town: Town): Town {
  const isleId = (isleNeighbors(state)[town.isleId] ?? []).find((id) => id !== 0);
  const target = isleId === undefined ? undefined : townsOnIsle(state, isleId)[0];
  if (!target) throw new Error('no linked isle');
  return target;
}

/** A town on an isle with no lane to `town`'s isle. */
export function townOutOfReach(state: GameState, town: Town): Town {
  const linked = new Set([town.isleId, ...(isleNeighbors(state)[town.isleId] ?? [])]);
  const target = state.towns.find((t) => !linked.has(t.isleId));
  if (!target) throw new Error('every isle is linked');
  return target;
}

/** A town on an inner-ring isle, which always has a lane to the Throne isle. */
export function innerRingTown(state: GameState): Town {
  const target = state.towns.find((t) => state.isles[t.isleId]?.ring === 1);
  if (!target) throw new Error('no inner ring');
  return target;
}

export function give(_state: GameState, town: Town, owner: string | null, garrison: Troops): void {
  town.owner = owner;
  town.garrison = garrison;
  town.neutralCap = owner === null ? town.neutralCap : 0;
}

export function allTroops(state: GameState): number {
  let sum = 0;
  for (const town of state.towns) sum += town.garrison.LANCER + town.garrison.ARCHER + town.garrison.GRIFFIN;
  for (const m of state.marches) sum += m.troops.LANCER + m.troops.ARCHER + m.troops.GRIFFIN;
  return sum;
}

export const NO_PRODUCTION: DeepPartial<GameConfig> = {
  towns: { troopsPerMin: [0, 0, 0, 0, 0], goldPerMin: [0, 0, 0, 0, 0] },
};
