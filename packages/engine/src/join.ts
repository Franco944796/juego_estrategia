import { PERSONALITIES } from '@si/config/constants';
import { accrueTo } from './economy';
import { advanceTo, scheduleFirstBotTurn } from './game';
import { checkGrowth } from './growth';
import { pick } from './rng';
import { openIsle, spawnLord } from './spawn';
import type { DomainEvent, GameState, LordInit, RuleError } from './types';
import { getLord } from './world';

export type JoinResult =
  | { ok: true; townId: number; events: DomainEvent[] }
  | { ok: false; error: RuleError; events: DomainEvent[] };

/**
 * A lord entering a running season appears on a free shore slot of the newest open isle. When every
 * isle is full and today's isles are spent, the world is full until the next one is born.
 */
export function joinLord(state: GameState, init: LordInit, now: number): JoinResult {
  const events = advanceTo(state, now);
  const at = Math.max(now, state.accruedAt);
  if (getLord(state, init.id)) {
    return {
      ok: false,
      error: { rule: 'R14', code: 'DUPLICATE_LORD', message: 'lord already joined' },
      events,
    };
  }
  if (state.status !== 'RUNNING' || at < state.startsAt || at >= state.endsAt) {
    return {
      ok: false,
      error: { rule: 'R02', code: 'SEASON_CLOSED', message: 'the season is not running' },
      events,
    };
  }
  const isle = openIsle(state);
  if (!isle) {
    return {
      ok: false,
      error: { rule: 'R02', code: 'WORLD_FULL', message: 'every isle is full; a new one is born soon' },
      events,
    };
  }
  // Settled only once the join is accepted: rejected joins are not logged, so replays never see them.
  accrueTo(state, at);
  const personality = init.isBot ? (init.personality ?? pick(state.rng, PERSONALITIES)) : null;
  const town = spawnLord(state, init, isle, personality);
  if (init.isBot) scheduleFirstBotTurn(state, init.id, at);
  events.push({ type: 'LORD_JOINED', at, lordId: init.id, townId: town.id });
  checkGrowth(state, at, events);
  return { ok: true, townId: town.id, events };
}

/** Cosmetic only; unknown styles are ignored. */
export function setStyle(state: GameState, lordId: string, style: string, at: number): DomainEvent[] {
  const lord = getLord(state, lordId);
  if (!lord || !state.config.cosmetics.styles.some((s) => s.id === style)) return [];
  lord.style = style;
  return [{ type: 'STYLE_CHANGED', at, lordId, style }];
}
