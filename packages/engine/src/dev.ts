import { accrueTo } from './economy';
import { advanceTo } from './game';
import type { DomainEvent, GameState } from './types';
import { gainXp, getLord, xpForLevel } from './world';

/** Helpers for test accounts; the server logs every one, so a replay repeats it. */
export type DevAction =
  | { type: 'ENABLE'; on: boolean }
  | { type: 'TROOPS'; townId: number; amount: number }
  | { type: 'LEVELS'; levels: number };

/** Above ~9·10¹⁵ troops lose units to float precision. */
export const DEV_MAX_TROOPS = 1e15;

function parseDev(input: unknown): DevAction | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as Record<string, unknown>;
  const whole = (v: unknown, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
  if (a.type === 'ENABLE' && typeof a.on === 'boolean') return { type: 'ENABLE', on: a.on };
  if (a.type === 'TROOPS' && typeof a.townId === 'number' && whole(a.amount, DEV_MAX_TROOPS)) {
    return { type: 'TROOPS', townId: a.townId, amount: a.amount };
  }
  if (a.type === 'LEVELS' && whole(a.levels, 1000)) return { type: 'LEVELS', levels: a.levels };
  return null;
}

/**
 * A test lord (`Lord.dev`) upgrades towns for free (see commands.ts), may add troops and levels here,
 * and stays out of the standings, so it earns no Legacy, medals or league moves.
 */
export function devAction(
  state: GameState,
  lordId: string,
  input: unknown,
  now: number,
): { ok: boolean; events: DomainEvent[] } {
  const events = advanceTo(state, now);
  const at = Math.max(now, state.accruedAt);
  const lord = getLord(state, lordId);
  const action = parseDev(input);
  if (!lord || !action) return { ok: false, events };
  accrueTo(state, at);
  if (action.type === 'ENABLE') {
    lord.dev = action.on;
    return { ok: true, events };
  }
  if (!lord.dev) return { ok: false, events };
  if (action.type === 'TROOPS') {
    const town = state.towns[action.townId];
    if (town?.owner !== lordId) return { ok: false, events };
    town.garrison = Math.min(DEV_MAX_TROOPS, town.garrison + action.amount);
    return { ok: true, events };
  }
  const max = state.config.levels.maxLevel;
  let need = -lord.xp;
  for (let k = 0; k < action.levels && lord.level + k < max; k++) need += xpForLevel(state, lord.level + k);
  if (need > 0) gainXp(state, lord, need, at, events);
  return { ok: true, events };
}
