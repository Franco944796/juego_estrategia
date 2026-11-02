import { projectedGarrison, townWalls } from './economy';
import { lordMods } from './modifiers';
import type { GameState } from './types';
import { areAllies } from './world';

/** A lord's power at time `t`: every troop it has (in towns, stationed, marching) plus its walls. */
export function lordPower(state: GameState, lordId: string, t = state.accruedAt): number {
  const mods = lordMods(state, lordId);
  let power = 0;
  for (const town of state.towns) {
    if (town.owner === lordId) power += projectedGarrison(state, town, t) + townWalls(state, town, mods);
    for (const s of town.stationed) if (s.lordId === lordId) power += s.troops;
  }
  for (const m of state.marches) if (m.owner === lordId) power += m.troops;
  return power;
}

/**
 * Experience multiplier for kills made attacking `defenderId`, from its power over the attacker's:
 * 0 means it may not be attacked at all. Neutral towns and allies are always ×1.
 */
export function xpMultiplier(
  state: GameState,
  attackerId: string,
  defenderId: string | null,
  t = state.accruedAt,
  /** Attacker troops not in the state any more (a march that just arrived). */
  inFlight = 0,
): number {
  if (defenderId === null || defenderId === attackerId || areAllies(state, attackerId, defenderId)) return 1;
  const cfg = state.config.power;
  const mine = lordPower(state, attackerId, t) + inFlight;
  const ratio = mine > 0 ? lordPower(state, defenderId, t) / mine : Infinity;
  if (ratio >= cfg.doubleFrom) return cfg.highXp;
  if (ratio >= cfg.halfBelow) return 1;
  if (ratio >= cfg.forbidBelow) return cfg.lowXp;
  return 0;
}
