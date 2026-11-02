import { distance } from './geometry';
import { isleFull } from './growth';
import { neutralTown, starterSpots } from './mapgen';
import { pick } from './rng';
import type { DomainEvent, GameState, Isle, LordInit, Personality, Town, Vec } from './types';
import { foundLord, recomputeZone } from './world';

/** Newest isle with a free shore slot, so newcomers land where neutral towns are left. */
export function openIsle(state: GameState): Isle | undefined {
  for (let i = state.isles.length - 1; i >= 0; i--) {
    const isle = state.isles[i];
    if (isle && !isleFull(isle)) return isle;
  }
  return undefined;
}

/** The free slot farthest (around the shore) from the taken ones; lowest index on ties. */
function bestSlot(isle: Isle): number {
  const n = isle.slots.length;
  const taken = isle.slots.flatMap((slot, i) => (slot.lordId === null ? [] : [i]));
  let best = -1;
  let bestGap = -1;
  isle.slots.forEach((slot, i) => {
    if (slot.lordId !== null) return;
    const gap = Math.min(n, ...taken.map((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j))));
    if (gap > bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

/** Takes a town out of its zone: capitals and private starter towns belong to none. */
function leaveZone(state: GameState, town: Town, at: number, events: DomainEvent[]): void {
  const zone = town.zoneId === null ? undefined : state.zones[town.zoneId];
  town.zoneId = null;
  if (!zone) return;
  zone.townIds = zone.townIds.filter((id) => id !== town.id);
  recomputeZone(state, zone.id, at, events);
}

function publicNeutrals(state: GameState, isle: Isle): Town[] {
  return isle.townIds.flatMap((id) => {
    const town = state.towns[id];
    return town && town.owner === null && town.privateTo === null && !town.isThrone ? [town] : [];
  });
}

/**
 * A random neutral town among the `map.spawn.farShare` farthest from the isle's capitals becomes the
 * new lord's capital, and its `map.spawn.privateTowns` nearest neutral neighbors become level-1 towns
 * only this lord sees and may attack until someone owns them.
 */
function spawnInland(
  state: GameState,
  init: LordInit,
  isle: Isle,
  personality: Personality | null,
  at: number,
  events: DomainEvent[],
): Town | null {
  const cfg = state.config;
  const candidates = publicNeutrals(state, isle);
  if (candidates.length === 0) return null;
  const capitals = isle.townIds.flatMap((id) =>
    state.towns[id]?.isCapital ? [state.towns[id] as Town] : [],
  );
  const room = (t: Town): number => Math.min(...capitals.map((c) => distance(c.pos, t.pos)));
  const ranked = [...candidates].sort((a, b) => room(b) - room(a) || a.id - b.id);
  // The first lord of an isle may land anywhere; the next ones away from the others.
  const far =
    capitals.length === 0
      ? candidates
      : ranked.slice(0, Math.max(1, Math.ceil(ranked.length * cfg.map.spawn.farShare)));
  const capital = pick(state.rng, far);
  leaveZone(state, capital, at, events);
  foundLord(state, init, capital, personality);
  const neighbors = publicNeutrals(state, isle)
    .sort((a, b) => distance(a.pos, capital.pos) - distance(b.pos, capital.pos) || a.id - b.id)
    .slice(0, cfg.map.spawn.privateTowns);
  for (const town of neighbors) {
    leaveZone(state, town, at, events);
    const fresh = neutralTown(town.id, town.isleId, town.pos, 1, cfg);
    Object.assign(town, { ...fresh, privateTo: init.id });
  }
  return capital;
}

/**
 * Places a new lord on `isle`, taking one of its shore slots (they count how many lords an isle
 * holds). The capital is an inland neutral town; only with none left does it go on the shore slot.
 */
export function spawnLord(
  state: GameState,
  init: LordInit,
  isle: Isle,
  personality: Personality | null,
  at: number,
  events: DomainEvent[],
): Town {
  const index = bestSlot(isle);
  const slot = isle.slots[index];
  if (!slot) throw new Error('isle without free slots');
  slot.lordId = init.id;
  return (
    spawnInland(state, init, isle, personality, at, events) ??
    spawnOnShore(state, init, isle, slot.pos, personality)
  );
}

/** The old way, kept for an isle with no neutral town left: a new capital on the shore slot. */
function spawnOnShore(
  state: GameState,
  init: LordInit,
  isle: Isle,
  at: Vec,
  personality: Personality | null,
): Town {
  const cfg = state.config;
  const capital = neutralTown(state.towns.length, isle.id, { ...at }, cfg.lords.capitalTier, cfg);
  state.towns.push(capital);
  isle.townIds.push(capital.id);
  foundLord(state, init, capital, personality);
  for (const pos of starterSpots(cfg, isle, at, cfg.map.spawn.privateTowns)) {
    const town = neutralTown(state.towns.length, isle.id, pos, 1, cfg);
    town.privateTo = init.id;
    state.towns.push(town);
    isle.townIds.push(town.id);
  }
  return capital;
}
