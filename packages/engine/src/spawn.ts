import { TROOP_TYPES } from '@si/config/constants';
import { isleFull } from './growth';
import { neutralTown, starterSpots } from './mapgen';
import type { GameState, Isle, LordInit, Personality, Town } from './types';
import { foundLord } from './world';

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

/**
 * A new capital on a free shore slot of `isle`, plus `map.spawn.privateTowns` tier-1 neutral towns
 * next to it that only this lord sees and may attack until someone owns them.
 */
export function spawnLord(
  state: GameState,
  init: LordInit,
  isle: Isle,
  personality: Personality | null,
): Town {
  const cfg = state.config;
  const index = bestSlot(isle);
  const slot = isle.slots[index];
  if (!slot) throw new Error('isle without free slots');
  slot.lordId = init.id;
  const spec = TROOP_TYPES[index % TROOP_TYPES.length] ?? 'LANCER';
  const capital = neutralTown(state.towns.length, isle.id, { ...slot.pos }, cfg.lords.capitalTier, spec, cfg);
  state.towns.push(capital);
  isle.townIds.push(capital.id);
  foundLord(state, init, capital, personality);
  starterSpots(cfg, isle, slot.pos, cfg.map.spawn.privateTowns).forEach((pos, k) => {
    const town = neutralTown(
      state.towns.length,
      isle.id,
      pos,
      1,
      TROOP_TYPES[k % TROOP_TYPES.length] ?? spec,
      cfg,
    );
    town.privateTo = init.id;
    state.towns.push(town);
    isle.townIds.push(town.id);
  });
  return capital;
}
