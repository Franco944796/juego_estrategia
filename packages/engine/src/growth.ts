import { MINUTE_MS } from '@si/config/constants';
import { addIsle, type MapParts } from './mapgen';
import { schedule } from './queue';
import type { DomainEvent, GameState, Isle } from './types';

const DAY_MS = 24 * 60 * MINUTE_MS;

export function isleFull(isle: Isle): boolean {
  return isle.slots.every((slot) => slot.lordId !== null);
}

/** Every town anyone can target has an owner; private starter towns do not hold the isle back. */
export function isleConquered(state: GameState, isle: Isle): boolean {
  return isle.townIds.every((id) => {
    const town = state.towns[id];
    return !town || town.owner !== null || town.privateTo !== null;
  });
}

export function growIsle(state: GameState, at: number, events: DomainEvent[]): Isle {
  // A fresh lanes array: the isle adjacency cache is keyed by it.
  const parts: MapParts = {
    isles: state.isles,
    towns: state.towns,
    zones: state.zones,
    lanes: [...state.lanes],
  };
  const isle = addIsle(state.config, state.rng, parts, state.mapSpin, at);
  state.lanes = parts.lanes;
  events.push({ type: 'MAP_EXPANDED', at, isleIds: [isle.id] });
  return isle;
}

/**
 * A new isle is born when the newest one is full or fully conquered, at most `maxPerDay` in 24 game
 * hours (the first isle does not count). Over the cap, a check is scheduled for when a slot frees up.
 */
export function checkGrowth(state: GameState, at: number, events: DomainEvent[]): void {
  const newest = state.isles[state.isles.length - 1];
  if (!newest || !(isleFull(newest) || isleConquered(state, newest))) return;
  const recent = state.isles.filter((isle) => isle.id > 0 && isle.bornAt > at - DAY_MS);
  if (recent.length < state.config.map.growth.maxPerDay) {
    growIsle(state, at, events);
    return;
  }
  if (state.growCheckAt !== null || recent.length === 0) return;
  const due = Math.min(...recent.map((isle) => isle.bornAt)) + DAY_MS;
  if (due >= state.endsAt) return;
  state.growCheckAt = due;
  schedule(state, due, { kind: 'GROW_CHECK' });
}
