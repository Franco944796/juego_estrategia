import { PERSONALITIES } from '@si/config/constants';
import { accrueTo } from './economy';
import { advanceTo, scheduleFirstBotTurn } from './game';
import { addRing, buildLanes } from './mapgen';
import { pick } from './rng';
import type { DomainEvent, GameState, Isle, Lane, LordInit, RuleError } from './types';
import { foundLord, getLord, recomputeBeacon } from './world';

export type JoinResult =
  | { ok: true; townId: number; events: DomainEvent[] }
  | { ok: false; error: RuleError; events: DomainEvent[] };

export function outerRing(state: GameState): number {
  return Math.max(...state.isles.map((isle) => isle.ring));
}

/** Outer-ring isles where nobody owns a town yet. */
function freeStartIsles(state: GameState): Isle[] {
  const ring = outerRing(state);
  return state.isles.filter(
    (isle) => isle.ring === ring && isle.townIds.every((id) => state.towns[id]?.owner === null),
  );
}

/** Existing lanes are kept, so a route that was open stays open after the map grows. */
function mergeLanes(old: Lane[], fresh: Lane[]): Lane[] {
  const byKey = new Map<string, Lane>();
  for (const lane of [...old, ...fresh]) byKey.set(`${lane.a}-${lane.b}`, lane);
  return [...byKey.values()].sort((p, q) => p.a - q.a || p.b - q.b);
}

/** Adds a ring of neutral isles outside the current outer ring. */
export function expandMap(state: GameState, at: number, events: DomainEvent[]): Isle[] {
  const cfg = state.config;
  const ring = outerRing(state);
  const current = state.isles.filter((isle) => isle.ring === ring);
  const meanRadius =
    current.reduce((sum, isle) => sum + Math.sqrt(isle.pos.x * isle.pos.x + isle.pos.y * isle.pos.y), 0) /
    Math.max(1, current.length);
  const radius = meanRadius + cfg.map.growth.ringSpacing;
  const count = Math.max(1, Math.round((2 * Math.PI * radius) / cfg.map.growth.isleSpacing));
  const added = addRing(
    cfg,
    state.rng,
    state.isles,
    state.towns,
    ring + 1,
    radius,
    count,
    cfg.map.growth.tiers,
  );
  state.lanes = mergeLanes(state.lanes, buildLanes(cfg, state.isles));
  events.push({ type: 'MAP_EXPANDED', at, isleIds: added.map((isle) => isle.id) });
  return added;
}

/** A lord entering a running season gets a capital on a free outer isle, growing the map if needed. */
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
  accrueTo(state, at);
  let candidates = freeStartIsles(state);
  if (candidates.length === 0) {
    expandMap(state, at, events);
    candidates = freeStartIsles(state);
  }
  const isle = pick(state.rng, candidates);
  const town = state.towns[isle.townIds[0] ?? -1];
  if (!town) throw new Error('start isle without towns');
  const personality = init.isBot ? (init.personality ?? pick(state.rng, PERSONALITIES)) : null;
  foundLord(state, init, town, personality);
  recomputeBeacon(state, isle.id, at, events);
  if (init.isBot) scheduleFirstBotTurn(state, init.id, at);
  events.push({ type: 'LORD_JOINED', at, lordId: init.id, townId: town.id });
  return { ok: true, townId: town.id, events };
}

/** Cosmetic only; unknown styles are ignored. */
export function setStyle(state: GameState, lordId: string, style: string, at: number): DomainEvent[] {
  const lord = getLord(state, lordId);
  if (!lord || !state.config.cosmetics.styles.some((s) => s.id === style)) return [];
  lord.style = style;
  return [{ type: 'STYLE_CHANGED', at, lordId, style }];
}
