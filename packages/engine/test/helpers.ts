import { defaultConfig, withOverrides, type DeepPartial, type GameConfig } from '@si/config';
import { createGame } from '../src/game';
import { growIsle } from '../src/growth';
import { isleNeighbors } from '../src/world';
import type { GameState, LordInit, Town } from '../src/types';

export const T0 = 1_700_000_000_000;
export const MIN = 60_000;

export function config(patch: DeepPartial<GameConfig> = {}): GameConfig {
  return withOverrides(defaultConfig, patch);
}

export function humans(n: number): LordInit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i + 1}`,
    name: `Human ${i + 1}`,
    color: '#3366cc',
    isBot: false,
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

/** Neutral towns anyone may target on the same isle as `town`, nearest first. */
export function neutralsBeside(state: GameState, town: Town): Town[] {
  const d = (t: Town): number => Math.hypot(t.pos.x - town.pos.x, t.pos.y - town.pos.y);
  return townsOnIsle(state, town.isleId)
    .filter((t) => t.owner === null && t.privateTo === null && !t.isThrone)
    .sort((a, b) => d(a) - d(b) || a.id - b.id);
}

/** Grows the map to at least `count` isles; a season starts with one, but many tests need lanes. */
export function growTo(state: GameState, count: number): void {
  while (state.isles.length < count) growIsle(state, state.accruedAt, []);
}

/** A town on an isle one lane away from `town`'s isle (grown on demand). */
export function townAcrossLane(state: GameState, town: Town): Town {
  growTo(state, 2);
  const isleId = (isleNeighbors(state)[town.isleId] ?? [])[0];
  const target = isleId === undefined ? undefined : townsOnIsle(state, isleId)[0];
  if (!target) throw new Error('no linked isle');
  return target;
}

/** A town on an isle with no lane to `town`'s isle (the map grows until there is one). */
export function townOutOfReach(state: GameState, town: Town): Town {
  for (let tries = 0; tries < 30; tries++) {
    const linked = new Set([town.isleId, ...(isleNeighbors(state)[town.isleId] ?? [])]);
    const target = state.towns.find((t) => !linked.has(t.isleId));
    if (target) return target;
    growIsle(state, state.accruedAt, []);
  }
  throw new Error('every isle is linked');
}

/** A neutral town that anyone may target. */
export function publicNeutral(state: GameState, isleId = 0): Town {
  const target = townsOnIsle(state, isleId).find(
    (t) => t.owner === null && t.privateTo === null && !t.isThrone,
  );
  if (!target) throw new Error('no public neutral town');
  return target;
}

export function give(_state: GameState, town: Town, owner: string | null, garrison: number): void {
  town.owner = owner;
  town.garrison = garrison;
  town.neutralCap = owner === null ? town.neutralCap : 0;
}

export function allTroops(state: GameState): number {
  let sum = 0;
  for (const town of state.towns) sum += town.garrison;
  for (const town of state.towns) for (const s of town.stationed) sum += s.troops;
  for (const m of state.marches) sum += m.troops;
  return sum;
}

export const NO_PRODUCTION: DeepPartial<GameConfig> = {
  towns: { troopsPerMin: 0, goldPerMin: 0 },
};

/** Capitals that can be attacked, for tests about losing one (both presets protect them). */
export const OPEN_CAPITALS: DeepPartial<GameConfig> = { rules: { capitalImmune: false } };

/** Dead troops vanish instead of reappearing in the capital, so tests can count losses plainly. */
export const NO_RECOVERY: DeepPartial<GameConfig> = {
  league: { attackerRecovery: 0, defenderRecovery: 0 },
};
